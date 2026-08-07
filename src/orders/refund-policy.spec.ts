import { ForbiddenException } from '@nestjs/common';
import { OrderStatusEnum, RolesEnum } from 'src/Common/Types';
import { decideRefund, statusAfterRefund } from './refund-policy';

const NOW = new Date('2026-08-05T12:00:00.000Z');

function ctx(overrides: Partial<Parameters<typeof decideRefund>[0]> = {}) {
  return {
    role: RolesEnum.CUSTOMER,
    isOwner: true,
    orderStatus: OrderStatusEnum.PENDING,
    isLineItemRefund: false,
    now: NOW,
    ...overrides,
  };
}

describe('decideRefund — customer', () => {
  it('auto-approves a cancellation while Pending', () => {
    expect(decideRefund(ctx())).toBe('auto');
  });

  it('auto-approves while Confirmed', () => {
    expect(decideRefund(ctx({ orderStatus: OrderStatusEnum.CONFIRMED }))).toBe(
      'auto',
    );
  });

  it('requires staff approval once Preparing', () => {
    expect(decideRefund(ctx({ orderStatus: OrderStatusEnum.PREPARING }))).toBe(
      'needs_approval',
    );
  });

  it('requires staff approval once Ready', () => {
    expect(decideRefund(ctx({ orderStatus: OrderStatusEnum.READY }))).toBe(
      'needs_approval',
    );
  });

  it('requires staff approval once Out For Delivery', () => {
    expect(
      decideRefund(ctx({ orderStatus: OrderStatusEnum.OUT_FOR_DELIVERY })),
    ).toBe('needs_approval');
  });

  it('refuses a refund of another customer order', () => {
    expect(() => decideRefund(ctx({ isOwner: false }))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a customer-requested line-item refund', () => {
    expect(() => decideRefund(ctx({ isLineItemRefund: true }))).toThrow(
      /support/i,
    );
  });

  it('refuses a customer refund of a delivered order', () => {
    expect(() =>
      decideRefund(
        ctx({
          orderStatus: OrderStatusEnum.DELIVERED,
          deliveredAt: new Date('2026-08-05T10:00:00.000Z'),
        }),
      ),
    ).toThrow(/support team/i);
  });
});

describe('decideRefund — staff', () => {
  const staff = { role: RolesEnum.MANAGER, isOwner: false };

  it('auto-approves at any pre-delivery status', () => {
    for (const status of [
      OrderStatusEnum.PENDING,
      OrderStatusEnum.PREPARING,
      OrderStatusEnum.OUT_FOR_DELIVERY,
    ]) {
      expect(decideRefund(ctx({ ...staff, orderStatus: status }))).toBe('auto');
    }
  });

  it('allows a line-item refund', () => {
    expect(decideRefund(ctx({ ...staff, isLineItemRefund: true }))).toBe(
      'auto',
    );
  });

  it('allows a delivered-order refund inside the 24-hour window', () => {
    expect(
      decideRefund(
        ctx({
          ...staff,
          orderStatus: OrderStatusEnum.DELIVERED,
          deliveredAt: new Date('2026-08-04T14:00:00.000Z'), // 22h earlier
        }),
      ),
    ).toBe('auto');
  });

  it('refuses a delivered-order refund after the window closes', () => {
    expect(() =>
      decideRefund(
        ctx({
          ...staff,
          orderStatus: OrderStatusEnum.DELIVERED,
          deliveredAt: new Date('2026-08-04T11:00:00.000Z'), // 25h earlier
        }),
      ),
    ).toThrow(/dispute window/i);
  });

  it('refuses a delivered-order refund with no delivery timestamp', () => {
    expect(() =>
      decideRefund(ctx({ ...staff, orderStatus: OrderStatusEnum.DELIVERED })),
    ).toThrow(/timestamp/i);
  });
});

describe('decideRefund — terminal statuses', () => {
  it.each([
    OrderStatusEnum.CANCELLED,
    OrderStatusEnum.REFUNDED,
    OrderStatusEnum.PAYMENT_FAILED,
    OrderStatusEnum.AWAITING_PAYMENT,
  ])('refuses a refund of a %s order', (status) => {
    expect(() =>
      decideRefund(ctx({ role: RolesEnum.ADMIN, orderStatus: status })),
    ).toThrow(ForbiddenException);
  });
});

describe('statusAfterRefund', () => {
  it('marks an undelivered order cancelled', () => {
    expect(statusAfterRefund(OrderStatusEnum.PREPARING, false)).toBe(
      OrderStatusEnum.CANCELLED,
    );
  });

  it('marks a delivered order REFUNDED, not cancelled', () => {
    // Calling a delivered order "cancelled" would falsify the fulfilment
    // record and corrupt the sales history the forecast trains on.
    expect(statusAfterRefund(OrderStatusEnum.DELIVERED, false)).toBe(
      OrderStatusEnum.REFUNDED,
    );
  });

  it('marks a line-item refund partially refunded', () => {
    expect(statusAfterRefund(OrderStatusEnum.DELIVERED, true)).toBe(
      OrderStatusEnum.PARTIALLY_REFUNDED,
    );
  });
});
