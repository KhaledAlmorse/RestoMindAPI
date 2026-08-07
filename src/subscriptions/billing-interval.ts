/** The three commitment lengths a merchant can buy. */
export type BillingInterval = 'monthly' | 'halfYearly' | 'yearly';

/**
 * Ascending by length. Both the purchase rule and the price-ladder guard walk
 * this array in order, so it must stay sorted.
 */
export const BILLING_INTERVALS: BillingInterval[] = [
  'monthly',
  'halfYearly',
  'yearly',
];

export const INTERVAL_MONTHS: Record<BillingInterval, number> = {
  monthly: 1,
  halfYearly: 6,
  yearly: 12,
};

export const INTERVAL_LABEL: Record<BillingInterval, string> = {
  monthly: 'Monthly',
  halfYearly: '6 Months',
  yearly: 'Yearly',
};

/**
 * A stored product cap as a comparable number.
 *
 * `null` is the unlimited sentinel because BSON cannot round-trip Infinity
 * dependably. Every comparison goes through here so no call site has to
 * remember that — and so `undefined` (never set) can never be mistaken for
 * unlimited, which would hand out free capacity.
 */
export function capValue(productCap: number | null | undefined): number {
  return productCap === null ? Number.POSITIVE_INFINITY : (productCap ?? 0);
}
