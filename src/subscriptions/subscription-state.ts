import { addDays } from 'src/Common/Utils';
import {
  BillingInterval,
  INTERVAL_MONTHS,
  capValue,
} from './billing-interval';
import { GRACE_DAYS } from './subscription-tiers.config';

export type SubscriptionState =
  | 'trial'
  | 'active'
  | 'grace'
  | 'expired'
  | 'unpaid';

export interface SubscriptionFields {
  /** A SubscriptionPlan slug. */
  tier?: string;
  interval?: BillingInterval;
  currentPeriodEnd?: Date | null;
  trialEndsAt?: Date | null;
  lastPaymentId?: unknown;
  /** null = unlimited, absent = never set. The distinction is load-bearing. */
  productCapSnapshot?: number | null;
  planLabelSnapshot?: string;
  trialProductCap?: number | null;
}

/**
 * The single source of truth for subscription state.
 *
 * Derived rather than stored: a persisted status field would need a cron to
 * flip it and would be wrong between ticks. The guard, the UI, the
 * offer-suspension cron and the tests all call this, so they cannot disagree.
 *
 * Precedence is deliberate — a paid period always outranks a trial, so a
 * merchant who converts early is never downgraded when their trial lapses
 * underneath them.
 */
export function resolveSubscriptionState(
  sub: SubscriptionFields | undefined | null,
  now: Date = new Date(),
): SubscriptionState {
  if (!sub) return 'unpaid';

  const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;

  if (periodEnd && now <= periodEnd) return 'active';
  if (periodEnd && now <= addDays(periodEnd, GRACE_DAYS)) return 'grace';

  // Trial end gets no grace window — the trial IS the grace period. Grace is
  // reserved for lapsed payers, who have earned the benefit of the doubt.
  if (trialEnd && now <= trialEnd) return 'trial';

  if (trialEnd || periodEnd) return 'expired';
  return 'unpaid';
}

/**
 * When a month bought right now would begin.
 *
 * Paying during a free trial must not cut the trial short, and renewing early
 * must extend rather than truncate — both fall out of taking the latest of the
 * three dates. Exported so the billing screen can promise the merchant the
 * same date that `onPaid` will actually write; a UI that guessed this
 * separately would eventually contradict the ledger.
 */
export function nextPeriodStart(
  sub: SubscriptionFields | undefined | null,
  now: Date = new Date(),
): Date {
  const candidates = [now];
  if (sub?.trialEndsAt) candidates.push(new Date(sub.trialEndsAt));
  if (sub?.currentPeriodEnd) candidates.push(new Date(sub.currentPeriodEnd));
  return new Date(Math.max(...candidates.map((date) => date.getTime())));
}

/**
 * Whether a tier can be bought right now.
 *
 * A merchant who already has capacity — paid for or on trial — cannot buy the
 * same tier again, or a smaller one, until that entitlement runs out. Stacking
 * months in advance is how the same plan gets bought twice by accident, and
 * paying for a downgrade you cannot use until next month helps nobody.
 *
 * Upgrades are always allowed. Someone who has hit their product cap needs the
 * bigger tier today, not on their renewal date — blocking that would leave the
 * "upgrade to keep adding products" message pointing at a locked door.
 *
 * Once the entitlement lapses (grace, expired, unpaid) everything is buyable
 * again: that window is exactly when renewal is supposed to happen.
 */
export function canPurchasePlan(
  sub: SubscriptionFields | undefined | null,
  state: SubscriptionState,
  planCap: number | null,
  interval: BillingInterval,
  now: Date = new Date(),
): boolean {
  if (state !== 'trial' && state !== 'active') return true;
  if (capValue(planCap) > effectiveProductCap(sub, state, now)) return true;
  return INTERVAL_MONTHS[interval] > currentIntervalMonths(sub, now);
}

/**
 * Months of commitment currently held.
 *
 * 0 on a trial: nothing was bought, so every interval reads as longer and a
 * trial merchant can commit to any of them.
 */
export function currentIntervalMonths(
  sub: SubscriptionFields | undefined | null,
  now: Date = new Date(),
): number {
  if (!sub?.interval || !sub.currentPeriodEnd) return 0;
  if (now > new Date(sub.currentPeriodEnd)) return 0;
  return INTERVAL_MONTHS[sub.interval];
}

/**
 * A snapshot cap, but only while the entitlement that granted it is live.
 *
 * `undefined` is 0 rather than unlimited: an unset snapshot means the record
 * predates the plans migration, and guessing "unlimited" there would hand out
 * free capacity. `null` is genuinely unlimited.
 */
function capIfLive(cap: number | null | undefined, live: boolean): number {
  if (!live) return 0;
  if (cap === undefined) return 0;
  return capValue(cap);
}

/**
 * The product cap in force right now. 0 means "cannot create anything".
 *
 * Pure and synchronous by design — this runs on every product create, so it
 * must never need a plan lookup. It reads only what was snapshotted when the
 * entitlement was granted, which is also what stops an admin editing a plan
 * from shrinking a merchant who has already paid.
 *
 * The max() matters because a merchant can now buy a SMALLER cap on a LONGER
 * interval (see canPurchasePlan). Mid-trial that must not shrink the capacity
 * the trial promised — and it preserves the older intent that someone who
 * hits their cap and upgrades gets the bigger cap today, not at renewal.
 */
export function effectiveProductCap(
  sub: SubscriptionFields | undefined | null,
  state: SubscriptionState,
  now: Date = new Date(),
): number {
  if (!hasDashboardAccess(state)) return 0;

  const trialLive = !!sub?.trialEndsAt && now <= new Date(sub.trialEndsAt);
  const paidLive =
    !!sub?.currentPeriodEnd &&
    now <= addDays(new Date(sub.currentPeriodEnd), GRACE_DAYS);

  return Math.max(
    capIfLive(sub?.trialProductCap, trialLive),
    capIfLive(sub?.productCapSnapshot, paidLive),
  );
}

/** States in which the dashboard is fully usable and offers stay live. */
export function hasDashboardAccess(state: SubscriptionState): boolean {
  return state === 'trial' || state === 'active' || state === 'grace';
}
