import { PayoutsService } from './payouts.service';

function makeRepo() {
  return {
    findMany: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
}

describe('PayoutsService.getStatement', () => {
  let service: PayoutsService;
  let orderRepository: ReturnType<typeof makeRepo>;
  let paymentRepository: ReturnType<typeof makeRepo>;
  let refundRepository: ReturnType<typeof makeRepo>;
  let restaurantRepository: ReturnType<typeof makeRepo>;
  let payoutRepository: ReturnType<typeof makeRepo>;
  let merchantAdjustmentRepository: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    orderRepository = makeRepo();
    paymentRepository = makeRepo();
    refundRepository = makeRepo();
    restaurantRepository = makeRepo();
    payoutRepository = makeRepo();
    merchantAdjustmentRepository = makeRepo();

    // Sensible defaults so a test that doesn't care about a given
    // collection doesn't have to stub it.
    restaurantRepository.findOne.mockResolvedValue({
      _id: 'r1',
      name: 'Test Restaurant',
      commissionRate: 0.15,
      payoutDestination: { bankAccount: '123' },
    });
    payoutRepository.findMany.mockResolvedValue([]);
    orderRepository.findMany.mockResolvedValue([]);
    paymentRepository.findMany.mockResolvedValue([]);
    refundRepository.findMany.mockResolvedValue([]);
    merchantAdjustmentRepository.findMany.mockResolvedValue([]);

    service = new PayoutsService(
      orderRepository as any,
      paymentRepository as any,
      refundRepository as any,
      restaurantRepository as any,
      payoutRepository as any,
      merchantAdjustmentRepository as any,
    );
  });

  it('starts the window at the last completed payout, not at the epoch', async () => {
    payoutRepository.findMany.mockResolvedValue([
      { periodEnd: new Date('2026-07-01T21:00:00Z'), status: 'completed' },
    ]);
    orderRepository.findMany.mockResolvedValue([]);

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.periodStart).toEqual(new Date('2026-07-01T21:00:00Z'));
    // The order query is shifted back by the hold, not by nothing.
    const filters = orderRepository.findMany.mock.calls[0][0].filters;
    expect(filters.deliveredAt.$lt).toEqual(
      new Date('2026-07-24T21:00:00Z'), // periodEnd minus 7 days
    );
  });

  it('cuts the period at Cairo midnight, not UTC midnight', async () => {
    payoutRepository.findMany.mockResolvedValue([]);
    orderRepository.findMany.mockResolvedValue([]);

    const statement = await service.getStatement('r1', '2026-08-01');

    // cutoffDate is the exclusive end, and Cairo is UTC+3 in August, so the
    // boundary is 21:00 UTC on 31 July — not 2026-08-01T00:00:00Z.
    expect(statement.periodEnd).toEqual(new Date('2026-07-31T21:00:00Z'));
  });

  it('includes a delivered order that was partially refunded', async () => {
    // statusAfterRefund moves it off DELIVERED. Filtering on DELIVERED alone
    // would drop the order entirely and the merchant would never be paid for
    // the part that was not refunded.
    orderRepository.findMany.mockResolvedValue([]);

    await service.getStatement('r1', '2026-08-01');

    const filters = orderRepository.findMany.mock.calls[0][0].filters;
    expect(filters.status.$in).toEqual(
      expect.arrayContaining(['Delivered', 'Partially Refunded', 'Refunded']),
    );
  });

  it('excludes a sale still inside the hold period', async () => {
    // Delivered one day before the cutoff, hold is 7 days — must not appear
    // yet. The mock honours the filter, so this fails if the hold is dropped.
    const orders = [
      {
        _id: 'o1',
        restaurantId: 'r1',
        groupOrderId: 'g1',
        paymentMethod: 'Card',
        finalTotalPrice: 200,
        commissionCents: 3_000,
        deliveredAt: new Date('2026-07-30T21:00:00Z'),
        status: 'Delivered',
      },
    ];
    orderRepository.findMany.mockImplementation(async ({ filters }: any) =>
      filters.deliveredAt
        ? orders.filter((o) => o.deliveredAt < filters.deliveredAt.$lt)
        : [],
    );
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: 'g1', purpose: 'order', status: 'paid' },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    const filters = orderRepository.findMany.mock.calls[0][0].filters;
    expect(filters.deliveredAt.$lt).toEqual(
      new Date('2026-07-24T21:00:00Z'), // periodEnd minus 7 days
    );
    expect(statement.lines).toHaveLength(0);
    expect(statement.totals.merchantNetCents).toBe(0);
  });

  it('filters sales on the payout mark, not on a lower date bound', async () => {
    // A date watermark cannot say "everything before this was settled except
    // that one order", so the sale query has no $gte at all.
    payoutRepository.findMany.mockResolvedValue([
      { periodEnd: new Date('2026-07-01T21:00:00Z'), status: 'completed' },
    ]);

    await service.getStatement('r1', '2026-08-01');

    const filters = orderRepository.findMany.mock.calls[0][0].filters;
    expect(filters.payoutId).toEqual({ $exists: false });
    expect(filters.deliveredAt.$gte).toBeUndefined();
  });

  it('keeps an unpaid delivered order payable once its payment finally settles', async () => {
    // The bug this replaced: the order was flagged on one statement, then the
    // sales window moved past its deliveredAt, so when the late webhook landed
    // it was in no statement's lines and no statement's exceptions — ever.
    const order = {
      _id: 'o1',
      restaurantId: 'r1',
      groupOrderId: 'g1',
      paymentMethod: 'Card',
      finalTotalPrice: 200,
      commissionCents: 3_000,
      deliveredAt: new Date('2026-07-20T10:00:00Z'),
      status: 'Delivered',
    };
    // Honours whatever bounds the service asks for, so a reinstated $gte
    // watermark would drop the order on the second statement and fail here.
    orderRepository.findMany.mockImplementation(async ({ filters }: any) => {
      if (!filters.deliveredAt) return [];
      const { $gte, $lt } = filters.deliveredAt;
      return [order].filter(
        (o) =>
          (!$gte || o.deliveredAt >= $gte) && (!$lt || o.deliveredAt < $lt),
      );
    });
    paymentRepository.findMany.mockResolvedValue([]); // never settled

    const first = await service.getStatement('r1', '2026-08-01');

    expect(first.lines).toHaveLength(0);
    expect(first.exceptions).toContainEqual(
      expect.objectContaining({ kind: 'delivered_unpaid', ref: 'o1' }),
    );

    // That statement is paid — paidThrough is now well past deliveredAt — and
    // only then does the gateway confirm the payment.
    payoutRepository.findMany.mockResolvedValue([
      { periodEnd: new Date('2026-07-31T21:00:00Z'), status: 'completed' },
    ]);
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: 'g1', purpose: 'order', status: 'paid' },
    ]);

    const second = await service.getStatement('r1', '2026-09-01');

    expect(second.lines).toContainEqual(
      expect.objectContaining({ kind: 'sale', ref: 'o1' }),
    );
    expect(second.totals.merchantNetCents).toBe(17_000);
  });

  it('holds a refund back for the same 7 days as the sale it reverses', async () => {
    // Unshifted, the refund lands on the statement before its own sale and the
    // merchant is invoiced for money RestoMind never paid them.
    const orders = [
      {
        _id: 'o1',
        restaurantId: 'r1',
        groupOrderId: 'g1',
        paymentMethod: 'Card',
        finalTotalPrice: 100,
        commissionCents: 1_500,
        deliveredAt: new Date('2026-07-28T10:00:00Z'),
        status: 'Delivered',
      },
    ];
    const refunds = [
      {
        _id: 'f1',
        orderGroupId: 'g1',
        amountCents: 10_000,
        status: 'succeeded',
        completedAt: new Date('2026-07-30T10:00:00Z'),
      },
    ];
    orderRepository.findMany.mockImplementation(async ({ filters }: any) => {
      if (filters.deliveredAt)
        return orders.filter((o) => o.deliveredAt < filters.deliveredAt.$lt);
      if (filters.groupOrderId) return orders;
      return [];
    });
    refundRepository.findMany.mockImplementation(async ({ filters }: any) =>
      filters.completedAt
        ? refunds.filter(
            (r) =>
              r.completedAt >= filters.completedAt.$gte &&
              r.completedAt < filters.completedAt.$lt,
          )
        : [],
    );
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: 'g1', purpose: 'order', status: 'paid' },
    ]);

    const early = await service.getStatement('r1', '2026-07-31');

    expect(early.lines).toHaveLength(0);
    expect(early.decision.action).not.toBe('collect');

    const later = await service.getStatement('r1', '2026-08-10');

    expect(later.lines).toHaveLength(2);
    expect(later.totals.merchantNetCents).toBe(0);
  });

  it('nets cash-on-delivery commission against online sales in one number', async () => {
    orderRepository.findMany.mockResolvedValue([
      {
        _id: 'o1',
        restaurantId: 'r1',
        groupOrderId: 'g1',
        paymentMethod: 'Card',
        finalTotalPrice: 200,
        commissionCents: 3_000,
        deliveredAt: new Date('2026-07-20T10:00:00Z'),
        status: 'Delivered',
      },
      {
        _id: 'o2',
        restaurantId: 'r1',
        groupOrderId: 'g2',
        paymentMethod: 'Cash on Delivery',
        finalTotalPrice: 100,
        commissionCents: 1_500,
        deliveredAt: new Date('2026-07-20T10:00:00Z'),
        status: 'Delivered',
      },
    ]);
    // Only the card order's group was actually paid; the cash one has no
    // gateway payment and must not need one.
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: 'g1', purpose: 'order', status: 'paid' },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    // 20000 - 3000 online, minus 1500 commission owed on the cash sale.
    expect(statement.totals.merchantNetCents).toBe(15_500);
    expect(statement.decision).toEqual({
      action: 'pay',
      direction: 'to_merchant',
    });
  });

  it('counts only refunds that actually moved money', async () => {
    refundRepository.findMany.mockResolvedValue([]);
    const statement = await service.getStatement('r1', '2026-08-01');
    const filters = refundRepository.findMany.mock.calls[0][0].filters;
    expect(filters.status).toBe('succeeded');
  });

  it('attributes a group refund to this restaurant only for its share', async () => {
    // Group of two restaurants, 100 EGP refunded, this one holds 60% of it.
    orderRepository.findMany
      .mockResolvedValueOnce([]) // sales in window
      .mockResolvedValueOnce([
        {
          _id: 'a',
          groupOrderId: 'g1',
          restaurantId: 'r1',
          paymentMethod: 'Card',
          finalTotalPrice: 60,
          commissionCents: 900,
          deliveredAt: new Date('2026-07-20T10:00:00Z'),
        },
        {
          _id: 'b',
          groupOrderId: 'g1',
          restaurantId: 'r2',
          paymentMethod: 'Card',
          finalTotalPrice: 40,
          commissionCents: 600,
          deliveredAt: new Date('2026-07-20T10:00:00Z'),
        },
      ]); // group orders for attribution
    refundRepository.findMany.mockResolvedValue([
      {
        _id: 'f1',
        orderGroupId: 'g1',
        orderId: undefined,
        amountCents: 10_000,
        status: 'succeeded',
        completedAt: new Date('2026-07-25T10:00:00Z'),
      },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.lines).toHaveLength(1);
    expect(statement.lines[0].restaurantId).toBe('r1');
    expect(statement.lines[0].grossCents).toBe(-6_000);
  });

  it('reports a delivered online order with no settled payment as an exception', async () => {
    orderRepository.findMany.mockResolvedValue([
      {
        _id: 'o9',
        restaurantId: 'r1',
        paymentMethod: 'Card',
        finalTotalPrice: 50,
        commissionCents: 750,
        deliveredAt: new Date('2026-07-20T10:00:00Z'),
        status: 'Delivered',
      },
    ]);
    paymentRepository.findMany.mockResolvedValue([]); // nothing paid

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.lines).toHaveLength(0);
    expect(statement.exceptions).toContainEqual(
      expect.objectContaining({ kind: 'delivered_unpaid', ref: 'o9' }),
    );
  });

  it('treats a delivered online order with no group id as unpaid, not as paid', async () => {
    // groupOrderId is optional on Order and legacy rows lack it. Matched into
    // an $in against a payment that also lacks one, the order would be paid
    // out on a String(undefined) collision.
    orderRepository.findMany.mockResolvedValue([
      {
        _id: 'o8',
        restaurantId: 'r1',
        paymentMethod: 'Card',
        finalTotalPrice: 50,
        commissionCents: 750,
        deliveredAt: new Date('2026-07-20T10:00:00Z'),
        status: 'Delivered',
      },
    ]);
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: undefined, purpose: 'order', status: 'paid' },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.lines).toHaveLength(0);
    expect(statement.exceptions).toContainEqual(
      expect.objectContaining({ kind: 'delivered_unpaid', ref: 'o8' }),
    );
  });

  it('reports a stuck group refund at this restaurant’s share only', async () => {
    refundRepository.findMany
      .mockResolvedValueOnce([]) // succeeded refunds in the window
      .mockResolvedValueOnce([
        {
          _id: 'stuck1',
          orderGroupId: 'g9',
          amountCents: 10_000,
          status: 'failed',
        },
        {
          _id: 'stuck2',
          orderGroupId: 'g8',
          orderId: 'oC',
          amountCents: 4_000,
          status: 'failed',
        },
      ]); // the stuck sweep
    orderRepository.findMany
      .mockResolvedValueOnce([]) // sales in window
      .mockResolvedValueOnce([]) // orphan sweep
      .mockResolvedValueOnce([
        {
          _id: 'oA',
          groupOrderId: 'g9',
          restaurantId: 'r1',
          paymentMethod: 'Card',
          finalTotalPrice: 60,
          commissionCents: 900,
        },
        {
          _id: 'oB',
          groupOrderId: 'g9',
          restaurantId: 'r2',
          paymentMethod: 'Card',
          finalTotalPrice: 40,
          commissionCents: 600,
        },
        {
          _id: 'oC',
          groupOrderId: 'g8',
          restaurantId: 'r2',
          paymentMethod: 'Card',
          finalTotalPrice: 50,
          commissionCents: 750,
        },
      ]); // every order in the stuck refunds' groups
    // Note: these orders deliberately carry no deliveredAt. A stuck refund on
    // an order cancelled before delivery is still customer money RestoMind
    // holds, so it must be reported even though it produces no ledger line.

    const statement = await service.getStatement('r1', '2026-08-01');

    // 60% of the group, not the group's 10 000.
    expect(statement.exceptions).toContainEqual(
      expect.objectContaining({
        kind: 'refund_stuck',
        ref: 'stuck1',
        amountCents: 6_000,
      }),
    );
    // r2's own stuck refund is r2's problem and must not block r1.
    expect(statement.exceptions).not.toContainEqual(
      expect.objectContaining({ ref: 'stuck2' }),
    );
  });

  it('reports a settled payment whose order never resolved as an exception', async () => {
    // RestoMind is holding this customer's money with nothing to show for it.
    // It is not merchant float and must not be mistaken for it.
    // No refunds, so collectRefunds returns before touching orderRepository:
    // call 1 is the sales window, call 2 is the orphan sweep.
    refundRepository.findMany.mockResolvedValue([]);
    orderRepository.findMany
      .mockResolvedValueOnce([]) // sales in window
      .mockResolvedValueOnce([
        {
          _id: 'o7',
          groupOrderId: 'g7',
          status: 'Preparing',
          finalTotalPrice: 80,
          createdAt: new Date('2026-06-01T10:00:00Z'),
        },
      ]); // stale, paid, unresolved
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: 'g7', status: 'paid', amountCents: 8_000 },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.exceptions).toContainEqual(
      expect.objectContaining({ kind: 'paid_undelivered', ref: 'o7' }),
    );
  });

  it('blocks payment when the merchant has no payout destination', async () => {
    restaurantRepository.findOne.mockResolvedValue({
      _id: 'r1',
      commissionRate: 0.15,
    });
    orderRepository.findMany.mockResolvedValue([
      {
        _id: 'o1',
        restaurantId: 'r1',
        groupOrderId: 'g1',
        paymentMethod: 'Card',
        finalTotalPrice: 200,
        commissionCents: 3_000,
        deliveredAt: new Date('2026-07-20T10:00:00Z'),
        status: 'Delivered',
      },
    ]);
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: 'g1', purpose: 'order', status: 'paid' },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.decision).toEqual({
      action: 'blocked',
      reason: 'no_payout_destination',
    });
  });
});

describe('PayoutsService settlement', () => {
  let service: PayoutsService;
  let orderRepository: ReturnType<typeof makeRepo>;
  let payoutRepository: ReturnType<typeof makeRepo>;
  let merchantAdjustmentRepository: ReturnType<typeof makeRepo>;

  /** A statement in whatever state the test under it needs. */
  function statementOf(over: Record<string, any>) {
    return {
      restaurantId: 'r1',
      restaurantName: 'Test Restaurant',
      periodStart: new Date(0),
      periodEnd: new Date('2026-08-01T21:00:00Z'),
      lines: [],
      totals: {
        grossCents: 0,
        commissionCents: 0,
        commissionNetCents: 0,
        commissionVatCents: 0,
        merchantNetCents: 0,
      },
      exceptions: [],
      ...over,
    } as any;
  }

  beforeEach(() => {
    orderRepository = makeRepo();
    payoutRepository = makeRepo();
    merchantAdjustmentRepository = makeRepo();
    payoutRepository.findMany.mockResolvedValue([]);

    service = new PayoutsService(
      orderRepository as any,
      makeRepo() as any,
      makeRepo() as any,
      makeRepo() as any,
      payoutRepository as any,
      merchantAdjustmentRepository as any,
    );
  });

  describe('recordPayout', () => {
    it('refuses to record a payout for a statement that is not payable', async () => {
      jest.spyOn(service, 'getStatement').mockResolvedValue(
        statementOf({
          totals: { merchantNetCents: 100 },
          decision: { action: 'carry', reason: 'below_minimum' },
        }),
      );

      await expect(
        service.recordPayout('r1', { cutoffDate: '2026-08-01' } as any, 'u1'),
      ).rejects.toThrow(/below_minimum/);
      expect(payoutRepository.create).not.toHaveBeenCalled();
    });

    it('says "already settled", not "below minimum", on a second attempt', async () => {
      // Once a period is settled its orders carry a payoutId, so the statement
      // comes back empty and the naive answer would be `below_minimum` — which
      // tells ops the merchant is owed too little when they were already paid.
      payoutRepository.findOne.mockResolvedValue({ _id: 'p1', status: 'pending' });
      jest.spyOn(service, 'getStatement').mockResolvedValue(
        statementOf({
          totals: { merchantNetCents: 0 },
          decision: { action: 'carry', reason: 'below_minimum' },
        }),
      );

      await expect(
        service.recordPayout(
          'r1',
          { cutoffDate: '2026-08-01', amountCents: 0 } as any,
          'u1',
        ),
      ).rejects.toThrow(/already been settled/);
      expect(payoutRepository.create).not.toHaveBeenCalled();
    });

    it('refuses when the recorded amount disagrees with the statement', async () => {
      // Ops typing a different number than the statement says is a mistake, not
      // an override — the two must be reconciled before money moves.
      jest.spyOn(service, 'getStatement').mockResolvedValue(
        statementOf({
          totals: {
            merchantNetCents: 20_000,
            commissionNetCents: 0,
            commissionVatCents: 0,
          },
          decision: { action: 'pay', direction: 'to_merchant' },
        }),
      );

      await expect(
        service.recordPayout(
          'r1',
          { cutoffDate: '2026-08-01', amountCents: 19_000 } as any,
          'u1',
        ),
      ).rejects.toThrow(/does not match/);
      expect(payoutRepository.create).not.toHaveBeenCalled();
    });

    it('snapshots the statement lines onto the payout', async () => {
      const lines = [{ kind: 'sale', ref: 'o1', merchantNetCents: 20_000 }];
      jest.spyOn(service, 'getStatement').mockResolvedValue(
        statementOf({
          totals: {
            merchantNetCents: 20_000,
            commissionNetCents: 2_632,
            commissionVatCents: 368,
          },
          decision: { action: 'pay', direction: 'to_merchant' },
          lines,
        }),
      );
      payoutRepository.create.mockImplementation(async (doc: any) => ({
        ...doc,
        _id: 'p1',
      }));

      const payout: any = await service.recordPayout(
        'r1',
        {
          cutoffDate: '2026-08-01',
          amountCents: 20_000,
          reference: 'NBE-991',
        } as any,
        'u1',
      );

      expect(payout.lines).toEqual(lines);
      expect(payout.amountCents).toBe(20_000);
      expect(payout.direction).toBe('to_merchant');
      expect(payout.status).toBe('pending');
    });

    it('turns a duplicate-key error into a clear double-payment refusal', async () => {
      jest.spyOn(service, 'getStatement').mockResolvedValue(
        statementOf({
          totals: {
            merchantNetCents: 20_000,
            commissionNetCents: 0,
            commissionVatCents: 0,
          },
          decision: { action: 'pay', direction: 'to_merchant' },
        }),
      );
      payoutRepository.create.mockRejectedValue({ code: 11000 });

      await expect(
        service.recordPayout(
          'r1',
          { cutoffDate: '2026-08-01', amountCents: 20_000 } as any,
          'u1',
        ),
      ).rejects.toThrow(/already been settled/);
      // The payout never existed, so nothing may have been marked settled.
      expect(orderRepository.updateMany).not.toHaveBeenCalled();
    });

    it('records a negative statement as a collection from the merchant', async () => {
      jest.spyOn(service, 'getStatement').mockResolvedValue(
        statementOf({
          totals: {
            merchantNetCents: -7_500,
            commissionNetCents: 0,
            commissionVatCents: 0,
          },
          decision: { action: 'collect', direction: 'from_merchant' },
        }),
      );
      payoutRepository.create.mockImplementation(async (doc: any) => ({
        ...doc,
        _id: 'p1',
      }));

      const payout: any = await service.recordPayout(
        'r1',
        { cutoffDate: '2026-08-01', amountCents: 7_500 } as any,
        'u1',
      );

      expect(payout.direction).toBe('from_merchant');
      expect(payout.amountCents).toBe(7_500);
    });

    it('stamps the payout onto its sale orders, and onto nothing else', async () => {
      // Without this stamp collectSales re-offers every settled order on the
      // next statement and the merchant is paid twice. A refund line's ref is a
      // Refund id and an adjustment's a MerchantAdjustment id — stamping either
      // writes an Order key onto the wrong collection.
      jest.spyOn(service, 'getStatement').mockResolvedValue(
        statementOf({
          totals: {
            merchantNetCents: 20_000,
            commissionNetCents: 0,
            commissionVatCents: 0,
          },
          decision: { action: 'pay', direction: 'to_merchant' },
          lines: [
            { kind: 'sale', ref: 'o1', merchantNetCents: 25_000 },
            { kind: 'sale', ref: 'o2', merchantNetCents: 500 },
            { kind: 'refund', ref: 'f1', merchantNetCents: -5_000 },
            { kind: 'adjustment', ref: 'a1', merchantNetCents: -500 },
          ],
        }),
      );
      payoutRepository.create.mockImplementation(async (doc: any) => ({
        ...doc,
        _id: 'p1',
      }));

      await service.recordPayout(
        'r1',
        { cutoffDate: '2026-08-01', amountCents: 20_000 } as any,
        'u1',
      );

      expect(orderRepository.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['o1', 'o2'] } },
        { $set: { payoutId: 'p1' } },
      );
    });
  });

  describe('completePayout', () => {
    it('marks a pending payout completed and stamps the time', async () => {
      payoutRepository.findOne.mockResolvedValue({
        _id: 'p1',
        status: 'pending',
      });
      payoutRepository.update.mockImplementation(async ({ body }: any) => body);

      const result: any = await service.completePayout(
        'p1',
        { reference: 'NBE-991' } as any,
        'u1',
      );

      expect(result.status).toBe('completed');
      expect(result.completedAt).toBeInstanceOf(Date);
      // A landed transfer keeps its orders settled.
      expect(orderRepository.updateMany).not.toHaveBeenCalled();
    });

    it('does not advance the paid-through mark when a transfer fails', async () => {
      payoutRepository.findOne.mockResolvedValue({
        _id: 'p1',
        status: 'pending',
      });
      payoutRepository.update.mockImplementation(async ({ body }: any) => body);

      const result: any = await service.completePayout(
        'p1',
        { failureReason: 'IBAN rejected' } as any,
        'u1',
      );

      expect(result.status).toBe('failed');
      expect(result.completedAt).toBeUndefined();
    });

    it('makes the orders payable again when the transfer bounced', async () => {
      // $unset, not null — collectSales filters on $exists: false, and a null
      // field still exists, so the money would be stranded.
      payoutRepository.findOne.mockResolvedValue({
        _id: 'p1',
        status: 'pending',
      });
      payoutRepository.update.mockImplementation(async ({ body }: any) => body);

      await service.completePayout(
        'p1',
        { failureReason: 'IBAN rejected' } as any,
        'u1',
      );

      expect(orderRepository.updateMany).toHaveBeenCalledWith(
        { payoutId: 'p1' },
        { $unset: { payoutId: '' } },
      );
    });

    it('refuses to re-complete a payout that is already completed', async () => {
      payoutRepository.findOne.mockResolvedValue({
        _id: 'p1',
        status: 'completed',
      });

      await expect(
        service.completePayout('p1', { reference: 'x' } as any, 'u1'),
      ).rejects.toThrow(/already/);
    });
  });

  describe('recordAdjustment', () => {
    it('rejects an adjustment backdated into an already-settled period', async () => {
      payoutRepository.findMany.mockResolvedValue([
        { periodEnd: new Date('2026-08-01T00:00:00Z'), status: 'completed' },
      ]);

      await expect(
        service.recordAdjustment(
          'r1',
          {
            amountCents: -500,
            reason: 'chargeback',
            effectiveAt: '2026-07-15',
          } as any,
          'u1',
        ),
      ).rejects.toThrow(/already settled/);
    });

    it('accepts an adjustment dated after the paid-through mark', async () => {
      payoutRepository.findMany.mockResolvedValue([
        { periodEnd: new Date('2026-08-01T00:00:00Z'), status: 'completed' },
      ]);
      merchantAdjustmentRepository.create.mockImplementation(
        async (doc: any) => doc,
      );

      const adjustment: any = await service.recordAdjustment(
        'r1',
        {
          amountCents: -500,
          reason: 'chargeback',
          effectiveAt: '2026-08-05',
        } as any,
        'u1',
      );

      expect(adjustment.amountCents).toBe(-500);
      // Cairo midnight, not UTC — 21:00 the previous day in August.
      expect(adjustment.effectiveAt).toEqual(new Date('2026-08-04T21:00:00Z'));
    });

    it('rejects a zero adjustment', async () => {
      await expect(
        service.recordAdjustment(
          'r1',
          { amountCents: 0, reason: 'oops' } as any,
          'u1',
        ),
      ).rejects.toThrow();
      expect(merchantAdjustmentRepository.create).not.toHaveBeenCalled();
    });
  });
});
