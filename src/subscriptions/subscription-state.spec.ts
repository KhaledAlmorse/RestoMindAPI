import {
  TIERS,
  TRIAL_TIER,
  splitVat,
  tierPriceCents,
} from './subscription-tiers.config';
import {
  canPurchaseTier,
  effectiveProductCap,
  effectiveTier,
  hasDashboardAccess,
  nextPeriodStart,
  resolveSubscriptionState,
} from './subscription-state';

const NOW = new Date('2026-08-05T12:00:00.000Z');

describe('resolveSubscriptionState', () => {
  it('is unpaid when there is no subscription at all', () => {
    expect(resolveSubscriptionState(undefined, NOW)).toBe('unpaid');
    expect(resolveSubscriptionState({}, NOW)).toBe('unpaid');
  });

  it('is trial while trialEndsAt is in the future', () => {
    const sub = { trialEndsAt: new Date('2026-08-10T12:00:00.000Z') };
    expect(resolveSubscriptionState(sub, NOW)).toBe('trial');
  });

  it('is still trial at the exact trial-end instant', () => {
    expect(resolveSubscriptionState({ trialEndsAt: NOW }, NOW)).toBe('trial');
  });

  it('goes straight to expired one millisecond after the trial ends', () => {
    // Trial end has NO grace — the trial IS the grace. Grace is reserved for
    // lapsed payers, who have earned the benefit of the doubt.
    const sub = { trialEndsAt: new Date(NOW.getTime() - 1) };
    expect(resolveSubscriptionState(sub, NOW)).toBe('expired');
  });

  it('is active while the paid period is current', () => {
    const sub = {
      tier: 'basic' as const,
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    };
    expect(resolveSubscriptionState(sub, NOW)).toBe('active');
  });

  it('is active at the exact period-end instant', () => {
    const sub = { tier: 'basic' as const, currentPeriodEnd: NOW };
    expect(resolveSubscriptionState(sub, NOW)).toBe('active');
  });

  it('is grace within GRACE_DAYS after the period ends', () => {
    const sub = {
      tier: 'basic' as const,
      currentPeriodEnd: new Date('2026-08-01T12:00:00.000Z'),
    };
    expect(resolveSubscriptionState(sub, NOW)).toBe('grace'); // 4 days past
  });

  it('is grace on the final day of the grace window', () => {
    const sub = {
      tier: 'basic' as const,
      currentPeriodEnd: new Date('2026-07-29T12:00:00.000Z'),
    };
    expect(resolveSubscriptionState(sub, NOW)).toBe('grace'); // exactly 7 days
  });

  it('is expired once the grace window has passed', () => {
    const sub = {
      tier: 'basic' as const,
      currentPeriodEnd: new Date('2026-07-20T12:00:00.000Z'),
    };
    expect(resolveSubscriptionState(sub, NOW)).toBe('expired');
  });

  it('lets a paid period outrank a still-running trial', () => {
    // A merchant who converts early must never be downgraded by their own
    // trial expiring underneath them.
    const sub = {
      tier: 'plus' as const,
      trialEndsAt: new Date('2026-08-06T12:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-06T12:00:00.000Z'),
    };
    expect(resolveSubscriptionState(sub, NOW)).toBe('active');
  });

  it('falls back to the trial when the paid period has fully lapsed', () => {
    const sub = {
      tier: 'basic' as const,
      currentPeriodEnd: new Date('2026-06-01T12:00:00.000Z'),
      trialEndsAt: new Date('2026-08-20T12:00:00.000Z'),
    };
    expect(resolveSubscriptionState(sub, NOW)).toBe('trial');
  });

  it('is expired when an admin revokes the trial by backdating it', () => {
    const sub = { trialEndsAt: new Date('2026-08-05T11:59:59.000Z') };
    expect(resolveSubscriptionState(sub, NOW)).toBe('expired');
  });

  it('handles date values arriving as strings from Mongo', () => {
    const sub = { trialEndsAt: '2026-08-10T12:00:00.000Z' as any };
    expect(resolveSubscriptionState(sub, NOW)).toBe('trial');
  });
});

describe('hasDashboardAccess', () => {
  it('allows trial, active and grace', () => {
    expect(hasDashboardAccess('trial')).toBe(true);
    expect(hasDashboardAccess('active')).toBe(true);
    expect(hasDashboardAccess('grace')).toBe(true);
  });

  it('denies expired and unpaid', () => {
    expect(hasDashboardAccess('expired')).toBe(false);
    expect(hasDashboardAccess('unpaid')).toBe(false);
  });
});

describe('effectiveTier and effectiveProductCap', () => {
  it('grants trial-tier capacity during the trial', () => {
    const sub = { trialEndsAt: new Date('2026-08-20T12:00:00.000Z') };
    expect(effectiveTier(sub, 'trial')).toBe(TRIAL_TIER);
    expect(effectiveProductCap(sub, 'trial')).toBe(TIERS[TRIAL_TIER].productCap);
  });

  it('uses the paid tier when active', () => {
    const sub = {
      tier: 'basic' as const,
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    };
    expect(effectiveTier(sub, 'active')).toBe('basic');
    expect(effectiveProductCap(sub, 'active')).toBe(1000);
  });

  it('keeps the paid tier during grace', () => {
    const sub = {
      tier: 'plus' as const,
      currentPeriodEnd: new Date('2026-08-01T12:00:00.000Z'),
    };
    expect(effectiveProductCap(sub, 'grace')).toBe(3000);
  });

  it('grants no capacity when expired or unpaid', () => {
    expect(effectiveProductCap({ tier: 'basic' }, 'expired')).toBe(0);
    expect(effectiveProductCap(undefined, 'unpaid')).toBe(0);
  });

  it('treats scale as unlimited', () => {
    const sub = {
      tier: 'scale' as const,
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    };
    expect(effectiveProductCap(sub, 'active')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('pricing helpers', () => {
  it('converts tier prices to integer piasters', () => {
    expect(tierPriceCents('basic')).toBe(30000);
    expect(tierPriceCents('plus')).toBe(60000);
    expect(tierPriceCents('scale')).toBe(150000);
  });

  it('splits VAT out of a VAT-inclusive amount', () => {
    const { netCents, vatCents } = splitVat(30000);
    expect(vatCents).toBe(3684); // 300 - 300/1.14 = 36.84 EGP
    expect(netCents).toBe(26316);
  });

  it('never loses a piaster on any tier', () => {
    for (const total of [30000, 60000, 150000]) {
      const { netCents, vatCents } = splitVat(total);
      expect(netCents + vatCents).toBe(total);
    }
  });
});

describe('nextPeriodStart', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('starts a purchase at the end of an unfinished trial', () => {
    // Paying on day 3 of a 14-day trial must not throw away the other 11.
    const trialEndsAt = new Date('2026-08-19T12:00:00Z');
    expect(nextPeriodStart({ trialEndsAt }, now)).toEqual(trialEndsAt);
  });

  it('extends an early renewal instead of truncating it', () => {
    const currentPeriodEnd = new Date('2026-09-19T12:00:00Z');
    expect(nextPeriodStart({ currentPeriodEnd }, now)).toEqual(
      currentPeriodEnd,
    );
  });

  it('starts now once both trial and paid period are behind us', () => {
    expect(
      nextPeriodStart(
        {
          trialEndsAt: new Date('2026-07-01T00:00:00Z'),
          currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
        },
        now,
      ),
    ).toEqual(now);
  });

  it('starts now for a restaurant that has never had either', () => {
    expect(nextPeriodStart(undefined, now)).toEqual(now);
  });
});

describe('canPurchaseTier', () => {
  const now = new Date('2026-08-05T12:00:00Z');
  const future = new Date('2026-09-19T12:00:00Z');
  const past = new Date('2026-07-01T12:00:00Z');

  it('refuses the plan a paying merchant already holds', () => {
    const sub = { tier: 'plus' as const, currentPeriodEnd: future };
    expect(canPurchaseTier(sub, 'plus', now)).toBe(false);
  });

  it('refuses a downgrade they could not use until next month anyway', () => {
    const sub = { tier: 'plus' as const, currentPeriodEnd: future };
    expect(canPurchaseTier(sub, 'basic', now)).toBe(false);
  });

  it('allows an upgrade immediately', () => {
    // Someone who has hit their product cap needs the bigger tier today —
    // making them wait for a renewal date would strand their catalogue.
    const sub = { tier: 'plus' as const, currentPeriodEnd: future };
    expect(canPurchaseTier(sub, 'scale', now)).toBe(true);
  });

  it('treats a trial as holding the trial tier', () => {
    const sub = { trialEndsAt: future };
    expect(canPurchaseTier(sub, 'basic', now)).toBe(false);
    expect(canPurchaseTier(sub, 'plus', now)).toBe(false);
    expect(canPurchaseTier(sub, 'scale', now)).toBe(true);
  });

  it('opens everything up during grace — that is the renewal window', () => {
    const sub = { tier: 'plus' as const, currentPeriodEnd: past };
    expect(canPurchaseTier(sub, 'plus', now)).toBe(true);
    expect(canPurchaseTier(sub, 'basic', now)).toBe(true);
  });

  it('opens everything up for a restaurant that has never subscribed', () => {
    expect(canPurchaseTier(undefined, 'basic', now)).toBe(true);
  });
});
