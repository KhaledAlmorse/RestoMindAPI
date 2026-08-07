import { BadRequestException } from '@nestjs/common';
import {
  BILLING_INTERVALS,
  BillingInterval,
  INTERVAL_MONTHS,
} from './billing-interval';

/** Just the part of a plan that pricing cares about, so tests need no document. */
export interface PricedPlan {
  prices: Record<BillingInterval, number | null>;
}

/**
 * What this merchant is charged for one `interval` of `plan`, in EGP cents.
 *
 * The single chokepoint every quoted price flows through, so the billing
 * screen and the checkout can never disagree. Returns null when the interval
 * is not sold — callers hide it rather than offering it at zero.
 *
 * Rounds to whole EGP, not to the piaster: every price in this system is a
 * round pound, and a discount producing 200.01 EGP would render as "200"
 * while 20001 cents was actually charged.
 */
export function planPriceCents(
  plan: PricedPlan,
  interval: BillingInterval,
  earlyBird: boolean,
  discountPercent: number,
): number | null {
  const base = plan.prices[interval];
  if (base === null || base === undefined) return null;
  if (!earlyBird || discountPercent <= 0) return base;
  return Math.round((base * (1 - discountPercent / 100)) / 100) * 100;
}

/** The per-month equivalent, for showing the saving on a longer commitment. */
export function perMonthCents(
  plan: PricedPlan,
  interval: BillingInterval,
): number | null {
  const base = plan.prices[interval];
  if (base === null || base === undefined) return null;
  return Math.round(base / INTERVAL_MONTHS[interval]);
}

/**
 * Refuses a commercially incoherent ladder.
 *
 * A longer commitment that costs more per month is never something an admin
 * means to publish — it punishes the merchant for committing, and the billing
 * screen would advertise a "saving" that is really a penalty. Enforced at the
 * API rather than only in the UI, so it holds for any client.
 */
export function assertMonotonicLadder(
  prices: Record<BillingInterval, number | null>,
): void {
  const priced = BILLING_INTERVALS.filter(
    (interval) => prices[interval] !== null && prices[interval] !== undefined,
  );

  if (priced.length === 0) {
    throw new BadRequestException(
      'A plan needs at least one priced interval, or it cannot be sold.',
    );
  }

  // BILLING_INTERVALS is ascending by length.
  // Each priced entry must have a higher TOTAL price and a lower (or equal) PER-MONTH price
  // than the shorter commitment before it.
  let previousTotal = -1;
  let previousPerMonth = Number.POSITIVE_INFINITY;

  for (const interval of priced) {
    const total = prices[interval]!;
    const perMonth = total / INTERVAL_MONTHS[interval];

    if (total <= previousTotal) {
      throw new BadRequestException(
        `The ${interval} total price must be greater than a shorter commitment's total price.`,
      );
    }
    if (perMonth > previousPerMonth) {
      throw new BadRequestException(
        `The ${interval} price works out dearer per month than a shorter commitment. A longer plan must never cost more per month.`,
      );
    }

    previousTotal = total;
    previousPerMonth = perMonth;
  }
}
