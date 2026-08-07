/**
 * What is left of the old compile-time tier table.
 *
 * Plans — labels, product caps and prices — now live in the
 * `subscriptionplans` collection and are managed by an admin. Only the two
 * timing constants remain here, because they are platform policy rather than
 * per-plan commercial terms.
 *
 * TRIAL_DAYS is the fallback length; the live value is
 * SystemSettings.trialDurationDays, which an admin can change without a deploy.
 * Which plan a trial borrows its capacity from is the plan flagged
 * `isTrialPlan`, not a constant.
 */

/** Days after currentPeriodEnd during which a LAPSED PAYER keeps full access. */
export const GRACE_DAYS = 7;

/** Default trial length, counted from setup-account completion. */
export const TRIAL_DAYS = 14;
