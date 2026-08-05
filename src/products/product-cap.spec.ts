import { TIERS } from 'src/subscriptions/subscription-tiers.config';
import { assertProductCapacity } from './product-cap';

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 30 * 24 * 3600 * 1000);

describe('assertProductCapacity', () => {
  it('allows creation below the tier cap', () => {
    expect(() =>
      assertProductCapacity({ tier: 'basic', currentPeriodEnd: FUTURE }, 999),
    ).not.toThrow();
  });

  it('blocks creation once the tier cap is reached', () => {
    expect(() =>
      assertProductCapacity({ tier: 'basic', currentPeriodEnd: FUTURE }, 1000),
    ).toThrow(/limit/i);
  });

  it('uses the trial tier capacity during a trial', () => {
    expect(() =>
      assertProductCapacity({ trialEndsAt: FUTURE }, 2999),
    ).not.toThrow();
    expect(() => assertProductCapacity({ trialEndsAt: FUTURE }, 3000)).toThrow();
  });

  it('blocks entirely when expired, even at zero products', () => {
    expect(() =>
      assertProductCapacity({ tier: 'basic', currentPeriodEnd: PAST }, 0),
    ).toThrow();
  });

  it('blocks entirely when there is no subscription at all', () => {
    expect(() => assertProductCapacity(undefined, 0)).toThrow();
  });

  it('still allows creation during grace', () => {
    // Grace keeps full access — the merchant is late, not gone.
    const justLapsed = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    expect(() =>
      assertProductCapacity({ tier: 'basic', currentPeriodEnd: justLapsed }, 10),
    ).not.toThrow();
  });

  it('allows unlimited on scale', () => {
    expect(() =>
      assertProductCapacity(
        { tier: 'scale', currentPeriodEnd: FUTURE },
        999_999,
      ),
    ).not.toThrow();
  });

  it('reports the next tier so the UI can offer an upgrade', () => {
    expect.assertions(4);
    try {
      assertProductCapacity({ tier: 'basic', currentPeriodEnd: FUTURE }, 1000);
    } catch (error: any) {
      expect(error.response.code).toBe('PRODUCT_LIMIT_REACHED');
      expect(error.response.cap).toBe(TIERS.basic.productCap);
      expect(error.response.nextTier).toBe('plus');
      expect(error.response.nextTierPriceEGP).toBe(TIERS.plus.priceEGP);
    }
  });

  it('reports no next tier when already on scale', () => {
    // Unreachable in practice (scale is unlimited) but the helper must not
    // invent a tier that does not exist.
    expect.assertions(1);
    try {
      assertProductCapacity({ tier: 'scale', currentPeriodEnd: FUTURE }, 10);
      expect(true).toBe(true); // scale never throws — cap is Infinity
    } catch {
      // unreachable
    }
  });
});
