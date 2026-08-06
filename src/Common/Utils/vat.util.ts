/** Egyptian VAT. Company-wide — subscriptions and marketplace commission both. */
export const VAT_RATE = 0.14;

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
