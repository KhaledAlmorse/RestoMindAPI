/**
 * Shapes product data for the forecasting microservice.
 *
 * The AI service resolves a product's calendar sensitivity by keyword-matching
 * the category *name* (Arabic or English) against its market priors — "معجنات"
 * and "croissant" both land on `pastry`, which is what carries the Ramadan and
 * kahk-season behaviour. Anything it cannot match falls back to neutral priors,
 * silently, with a 200 response.
 *
 * So a category that arrives as a bare ObjectId is not a cosmetic problem: the
 * product loses the entire calendar signal, which is the main thing the model
 * contributes. Route every AI payload through here rather than reaching into
 * `product.category` at the call site.
 */

/** Populated `category` documents look like this once `populate('category')` ran. */
interface PopulatedCategory {
  name?: string;
}

/**
 * The category's display name, or `'General'` when it is unpopulated, missing,
 * or nameless.
 *
 * An unpopulated `category` is a Mongoose ObjectId — truthy, and serialising to
 * a 24-char hex string — so a plain `product.category || 'General'` passes the
 * ObjectId straight through to the AI service. The `typeof` check is what
 * distinguishes "populated document" from "raw reference"; keep it.
 */
/**
 * Closing hour used when a restaurant has not set one. Kept at the value that
 * was previously hardcoded at the call site, so restaurants that never
 * configure `closeHour` behave exactly as before.
 */
export const DEFAULT_CLOSE_HOUR = 22;

/**
 * A restaurant's closing hour as a Cairo wall-clock hour, 0–23.
 *
 * The surplus scan sizes its discount from the selling time left before this
 * hour. A wrong value is not a rounding error: a bakery that closes at 18:00
 * evaluated against 22 looks like it has four more hours to sell through, so
 * the discount is too small and fires too late to clear anything.
 *
 * Rejects non-integers and out-of-range values rather than forwarding them —
 * the AI service indexes an hourly sell-through curve with this.
 */
export function resolveCloseHour(closeHour: unknown): number {
  if (
    typeof closeHour === 'number' &&
    Number.isInteger(closeHour) &&
    closeHour >= 0 &&
    closeHour <= 23
  ) {
    return closeHour;
  }
  return DEFAULT_CLOSE_HOUR;
}

export function resolveCategoryName(category: unknown): string {
  if (
    category &&
    typeof category === 'object' &&
    typeof (category as PopulatedCategory).name === 'string' &&
    (category as PopulatedCategory).name!.trim()
  ) {
    return (category as PopulatedCategory).name!.trim();
  }
  return 'General';
}
