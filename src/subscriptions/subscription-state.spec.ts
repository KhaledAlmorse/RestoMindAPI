import { addDays, splitVat } from 'src/Common/Utils';
import {
  canPurchasePlan,
  currentIntervalMonths,
  effectiveProductCap,
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

describe('effectiveProductCap', () => {
  const future = (days: number) => addDays(NOW, days);

  it('grants no capacity when expired or unpaid', () => {
    expect(effectiveProductCap({}, 'unpaid', NOW)).toBe(0);
    expect(
      effectiveProductCap({ productCapSnapshot: 1000 }, 'expired', NOW),
    ).toBe(0);
    expect(effectiveProductCap(undefined, 'unpaid', NOW)).toBe(0);
  });

  it('reads the paid snapshot for an active subscription', () => {
    const sub = { currentPeriodEnd: future(10), productCapSnapshot: 1000 };
    expect(effectiveProductCap(sub, 'active', NOW)).toBe(1000);
  });

  it('treats a null snapshot as unlimited', () => {
    const sub = { currentPeriodEnd: future(10), productCapSnapshot: null };
    expect(effectiveProductCap(sub, 'active', NOW)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('treats an unset snapshot as zero, never as unlimited', () => {
    // A pre-migration record must not be handed free capacity.
    const sub = { currentPeriodEnd: future(10) };
    expect(effectiveProductCap(sub, 'active', NOW)).toBe(0);
  });

  it('keeps the trial cap while the trial is still running', () => {
    const sub = { trialEndsAt: future(5), trialProductCap: 3000 };
    expect(effectiveProductCap(sub, 'trial', NOW)).toBe(3000);
  });

  it('still honours the paid cap during grace', () => {
    const sub = { currentPeriodEnd: addDays(NOW, -2), productCapSnapshot: 1000 };
    expect(resolveSubscriptionState(sub, NOW)).toBe('grace');
    expect(effectiveProductCap(sub, 'grace', NOW)).toBe(1000);
  });

  // The case the "longer interval" purchase rule creates: buying a
  // smaller-cap, longer-interval plan mid-trial must not shrink capacity.
  it('takes the larger of trial and paid caps while the trial runs', () => {
    const sub = {
      trialEndsAt: future(5),
      trialProductCap: 3000,
      currentPeriodEnd: future(370),
      productCapSnapshot: 1000,
    };
    expect(effectiveProductCap(sub, 'active', NOW)).toBe(3000);
  });

  it('drops to the paid cap once the trial has ended', () => {
    const sub = {
      trialEndsAt: addDays(NOW, -1),
      trialProductCap: 3000,
      currentPeriodEnd: future(370),
      productCapSnapshot: 1000,
    };
    expect(effectiveProductCap(sub, 'active', NOW)).toBe(1000);
  });

  it('gives a mid-trial upgrade its bigger cap immediately', () => {
    const sub = {
      trialEndsAt: future(5),
      trialProductCap: 3000,
      currentPeriodEnd: future(35),
      productCapSnapshot: null,
    };
    expect(effectiveProductCap(sub, 'active', NOW)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('currentIntervalMonths', () => {
  it('is 0 on a trial, so every interval counts as longer', () => {
    expect(
      currentIntervalMonths({ trialEndsAt: addDays(NOW, 5) }, NOW),
    ).toBe(0);
  });

  it('reflects the interval held while the period is live', () => {
    const sub = { interval: 'yearly' as const, currentPeriodEnd: addDays(NOW, 5) };
    expect(currentIntervalMonths(sub, NOW)).toBe(12);
  });

  it('is 0 once the period has lapsed', () => {
    const sub = { interval: 'yearly' as const, currentPeriodEnd: addDays(NOW, -1) };
    expect(currentIntervalMonths(sub, NOW)).toBe(0);
  });
});

describe('VAT split', () => {
  it('never loses a piaster at any seeded price', () => {
    for (const total of [30000, 165000, 300000, 60000, 1500000]) {
      const { netCents, vatCents } = splitVat(total);
      expect(netCents + vatCents).toBe(total);
    }
  });

  it('splits VAT out of a VAT-inclusive amount', () => {
    const { netCents, vatCents } = splitVat(30000);
    expect(vatCents).toBe(3684); // 300 - 300/1.14 = 36.84 EGP
    expect(netCents).toBe(26316);
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

describe('canPurchasePlan', () => {
  const now = new Date('2026-08-05T12:00:00Z');
  const future = new Date('2026-09-19T12:00:00Z');
  const past = new Date('2026-07-01T12:00:00Z');

  const activeMonthly = {
    tier: 'basic',
    interval: 'monthly' as const,
    currentPeriodEnd: future,
    productCapSnapshot: 1000,
  };

  it('allows anything once the subscription has lapsed', () => {
    expect(canPurchasePlan({}, 'unpaid', 1000, 'monthly', now)).toBe(true);
    expect(canPurchasePlan(undefined, 'unpaid', 1000, 'monthly', now)).toBe(
      true,
    );
  });

  it('blocks the same capacity on the same interval', () => {
    expect(
      canPurchasePlan(activeMonthly, 'active', 1000, 'monthly', now),
    ).toBe(false);
  });

  it('allows the same capacity on a longer interval', () => {
    expect(
      canPurchasePlan(activeMonthly, 'active', 1000, 'halfYearly', now),
    ).toBe(true);
    expect(canPurchasePlan(activeMonthly, 'active', 1000, 'yearly', now)).toBe(
      true,
    );
  });

  it('allows a bigger cap on any interval', () => {
    expect(
      canPurchasePlan(activeMonthly, 'active', 3000, 'monthly', now),
    ).toBe(true);
  });

  it('allows unlimited on any interval', () => {
    expect(canPurchasePlan(activeMonthly, 'active', null, 'monthly', now)).toBe(
      true,
    );
  });

  it('blocks a smaller cap on a shorter-or-equal interval', () => {
    const yearly = {
      tier: 'plus',
      interval: 'yearly' as const,
      currentPeriodEnd: future,
      productCapSnapshot: 3000,
    };
    expect(canPurchasePlan(yearly, 'active', 1000, 'monthly', now)).toBe(false);
    expect(canPurchasePlan(yearly, 'active', 1000, 'yearly', now)).toBe(false);
  });

  it('lets a trial merchant commit to any interval', () => {
    // A trial bought no interval, so every interval reads as longer.
    const trial = { trialEndsAt: future, trialProductCap: 3000 };
    expect(canPurchasePlan(trial, 'trial', 1000, 'monthly', now)).toBe(true);
    expect(canPurchasePlan(trial, 'trial', 3000, 'yearly', now)).toBe(true);
  });

  it('opens everything up during grace — that is the renewal window', () => {
    const sub = {
      tier: 'plus',
      interval: 'monthly' as const,
      currentPeriodEnd: past,
      productCapSnapshot: 3000,
    };
    expect(canPurchasePlan(sub, 'grace', 3000, 'monthly', now)).toBe(true);
    expect(canPurchasePlan(sub, 'grace', 1000, 'monthly', now)).toBe(true);
  });
});
