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

    // Every id compared against a ledger line has to be the same string the
    // line carries, and payout-math builds those with String(objectId) — always
    // lowercase hex. Deriving it once here makes the whole method immune to an
    // uppercase-hex route param, which would otherwise drop every refund line
    // while keeping every sale line, i.e. overpay the merchant.
    const canonicalId = String((restaurant as any)._id);

    // cutoffDate is the EXCLUSIVE end of the period, so '2026-08-01' settles
    // through the end of 31 July Cairo. `.start`, not `.end` — using `.end`
    // would quietly pull an extra day into every statement.
    const periodEnd = getBusinessDayRange(cutoffDateStr).start;
    const periodStart = await this.paidThrough(canonicalId);

    const [saleLines, unpaidExceptions] = await this.collectSales(
      canonicalId,
      periodEnd,
    );
    const refundLedger = await this.collectRefunds(
      canonicalId,
      periodStart,
      periodEnd,
    );
    const adjustmentLedger = await this.collectAdjustments(
      canonicalId,
      periodStart,
      periodEnd,
    );

    const lines = [...saleLines, ...refundLedger, ...adjustmentLedger].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const totals = summarise(lines);

    return {
      restaurantId: canonicalId,
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
        ...(await this.orphanedPayments(canonicalId)),
        ...(await this.stuckRefunds(canonicalId)),
      ],
    };
  }

  /**
   * The merchant's paid-through mark: the end of the newest COMPLETED payout.
   * A PENDING or FAILED payout deliberately does not advance it — money that
   * has not landed has not been settled.
   *
   * This bounds refunds and adjustments only. Both always produce a line, so
   * "everything before this date is settled" is true of them. It is NOT true of
   * sales, where a single order can be deliberately held back as an exception —
   * those are marked per order instead, see `collectSales`.
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
   * Every sale that is payable and has not been paid yet.
   *
   * There is no lower bound: "settled" is a per-order mark (`payoutId`, stamped
   * when a payout is created and cleared if it fails), not a date. A date
   * watermark cannot say "everything before this was settled except that one
   * order" — and an order deliberately held back as a `delivered_unpaid`
   * exception is exactly that, so under a watermark it would sink below the
   * window and never be paid once its payment finally settled.
   *
   * The upper bound is `periodEnd` shifted back by the hold, applied in the
   * query rather than afterwards so it still uses the
   * { restaurantId, status, deliveredAt } index.
   */
  private async collectSales(
    restaurantId: string,
    periodEnd: Date,
  ): Promise<[LedgerLine[], StatementException[]]> {
    const orders =
      (await this.orderRepository.findMany({
        filters: {
          restaurantId,
          status: { $in: PAYABLE_ORDER_STATUSES },
          payoutId: { $exists: false },
          deliveredAt: { $lt: addDays(periodEnd, -PAYOUT_HOLD_DAYS) },
        },
      })) ?? [];

    const online = orders.filter((o) => o.paymentMethod !== 'Cash on Delivery');
    const paidGroupIds = new Set(
      (
        (await this.paymentRepository.findMany({
          filters: {
            // Nullish ids are dropped: Mongoose serialises `undefined` in an
            // $in as `null`, which matches every payment that has no group and
            // would mark a groupless order paid.
            orderGroupId: {
              $in: online.flatMap((o) =>
                o.groupOrderId ? [o.groupOrderId] : [],
              ),
            },
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
      const paid =
        order.groupOrderId && paidGroupIds.has(String(order.groupOrderId));
      if (isOnline && !paid) {
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
   * The window is shifted back by the hold exactly as the sales window is.
   * Unshifted, a refund completing during its own sale's hold would land on the
   * statement *before* the sale it reverses, invoicing the merchant for money
   * RestoMind never paid them — the very thing the hold exists to prevent.
   * The windows stay contiguous, so nothing is lost or double-counted; a refund
   * of an already-settled sale still lands on a later statement, 7 days later.
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
          completedAt: {
            $gte: addDays(periodStart, -PAYOUT_HOLD_DAYS),
            $lt: addDays(periodEnd, -PAYOUT_HOLD_DAYS),
          },
        },
      })) ?? [];
    if (!refunds.length) return [];

    const ordersByGroup = await this.ordersByGroupFor(refunds);

    return refunds
      .flatMap((refund) =>
        refundLines(
          refund as any,
          ordersByGroup.get(String(refund.orderGroupId)) ?? [],
        ),
      )
      .filter((line) => line.restaurantId === restaurantId);
  }

  /**
   * Every order in the given refunds' groups, indexed by group id.
   *
   * Deliberately not filtered to one restaurant: `refundLines` divides the
   * refund pro-rata across the whole group, so a partial list would give the
   * wrong denominator and overstate this restaurant's share.
   */
  private async ordersByGroupFor(
    refunds: { orderGroupId?: any }[],
  ): Promise<Map<string, any[]>> {
    const groupIds = [...new Set(refunds.map((r) => String(r.orderGroupId)))];
    const orders =
      (await this.orderRepository.findMany({
        filters: { groupOrderId: { $in: groupIds } },
      })) ?? [];

    const byGroup = new Map<string, any[]>();
    for (const order of orders) {
      const key = String(order.groupOrderId);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(order);
    }
    return byGroup;
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
            // Same nullish guard as collectSales: an order with no group must
            // never match a payment with no group.
            orderGroupId: {
              $in: stale.flatMap((o) =>
                o.groupOrderId ? [o.groupOrderId] : [],
              ),
            },
            purpose: PaymentPurposeEnum.ORDER,
            status: PaymentStatusEnum.PAID,
          },
        })) ?? []
      ).map((p) => String(p.orderGroupId)),
    );

    return stale
      .filter((o) => o.groupOrderId && paidGroupIds.has(String(o.groupOrderId)))
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
   *
   * Attributed through `refundLines`, the same pro-rata split the ledger uses,
   * so a group refund is reported at this restaurant's share rather than the
   * whole group's total — reporting the total would leak another merchant's
   * figure and could block this one's payout over someone else's problem.
   * `refundLines` honours `refund.orderId` itself, so a single-order refund
   * scopes to its own restaurant for free.
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

    const ordersByGroup = await this.ordersByGroupFor(stuck);

    const exceptions: StatementException[] = [];
    for (const refund of stuck) {
      // A stuck refund has no completedAt, so refundLines dates these to the
      // epoch — harmless, only amountCents is read.
      const mine = refundLines(
        refund as any,
        ordersByGroup.get(String(refund.orderGroupId)) ?? [],
      ).filter((line) => line.restaurantId === restaurantId);
      if (!mine.length) continue;

      exceptions.push({
        kind: 'refund_stuck',
        ref: String(refund._id),
        amountCents: mine.reduce((sum, line) => sum - line.grossCents, 0),
        detail: `Refund is ${refund.status} and has not moved money`,
      });
    }
    return exceptions;
  }
}
