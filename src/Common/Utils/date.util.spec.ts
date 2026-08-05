import {
  BUSINESS_TIMEZONE,
  addDays,
  addDaysToDateString,
  addMonths,
  getBusinessDateString,
  getBusinessDayOfWeek,
  getBusinessDayRange,
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

  describe('getBusinessDayRange', () => {
    it('bounds a summer (UTC+3) Cairo calendar day', () => {
      const { start, end } = getBusinessDayRange('2026-07-15');
      expect(start.toISOString()).toBe('2026-07-14T21:00:00.000Z');
      expect(end.toISOString()).toBe('2026-07-15T21:00:00.000Z');
    });

    it('bounds a winter (UTC+2) Cairo calendar day', () => {
      const { start, end } = getBusinessDayRange('2026-01-15');
      expect(start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
      expect(end.toISOString()).toBe('2026-01-15T22:00:00.000Z');
    });
  });
});

describe('addDays', () => {
  it('adds whole days preserving the Cairo wall-clock time', () => {
    // 2026-07-29T18:00Z = 2026-07-29 21:00 Cairo (+3)
    const result = addDays(new Date('2026-07-29T18:00:00.000Z'), 7);
    expect(getBusinessDateString(result)).toBe('2026-08-05');
  });

  it('does not drift across the summer-to-winter DST boundary', () => {
    // Egypt ends DST in late October. Crossing it must not shift the Cairo
    // wall-clock hour, even though the UTC offset changes +3 -> +2.
    const start = new Date('2026-10-20T12:00:00.000Z'); // 15:00 Cairo (+3)
    const result = addDays(start, 14); // lands in November
    const cairoHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TIMEZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(result);
    expect(cairoHour).toBe('15');
  });

  it('accepts negative days', () => {
    const result = addDays(new Date('2026-08-05T18:00:00.000Z'), -7);
    expect(getBusinessDateString(result)).toBe('2026-07-29');
  });

  it('is a no-op for zero days', () => {
    const instant = new Date('2026-07-29T18:00:00.000Z');
    expect(addDays(instant, 0).toISOString()).toBe(instant.toISOString());
  });
});

describe('addMonths', () => {
  it('adds one calendar month', () => {
    const result = addMonths(new Date('2026-03-15T10:00:00.000Z'), 1);
    expect(getBusinessDateString(result)).toBe('2026-04-15');
  });

  it('clamps to the last day when the target month is shorter', () => {
    // 31 Jan + 1 month has no 31 Feb — must clamp to 28 Feb, not roll to 3 Mar.
    const result = addMonths(new Date('2026-01-31T10:00:00.000Z'), 1);
    expect(getBusinessDateString(result)).toBe('2026-02-28');
  });

  it('clamps to 29 February in a leap year', () => {
    const result = addMonths(new Date('2028-01-31T10:00:00.000Z'), 1);
    expect(getBusinessDateString(result)).toBe('2028-02-29');
  });

  it('rolls the year over', () => {
    const result = addMonths(new Date('2026-12-15T10:00:00.000Z'), 1);
    expect(getBusinessDateString(result)).toBe('2027-01-15');
  });

  it('rolls the year backwards for a negative month', () => {
    const result = addMonths(new Date('2026-01-15T10:00:00.000Z'), -1);
    expect(getBusinessDateString(result)).toBe('2025-12-15');
  });

  it('preserves the Cairo wall-clock hour across a winter-to-summer change', () => {
    // Feb (+2) -> May (+3). The local hour must not move.
    const result = addMonths(new Date('2026-02-15T10:00:00.000Z'), 3);
    const cairoHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TIMEZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(result);
    expect(cairoHour).toBe('12'); // 10:00Z in Feb is 12:00 Cairo
  });
});
