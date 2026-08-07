/**
 * Business-date helpers.
 *
 * Every date the business reasons about (a production-plan day, a prediction's
 * targetWeek) is a calendar date in Cairo, stored as a `YYYY-MM-DD` string.
 * Deriving it from `new Date().toISOString()` returns the *UTC* date, which is
 * a day behind between 00:00 and 02:00 Cairo time — so a midnight cron would
 * write yesterday's plan. Always go through these helpers.
 */

export const BUSINESS_TIMEZONE = 'Africa/Cairo';

// 'en-CA' formats as YYYY-MM-DD, which is exactly our storage format.
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Today's calendar date in Cairo, as `YYYY-MM-DD`. */
export function getBusinessDateString(now: Date = new Date()): string {
  return DATE_FORMATTER.format(now);
}

/** Day of week in Cairo: 0 = Sunday … 6 = Saturday. */
export function getBusinessDayOfWeek(now: Date = new Date()): number {
  const weekday = WEEKDAY_FORMATTER.format(now);
  const index = WEEKDAY_INDEX[weekday];
  if (index === undefined) {
    throw new Error(
      `getBusinessDayOfWeek: unexpected ICU short-weekday value "${weekday}"`,
    );
  }
  return index;
}

/**
 * Calendar arithmetic on a `YYYY-MM-DD` string. Operates at UTC noon so a DST
 * shift can never push the result onto an adjacent day.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  const yy = anchor.getUTCFullYear();
  const mm = String(anchor.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(anchor.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Offset (in ms) such that `local time = instant + offset`, for the given
 * timezone at the given instant. Computed by re-formatting the instant in
 * that timezone and diffing against its raw UTC value, rather than assuming
 * a fixed offset — Africa/Cairo is UTC+3 in summer and UTC+2 in winter.
 */
function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - instant.getTime();
}

/** UTC instant of local midnight for `dateStr` in the given timezone. */
function startOfBusinessDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // A candidate instant labelled with the target date at UTC midnight. Its
  // Cairo offset (probed via Intl) tells us how far that candidate actually
  // sits from true Cairo midnight, so we can correct it.
  const candidate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetMs = getTimeZoneOffsetMs(candidate, BUSINESS_TIMEZONE);
  return new Date(candidate.getTime() - offsetMs);
}

/**
 * The UTC instants bounding the Cairo calendar day `dateStr`, as a half-open
 * `[start, end)` range. Used to build query windows that actually match the
 * Cairo day they claim to, instead of a UTC-aligned span mislabelled with a
 * Cairo date string.
 */
export function getBusinessDayRange(dateStr: string): {
  start: Date;
  end: Date;
} {
  return {
    start: startOfBusinessDay(dateStr),
    end: startOfBusinessDay(addDaysToDateString(dateStr, 1)),
  };
}

type CairoParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** The Cairo wall-clock components of an instant. */
function getBusinessParts(instant: Date): CairoParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Shifts an instant by rewriting its *Cairo* calendar components, then
 * re-deriving the UTC instant from them.
 *
 * Doing the arithmetic on the local calendar rather than on the epoch value is
 * what keeps the wall-clock time of day fixed across a DST transition: adding
 * 14 days to 15:00 Cairo yields 15:00 Cairo, not 14:00, even when the offset
 * changed from +3 to +2 in between.
 */
function shiftBusinessCalendar(
  instant: Date,
  shift: (parts: CairoParts) => CairoParts,
): Date {
  const target = shift(getBusinessParts(instant));

  // Treat the target components as if they were UTC, then correct by the
  // Cairo offset that actually applies *at that* moment — probing the
  // candidate rather than the original is what makes this DST-correct.
  const naive = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
    instant.getUTCMilliseconds(),
  );
  const offsetMs = getTimeZoneOffsetMs(new Date(naive), BUSINESS_TIMEZONE);
  return new Date(naive - offsetMs);
}

/**
 * Adds days to an instant, preserving the Cairo wall-clock time of day.
 *
 * A naive `+ n * 86400000` drifts by an hour whenever the span crosses Egypt's
 * DST boundary, which silently moves a subscription's expiry. Accepts negative
 * values.
 */
export function addDays(instant: Date, days: number): Date {
  return shiftBusinessCalendar(instant, (parts) => ({
    ...parts,
    day: parts.day + days,
  }));
}

/**
 * Adds calendar months, clamping to the last valid day of the target month:
 * 31 Jan + 1 month is 28 Feb (29 in a leap year), never 3 March. Accepts
 * negative values.
 */
export function addMonths(instant: Date, months: number): Date {
  return shiftBusinessCalendar(instant, (parts) => {
    const zeroBased = parts.month - 1 + months;
    const year = parts.year + Math.floor(zeroBased / 12);
    const month = (((zeroBased % 12) + 12) % 12) + 1;
    // Day 0 of the following month is the last day of this one.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { ...parts, year, month, day: Math.min(parts.day, lastDay) };
  });
}

/** True only for a well-formed AND real calendar date. */
export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}
