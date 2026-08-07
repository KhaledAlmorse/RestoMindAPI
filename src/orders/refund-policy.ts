import { ForbiddenException } from '@nestjs/common';
import { OrderStatusEnum, RolesEnum } from 'src/Common/Types';

/** Hours after delivery during which staff may still issue a refund. */
export const DISPUTE_WINDOW_HOURS = 24;

/** Statuses a customer may cancel-and-refund without staff approval. */
const CUSTOMER_AUTO_REFUNDABLE = [
  OrderStatusEnum.PENDING,
  OrderStatusEnum.CONFIRMED,
];

/** Statuses from which no refund is possible at all. */
const TERMINAL = [
  OrderStatusEnum.CANCELLED,
  OrderStatusEnum.REFUNDED,
  OrderStatusEnum.PAYMENT_FAILED,
  OrderStatusEnum.AWAITING_PAYMENT,
];

/** No money was ever committed for these — cancel directly, no refund needed. */
export const NOTHING_COMMITTED_STATUSES = [
  OrderStatusEnum.AWAITING_PAYMENT,
  OrderStatusEnum.PAYMENT_FAILED,
];

export type RefundDecision = 'auto' | 'needs_approval';

export interface RefundRequestContext {
  role: RolesEnum;
  /** True when the requester owns the order group. */
  isOwner: boolean;
  /** Worst (most advanced) status across the orders being refunded. */
  orderStatus: OrderStatusEnum;
  /** When the order was delivered, if it was. */
  deliveredAt?: Date | null;
  /** True when specific line items were named rather than a whole order. */
  isLineItemRefund: boolean;
  now?: Date;
}

const STAFF_ROLES = [RolesEnum.ADMIN, RolesEnum.MANAGER, RolesEnum.STAFF];

/**
 * Decides whether a refund request is allowed and whether it needs a human.
 *
 * Throws ForbiddenException when the request is not permitted at all;
 * otherwise returns 'auto' (execute immediately) or 'needs_approval'
 * (record it and wait for a manager).
 */
export function decideRefund(ctx: RefundRequestContext): RefundDecision {
  const now = ctx.now ?? new Date();
  const isStaff = STAFF_ROLES.includes(ctx.role);

  if (!isStaff && !ctx.isOwner) {
    throw new ForbiddenException('You can only refund your own orders');
  }

  if (TERMINAL.includes(ctx.orderStatus)) {
    throw new ForbiddenException(
      `An order in status "${ctx.orderStatus}" cannot be refunded`,
    );
  }

  // Line-item partials are a staff judgement call ("one item was wrong"),
  // not something a customer self-serves.
  if (ctx.isLineItemRefund && !isStaff) {
    throw new ForbiddenException(
      'Partial item refunds must be requested through support',
    );
  }

  if (ctx.orderStatus === OrderStatusEnum.DELIVERED) {
    if (!isStaff) {
      throw new ForbiddenException(
        'Delivered orders can only be refunded by our support team',
      );
    }
    const deliveredAt = ctx.deliveredAt ? new Date(ctx.deliveredAt) : null;
    if (!deliveredAt) {
      throw new ForbiddenException(
        'This delivered order has no delivery timestamp, so the dispute window cannot be verified',
      );
    }
    const hoursSince =
      (now.getTime() - deliveredAt.getTime()) / (60 * 60 * 1000);
    if (hoursSince > DISPUTE_WINDOW_HOURS) {
      throw new ForbiddenException(
        `The ${DISPUTE_WINDOW_HOURS}-hour dispute window for this delivered order has closed`,
      );
    }
    return 'auto'; // staff-initiated is already the approval
  }

  if (isStaff) return 'auto';

  return CUSTOMER_AUTO_REFUNDABLE.includes(ctx.orderStatus)
    ? 'auto'
    : 'needs_approval';
}

/**
 * The order status to write once a refund succeeds.
 *
 * A delivered order becomes REFUNDED, never CANCELLED — it was delivered, and
 * recording it as cancelled would falsify the fulfilment record and corrupt
 * the sales history the forecasting model trains on.
 */
export function statusAfterRefund(
  current: OrderStatusEnum,
  isLineItemRefund: boolean,
): OrderStatusEnum {
  if (isLineItemRefund) return OrderStatusEnum.PARTIALLY_REFUNDED;
  if (current === OrderStatusEnum.DELIVERED) return OrderStatusEnum.REFUNDED;
  return OrderStatusEnum.CANCELLED;
}
