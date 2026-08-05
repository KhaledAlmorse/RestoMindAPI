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
  { productCap: number; priceEGP: number; label: string }
> = {
  basic: { productCap: 1_000, priceEGP: 300, label: 'Basic' },
  plus: { productCap: 3_000, priceEGP: 600, label: 'Plus' },
  scale: {
    productCap: Number.POSITIVE_INFINITY,
    priceEGP: 1_500,
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

export const VAT_RATE = 0.14;

export function tierPriceCents(tier: TierName): number {
  return Math.round(TIERS[tier].priceEGP * 100);
}

/**
 * Breaks a VAT-inclusive amount into net + VAT for the invoice.
 *
 * VAT is the rounded part and net is the remainder, so net + vat === total
 * exactly — the invoice can never disagree with what was charged by a piaster.
 */
export function splitVat(totalCents: number): {
  netCents: number;
  vatCents: number;
} {
  const vatCents = Math.round(totalCents - totalCents / (1 + VAT_RATE));
  return { netCents: totalCents - vatCents, vatCents };
}

export function nextTierAfter(tier: TierName | undefined): TierName | null {
  const index = tier ? TIER_ORDER.indexOf(tier) : -1;
  return TIER_ORDER[index + 1] ?? null;
}
