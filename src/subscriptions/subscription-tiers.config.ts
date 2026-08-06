export type TierName = 'basic' | 'plus' | 'scale';

/**
 * The only place these numbers exist. Tuning pricing is a change here and
 * nowhere else.
 *
 * Caps count active Product records per restaurant (isDeleted: false).
 * Prices are VAT-inclusive — what the merchant is charged is exactly this.
 */
export const TIERS: Record<
  TierName,
  {
    productCap: number;
    priceEGP: number;
    earlyBirdEGP: number;
    label: string;
  }
> = {
  basic: { productCap: 1_000, priceEGP: 300, earlyBirdEGP: 200, label: 'Basic' },
  plus: { productCap: 3_000, priceEGP: 600, earlyBirdEGP: 400, label: 'Plus' },
  scale: {
    productCap: Number.POSITIVE_INFINITY,
    priceEGP: 1_500,
    earlyBirdEGP: 1_000,
    label: 'Scale',
  },
};

export const TIER_ORDER: TierName[] = ['basic', 'plus', 'scale'];

/** Days after currentPeriodEnd during which a LAPSED PAYER keeps full access. */
export const GRACE_DAYS = 7;

/** Trial length, counted from setup-account completion. */
export const TRIAL_DAYS = 14;

/** Capacity granted during the trial — the cap must not obstruct evaluation. */
export const TRIAL_TIER: TierName = 'plus';

/**
 * What this merchant is charged for a month of `tier`.
 *
 * `earlyBird` must be the *effective* entitlement — the merchant holds a seat
 * AND the platform switch is still on — not merely the flag on the restaurant.
 * Every price the merchant ever sees or pays comes through here, so the billing
 * screen and the checkout can never quote different numbers.
 */
export function tierPriceCents(tier: TierName, earlyBird = false): number {
  const priceEGP = earlyBird
    ? TIERS[tier].earlyBirdEGP
    : TIERS[tier].priceEGP;
  return Math.round(priceEGP * 100);
}

export function nextTierAfter(tier: TierName | undefined): TierName | null {
  const index = tier ? TIER_ORDER.indexOf(tier) : -1;
  return TIER_ORDER[index + 1] ?? null;
}
