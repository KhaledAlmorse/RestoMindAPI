import { addDays } from 'src/Common/Utils';
import {
  GRACE_DAYS,
  TIERS,
  TRIAL_TIER,
  TierName,
} from './subscription-tiers.config';

export type SubscriptionState =
  | 'trial'
  | 'active'
  | 'grace'
  | 'expired'
  | 'unpaid';

export interface SubscriptionFields {
  tier?: TierName;
  currentPeriodEnd?: Date | null;
  trialEndsAt?: Date | null;
  lastPaymentId?: unknown;
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
export function canPurchaseTier(
  sub: SubscriptionFields | undefined | null,
  target: TierName,
  now: Date = new Date(),
): boolean {
  const state = resolveSubscriptionState(sub, now);
  if (state !== 'trial' && state !== 'active') return true;

  const held = effectiveTier(sub, state);
  if (!held) return true;

  return TIERS[target].productCap > TIERS[held].productCap;
}

/** The tier whose limits currently apply. Trials borrow TRIAL_TIER's capacity. */
export function effectiveTier(
  sub: SubscriptionFields | undefined | null,
  state: SubscriptionState,
): TierName | null {
  if (state === 'trial') return TRIAL_TIER;
  if (state === 'active' || state === 'grace') return sub?.tier ?? null;
  return null;
}

/** 0 means "cannot create anything" — expired and unpaid both land here. */
export function effectiveProductCap(
  sub: SubscriptionFields | undefined | null,
  state: SubscriptionState,
): number {
  const tier = effectiveTier(sub, state);
  return tier ? TIERS[tier].productCap : 0;
}

/** States in which the dashboard is fully usable and offers stay live. */
export function hasDashboardAccess(state: SubscriptionState): boolean {
  return state === 'trial' || state === 'active' || state === 'grace';
}
