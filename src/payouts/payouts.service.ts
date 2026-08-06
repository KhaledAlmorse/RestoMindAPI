import { Injectable, NotFoundException } from '@nestjs/common';
import { addDays, getBusinessDayRange } from 'src/Common/Utils';
import {
  OrderStatusEnum,
  PaymentPurposeEnum,
  PaymentStatusEnum,
  PayoutStatusEnum,
  RefundStatusEnum,
} from 'src/Common/Types';
import {
  MerchantAdjustmentRepository,
  OrderRepository,
  PaymentRepository,
  PayoutRepository,
  RefundRepository,
  RestaurantRepository,
} from 'src/DB/Repositories';
import { PAYOUT_HOLD_DAYS } from './payout.config';
import {
  LedgerLine,
  PayoutDecision,
  StatementTotals,
  adjustmentLine,
  payoutDecision,
  refundLines,
  saleLine,
  summarise,
} from './payout-math';

export interface StatementException {
  kind: 'delivered_unpaid' | 'paid_undelivered' | 'refund_stuck';
  ref: string;
  amountCents: number;
  detail: string;
}

/**
 * A delivered order stays payable after a refund. `statusAfterRefund` moves it
 * to PARTIALLY_REFUNDED or REFUNDED, and filtering on DELIVERED alone would
 * silently drop it — the merchant would never be paid for the part of the order
 * that was not refunded.
 */
const PAYABLE_ORDER_STATUSES = [
  OrderStatusEnum.DELIVERED,
  OrderStatusEnum.PARTIALLY_REFUNDED,
  OrderStatusEnum.REFUNDED,
];

/** Statuses that mean an order is finished, one way or another. */
const RESOLVED_ORDER_STATUSES = [
  ...PAYABLE_ORDER_STATUSES,
  OrderStatusEnum.CANCELLED,
  OrderStatusEnum.PAYMENT_FAILED,
];

export interface PayoutStatement {
  restaurantId: string;
  restaurantName: string;
  periodStart: Date;
  periodEnd: Date;
  lines: LedgerLine[];
  totals: StatementTotals;
  decision: PayoutDecision;
  exceptions: StatementException[];
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly refundRepository: RefundRepository,
    private readonly restaurantRepository: RestaurantRepository,
    private readonly payoutRepository: PayoutRepository,
    private readonly merchantAdjustmentRepository: MerchantAdjustmentRepository,
  ) {}

  /**
   * Everything owed to (or by) one restaurant that has not been settled yet,
   * up to the Cairo end of `cutoffDateStr`.
   *
   * The window starts at the merchant's paid-through mark rather than at a
   * fixed calendar point, which is what makes this safe: a refund that settles
   * after we already paid was never inside any prior payout's window, so it
   * appears here instead of retroactively changing a statement.
   */
  async getStatement(
    restaurantId: string,
    cutoffDateStr: string,
  ): Promise<PayoutStatement> {
    const restaurant = await this.restaurantRepository.findOne({
      filters: { _id: restaurantId },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    // cutoffDate is the EXCLUSIVE end of the period, so '2026-08-01' settles
    // through the end of 31 July Cairo. `.start`, not `.end` — using `.end`
    // would quietly pull an extra day into every statement.
    const periodEnd = getBusinessDayRange(cutoffDateStr).start;
    const periodStart = await this.paidThrough(restaurantId);

    const [saleLines, unpaidExceptions] = await this.collectSales(
      restaurantId,
      periodStart,
      periodEnd,
    );
    const refundLedger = await this.collectRefunds(
      restaurantId,
      periodStart,
      periodEnd,
    );
    const adjustmentLedger = await this.collectAdjustments(
      restaurantId,
      periodStart,
      periodEnd,
    );

    const lines = [...saleLines, ...refundLedger, ...adjustmentLedger].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const totals = summarise(lines);

    return {
      restaurantId,
      restaurantName: (restaurant as any).name ?? '',
      periodStart,
      periodEnd,
      lines,
      totals,
      decision: payoutDecision(
        totals.merchantNetCents,
        Boolean((restaurant as any).payoutDestination),
      ),
      exceptions: [
        ...unpaidExceptions,
        ...(await this.orphanedPayments(restaurantId)),
        ...(await this.stuckRefunds(restaurantId)),
      ],
    };
  }

  /**
   * The merchant's paid-through mark: the end of the newest COMPLETED payout.
   * A PENDING or FAILED payout deliberately does not advance it — money that
   * has not landed has not been settled.
   */
  private async paidThrough(restaurantId: string): Promise<Date> {
    const settled =
      (await this.payoutRepository.findMany({
        filters: {
          restaurantId,
          status: PayoutStatusEnum.COMPLETED,
        },
      })) ?? [];

    return settled.reduce<Date>(
      (latest, p) => (p.periodEnd > latest ? p.periodEnd : latest),
      new Date(0),
    );
  }

  /**
   * Delivered orders whose hold has elapsed inside this window. The window is
   * shifted back by the hold rather than filtering afterwards, so the query
   * uses the { restaurantId, status, deliveredAt } index.
   */
  private async collectSales(
    restaurantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<[LedgerLine[], StatementException[]]> {
    const orders =
      (await this.orderRepository.findMany({
        filters: {
          restaurantId,
          status: { $in: PAYABLE_ORDER_STATUSES },
          deliveredAt: {
            $gte: addDays(periodStart, -PAYOUT_HOLD_DAYS),
            $lt: addDays(periodEnd, -PAYOUT_HOLD_DAYS),
          },
        },
      })) ?? [];

    const online = orders.filter((o) => o.paymentMethod !== 'Cash on Delivery');
    const paidGroupIds = new Set(
      (
        (await this.paymentRepository.findMany({
          filters: {
            orderGroupId: { $in: online.map((o) => o.groupOrderId) },
            purpose: PaymentPurposeEnum.ORDER,
            status: PaymentStatusEnum.PAID,
          },
        })) ?? []
      ).map((p) => String(p.orderGroupId)),
    );

    const lines: LedgerLine[] = [];
    const exceptions: StatementException[] = [];

    for (const order of orders) {
      const isOnline = order.paymentMethod !== 'Cash on Delivery';
      if (isOnline && !paidGroupIds.has(String(order.groupOrderId))) {
        // Delivered but the money never settled. Paying this out would hand
        // the merchant cash RestoMind never received, so it is escalated
        // rather than dropped or guessed at.
        exceptions.push({
          kind: 'delivered_unpaid',
          ref: String(order._id),
          amountCents: Math.round((order.finalTotalPrice ?? 0) * 100),
          detail: `Order delivered ${order.deliveredAt?.toISOString()} has no settled payment`,
        });
        continue;
      }
      lines.push(saleLine(order as any));
    }

    return [lines, exceptions];
  }

  /**
   * Refunds that completed inside the window, attributed to this restaurant.
   *
   * Refund rows carry no restaurantId — a group refund deliberately spans
   * several — so the group's orders are loaded to work out each restaurant's
   * pro-rata share.
   *
   * ponytail: loads every succeeded refund in the window, then filters. Fine at
   * marketplace volume; switch to an aggregation joining orders if a single
   * period ever holds thousands of refunds.
   */
  private async collectRefunds(
    restaurantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<LedgerLine[]> {
    const refunds =
      (await this.refundRepository.findMany({
        filters: {
          status: RefundStatusEnum.SUCCEEDED,
          completedAt: { $gte: periodStart, $lt: periodEnd },
        },
      })) ?? [];
    if (!refunds.length) return [];

    const groupIds = [...new Set(refunds.map((r) => String(r.orderGroupId)))];
    const groupOrders =
      (await this.orderRepository.findMany({
        filters: {
          groupOrderId: { $in: groupIds },
        },
      })) ?? [];

    const ordersByGroup = new Map<string, any[]>();
    for (const order of groupOrders) {
      const key = String(order.groupOrderId);
      if (!ordersByGroup.has(key)) ordersByGroup.set(key, []);
      ordersByGroup.get(key)!.push(order);
    }

    return refunds
      .flatMap((refund) =>
        refundLines(
          refund as any,
          ordersByGroup.get(String(refund.orderGroupId)) ?? [],
        ),
      )
      .filter((line) => line.restaurantId === restaurantId);
  }

  private async collectAdjustments(
    restaurantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<LedgerLine[]> {
    const adjustments =
      (await this.merchantAdjustmentRepository.findMany({
        filters: {
          restaurantId,
          effectiveAt: { $gte: periodStart, $lt: periodEnd },
        },
      })) ?? [];

    return adjustments.map((a) => adjustmentLine(a as any));
  }

  /**
   * Orders this restaurant was paid for that never reached a resolution — not
   * delivered, not cancelled, not refunded — long after the hold would have
   * elapsed. RestoMind is holding that money with nothing to show for it.
   *
   * Not time-windowed like the other queries: an orphan does not age out, and
   * it should keep appearing on every statement until somebody resolves it.
   */
  private async orphanedPayments(
    restaurantId: string,
  ): Promise<StatementException[]> {
    const stale =
      (await this.orderRepository.findMany({
        filters: {
          restaurantId,
          paymentMethod: { $ne: 'Cash on Delivery' },
          status: { $nin: RESOLVED_ORDER_STATUSES },
          createdAt: { $lt: addDays(new Date(), -2 * PAYOUT_HOLD_DAYS) },
        },
      })) ?? [];
    if (!stale.length) return [];

    const paidGroupIds = new Set(
      (
        (await this.paymentRepository.findMany({
          filters: {
            orderGroupId: { $in: stale.map((o) => o.groupOrderId) },
            purpose: PaymentPurposeEnum.ORDER,
            status: PaymentStatusEnum.PAID,
          },
        })) ?? []
      ).map((p) => String(p.orderGroupId)),
    );

    return stale
      .filter((o) => paidGroupIds.has(String(o.groupOrderId)))
      .map((o) => ({
        kind: 'paid_undelivered' as const,
        ref: String(o._id),
        amountCents: Math.round((o.finalTotalPrice ?? 0) * 100),
        detail: `Paid on ${(o as any).createdAt?.toISOString()} but still "${o.status}"`,
      }));
  }

  /**
   * Refunds owed to a customer that the gateway could not move. Surfaced on the
   * statement because until they settle, RestoMind is holding money that
   * belongs to a customer, and it must not be mistaken for merchant float.
   */
  private async stuckRefunds(
    restaurantId: string,
  ): Promise<StatementException[]> {
    const stuck =
      (await this.refundRepository.findMany({
        filters: {
          status: {
            $in: [RefundStatusEnum.MANUAL_REQUIRED, RefundStatusEnum.FAILED],
          },
        },
      })) ?? [];
    if (!stuck.length) return [];

    const groupOrders =
      (await this.orderRepository.findMany({
        filters: {
          groupOrderId: { $in: stuck.map((r) => r.orderGroupId) },
          restaurantId,
        },
      })) ?? [];
    const touched = new Set(groupOrders.map((o) => String(o.groupOrderId)));

    return stuck
      .filter((r) => touched.has(String(r.orderGroupId)))
      .map((r) => ({
        kind: 'refund_stuck' as const,
        ref: String(r._id),
        amountCents: r.amountCents,
        detail: `Refund is ${r.status} and has not moved money`,
      }));
  }
}
