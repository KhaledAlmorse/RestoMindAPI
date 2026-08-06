/**
 * Every tunable number for merchant settlement. Tuning payout policy is a
 * change here and nowhere else.
 */

/**
 * Days between delivery and a sale becoming payable. Must exceed
 * DISPUTE_WINDOW_HOURS (24) in src/orders/refund-policy.ts — paying out inside
 * the window means clawing money back from a merchant who already spent it.
 *
 * Card chargebacks can arrive ~120 days out; no practical hold covers those, so
 * they are handled as MerchantAdjustment rows rather than by a longer hold.
 */
export const PAYOUT_HOLD_DAYS = 7;

/** Below this, the statement carries forward rather than triggering a transfer. */
export const MIN_PAYOUT_CENTS = 5_000; // 50 EGP

/** Applied when a Restaurant has no commissionRate of its own. */
export const DEFAULT_COMMISSION_RATE = 0.05;

export function commissionRateFor(restaurant: {
  commissionRate?: number;
}): number {
  return restaurant.commissionRate ?? DEFAULT_COMMISSION_RATE;
}

/**
 * Rounded once, here, at order creation. Because the per-order figure is
 * stored, a statement is an exact sum of stored integers and can never
 * disagree with the orders it lists by a piaster.
 */
export function commissionCentsFor(grossCents: number, rate: number): number {
  return Math.round(grossCents * rate);
}
