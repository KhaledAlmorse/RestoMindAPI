import { createHmac } from 'crypto';
import { PaymentPurposeEnum, PaymentStatusEnum } from 'src/Common/Types';
import { buildTransactionHmacString } from './hmac';
import { PaymentsService, pickSettledTransaction } from './payments.service';

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
      { [PaymentPurposeEnum.ORDER]: fulfiller },
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
    service = new PaymentsService(repo as any, {} as any, {} as any, {});
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

describe('PaymentsService late-success auto-refund', () => {
  let service: PaymentsService;
  let repo: ReturnType<typeof makeRepo>;
  let refundRepo: any;
  let paymob: any;

  beforeEach(() => {
    process.env.PAYMOB_HMAC_SECRET = HMAC_SECRET;
    repo = makeRepo({
      _id: 'pay1',
      purpose: PaymentPurposeEnum.ORDER,
      userId: 'u1',
      orderGroupId: 'g1',
      amountCents: 30000,
      currency: 'EGP',
      // The sweeper already expired this and gave the stock back.
      status: PaymentStatusEnum.EXPIRED,
      refundedAmountCents: 0,
      paymobOrderId: 555000,
    });
    const refundStore: any = {
      _id: 'ref1',
      paymentId: 'pay1',
      amountCents: 30000,
      settlementMode: 'gateway',
    };
    refundRepo = {
      create: jest.fn(async (doc: any) => ({ ...doc, _id: 'ref1' })),
      findOne: jest.fn(async () => refundStore),
      update: jest.fn(async ({ body }: any) =>
        Object.assign(refundStore, body),
      ),
    };
    paymob = {
      refundTransaction: jest.fn(async () => ({ id: 777 })),
      voidTransaction: jest.fn(),
    };
    service = new PaymentsService(repo as any, refundRepo, paymob, {});
  });

  it('refunds in full when a success lands on an expired payment', async () => {
    // The stock is gone, so the money must go back — there is nothing left
    // to deliver.
    const outcome = await service.applyTransactionOutcome(
      repo.store as any,
      { id: 991122, success: true, pending: false } as any,
    );

    expect(outcome).toBe('applied');
    expect(refundRepo.create).toHaveBeenCalledTimes(1);
    expect(refundRepo.create.mock.calls[0][0].amountCents).toBe(30000);
    expect(paymob.refundTransaction).toHaveBeenCalledWith(991122, 30000);
    expect(repo.store.refundedAmountCents).toBe(30000);
  });

  it('does not refund twice when the late callback is redelivered', async () => {
    await service.applyTransactionOutcome(
      repo.store as any,
      { id: 991122, success: true, pending: false } as any,
    );
    // Second delivery: paymobTransactionId now matches, so the duplicate
    // guard at the top short-circuits before any refund is created.
    const second = await service.applyTransactionOutcome(
      repo.store as any,
      { id: 991122, success: true, pending: false } as any,
    );

    expect(second).toBe('duplicate');
    expect(refundRepo.create).toHaveBeenCalledTimes(1);
  });

  it('does not auto-refund a failed transaction on an expired payment', async () => {
    await service.applyTransactionOutcome(
      repo.store as any,
      { id: 991122, success: false, pending: false } as any,
    );
    expect(refundRepo.create).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.reconcileByPaymobOrderId', () => {
  const OWNER = 'user-1';
  let repo: ReturnType<typeof makeRepo>;
  let paymob: { getOrderWithTransactions: jest.Mock };
  let fulfiller: { onPaid: jest.Mock; onFailed: jest.Mock };
  let service: PaymentsService;

  beforeEach(() => {
    repo = makeRepo({
      _id: 'pay1',
      userId: OWNER,
      purpose: PaymentPurposeEnum.SUBSCRIPTION,
      amountCents: 30000,
      currency: 'EGP',
      status: PaymentStatusEnum.PENDING,
      refundedAmountCents: 0,
      paymobOrderId: 555000,
    });
    paymob = { getOrderWithTransactions: jest.fn() };
    fulfiller = { onPaid: jest.fn(), onFailed: jest.fn() };
    service = new PaymentsService(repo as any, {} as any, paymob as any, {
      [PaymentPurposeEnum.SUBSCRIPTION]: fulfiller,
    });
  });

  it('settles a payment whose callback never arrived', async () => {
    paymob.getOrderWithTransactions.mockResolvedValue({
      transactions: [{ id: 991122, success: true, pending: false }],
    });

    const result = await service.reconcileByPaymobOrderId(555000, OWNER as any);

    expect(result.status).toBe(PaymentStatusEnum.PAID);
    expect(fulfiller.onPaid).toHaveBeenCalledTimes(1);
  });

  it('refuses to touch a payment belonging to someone else', async () => {
    // The Paymob order id is visible in the return URL, so it must not be
    // usable to settle — or even read — another user's payment.
    await expect(
      service.reconcileByPaymobOrderId(555000, 'user-2' as any),
    ).rejects.toThrow('Payment not found');
    expect(paymob.getOrderWithTransactions).not.toHaveBeenCalled();
  });

  it('does not re-inquire about a payment that is already settled', async () => {
    repo.store.status = PaymentStatusEnum.PAID;
    const result = await service.reconcileByPaymobOrderId(555000, OWNER as any);
    expect(result.status).toBe(PaymentStatusEnum.PAID);
    expect(paymob.getOrderWithTransactions).not.toHaveBeenCalled();
  });

  it('leaves the payment pending when the inquiry itself fails', async () => {
    // An unreachable gateway is not evidence of non-payment; expiring here
    // would cancel an order the customer may well have paid for.
    paymob.getOrderWithTransactions.mockRejectedValue(new Error('network'));
    const result = await service.reconcileByPaymobOrderId(555000, OWNER as any);
    expect(result.status).toBe(PaymentStatusEnum.PENDING);
    expect(fulfiller.onPaid).not.toHaveBeenCalled();
  });

  it('stays pending while the transaction is still in flight', async () => {
    paymob.getOrderWithTransactions.mockResolvedValue({
      transactions: [{ id: 991122, success: false, pending: true }],
    });
    const result = await service.reconcileByPaymobOrderId(555000, OWNER as any);
    expect(result.status).toBe(PaymentStatusEnum.PENDING);
    expect(fulfiller.onFailed).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.executeRefund with OFFLINE settlement', () => {
  let service: PaymentsService;
  let refundRepo: any;

  function makeRefundStore(overrides: Record<string, any> = {}) {
    return {
      _id: 'ref1',
      amountCents: 10000,
      settlementMode: 'offline',
      ...overrides,
    };
  }

  beforeEach(() => {
    refundRepo = {
      findOne: jest.fn(async () => makeRefundStore()),
      update: jest.fn(async ({ body }: any) => {
        return Object.assign(makeRefundStore(), body);
      }),
    };
    service = new PaymentsService({} as any, refundRepo, {} as any, {});
  });

  it('succeeds an OFFLINE refund when orderWasDelivered is false', async () => {
    refundRepo.findOne = jest.fn(async () =>
      makeRefundStore({ orderWasDelivered: false }),
    );
    const status = await service.executeRefund('ref1' as any);
    expect(status).toBe('succeeded');
    expect(refundRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { _id: 'ref1' },
      }),
    );
    // Verify that the settle call received the SUCCEEDED status and empty metadata
    expect(refundRepo.update.mock.calls[0][0].body).toMatchObject({
      status: 'succeeded',
    });
  });

  it('requires manual settlement when orderWasDelivered is true', async () => {
    refundRepo.findOne = jest.fn(async () =>
      makeRefundStore({ orderWasDelivered: true }),
    );
    const status = await service.executeRefund('ref1' as any);
    expect(status).toBe('manual_required');
    expect(refundRepo.update).toHaveBeenCalled();
    // Verify that the settle call received MANUAL_REQUIRED status with gatewayError
    const updateCall = refundRepo.update.mock.calls[0][0];
    expect(updateCall.body?.status).toBe('manual_required');
    expect(updateCall.body?.gatewayError).toBe(
      'Cash on delivery — settle offline with the customer',
    );
  });

  it('requires manual settlement when orderWasDelivered is undefined', async () => {
    refundRepo.findOne = jest.fn(async () =>
      makeRefundStore({ orderWasDelivered: undefined }),
    );
    const status = await service.executeRefund('ref1' as any);
    expect(status).toBe('manual_required');
    expect(refundRepo.update).toHaveBeenCalled();
    // Verify that the settle call received MANUAL_REQUIRED status with gatewayError
    const updateCall = refundRepo.update.mock.calls[0][0];
    expect(updateCall.body?.status).toBe('manual_required');
    expect(updateCall.body?.gatewayError).toBe(
      'Cash on delivery — settle offline with the customer',
    );
  });
});

describe('pickSettledTransaction', () => {
  const txn = (over: Record<string, any>) =>
    ({ id: 1, success: false, pending: false, ...over }) as any;

  it('prefers the successful attempt over an earlier decline', () => {
    // Two cards, one declined, one approved — and no guaranteed order in the
    // response. Reading the decline would cancel a paid order.
    const picked = pickSettledTransaction([
      txn({ id: 1, success: false }),
      txn({ id: 2, success: true }),
    ]);
    expect(picked?.id).toBe(2);
  });

  it('ignores refunds and captures booked against the same order', () => {
    const picked = pickSettledTransaction([
      txn({ id: 9, success: true, has_parent_transaction: true }),
    ]);
    expect(picked).toBeUndefined();
  });

  it('ignores transactions still in flight', () => {
    expect(pickSettledTransaction([txn({ pending: true })])).toBeUndefined();
  });

  it('reports the failure when every attempt failed', () => {
    const picked = pickSettledTransaction([txn({ id: 3, success: false })]);
    expect(picked?.id).toBe(3);
    expect(picked?.success).toBe(false);
  });
});
