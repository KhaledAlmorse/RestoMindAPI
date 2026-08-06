import { BadRequestException } from '@nestjs/common';
import {
  assertMonotonicLadder,
  perMonthCents,
  planPriceCents,
} from './plan-pricing';

const BASIC = { prices: { monthly: 30000, halfYearly: 165000, yearly: 300000 } };
const SCALE = {
  prices: { monthly: 150000, halfYearly: 825000, yearly: 1500000 },
};

describe('planPriceCents', () => {
  it('returns the standard price when early bird does not apply', () => {
    expect(planPriceCents(BASIC, 'monthly', false, 33.3333)).toBe(30000);
  });

  it('reproduces every legacy early-bird price exactly', () => {
    expect(planPriceCents(BASIC, 'monthly', true, 33.3333)).toBe(20000);
    expect(planPriceCents(BASIC, 'halfYearly', true, 33.3333)).toBe(110000);
    expect(planPriceCents(BASIC, 'yearly', true, 33.3333)).toBe(200000);
    // The case that fails at 33.33 — it would come out as 1000100.
    expect(planPriceCents(SCALE, 'yearly', true, 33.3333)).toBe(1000000);
  });

  it('rounds a discounted price to whole EGP, never fractional piasters', () => {
    const price = planPriceCents(
      { prices: { monthly: 33333, halfYearly: null, yearly: null } },
      'monthly',
      true,
      33.3333,
    );
    expect(price! % 100).toBe(0);
  });

  it('returns null for an interval that is not sold', () => {
    expect(
      planPriceCents(
        { prices: { monthly: 30000, halfYearly: null, yearly: null } },
        'yearly',
        false,
        33.3333,
      ),
    ).toBeNull();
  });

  it('ignores a zero or negative discount rather than inflating the price', () => {
    expect(planPriceCents(BASIC, 'monthly', true, 0)).toBe(30000);
  });
});

describe('perMonthCents', () => {
  it('divides by the interval length', () => {
    expect(perMonthCents(BASIC, 'yearly')).toBe(25000);
    expect(perMonthCents(BASIC, 'halfYearly')).toBe(27500);
    expect(perMonthCents(BASIC, 'monthly')).toBe(30000);
  });

  it('returns null for an unsold interval', () => {
    expect(
      perMonthCents(
        { prices: { monthly: 30000, halfYearly: null, yearly: null } },
        'yearly',
      ),
    ).toBeNull();
  });
});

describe('assertMonotonicLadder', () => {
  it('accepts a ladder where longer commitments cost less per month', () => {
    expect(() => assertMonotonicLadder(BASIC.prices)).not.toThrow();
  });

  it('accepts a ladder with unpriced intervals', () => {
    expect(() =>
      assertMonotonicLadder({
        monthly: 30000,
        halfYearly: null,
        yearly: 300000,
      }),
    ).not.toThrow();
  });

  it('accepts equal per-month prices across intervals', () => {
    expect(() =>
      assertMonotonicLadder({
        monthly: 30000,
        halfYearly: 180000,
        yearly: 360000,
      }),
    ).not.toThrow();
  });

  it('rejects a yearly price that is worse value than monthly', () => {
    expect(() =>
      assertMonotonicLadder({
        monthly: 30000,
        halfYearly: null,
        yearly: 400000,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a half-yearly price dearer per month than monthly', () => {
    expect(() =>
      assertMonotonicLadder({
        monthly: 30000,
        halfYearly: 200000,
        yearly: 300000,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a plan with no priced interval', () => {
    expect(() =>
      assertMonotonicLadder({ monthly: null, halfYearly: null, yearly: null }),
    ).toThrow(BadRequestException);
  });
});
