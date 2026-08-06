import { splitVat } from 'src/Common/Utils';
import { MIN_PAYOUT_CENTS } from './payout.config';

export type LedgerLineKind = 'sale' | 'refund' | 'adjustment';

/**
 * One signed movement in a merchant's favour or against it. Every amount is
 * integer piasters, and `merchantNetCents` is the only field that decides what
 * gets transferred — `grossCents` and `commissionCents` exist so the statement
 * can explain itself.
 */
export interface LedgerLine {
  kind: LedgerLineKind;
  /** Order, Refund or MerchantAdjustment id, as a string. */
  ref: string;
  restaurantId: string;
  occurredAt: Date;
  /** Money RestoMind collected from the customer. Zero for cash on delivery. */
  grossCents: number;
  /** Positive when RestoMind earns it, negative when it is reversed. */
  commissionCents: number;
  /** Positive: RestoMind owes the merchant. Negative: the merchant owes us. */
  merchantNetCents: number;
  note?: string;
}

export interface StatementTotals {
  grossCents: number;
  commissionCents: number;
  commissionNetCents: number;
  commissionVatCents: number;
  merchantNetCents: number;
}

const toCents = (egp: number): number => Math.round((egp ?? 0) * 100);

const isCod = (paymentMethod: string): boolean =>
  paymentMethod === 'Cash on Delivery';

/**
 * Divides `totalCents` across `weights` so the parts are integers that sum to
 * `totalCents` exactly. Largest remainder: floor everything, then hand the
 * leftover piasters to the entries with the biggest fractional parts.
 *
 * Plain rounding would let a three-way split of 1000 come to 999 or 1002, and
 * a refund that does not sum to the amount actually refunded is a hole in the
 * ledger nobody can explain later.
 */
export function splitProRata(totalCents: number, weights: number[]): number[] {
  if (!weights.length) return [];

  const sign = totalCents < 0 ? -1 : 1;
  const total = Math.abs(totalCents);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  // All-zero weights would divide by zero; an equal split is the only
  // defensible reading of "split this across orders that are all worth zero".
  const safeWeights = weightSum > 0 ? weights : weights.map(() => 1);
  const safeSum = weightSum > 0 ? weightSum : weights.length;

  const exact = safeWeights.map((w) => (total * w) / safeSum);
  const parts = exact.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  for (const { index } of order) {
    if (remainder <= 0) break;
    parts[index] += 1;
    remainder -= 1;
  }

  return parts.map((p) => p * sign);
}

/** Minimal shape this module needs from an Order document. */
interface OrderLike {
  _id: any;
  restaurantId: any;
  paymentMethod: string;
  finalTotalPrice: number;
  commissionCents: number;
  deliveredAt?: Date;
}

export function saleLine(order: OrderLike): LedgerLine {
  const grossCents = isCod(order.paymentMethod)
    ? 0
    : toCents(order.finalTotalPrice);

  return {
    kind: 'sale',
    ref: String(order._id),
    restaurantId: String(order.restaurantId),
    occurredAt: order.deliveredAt ?? new Date(0),
    grossCents,
    commissionCents: order.commissionCents,
    merchantNetCents: grossCents - order.commissionCents,
  };
}

interface RefundLike {
  _id: any;
  orderId?: any;
  amountCents: number;
  completedAt?: Date;
}

/**
 * Turns one Refund row into one line per affected order.
 *
 * A group-level refund has no orderId and can span several restaurants — see
 * refunds.service.ts, which deliberately writes one row for the whole group.
 * `orders` must therefore be every order in that refund's group, not just this
 * restaurant's, or the pro-rata denominator is wrong.
 */
export function refundLines(
  refund: RefundLike,
  orders: OrderLike[],
): LedgerLine[] {
  const targets = refund.orderId
    ? orders.filter((o) => String(o._id) === String(refund.orderId))
    : orders;
  if (!targets.length) return [];

  const shares = splitProRata(
    refund.amountCents,
    targets.map((o) => toCents(o.finalTotalPrice)),
  );

  return targets.map((order, i) => {
    const refunded = shares[i];
    const orderTotal = toCents(order.finalTotalPrice);
    // Cap at the commission actually charged: a rounding artefact must never
    // hand back more commission than was taken.
    const reversed = Math.min(
      orderTotal > 0
        ? Math.round((order.commissionCents * refunded) / orderTotal)
        : 0,
      order.commissionCents,
    );
    const grossCents = isCod(order.paymentMethod) ? 0 : -refunded;

    return {
      kind: 'refund' as const,
      ref: String(refund._id),
      restaurantId: String(order.restaurantId),
      occurredAt: refund.completedAt ?? new Date(0),
      grossCents,
      commissionCents: -reversed,
      merchantNetCents: grossCents + reversed,
    };
  });
}

interface AdjustmentLike {
  _id: any;
  restaurantId?: any;
  amountCents: number;
  reason: string;
  effectiveAt: Date;
}

export function adjustmentLine(adjustment: AdjustmentLike): LedgerLine {
  return {
    kind: 'adjustment',
    ref: String(adjustment._id),
    restaurantId: String(adjustment.restaurantId ?? ''),
    occurredAt: adjustment.effectiveAt,
    grossCents: 0,
    commissionCents: 0,
    merchantNetCents: adjustment.amountCents,
    note: adjustment.reason,
  };
}

export function summarise(lines: LedgerLine[]): StatementTotals {
  const grossCents = lines.reduce((sum, l) => sum + l.grossCents, 0);
  const commissionCents = lines.reduce((sum, l) => sum + l.commissionCents, 0);
  const merchantNetCents = lines.reduce((sum, l) => sum + l.merchantNetCents, 0);
  const { netCents, vatCents } = splitVat(commissionCents);

  return {
    grossCents,
    commissionCents,
    commissionNetCents: netCents,
    commissionVatCents: vatCents,
    merchantNetCents,
  };
}

export type PayoutDecision =
  | { action: 'pay'; direction: 'to_merchant' }
  | { action: 'collect'; direction: 'from_merchant' }
  | { action: 'carry'; reason: 'below_minimum' }
  | { action: 'blocked'; reason: 'no_payout_destination' };

/**
 * What ops should do with a statement. Kept pure and separate from the money
 * arithmetic so the thresholds can be argued about without touching the ledger.
 *
 * Note the asymmetry: a missing destination blocks paying a merchant but not
 * collecting from one, because collection does not need their bank details.
 */
export function payoutDecision(
  merchantNetCents: number,
  hasDestination: boolean,
): PayoutDecision {
  if (merchantNetCents < 0) {
    return { action: 'collect', direction: 'from_merchant' };
  }
  if (merchantNetCents < MIN_PAYOUT_CENTS) {
    return { action: 'carry', reason: 'below_minimum' };
  }
  if (!hasDestination) {
    return { action: 'blocked', reason: 'no_payout_destination' };
  }
  return { action: 'pay', direction: 'to_merchant' };
}
