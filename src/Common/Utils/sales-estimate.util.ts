import { addDaysToDateString, getBusinessDateString } from './date.util';

export const AVG_DAILY_SALES_LOOKBACK_DAYS = 14;

/**
 * Where a daily-demand figure came from. The AI service needs this, not just the
 * number: it multiplies whatever we send by the target day's calendar multiplier,
 * so the figure has to be an ORDINARY-day level.
 *
 * - `measured` — a raw mean over a real window, which therefore carries that
 *   window's own calendar (weekends, Ramadan, Eid). Must be sent with its window
 *   so the service can divide that effect back out.
 * - `owner` — the manager's `expectedDailySales`. Already an ordinary-day figure
 *   by construction: nobody answers "how much do you sell on a normal day?" with
 *   a Ramadan average.
 * - `none` — no signal; the service applies its category default.
 */
export type DailySalesEstimateSource = 'measured' | 'owner' | 'none';

export interface DailySalesEstimate {
  /** `null` means "no estimate", NOT zero. Zero means "sells nothing". */
  value: number | null;
  source: DailySalesEstimateSource;
  /** Present only for `measured`. Inclusive, Cairo calendar dates. */
  window?: { from: string; to: string };
}

/**
 * The daily demand level to send the forecasting service, with the provenance
 * the service needs to interpret it.
 *
 * Precedence: measured history > owner estimate > null (let the model decide).
 * Returning `null` rather than `0` matters — the bridge treats null as "no
 * estimate given" and applies its category default, while 0 means "sells
 * nothing" and forecasts zero.
 *
 * The measured branch divides by the FULL lookback length, not by the number of
 * rows: a day with no sales row is a day that sold nothing, not a day that did
 * not happen. Averaging over rows only would inflate the level of any product
 * that does not sell every day.
 *
 * @param referenceDate Cairo date the lookback window ends on (inclusive).
 *                      Defaults to today, which is what every live caller wants;
 *                      passed explicitly by tests so the window is deterministic.
 */
export function resolveDailySalesEstimate(
  totalSold: number,
  salesRowCount: number,
  product: { expectedDailySales?: number | null },
  referenceDate: string = getBusinessDateString(),
): DailySalesEstimate {
  if (salesRowCount > 0) {
    return {
      value: Math.round((totalSold / AVG_DAILY_SALES_LOOKBACK_DAYS) * 100) / 100,
      source: 'measured',
      window: {
        from: addDaysToDateString(
          referenceDate,
          -(AVG_DAILY_SALES_LOOKBACK_DAYS - 1),
        ),
        to: referenceDate,
      },
    };
  }

  if (
    product.expectedDailySales !== undefined &&
    product.expectedDailySales !== null
  ) {
    return { value: product.expectedDailySales, source: 'owner' };
  }

  return { value: null, source: 'none' };
}

/**
 * The estimate alone, for call sites that genuinely only need the number.
 *
 * Prefer `resolveDailySalesEstimate`: anything building an AI payload must also
 * send `avgDailySalesWindow`, or a mean measured during Ramadan gets the Ramadan
 * multiplier applied a second time.
 */
export function resolveAvgDailySales(
  totalSold: number,
  salesRowCount: number,
  product: { expectedDailySales?: number | null },
): number | null {
  return resolveDailySalesEstimate(totalSold, salesRowCount, product).value;
}
