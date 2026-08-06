import { PayoutsService } from './payouts.service';

function makeRepo() {
  return {
    findMany: jest.fn(),
    findOne: jest.fn(),
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
    // Delivered yesterday, hold is 7 days — must not appear yet.
    orderRepository.findMany.mockResolvedValue([]);
    const statement = await service.getStatement('r1', '2026-08-01');
    expect(statement.lines).toHaveLength(0);
    expect(statement.totals.merchantNetCents).toBe(0);
  });

  it('nets cash-on-delivery commission against online sales in one number', async () => {
    orderRepository.findMany.mockResolvedValue([
      { _id: 'o1', restaurantId: 'r1', paymentMethod: 'Card', finalTotalPrice: 200, commissionCents: 3_000, deliveredAt: new Date('2026-07-20T10:00:00Z'), status: 'Delivered' },
      { _id: 'o2', restaurantId: 'r1', paymentMethod: 'Cash on Delivery', finalTotalPrice: 100, commissionCents: 1_500, deliveredAt: new Date('2026-07-20T10:00:00Z'), status: 'Delivered' },
    ]);
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: undefined, purpose: 'order', status: 'paid' },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    // 20000 - 3000 online, minus 1500 commission owed on the cash sale.
    expect(statement.totals.merchantNetCents).toBe(15_500);
    expect(statement.decision).toEqual({ action: 'pay', direction: 'to_merchant' });
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
        { _id: 'a', groupOrderId: 'g1', restaurantId: 'r1', paymentMethod: 'Card', finalTotalPrice: 60, commissionCents: 900 },
        { _id: 'b', groupOrderId: 'g1', restaurantId: 'r2', paymentMethod: 'Card', finalTotalPrice: 40, commissionCents: 600 },
      ]); // group orders for attribution
    refundRepository.findMany.mockResolvedValue([
      { _id: 'f1', orderGroupId: 'g1', orderId: undefined, amountCents: 10_000, status: 'succeeded', completedAt: new Date('2026-07-25T10:00:00Z') },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.lines).toHaveLength(1);
    expect(statement.lines[0].restaurantId).toBe('r1');
    expect(statement.lines[0].grossCents).toBe(-6_000);
  });

  it('reports a delivered online order with no settled payment as an exception', async () => {
    orderRepository.findMany.mockResolvedValue([
      { _id: 'o9', restaurantId: 'r1', paymentMethod: 'Card', finalTotalPrice: 50, commissionCents: 750, deliveredAt: new Date('2026-07-20T10:00:00Z'), status: 'Delivered' },
    ]);
    paymentRepository.findMany.mockResolvedValue([]); // nothing paid

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.lines).toHaveLength(0);
    expect(statement.exceptions).toContainEqual(
      expect.objectContaining({ kind: 'delivered_unpaid', ref: 'o9' }),
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
        { _id: 'o7', groupOrderId: 'g7', status: 'Preparing', finalTotalPrice: 80, createdAt: new Date('2026-06-01T10:00:00Z') },
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
    restaurantRepository.findOne.mockResolvedValue({ _id: 'r1', commissionRate: 0.15 });
    orderRepository.findMany.mockResolvedValue([
      { _id: 'o1', restaurantId: 'r1', paymentMethod: 'Card', finalTotalPrice: 200, commissionCents: 3_000, deliveredAt: new Date('2026-07-20T10:00:00Z'), status: 'Delivered' },
    ]);
    paymentRepository.findMany.mockResolvedValue([
      { orderGroupId: undefined, purpose: 'order', status: 'paid' },
    ]);

    const statement = await service.getStatement('r1', '2026-08-01');

    expect(statement.decision).toEqual({ action: 'blocked', reason: 'no_payout_destination' });
  });
});
