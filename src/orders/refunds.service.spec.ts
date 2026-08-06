import { Types } from 'mongoose';
import { OrderStatusEnum, RefundStatusEnum, RolesEnum } from 'src/Common/Types';
import { RefundsService } from './refunds.service';

/**
 * Covers the money-path decisions that live in the service rather than in the
 * pure policy function: what a succeeded refund does to the orders behind it,
 * and the four guards that stop the same money moving twice.
 *
 * Plain object fakes, no Nest DI — every dependency is a constructor argument.
 */

const oid = () => new Types.ObjectId();

function build(overrides: Record<string, any> = {}) {
  const restockCalls: string[] = [];
  const statusWrites: Array<{ id: string; status: string }> = [];

  const orders: any[] = overrides.orders ?? [];
  const refunds: any[] = overrides.refunds ?? [];

  const refundRepository = {
    findOne: jest.fn(({ filters }: any) =>
      Promise.resolve(
        refunds.find((r) => String(r._id) === String(filters._id)),
      ),
    ),
    findMany: jest.fn(({ filters }: any) =>
      Promise.resolve(
        refunds.filter((r) => {
          if (
            filters.orderId &&
            String(r.orderId) !== String(filters.orderId)
          ) {
            return false;
          }
          if (filters.status?.$in) return filters.status.$in.includes(r.status);
          return true;
        }),
      ),
    ),
    create: jest.fn((doc: any) => Promise.resolve({ ...doc, _id: oid() })),
    update: jest.fn(() => Promise.resolve(null)),
  };

  const orderRepository = {
    findMany: jest.fn(() => Promise.resolve(orders)),
    update: jest.fn(({ filters, body }: any) => {
      statusWrites.push({ id: String(filters._id), status: body.status });
      return Promise.resolve(null);
    }),
  };

  const orderGroupRepository = {
    findOne: jest.fn(() => Promise.resolve(overrides.group ?? null)),
    update: jest.fn(() => Promise.resolve(null)),
  };

  const paymentRepository = { findOne: jest.fn(() => Promise.resolve(null)) };

  const paymentsService = {
    executeRefund: jest.fn(() => Promise.resolve(RefundStatusEnum.SUCCEEDED)),
    reserveRefund: jest.fn(() => Promise.resolve(true)),
    releaseRefundReservation: jest.fn(() => Promise.resolve(undefined)),
  };

  const ordersService = {
    restoreStockForOrder: jest.fn((o: any) => {
      restockCalls.push(String(o._id));
      return Promise.resolve();
    }),
    computeGroupStatus: jest.fn(() => 'Cancelled'),
  };

  const service = new RefundsService(
    refundRepository as any,
    paymentRepository as any,
    orderRepository as any,
    orderGroupRepository as any,
    paymentsService as any,
    ordersService as any,
  );

  return { service, restockCalls, statusWrites, refundRepository };
}

describe('applyOrderConsequences', () => {
  it('does not restock a DELIVERED order — the food was eaten', async () => {
    const orderId = oid();
    const refundId = oid();
    const groupId = oid();

    const { service, restockCalls, statusWrites } = build({
      orders: [{ _id: orderId, status: OrderStatusEnum.DELIVERED, items: [] }],
      refunds: [{ _id: refundId, orderGroupId: groupId, amountCents: 5000 }],
    });

    await (service as any).applyOrderConsequences(refundId);

    expect(restockCalls).toEqual([]);
    expect(statusWrites).toEqual([
      { id: String(orderId), status: OrderStatusEnum.REFUNDED },
    ]);
  });

  it('restocks an undelivered order and marks it cancelled', async () => {
    const orderId = oid();
    const refundId = oid();
    const groupId = oid();

    const { service, restockCalls, statusWrites } = build({
      orders: [{ _id: orderId, status: OrderStatusEnum.PREPARING, items: [] }],
      refunds: [{ _id: refundId, orderGroupId: groupId, amountCents: 5000 }],
    });

    await (service as any).applyOrderConsequences(refundId);

    expect(restockCalls).toEqual([String(orderId)]);
    expect(statusWrites).toEqual([
      { id: String(orderId), status: OrderStatusEnum.CANCELLED },
    ]);
  });

  it('leaves an already-finished sibling alone', async () => {
    const live = oid();
    const done = oid();
    const refundId = oid();

    const { service, restockCalls, statusWrites } = build({
      orders: [
        { _id: done, status: OrderStatusEnum.REFUNDED, items: [] },
        { _id: live, status: OrderStatusEnum.PENDING, items: [] },
      ],
      refunds: [{ _id: refundId, orderGroupId: oid(), amountCents: 5000 }],
    });

    await (service as any).applyOrderConsequences(refundId);

    // The REFUNDED order is neither rewritten to CANCELLED nor restocked twice.
    expect(statusWrites).toEqual([
      { id: String(live), status: OrderStatusEnum.CANCELLED },
    ]);
    expect(restockCalls).toEqual([String(live)]);
  });

  it('never restocks on a line-item refund', async () => {
    const orderId = oid();
    const refundId = oid();

    const { service, restockCalls, statusWrites } = build({
      orders: [{ _id: orderId, status: OrderStatusEnum.PREPARING, items: [] }],
      refunds: [
        {
          _id: refundId,
          orderGroupId: oid(),
          orderId,
          lineItemIndexes: [0],
          amountCents: 1000,
        },
      ],
    });

    await (service as any).applyOrderConsequences(refundId);

    expect(restockCalls).toEqual([]);
    expect(statusWrites).toEqual([
      { id: String(orderId), status: OrderStatusEnum.PARTIALLY_REFUNDED },
    ]);
  });
});

describe('assertLineItemsNotAlreadyRefunded', () => {
  const orderId = oid();

  it('refuses an index a live refund already covers', async () => {
    const { service } = build({
      refunds: [
        {
          _id: oid(),
          orderId,
          lineItemIndexes: [1, 2],
          status: RefundStatusEnum.SUCCEEDED,
        },
      ],
    });

    await expect(
      (service as any).assertLineItemsNotAlreadyRefunded(String(orderId), [2]),
    ).rejects.toThrow(/already have a refund/);
  });

  it('allows an untouched index', async () => {
    const { service } = build({
      refunds: [
        {
          _id: oid(),
          orderId,
          lineItemIndexes: [1],
          status: RefundStatusEnum.SUCCEEDED,
        },
      ],
    });

    await expect(
      (service as any).assertLineItemsNotAlreadyRefunded(String(orderId), [0]),
    ).resolves.toBeUndefined();
  });

  it('ignores a rejected refund — those items are free again', async () => {
    const { service } = build({
      refunds: [
        {
          _id: oid(),
          orderId,
          lineItemIndexes: [0],
          status: RefundStatusEnum.REJECTED,
        },
      ],
    });

    await expect(
      (service as any).assertLineItemsNotAlreadyRefunded(String(orderId), [0]),
    ).resolves.toBeUndefined();
  });
});

describe('assertRestaurantScope', () => {
  const mine = oid();
  const theirs = oid();
  const { service } = build();

  it("refuses a manager acting on another restaurant's order", () => {
    expect(() =>
      (service as any).assertRestaurantScope(
        { role: RolesEnum.MANAGER, restaurantId: mine },
        [{ restaurantId: theirs }],
      ),
    ).toThrow(/your own restaurant/);
  });

  it('refuses a manager on a mixed group order', () => {
    expect(() =>
      (service as any).assertRestaurantScope(
        { role: RolesEnum.MANAGER, restaurantId: mine },
        [{ restaurantId: mine }, { restaurantId: theirs }],
      ),
    ).toThrow(/your own restaurant/);
  });

  it('allows a manager on their own order', () => {
    expect(() =>
      (service as any).assertRestaurantScope(
        { role: RolesEnum.STAFF, restaurantId: mine },
        [{ restaurantId: mine }],
      ),
    ).not.toThrow();
  });

  it('lets an admin and a customer through untouched', () => {
    for (const role of [RolesEnum.ADMIN, RolesEnum.CUSTOMER]) {
      expect(() =>
        (service as any).assertRestaurantScope({ role }, [
          { restaurantId: theirs },
        ]),
      ).not.toThrow();
    }
  });
});

describe('deliveredAtOf', () => {
  const { service } = build();

  it('reads the stamped deliveredAt, never updatedAt', () => {
    const stamped = new Date('2026-08-01T10:00:00Z');
    expect(
      (service as any).deliveredAtOf([
        {
          status: OrderStatusEnum.DELIVERED,
          deliveredAt: stamped,
          updatedAt: new Date('2026-08-05T10:00:00Z'),
        },
      ]),
    ).toEqual(stamped);
  });

  it('returns null when the stamp is missing, rather than guessing', () => {
    expect(
      (service as any).deliveredAtOf([
        {
          status: OrderStatusEnum.DELIVERED,
          updatedAt: new Date('2026-08-05T10:00:00Z'),
        },
      ]),
    ).toBeNull();
  });
});
