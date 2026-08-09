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

/** The product shape every AI payload uses. Mirrors the service's `RMProduct`. */
export interface AiProductPayload {
  productId: string;
  title: string;
  category: string;
  price: number;
  unitCost: number | null;
  freshnessWindow: number | null;
}

/**
 * The single definition of how a Product is described to the AI service.
 *
 * Call sites used to build this by hand, and they drifted: the CSV ingest path
 * sent only `{ productId, title, category }` while the backfill path also sent
 * `price` and `freshnessWindow`. Those two are what the service computes the
 * newsvendor quantile from, so products onboarded by CSV import arrived without
 * the economics — and, because the registry replaced the stored record on every
 * upsert, a CSV import could strip economics an earlier backfill had populated.
 *
 * `freshnessWindow` stays `null` rather than defaulting to a number: the shelf
 * life of an unknown product is unknown, and inventing one silently sets a
 * service level nobody chose. `unitCost` is the same story: there is no cost
 * field to read off `product` directly (see `ProductCostService`, which derives
 * it from the recipe/BOM), so it is always passed in explicitly rather than
 * guessed at here -- omitting it means "unknown", never 0 ("free to produce").
 */
export function buildAiProductPayload(
  product: any,
  unitCost: number | null = null,
): AiProductPayload {
  return {
    productId: product._id.toString(),
    title: product.title || 'Product',
    category: resolveCategoryName(product.category),
    price: product.price || 0,
    unitCost,
    freshnessWindow: product.freshnessWindow ?? null,
  };
}

/**
 * The products an ingest needs to describe: those its records actually refer to.
 *
 * Sending the whole catalogue on every ingest is wasted payload, and it was
 * actively harmful while the registry replaced records wholesale — one CSV
 * import re-sent every product in the restaurant, including ones the file never
 * mentioned. Narrowing it means an ingest can only ever affect what it carries
 * data for.
 */
export function buildAiProductPayloadsFor(
  products: any[],
  referencedProductIds: Iterable<string>,
  unitCosts: Map<string, number> = new Map(),
): AiProductPayload[] {
  const wanted = new Set(referencedProductIds);
  return products
    .filter((p) => wanted.has(p._id.toString()))
    .map((p) =>
      buildAiProductPayload(p, unitCosts.get(p._id.toString()) ?? null),
    );
}
