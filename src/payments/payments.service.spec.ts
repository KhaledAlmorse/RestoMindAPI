import { createHmac } from 'crypto';
import { PaymentPurposeEnum, PaymentStatusEnum } from 'src/Common/Types';
import { buildTransactionHmacString } from './hmac';
import { PaymentsService } from './payments.service';

const HMAC_SECRET = 'test_hmac_secret';

function makeCallbackObj(overrides: Record<string, any> = {}) {
  return {
    amount_cents: 30000,
    created_at: '2026-08-05T10:00:00.000000',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 991122,
    integration_id: 5752819,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 555000 },
    owner: 4705,
    pending: false,
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    success: true,
    ...overrides,
  };
}

function sign(obj: Record<string, any>): string {
  return createHmac('sha512', HMAC_SECRET)
    .update(buildTransactionHmacString(obj))
    .digest('hex');
}

/**
 * In-memory stand-in for PaymentRepository. findOneAndUpdate emulates
 * MongoDB's conditional-update semantics: when the filter does not match,
 * nothing is written and null is returned.
 */
function makeRepo(initial: Record<string, any>) {
  const store: Record<string, any> = { ...initial };
  return {
    store,
    findOne: jest.fn(async () => store),
    create: jest.fn(async (doc: any) => ({ ...doc, _id: 'new' })),
    update: jest.fn(async ({ body }: any) => {
      Object.assign(store, body);
      return store;
    }),
    findOneAndUpdate: jest.fn(async ({ filters, updateData }: any) => {
      const guard = filters?.refundedAmountCents?.$lte;
      if (guard !== undefined && !(store.refundedAmountCents <= guard)) {
        return null;
      }
      if (updateData?.$inc?.refundedAmountCents) {
        store.refundedAmountCents += updateData.$inc.refundedAmountCents;
      }
      return store;
    }),
  };
}

describe('PaymentsService.processCallback', () => {
  let service: PaymentsService;
  let repo: ReturnType<typeof makeRepo>;
  let fulfiller: { onPaid: jest.Mock; onFailed: jest.Mock };

  beforeEach(() => {
    process.env.PAYMOB_HMAC_SECRET = HMAC_SECRET;
    repo = makeRepo({
      _id: 'pay1',
      purpose: PaymentPurposeEnum.ORDER,
      amountCents: 30000,
      currency: 'EGP',
      status: PaymentStatusEnum.PENDING,
      refundedAmountCents: 0,
      paymobOrderId: 555000,
    });
    fulfiller = { onPaid: jest.fn(), onFailed: jest.fn() };
    service = new PaymentsService(
      repo as any,
      {} as any, // RefundRepository — unused on this path
      {} as any, // PaymobService — unused on this path
      { [PaymentPurposeEnum.ORDER]: fulfiller } as any,
    );
  });

  it('rejects a payload whose HMAC does not verify, changing no state', async () => {
    const result = await service.processCallback(makeCallbackObj(), 'deadbeef');
    expect(result).toBe('rejected');
    expect(repo.store.status).toBe(PaymentStatusEnum.PENDING);
    expect(fulfiller.onPaid).not.toHaveBeenCalled();
  });

  it('rejects a verified payload whose amount does not match the payment', async () => {
    // The "paid 1 piaster for a 300 EGP order" case: a genuinely signed
    // callback from a different, cheaper intention must never fulfil this one.
    const obj = makeCallbackObj({ amount_cents: 100 });
    expect(await service.processCallback(obj, sign(obj))).toBe('rejected');
    expect(fulfiller.onPaid).not.toHaveBeenCalled();
    expect(repo.store.status).toBe(PaymentStatusEnum.PENDING);
  });

  it('rejects a currency mismatch', async () => {
    const obj = makeCallbackObj({ currency: 'USD' });
    expect(await service.processCallback(obj, sign(obj))).toBe('rejected');
    expect(fulfiller.onPaid).not.toHaveBeenCalled();
  });

  it('marks the payment paid and calls the fulfiller on success', async () => {
    const obj = makeCallbackObj();
    expect(await service.processCallback(obj, sign(obj))).toBe('applied');
    expect(repo.store.status).toBe(PaymentStatusEnum.PAID);
    expect(repo.store.paymobTransactionId).toBe(991122);
    expect(fulfiller.onPaid).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when Paymob retries the same transaction', async () => {
    const obj = makeCallbackObj();
    await service.processCallback(obj, sign(obj));
    expect(await service.processCallback(obj, sign(obj))).toBe('duplicate');
    expect(fulfiller.onPaid).toHaveBeenCalledTimes(1);
  });

  it('marks the payment failed and calls onFailed when success is false', async () => {
    const obj = makeCallbackObj({ success: false, pending: false });
    expect(await service.processCallback(obj, sign(obj))).toBe('applied');
    expect(repo.store.status).toBe(PaymentStatusEnum.FAILED);
    expect(fulfiller.onFailed).toHaveBeenCalledTimes(1);
  });

  it('ignores a still-pending transaction without fulfilling either way', async () => {
    const obj = makeCallbackObj({ success: false, pending: true });
    await service.processCallback(obj, sign(obj));
    expect(repo.store.status).toBe(PaymentStatusEnum.PENDING);
    expect(fulfiller.onPaid).not.toHaveBeenCalled();
    expect(fulfiller.onFailed).not.toHaveBeenCalled();
  });

  it('reports unknown_payment when no payment matches the paymob order id', async () => {
    repo.findOne = jest.fn(async () => null) as any;
    const obj = makeCallbackObj();
    expect(await service.processCallback(obj, sign(obj))).toBe(
      'unknown_payment',
    );
  });
});

describe('PaymentsService refund reservation', () => {
  let service: PaymentsService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo({
      _id: 'pay1',
      purpose: PaymentPurposeEnum.ORDER,
      amountCents: 30000,
      currency: 'EGP',
      status: PaymentStatusEnum.PAID,
      refundedAmountCents: 0,
    });
    service = new PaymentsService(repo as any, {} as any, {} as any, {} as any);
  });

  it('allows a partial refund within the paid amount', async () => {
    expect(await service.reserveRefund('pay1' as any, 10000)).toBe(true);
    expect(repo.store.refundedAmountCents).toBe(10000);
  });

  it('allows successive partials that exactly exhaust the payment', async () => {
    expect(await service.reserveRefund('pay1' as any, 20000)).toBe(true);
    expect(await service.reserveRefund('pay1' as any, 10000)).toBe(true);
    expect(repo.store.refundedAmountCents).toBe(30000);
  });

  it('refuses the refund that would exceed the amount paid', async () => {
    expect(await service.reserveRefund('pay1' as any, 20000)).toBe(true);
    expect(await service.reserveRefund('pay1' as any, 20000)).toBe(false);
    // The rejected attempt must not have moved the counter.
    expect(repo.store.refundedAmountCents).toBe(20000);
  });

  it('refuses a refund larger than the payment outright', async () => {
    expect(await service.reserveRefund('pay1' as any, 30001)).toBe(false);
    expect(repo.store.refundedAmountCents).toBe(0);
  });

  it('refuses any refund once the payment is fully refunded', async () => {
    expect(await service.reserveRefund('pay1' as any, 30000)).toBe(true);
    expect(await service.reserveRefund('pay1' as any, 1)).toBe(false);
    expect(repo.store.refundedAmountCents).toBe(30000);
  });

  it('releases a reservation back when the gateway definitively rejects', async () => {
    await service.reserveRefund('pay1' as any, 10000);
    await service.releaseRefundReservation('pay1' as any, 10000);
    expect(repo.store.refundedAmountCents).toBe(0);
  });
});
