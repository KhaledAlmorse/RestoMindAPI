import {
  DEFAULT_COMMISSION_RATE,
  PAYOUT_HOLD_DAYS,
  commissionCentsFor,
  commissionRateFor,
} from './payout.config';
import { DISPUTE_WINDOW_HOURS } from 'src/orders/refund-policy';

describe('commissionRateFor', () => {
  it('prefers the restaurant rate', () => {
    expect(commissionRateFor({ commissionRate: 0.2 })).toBe(0.2);
  });

  it('falls back to the platform default when unset', () => {
    expect(commissionRateFor({})).toBe(DEFAULT_COMMISSION_RATE);
  });

  it('honours an explicit zero rate rather than treating it as unset', () => {
    // A merchant on a zero-commission promo must not silently be charged 15%.
    expect(commissionRateFor({ commissionRate: 0 })).toBe(0);
  });
});

describe('commissionCentsFor', () => {
  it('computes a whole number of piasters', () => {
    expect(commissionCentsFor(10_000, 0.15)).toBe(1_500);
  });

  it('rounds a fractional piaster instead of carrying a float', () => {
    // 33.33 EGP at 15% = 499.95 piasters.
    const result = commissionCentsFor(3_333, 0.15);
    expect(result).toBe(500);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('returns zero for a zero rate', () => {
    expect(commissionCentsFor(10_000, 0)).toBe(0);
  });
});

describe('PAYOUT_HOLD_DAYS', () => {
  it('outlives the refund dispute window', () => {
    // Paying out inside the window means clawing money back from a merchant
    // who has already spent it. This test fails loudly if either constant moves.
    expect(PAYOUT_HOLD_DAYS * 24).toBeGreaterThan(DISPUTE_WINDOW_HOURS);
  });
});
