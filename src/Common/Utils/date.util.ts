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
