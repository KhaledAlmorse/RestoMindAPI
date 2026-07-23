# RestoMind Backend — Remaining Implementation Plan

**Source of truth used to build this plan:**
- `API_AND_STRUCTURE.md` (current implementation, latest upload) — what's already live.
- `RestoMind Database Schema Complete` + `RestoMind API Documentation Complete` — the target design for the Admin/Manager & AI pipeline.
- Capstone Proposal + AI Workflow Analysis documents — the product requirements and the AI pipeline's exact data/feature contract.
- Backend hardening review (latest) — confirms Phase 0 fully closed and establishes several conventions (below) that carry forward into every remaining phase.

**Rule for every phase below: do not start Phase N+1 until Phase N is implemented, tested, and you've confirmed it here.** Each phase ends with a checklist and Postman testing steps. Stop after each phase and wait for explicit confirmation before continuing.

---

## What's already implemented (confirmed, not part of this plan)

**Core modules:** Auth (16 endpoints incl. address management) · Users · Categories · Products (with `restaurantId`) · Favorites · Cart · Orders (with delivery method, address snapshot, auto-derived `fullName`, multi-restaurant split) · Restaurants (6 endpoints).

**Hardening completed on top of the core modules (latest review) — do not redesign or repeat any of this:**
- **Restaurant Management**: owner must exist and must have role `manager`; a manager cannot own multiple restaurants; owner references stay correct through restaurant update/delete. → **This is what closes Phase 0's remaining checklist below** (all five edge cases from the previous revision are now resolved).
- **Restaurant Orders**: `GET /orders/restaurant/:restaurantId` validates the restaurant exists (404 if not), returns `[]` only when it exists with no orders.
- **Products**: category filtering validates ObjectId (400 on invalid) and filters by ObjectId, not string; title uniqueness is now scoped to `restaurantId + title` (compound unique index) instead of global; products are retrievable by slug (`restaurant-name-product-title`, unique, indexed, auto-updates if the restaurant renames).
- **Categories**: a permanent, non-deletable Default Category exists (auto-created if missing); deleting a category reassigns its products to the Default Category automatically.
- **Favorites**: validates product existence first (404 for deleted/non-existent), resolves by both ID and slug.
- **Users**: full permission matrix enforced — managers can't create/update/delete admins or assign higher privileges; admins can't modify/delete other admins; no self-deletion; duplicate-email checked on update.
- **Cross-cutting**: standardized exception usage (`BadRequestException` / `ConflictException` / `ForbiddenException` / `NotFoundException`) everywhere, no more silent failures; repository layer gained `updateMany` and paginated-with-total-count responses; DTO validation reviewed across the board; phone numbers stored reversibly (not hashed) since they need to display in profile responses; all upload endpoints share one MIME-type validation utility with a consistent error listing supported formats.

## Conventions now established — every remaining phase below must follow these, not just re-check its own module

1. **Exceptions**: use `NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException` consistently — e.g., the overlapping-offer rule in Phase 0B should throw `ConflictException`, not a generic error.
2. **Compound uniqueness over global uniqueness** where the real-world constraint is scoped: Products already moved from a global-unique `title` to `restaurantId + title`. Apply the same thinking to any new unique constraint in the phases below (e.g., an `Ingredient.ingredientCode` should be unique per restaurant, not globally).
3. **Slug + ID resolution**: Products/Favorites now resolve by either Mongo ID or slug. Any new customer-facing lookup added in later phases (e.g. `GET /offers/active`) should follow the same dual-resolution pattern for consistency, not reintroduce ID-only lookups.
4. **Repository layer**: use the now-available `updateMany` and paginated-with-total responses rather than hand-rolling either in a new service (e.g., Phase 0B's scheduled `scheduled → active` offer-status flip is a natural `updateMany` use case).
5. **Shared upload validation**: any new endpoint accepting an image (none currently planned in the remaining phases, but if one appears) reuses the existing shared MIME-validation utility rather than a new one-off check.

## Assumptions & decisions made for this plan (confirm or correct before Phase 0B)

1. **No separate "Branch" layer.** The target design documents assumed `Restaurant → Branches → Products`. What's actually built treats `Restaurant` itself as the single location (it already carries `address`, `phone` directly). This plan builds on that reality — every "branch-scoped" concept in the earlier design becomes "restaurant-scoped" instead. If you actually need multi-location restaurants (one owner, several physical branches) later, that's a bigger schema change and should be raised explicitly before Phase 1, not discovered midway.
2. **Only `admin` / `manager` / `customer` roles exist**, with the full permission matrix now enforced between them (see Users hardening above). A `staff` (read-only branch employee) role is treated as optional and deferred to the end (Phase 9) rather than blocking anything.
3. **Marketplace orders double as sales history.** Rather than treating `sales_transactions` (bulk POS import) and marketplace `orders` as unrelated, a completed order should write a `sales_transactions` row — this is called out explicitly in Phase 2 because it touches the existing, already-tested Orders module.
4. **`Offer` replaces the originally-planned standalone `promotions` collection.** Earlier drafts of this plan had `promotions` (Phase 2) as a forward-looking "will this item be discounted next week" planner, separate from any customer-facing discount concept. Those turned out to be the same entity at different points in a lifecycle (`scheduled → active → expired`), so `Offer` (Phase 0B) now does both jobs. **Phase 2 no longer has its own promotions endpoints** — see the updated Phase 2 section.

---

## Phase 0 — Onboarding Hardening ✅ COMPLETE

All five edge cases identified in the previous revision are now resolved, confirmed by the latest backend review:

| Item | Status |
|---|---|
| Atomicity (restaurant-create + owner-link) | ✅ Owner references stay correct through restaurant update/delete — confirmed |
| `ownerUserId` existence check | ✅ Restaurant owner must exist |
| `ownerUserId` role check | ✅ Restaurant owner must have role `manager` |
| Duplicate-ownership (1:1 enforcement) | ✅ A manager cannot own multiple restaurants |
| Soft-delete cleanup | ✅ Owner references updated correctly on delete |

No further action needed here. Do not re-implement or re-test this phase — move straight to Phase 0B.

---

## Phase 0B — Offers Entity (core architecture addition)

**Why this belongs in Phase 0, not later:** `Offer` is referenced by `Product` (Phase 0, already implemented), by the AI feature-computation step (Phase 5), and by the recommendation-approval flow (Phase 6). Getting its shape right now means every later phase builds on the correct structure instead of Phase 6 having to retrofit a `promotions` collection into an `Offer` concept that didn't exist yet.

### The core decision
`Offer` is a **separate entity that references `Product`**, not a set of fields bolted onto `Product`. Reasoning: a product is slow-changing state ("this item exists"); an offer is a time-boxed event with its own lifecycle (`draft → scheduled → active → expired/cancelled`) and — critically — its own history, needed to answer "did this specific discount actually reduce waste." A field on `Product` gets overwritten by the next offer and loses that history; a separate document per offer doesn't.

### New model: `offer.model.ts`
```
_id                        ObjectId
productId                  ObjectId → Product           required
restaurantId                ObjectId → Restaurant         required (denormalized, for tenant-scoped queries)
discountPercentage         Number                        required
startDate / endDate         Date                          required
status                      draft|scheduled|active|expired|cancelled   required
source                      manual | ai_recommendation    required
recommendationId           ObjectId → Recommendation     optional — set only when source = ai_recommendation
featured                    Boolean                       default false — surfaces on GET /products/recommendations
estimatedWasteReduction    Number                        optional — copied from the Recommendation at creation, if source = ai_recommendation
estimatedRevenueRecovery   Number                        optional — same
actualUnitsSold             Number                        optional — filled in after endDate passes
actualRevenueRecovered      Number                        optional — same
createdBy                   ObjectId → User               required
createdAt / updatedAt       Date
```

### New endpoints
| Method | Endpoint | Roles | Notes |
|---|---|---|---|
| POST | `/offers` | `manager` | Manual offer creation. Body: `{ productId, discountPercentage, startDate, endDate, featured? }`. `source` is forced to `manual` server-side — never accepted from the client. |
| GET | `/offers` | `manager`, `staff` | Query: `status`, `productId`, `source`. |
| GET | `/offers/:id` | `manager`, `staff` | |
| PATCH | `/offers/:id` | `manager` | Can only edit offers with `status: draft` or `scheduled` — an `active` offer's discount shouldn't change out from under a customer mid-purchase. |
| PATCH | `/offers/:id/cancel` | `manager` | Sets `status: cancelled`; triggers the same `Product.discountedPrice` sync as expiry (see below). |
| GET | `/offers/active` | Public | What `GET /products` / `GET /products/recommendations` actually read from — see 0B.4. |

### 0B.1 Relationship to Product
`Product.discountedPrice` **stays on the schema** but changes role: it's no longer a field the admin writes directly — it becomes a **denormalized read cache**, synced automatically whenever an `Offer` for that product transitions into or out of `status: active`.

**Required change to existing endpoints:**
- `PATCH /products/:id/discount` — **behavior changes, endpoint stays.** Instead of writing `discountedPrice` directly, it now creates a lightweight `Offer` (`source: manual`, `status: active`, `startDate: now`, a reasonable default `endDate` or one supplied in the body) and lets the sync logic below set `discountedPrice` as a side effect. This keeps the endpoint backward-compatible at the request/response level while giving even quick manual discounts the same history/tracking as AI-driven ones.

### 0B.2 Relationship to Recommendation
`Recommendation.type: 'apply_discount'` approval (Phase 6) creates an `Offer` with `source: 'ai_recommendation'` and `recommendationId` set, rather than writing a `promotions` entry (the earlier plan's design — see Assumption #4 above). `Recommendation` itself is unchanged in shape; only what `PATCH /recommendations/:id/approve` creates is different.

### 0B.3 Synchronization logic (`Product.discountedPrice`)
A single service function, called from three places (offer creation reaching `active`, a scheduled job flipping `scheduled → active` on `startDate`, and expiry/cancellation):
```
onOfferBecomesActive(offer):
  Product.updateOne({ _id: offer.productId }, { discountedPrice: product.price * (1 - offer.discountPercentage / 100) })

onOfferEndsOrCancels(offer):
  Product.updateOne({ _id: offer.productId }, { discountedPrice: null })
  // then check: is there another still-active offer for this product? if so, sync to that one instead of nulling
```
**Edge case to handle explicitly:** two overlapping offers on the same product (e.g. a manual offer created while an AI one is already active). Decide and enforce a rule — recommended: reject creating a second `active`/`scheduled` offer for a product that already has one in that state, throwing `ConflictException` (per the now-standardized exception convention), rather than allowing silent overwrites.

### 0B.4 Required changes to existing Product endpoints
| Endpoint | Change |
|---|---|
| `GET /products` | No structural change — still reads `discountedPrice` off the product document, which is now sync-maintained rather than directly writable. |
| `GET /products/recommendations` | Should read from `GET /offers/active`-equivalent logic (offers with `status: active`), not just "any product with a non-null `discountedPrice`" — this makes `featured` offers rankable/sortable, which a bare price field can't do. |
| `PATCH /products/:id/discount` | Behavior change per 0B.1 above — creates an `Offer` instead of a direct field write. |

### 0B.5 Required changes to the AI recommendation workflow (affects Phase 5 & 6 as written)
- **Phase 5** (feature computation): the `promotion_active`/`featured`/`discount_pct` inputs sent to the AI service for a target week are now resolved by querying `Offer` (`status: scheduled` or `active` for that product + week), not a `promotions` collection.
- **Phase 6** (`PATCH /recommendations/:id/approve`): for `type: apply_discount`, creates an `Offer` (`source: ai_recommendation`, `recommendationId` set, `estimatedWasteReduction`/`estimatedRevenueRecovery` copied from the recommendation) instead of a `promotions` entry.
- **Phase 8** (feedback loop): reconciliation should backfill `Offer.actualUnitsSold`/`actualRevenueRecovered` from `sales_transactions` once `endDate` passes, in addition to `predictions.actualOrders` — this is what makes "did our recommendations actually work" answerable, which is the whole point of tracking offers as their own entity.

### Dependency check
- Requires `Product`, `Restaurant` (both implemented). `recommendationId` is a forward reference to a Phase-6 collection that doesn't exist yet — make it optional/nullable now so Phase 0B doesn't block on Phase 6, and it'll simply stay unused until Phase 6 ships.

### Non-breaking guarantee
- `PATCH /products/:id/discount`'s request/response shape stays the same from the client's point of view — only its internal behavior (create an Offer vs. write a field directly) changes. Re-run any existing test for this endpoint and confirm the response still reports the expected `discountedPrice`.
- `GET /products` and `GET /products/:id` response shapes are unchanged — `discountedPrice` is still just a field on the product.

### Checklist
- [ ] `offer.model.ts` implemented with the fields above
- [ ] All 6 Offer endpoints implemented with correct role scoping
- [ ] `PATCH /products/:id/discount` creates an `Offer` instead of writing `discountedPrice` directly; existing tests for this endpoint still pass
- [ ] Sync logic correctly sets/clears `Product.discountedPrice` on offer activation/expiry/cancellation
- [ ] Overlapping-offer rule decided and enforced (reject vs. allow — recommend reject)
- [ ] `GET /products/recommendations` updated to read from active offers, not a bare `discountedPrice != null` check
- [ ] A scheduled job (or equivalent) flips `scheduled → active` on `startDate` and `active → expired` on `endDate` — offers shouldn't require a manual status change to take effect or end

### Testing (Postman)
1. `POST /offers` for a product, `status: scheduled`, `startDate` in the past (to force immediate activation on the next job run, or trigger the transition manually if no scheduler exists yet) — confirm `Product.discountedPrice` updates to match.
2. `GET /products/:id` — confirm the synced `discountedPrice` is visible.
3. `PATCH /offers/:id/cancel` — confirm `Product.discountedPrice` clears (or falls back to another active offer, if you're testing the overlap case).
4. `PATCH /products/:id/discount` (the existing endpoint) — confirm it now creates an `Offer` document, and confirm existing callers of this endpoint still get the response shape they expect.
5. Attempt to create a second `active` offer on a product that already has one — confirm it's rejected per the rule chosen in the checklist.
6. `GET /offers/active` (or however `GET /products/recommendations` is wired) — confirm only genuinely active offers appear, not scheduled or expired ones.

**⏸ STOP — confirm Phase 0B before continuing to Phase 1.**

---


## Phase 1 — Ingredients & Recipes

**Why next:** nothing about consumption, stock, or waste can be computed without knowing what a product is made of. This is pure foundation — no AI, no external calls.

### Endpoints to implement
| Method | Endpoint | Roles |
|---|---|---|
| POST | `/ingredients` | `manager` |
| GET | `/ingredients` | `manager` |
| PATCH | `/ingredients/:id` | `manager` |
| DELETE | `/ingredients/:id` | `manager` |
| PUT | `/products/:productId/recipe` | `manager` |
| GET | `/products/:productId/recipe` | `manager` |

### Models
- **New:** `ingredient.model.ts` — `restaurantId, ingredientCode, name, unit (kg|liter|piece), shelfLifeDays, minimumStock, safetyStock, isDeleted, deletedAt`.
- **New:** `recipe.model.ts` — `restaurantId, productId (unique), ingredients: [{ ingredientId, quantityPerPortion, unit, yieldPercentage }]`.

### Services / validation
- `ingredients` module follows the exact same CRUD + soft-delete shape as `categories`.
- `recipe` sits under the existing `products` module (new controller methods, not a new top-level module) — a recipe has no independent existence from its product.
- Validate every `ingredientId` in a recipe belongs to the same `restaurantId` as the product before saving.

### Dependency check
- Requires `products` and `restaurants` (both implemented). No dependency on anything not yet built.

### Non-breaking guarantee
- Purely additive new collections + new nested routes under `/products/:productId/recipe`. Existing `/products` CRUD endpoints are untouched — verify `POST /products`, `PATCH /products/:id`, `GET /products` still pass their existing tests unmodified.

### Checklist
- [ ] `ingredient` model + CRUD implemented, soft delete matches existing pattern
- [ ] `recipe` model implemented, one recipe per product enforced (unique index)
- [ ] Recipe ingredient references validated against the product's own `restaurantId`
- [ ] Existing Products module endpoints unaffected — re-run existing product tests

### Testing (Postman)
1. As manager, create 2–3 ingredients (`POST /ingredients`).
2. Create/reuse a product, then `PUT /products/:productId/recipe` with those ingredients + quantities.
3. `GET /products/:productId/recipe` returns exactly what you saved.
4. Try saving a recipe referencing an ingredient from a *different* restaurant — confirm it's rejected.
5. Re-run Phase-A regression: create/update/delete a product exactly as before Phase 1 — confirm no behavior changed.

**⏸ STOP — confirm Phase 1 works before continuing.**

---

## Phase 2 — Sales History & Order→Sales Sync

**Why next:** this is the model's actual training signal. Recipes alone don't help without real consumption history, and this phase also closes the loop on the *already-implemented* Orders module — the highest-risk phase for accidentally breaking something that already works, so read the non-breaking section carefully.

**Note:** the standalone Promotion Planner originally planned for this phase has been merged into the `Offer` entity (Phase 0B) — there is no separate `promotions` collection or endpoints. Anywhere this phase needs "is this product discounted/featured this week," it reads from `Offer`.

### Endpoints to implement
| Method | Endpoint | Roles |
|---|---|---|
| GET | `/sales` | `manager` |
| GET | `/sales/summary` | `manager` |

### Models
- **New:** `sales-transaction.model.ts` — `restaurantId, productId, date, quantitySold, basePrice, sellingPrice, promotionActive, featured, stockoutMinutes, cancelledOrders, returnedOrders, salesChannel, source (csv_import|marketplace_order|pos_sync), importJobId?, orderId?`. `promotionActive`/`featured` on a historical row are set by checking whether an `Offer` (Phase 0B) was `active` for that product on that date — not by a separate promotions lookup.

### Services / integration point (the risky part)
- **Modify `orders.service.ts`**: when `PATCH /orders/:id/status` sets `status: 'Delivered'`, write one `sales_transactions` row per order line item (`source: 'marketplace_order'`, `orderId` set, `sellingPrice` from the order's snapshotted line price, `promotionActive` set from whether an `Offer` was active on that product at order time).
- This must be **fire-and-forget-safe**: if the sales-transaction write fails, the order status update must still succeed and be logged as a warning — a failure in this new sync step must never block or roll back an order status change that already works today.

### Dependency check
- Requires `products`, `restaurants`, `orders` (all implemented), and `Offer` (Phase 0B) for the `promotionActive`/`featured` fields.

### Non-breaking guarantee — this is the important one
- `PATCH /orders/:id/status` is a live, already-tested endpoint. Before touching it:
  1. Write down (or re-run) its existing test cases first.
  2. Add the sales-transaction side effect behind a try/catch that only logs on failure.
  3. Re-run every existing order status test afterward and confirm identical responses/behavior for all transitions, especially `Delivered` and `Cancelled` (the two terminal states).
- Search the codebase for every place `orders.service.ts` or the order status enum is referenced (e.g., any notification logic, any other module importing order status) and confirm none of them assume the old "no side effect" behavior.

### Checklist
- [x] `sales_transactions` model implemented
- [x] Order → sales_transactions sync added on `Delivered`, wrapped so failures don't affect the order write
- [x] `promotionActive`/`featured` on each synced row correctly reflects whether an `Offer` was active for that product at order time
- [x] All pre-existing order status tests re-run and pass unchanged
- [x] `GET /sales` and `/sales/summary` return correct data after a test order is marked Delivered


### Testing (Postman)
1. Run through the full Phase-A order flow (cart → order → status progression) exactly as before — confirm `Delivered` still works and the response shape is unchanged.
2. `GET /sales?restaurantId=...` — confirm a `sales_transactions` row now exists with `source: "marketplace_order"` for the delivered order's items.
3. Create an active `Offer` (Phase 0B) on a product, place and delivered an order for it, and confirm the resulting `sales_transactions` row has `promotionActive: true`.
4. Force a failure in the sales-sync step (e.g. temporarily break the write) and confirm the order status update still succeeds — this is the one test worth doing deliberately even though it's awkward, since it's the whole point of the try/catch.

**⏸ STOP — confirm Phase 2 works before continuing, and confirm nothing about existing Orders behavior changed.**

---

## Phase 3 — Inventory, Stock, Waste Events, Suppliers & Purchase Orders

### Endpoints to implement
| Method | Endpoint | Roles |
|---|---|---|
| POST | `/inventory/batches` | `manager` |
| GET | `/inventory/batches` | `manager` |
| POST | `/inventory/transactions` | `manager` |
| GET | `/inventory/transactions` | `manager` |
| POST | `/inventory/waste-events` | `manager` |
| GET | `/inventory/waste-events` | `manager` |
| POST | `/suppliers` | `manager` |
| GET | `/suppliers` | `manager` |
| POST | `/purchase-orders` | `manager` |
| GET | `/purchase-orders` | `manager` |
| PATCH | `/purchase-orders/:id/receive` | `manager` |

### Models
- **New:** `inventory-batch.model.ts` — `restaurantId, ingredientId, batchNumber, quantityRemaining, unitCost, expiryDate, receivedDate`.
- **New:** `stock-transaction.model.ts` — `restaurantId, ingredientId, batchId?, transactionType (purchase|consumption|waste|adjustment|transfer_in|transfer_out|return_to_supplier), quantity, unit, date`.
- **New:** `waste-event.model.ts` — `restaurantId, ingredientId, batchId?, quantity, unit, wasteReason (expired|overproduction|preparation_loss|spoiled|customer_return|damaged|incorrect_order|unknown), estimatedCost, date`.
- **New:** `supplier.model.ts` — `restaurantId, name, contactInfo, leadTimeDays`.
- **New:** `purchase-order.model.ts` — `restaurantId, supplierId, items: [{ ingredientId, quantity, unit, unitCost }], status (draft|sent|received|cancelled), expectedDeliveryDate, createdBy`.

### Services / validation
- `PATCH /purchase-orders/:id/receive` creates the corresponding `inventory_batches` row(s) — this is the one endpoint in this phase with a side effect on another new collection (both new this phase, so lower risk than Phase 2's Orders touch-point, but still test the two together).
- `POST /inventory/transactions` of type `waste` should also allow (not require) linking a `waste-event` for the fuller reason/cost detail — decide whether these are the same write or two related writes; recommend two writes (a generic ledger row + an optional detailed waste-event) rather than overloading one collection with optional reason fields, consistent with the target schema design.

### Dependency check
- Requires `ingredients` (Phase 1). No dependency on Phase 2's sales data.

### Non-breaking guarantee
- Entirely new collections and new routes — no existing endpoint is modified in this phase. Confirm none of the new route paths collide with existing ones (they don't, per the list above).

### Checklist
- [ ] All 5 new models implemented with soft-delete/timestamps matching existing conventions
- [ ] `purchase-orders/:id/receive` correctly creates batch(es) and is tested together with `POST /inventory/batches`
- [ ] Existing modules (Products, Orders, Restaurants) untouched — quick regression pass

### Testing (Postman)
1. Create a supplier, then a purchase order referencing 2 ingredients from Phase 1.
2. Mark it received (`PATCH /purchase-orders/:id/receive`) — confirm matching `inventory_batches` rows appear.
3. Record a manual purchase and a manual waste transaction via `POST /inventory/transactions`.
4. Record a detailed waste event via `POST /inventory/waste-events` and confirm it's queryable by `wasteReason`.

**⏸ STOP — confirm Phase 3 works before continuing.**

---

## Phase 4 — Import Center (CSV Upload Pipeline)

**Why now, not earlier:** it needs Phases 1–3's target collections to exist before it has anywhere to write validated rows to.

### Endpoints to implement
| Method | Endpoint | Roles |
|---|---|---|
| POST | `/imports` | `manager` |
| POST | `/imports/:id/preview` | `manager` |
| POST | `/imports/:id/confirm` | `manager` |
| GET | `/imports` | `manager` |
| GET | `/imports/:id` | `manager` |

### Models
- **New:** `import-job.model.ts` — `restaurantId, uploadedBy, importType (menu_items|sales_history|recipes|inventory_transactions|waste_events|offers|inventory_batches), fileName, columnMapping, status (processing|validated|failed), totalRows, validRows, invalidRows, errors: [{ row, column, message }]`. (`offers` replaces the earlier `promotions` importType — bulk-importing historical/planned discounts now targets the `Offer` collection from Phase 0B.)

### Services / validation
- One generic controller/service handling all 7 `importType` values, with a per-type validation strategy (column requirements, type coercion, duplicate-row checks) — implement this as a strategy/lookup map keyed by `importType`, not 7 near-duplicate methods.
- `preview` parses just the header row for the column-mapping UI step; `confirm` runs full validation and writes valid rows to the correct target collection from Phases 0B–3.

### Dependency check
- Requires `ingredients`/`recipes` (Phase 1), `sales_transactions` (Phase 2), `Offer` (Phase 0B), and the inventory collections (Phase 3) — this phase has the broadest dependency footprint, confirm all of them are actually working before starting.

### Non-breaking guarantee
- New collection, new module — no existing endpoint touched. The only risk is writing malformed data into Phase 1–3 collections; validate strictly and reject rather than partially import a row you're unsure about.

### Checklist
- [ ] `import-job` model implemented
- [ ] All 7 `importType` values have a working validation strategy
- [ ] A deliberately malformed CSV produces a correct `errors[]` array and does not partially corrupt target collections
- [ ] A clean CSV for each of the 7 types successfully populates the correct Phase 1–3 collection

### Testing (Postman)
1. Upload a small, clean `sales_history` CSV → preview → confirm → verify rows landed in `sales_transactions` with `source: "csv_import"`.
2. Upload a CSV with 2 intentionally broken rows (bad date, negative price) → confirm `invalidRows: 2` and specific row/column error messages, and confirm the 2 good rows still imported.
3. Repeat for at least one more `importType` (e.g. `inventory_transactions`) to confirm the generic pipeline isn't hardcoded to one shape.

**⏸ STOP — confirm Phase 4 works before continuing.**

---

## Phase 5 — AI Prediction Pipeline

**Why now:** this is the first phase that needs real data to exist (Phases 1–4) before it produces anything meaningful.

### Endpoints to implement
| Method | Endpoint | Roles |
|---|---|---|
| POST | `/predictions/recalculate` | `manager` |
| POST | `/predictions/batch-recalculate` | `manager`, system (scheduled) |
| GET | `/predictions` | `manager` |
| — | `POST /predict/demand` (internal, backend → AI service) | n/a |

### Models
- **New:** `model-version.model.ts` — `version, algorithm, scope (global_demo|restaurant_finetuned), restaurantId?, trainingWindow, metrics, isActive, artifactPath`.
- **New:** `prediction.model.ts` — `restaurantId, productId, modelVersionId, targetWeek, predictedOrders, featuresUsed (snapshot), actualOrders?`.

### Services
- **New:** a feature-computation service that reads `sales_transactions` (Phase 2) to compute `orders_lag_1/2`, `rolling_mean_4w/8w`, `rolling_std_4w`, `discount_pct`, `promo_count_last_4w`, and reads `Offer` (Phase 0B, `status: scheduled` or `active`) for the target week's `promotion_active`/`featured`/prices.
- **New:** `AiServiceModule` — HTTP client to the external AI service. `restaurantId`/`productId` are sent directly as `branch_model_key`/`menu_item_model_key` — no ID-mapping table (this is the fix for the Kaggle ID mismatch problem raised in the AI analysis).
- Reject with 422 if the AI service itself rejects the model key (unrecognized) — do not silently fall back to a fabricated prediction.

### Dependency check
- Hard dependency on Phase 2 (`sales_transactions`) and Phase 0B (`Offer`, for the target week's promotion inputs). Soft dependency on Phase 4 (import) only in the sense that without imported historical data, predictions will be low-quality — not a blocker, just a quality caveat worth surfacing in the response or docs.

### Non-breaking guarantee
- New collections and a new outbound-only integration (backend calling an external service) — no existing endpoint is modified.

### Checklist
- [ ] Feature computation verified against a manually-checked example (compute lag/rolling values by hand for one product and compare)
- [ ] `POST /predict/demand` request payload matches the AI service's confirmed contract exactly (field names/casing)
- [ ] A 422 from the AI service (unrecognized model key) is surfaced clearly, not swallowed
- [ ] `predictions.featuresUsed` stores the exact request sent, for auditability

### Testing (Postman)
1. Ensure the test restaurant/product has at least 8 weeks of `sales_transactions` (seed via Phase 4's import if needed).
2. `POST /predictions/recalculate` for that product — inspect the response and the stored `predictions` document, including `featuresUsed`.
3. Manually recompute the rolling mean/lag values from the raw `sales_transactions` and confirm they match what was sent to the AI service.
4. Try recalculating for a product with too little history — confirm graceful handling (clear error or a documented cold-start fallback), not a crash.

**⏸ STOP — confirm Phase 5 works before continuing.**

---

## Phase 6 — Waste Reports & Recommendations

### Endpoints to implement
| Method | Endpoint | Roles |
|---|---|---|
| GET | `/waste-reports` | `manager` |
| GET | `/waste-reports/:id` | `manager` |
| GET | `/waste-reports/summary` | `manager` |
| GET | `/recommendations` | `manager` |
| PATCH | `/recommendations/:id/approve` | `manager` |
| PATCH | `/recommendations/:id/edit` | `manager` |
| PATCH | `/recommendations/:id/dismiss` | `manager` |

### Models
- **New:** `waste-report.model.ts` — `restaurantId, predictionId, ingredientId, expectedConsumption, usableAvailableStock, expectedSurplus, riskLevel`.
- **New:** `recommendation.model.ts` — `restaurantId, wasteReportId, type (reduce_purchase|apply_discount|stop_production|transfer_stock), suggestedValue?, targetRestaurantId?, gptExplanation?, status (pending|approved|edited|dismissed), reviewedBy`.

### Services
- Waste calculation service: `expectedConsumption = predictedOrders × recipe.quantityPerPortion / yieldPercentage`; `usableAvailableStock` sums `inventory_batches` where `expiryDate > targetDemandDate` plus `purchase_orders` arriving before the demand date (the refined formula from the AI analysis, not naive current+incoming).
- Rule engine: pure functions mapping `(riskLevel, expectedSurplus)` → recommendation `type` + `suggestedValue`. **No GPT call in this step.**
- GPT explanation step runs *after* the rule decision, strictly to phrase `gptExplanation` from the already-decided numbers — must not be allowed to alter `type` or `suggestedValue`.
- `PATCH /recommendations/:id/approve` for `type: apply_discount` creates an `Offer` (Phase 0B) — `source: 'ai_recommendation'`, `recommendationId` set, `discountPercentage` from `suggestedValue`, `estimatedWasteReduction`/`estimatedRevenueRecovery` copied from the recommendation — rather than a `promotions` entry (superseded, see Assumption #4). This reuses Phase 0B's existing sync logic to update `Product.discountedPrice` automatically.

### Dependency check
- Requires `predictions` (Phase 5), `recipes` (Phase 1), `inventory_batches`/`purchase_orders` (Phase 3), and `Offer` (Phase 0B) for the approve action.

### Non-breaking guarantee
- New collections; the one integration point (`approve` creating an `Offer`) touches a Phase 0B collection, not an already-tested endpoint — lower risk than Phase 2's Orders touch-point, but still worth a regression check on `GET /offers` and `GET /products/:id` (for the synced `discountedPrice`) after approving a recommendation.

### Checklist
- [ ] Waste formula verified by hand against Phase 5's test prediction
- [ ] Rule engine covers all four recommendation types with clear, testable thresholds
- [ ] GPT step confirmed to only affect `gptExplanation`, never the decided `type`/`suggestedValue`
- [ ] Approving a discount recommendation correctly creates an `Offer` with `source: ai_recommendation` and `recommendationId` set, and `Product.discountedPrice` syncs via Phase 0B's existing logic
- [ ] Approving a recommendation whose product already has an active/scheduled `Offer` is handled per the overlapping-offer rule chosen in Phase 0B (reject vs. allow)

### Testing (Postman)
1. From Phase 5's test prediction, trigger waste-report generation — verify the numbers by hand.
2. `GET /recommendations` — confirm a recommendation was generated with a sensible type/value for the surplus computed.
3. `PATCH /recommendations/:id/approve` for an `apply_discount` type — confirm an `Offer` now exists with `recommendationId` set, and `GET /products/:id` shows the synced `discountedPrice`.
4. `PATCH /recommendations/:id/dismiss` on another — confirm no `Offer` is created and no side effects occur.
5. Approve a second `apply_discount` recommendation for a product that already has an active offer from step 3 — confirm the overlap rule from Phase 0B is enforced here too, not bypassed by the recommendation-approval path.

**⏸ STOP — confirm Phase 6 works before continuing.**

---

## Phase 7 — Dashboard & Analytics

### Endpoints to implement
| Method | Endpoint | Roles |
|---|---|---|
| GET | `/dashboard/overview` | `manager` |
| GET | `/dashboard/money-saved` | `manager` |

### Services
- Aggregation-only endpoints reading from `predictions`, `waste_reports`, `recommendations`, `sales_transactions` — no new collections.
- `money-saved` depends on Phase 8's actual-vs-predicted data to be meaningful; it can ship with a "not enough data yet" response until Phase 8 exists.

### Dependency check
- Requires Phases 5–6. Soft dependency on Phase 8 for `money-saved` to return real numbers.

### Non-breaking guarantee
- Read-only aggregation endpoints; zero risk to existing functionality.

### Checklist
- [ ] `/dashboard/overview` returns correct aggregates cross-checked against raw Phase 5–6 data
- [ ] `/dashboard/money-saved` degrades gracefully with a clear message when Phase 8 data doesn't exist yet

### Testing (Postman)
1. `GET /dashboard/overview` — compare each number against a manual query of the underlying collections.

**⏸ STOP — confirm Phase 7 works before continuing.**

---

## Phase 8 — Feedback Loop & Prediction Accuracy

### Endpoints to implement
| Method | Endpoint | Roles |
|---|---|---|
| POST | `/predictions/reconcile` | system (scheduled), `admin` (manual trigger) |
| GET | `/predictions/accuracy` | `manager`, `admin` |

### Services
- Scheduled job: for every `prediction` whose `targetWeek` has passed, read actual `sales_transactions` for that product/week, set `predictions.actualOrders`, compute error.
- **Same job also reconciles `Offer`**: for every `Offer` whose `endDate` has passed, sum actual `sales_transactions` for that product during the offer window into `Offer.actualUnitsSold`/`actualRevenueRecovered` (per 0B.5) — this is what makes "did our AI-driven discounts actually reduce waste and recover revenue" a queryable, evidence-backed answer rather than a guess.
- Accuracy endpoint aggregates prediction error, waste-prediction error, and recommendation acceptance rate (from Phase 6's `status` field). Consider adding offer-effectiveness (`estimatedWasteReduction` vs. actual) here too, since the data now exists to support it.

### Dependency check
- Requires Phase 5 (`predictions`), Phase 2 (`sales_transactions`), and Phase 0B (`Offer`) for the offer-reconciliation half of this job.

### Non-breaking guarantee
- New scheduled job + read-only endpoint; no existing code touched.

### Checklist
- [ ] Reconciliation job correctly matches predictions to actuals by product + week
- [ ] Reconciliation job correctly backfills `Offer.actualUnitsSold`/`actualRevenueRecovered` for expired offers
- [ ] `/predictions/accuracy` numbers match a manual spot-check

### Testing (Postman)
1. Manually trigger `POST /predictions/reconcile` for a past-week test prediction with known actual sales.
2. Confirm `actualOrders` and the computed error match your manual calculation.
3. `GET /predictions/accuracy` — confirm it reflects that reconciliation.
4. Let (or force) an `Offer` from Phase 0B/6 testing pass its `endDate`, run reconciliation, and confirm `actualUnitsSold`/`actualRevenueRecovered` populate correctly on that `Offer` document.

**⏸ STOP — confirm Phase 8 works before continuing.**

---

## Phase 9 — Optional Polish (only if needed)

- Add a `staff` role: reuses `User.restaurantId`, read-only guards on Phase 1–8's GET endpoints. Not required for the AI pipeline to function.
- Revisit the "no branches" assumption from the top of this document if multi-location restaurants become a real requirement.

---

## How to use this file during implementation

1. Work top to bottom. Do not skip ahead — later phases assume earlier ones are live and tested.
2. After finishing a phase's checklist and Postman tests, report back explicitly (e.g. "Phase 2 tested, all passing") before I give you the go-ahead for the next phase.
3. If a phase's testing surfaces a problem in an *earlier* phase, fix it in that earlier phase before continuing — don't patch around it in the current phase.
