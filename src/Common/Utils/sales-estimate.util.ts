export const AVG_DAILY_SALES_LOOKBACK_DAYS = 14;

/**
 * The daily demand level to send the forecasting service.
 *
 * Precedence: measured history > owner estimate > null (let the model decide).
 * Returning `null` rather than `0` matters — the bridge treats null as "no
 * estimate given" and applies its category default, while 0 means "sells
 * nothing" and forecasts zero.
 */
export function resolveAvgDailySales(
  totalSold: number,
  salesRowCount: number,
  product: { expectedDailySales?: number | null },
): number | null {
  if (salesRowCount > 0) {
    return Math.round((totalSold / AVG_DAILY_SALES_LOOKBACK_DAYS) * 100) / 100;
  }
  if (
    product.expectedDailySales !== undefined &&
    product.expectedDailySales !== null
  ) {
    return product.expectedDailySales;
  }
  return null;
}
