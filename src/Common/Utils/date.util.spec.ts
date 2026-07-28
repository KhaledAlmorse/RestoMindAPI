import {
  BUSINESS_TIMEZONE,
  addDaysToDateString,
  getBusinessDateString,
  getBusinessDayOfWeek,
  isValidDateString,
} from './date.util';

describe('date.util', () => {
  it('exposes Africa/Cairo as the business timezone', () => {
    expect(BUSINESS_TIMEZONE).toBe('Africa/Cairo');
  });

  // NOTE: Egypt observes DST — Africa/Cairo is UTC+3 in July, UTC+2 in winter.
  // These fixtures are chosen against the July (+3) offset; do not "correct"
  // them to +2. Cairo midnight in July is 21:00Z.
  it('returns the Cairo date, not the UTC date, just after midnight local', () => {
    // 2026-07-29T22:30Z is 2026-07-30 01:30 in Cairo. UTC still says the 29th.
    const instant = new Date('2026-07-29T22:30:00.000Z');
    expect(getBusinessDateString(instant)).toBe('2026-07-30');
  });

  it('returns the Cairo date, not the UTC date, before midnight local', () => {
    // 2026-07-29T18:00Z is 2026-07-29 21:00 in Cairo — comfortably same day.
    const instant = new Date('2026-07-29T18:00:00.000Z');
    expect(getBusinessDateString(instant)).toBe('2026-07-29');
  });

  it('handles the winter offset too (UTC+2)', () => {
    // 2026-01-15T22:30Z is 2026-01-16 00:30 in Cairo at the +2 winter offset.
    expect(getBusinessDateString(new Date('2026-01-15T22:30:00.000Z'))).toBe(
      '2026-01-16',
    );
  });

  it('reports the Cairo day of week', () => {
    // 2026-07-30 in Cairo is a Thursday (4).
    expect(getBusinessDayOfWeek(new Date('2026-07-29T22:30:00.000Z'))).toBe(4);
  });

  it('returns a valid weekday index (0-6) for a known date, never undefined', () => {
    const day = getBusinessDayOfWeek(new Date('2026-07-29T22:30:00.000Z'));
    expect(typeof day).toBe('number');
    expect(Number.isInteger(day)).toBe(true);
    expect(day).toBeGreaterThanOrEqual(0);
    expect(day).toBeLessThanOrEqual(6);
  });

  it('adds days across a month boundary', () => {
    expect(addDaysToDateString('2026-07-30', 3)).toBe('2026-08-02');
    expect(addDaysToDateString('2026-08-02', -3)).toBe('2026-07-30');
  });

  it('rejects well-formed but impossible dates', () => {
    expect(isValidDateString('2026-07-30')).toBe(true);
    expect(isValidDateString('2025-13-45')).toBe(false);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('not-a-date')).toBe(false);
  });
});
