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

/**
 * Fallback when a Restaurant has no commissionRate AND no platform default was
 * passed. The live default is SystemSettings.defaultCommissionRate, editable by
 * an admin; this constant only covers callers with no database at hand (the
 * backfill script, tests) and the schema default it mirrors.
 */
export const DEFAULT_COMMISSION_RATE = 0.05;

/**
 * Fractions throughout — 0.05 is 5%. Restaurant, SystemSettings and Order all
 * store the same unit, so nothing here ever converts; percent exists only in
 * the UI.
 *
 * `?? `, not `||`: a deliberately negotiated 0% commission must survive, and
 * `||` would silently replace it with the default.
 */
export function commissionRateFor(
  restaurant: { commissionRate?: number },
  platformDefault: number = DEFAULT_COMMISSION_RATE,
): number {
  return restaurant.commissionRate ?? platformDefault;
}

/**
 * Rounded once, here, at order creation. Because the per-order figure is
 * stored, a statement is an exact sum of stored integers and can never
 * disagree with the orders it lists by a piaster.
 */
export function commissionCentsFor(grossCents: number, rate: number): number {
  return Math.round(grossCents * rate);
}
