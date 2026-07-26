# RestoMind Backend — AI Integration Roadmap (Phase 4 → Final Phase)

## Status

Phases 0, 0B, 1, 2, and 3 are complete and are not revisited by this document: onboarding hardening, the Offer entity (with `originalPrice`/`offerPrice` snapshot pricing and `Product.discountedPrice` already removed), Ingredients & Recipes, Sales Transactions, and Inventory/Batches/Waste Events/Suppliers/Purchase Orders. This roadmap starts at Phase 4 and runs to the final phase of the AI integration arc: Import → Daily Production Planning → Weekly Demand & Purchasing → Waste/Recommendations → Reconciliation & Accuracy.

## Non-Negotiable Architecture Constraints

Every phase below has been checked against these. If anything in a phase appears to conflict with one of these, that is a bug in this document to flag back, not something to route around silently during implementation.

1. **`Product.discountedPrice` does not exist and must never be reintroduced.** `Offer.offerPrice` is the only customer-visible discounted price, computed exactly once (at offer creation/approval) and never recalculated from a live `Product.price` afterward.
2. **No duplicated sources of truth for pricing, demand, or status.** Anywhere a value can be derived, derive it — don't maintain two fields that could disagree.
3. **Product demand is never compared directly to ingredient stock.** Every comparison between "predicted orders" and "available inventory" goes through the recipe conversion (`predictedOrders × recipe.quantityPerPortion / yieldPercentage`) first.
4. **Daily production planning and weekly purchasing forecasting are separate workflows**, different audiences, different cron schedules, different collections — never merged into one.
5. **Every cron job has retry handling, a defined fallback, and error logging** — none of these run unattended without a plan for what happens when the AI microservice is unreachable.
6. **Accuracy metrics (WAPE, MASE) are explicitly formula-defined and actually implemented** — not just named as a goal.
7. **Offer reconciliation tracks sales by `offerId`**, not by product + date-range inference.
8. **Both daily and weekly prediction workflows get their accuracy measured** — not just one.

## Final Execution Order

```
Phase 4 — Import Center (CSV Upload + Historical Data Prep)
   ↓
Phase 5 — Daily Production Planning (Primary AI Workflow) + Nightly AI Learning Sync
   ↓
Phase 6 — Weekly Demand Prediction & Purchasing Forecast (Secondary AI Workflow)
   ↓
Phase 7 — Waste Reports, Surplus Detection & Recommendations
   ↓
Phase 8 — Feedback Loop, Reconciliation & AI Accuracy Analytics  [FINAL PHASE]
```

Strict sequencing: do not begin a phase until the one before it has passed its Completion Checklist. Phase 6 and 7 both read data Phase 5 and Phase 4 produce; Phase 8 reads data every prior phase produces.

---

# Phase 4 — Import Center (CSV Upload + Historical Data Preparation)

## 1. Phase Goal

Let a manager onboard a restaurant's historical sales/inventory data in bulk, and use that import to immediately move the AI's demand model for that restaurant's products from cold-start rule-based estimates toward real learned levels — without ever risking the imported data itself if the AI service is slow or unavailable at import time.

## 2. Models / Schema Changes

**New:**
```typescript
// import-job.model.ts
_id                ObjectId
restaurantId       ObjectId → Restaurant     required (index)
uploadedBy         ObjectId → User           required
importType         'sales_history' | 'inventory_transactions' | 'recipes' | 'menu_items'   required
fileName           String                    required
columnMapping      Object                    optional — e.g. { "Item Code": "productId" }
status             'processing' | 'validated' | 'ai_ingest_pending' | 'ai_ingest_failed' | 'completed' | 'failed'   required
totalRows          Number
validRows          Number
invalidRows        Number
errors             Array<{ row, column, message }>
aiIngestAttempts    Number                   default 0
aiIngestLastError   String                   optional
createdAt / updatedAt   Date
```
The status enum is intentionally richer than "processing/validated/failed" — `ai_ingest_pending`/`ai_ingest_failed` exist specifically so a manager can see, and act on, the difference between "your data is safely stored" and "the AI hasn't learned from it yet" (Constraint 5).

**Modification to the already-complete Phase 2 `sales_transactions` model:**
```typescript
offerId   ObjectId → Offer   optional, nullable   // NEW — populated when a sale is attributable to a specific offer
```
This is required for Phase 8's offer reconciliation (Constraint 7) — without it, reconciliation can only guess which sales belonged to an offer by product + date-range overlap, which is wrong the moment a product has both offer-priced and regular-priced sales in the same window. CSV sales-history imports may optionally include an offer reference column; if absent, `offerId` stays `null` (a regular, non-offer sale) — this is not a breaking change to the existing model, purely additive.

## 3. Backend Implementation

- **`ImportsModule`**: `imports.controller.ts`, `imports.service.ts`, `dto/create-import.dto.ts`, `dto/confirm-import.dto.ts`.
- **`CsvParsingService`** (shared): header detection, type coercion, per-`importType` validation strategy — one service, a strategy map keyed by `importType`, not four near-duplicate parsers.
- **`AiIngestService`** (shared, reused again in Phase 5's nightly sync — do not duplicate this logic in two places): wraps the call to the AI microservice's ingest endpoint with:
  - Retry: 3 attempts, exponential backoff (e.g. 2s, 8s, 30s).
  - On exhausted retries: set `ImportJob.status = 'ai_ingest_failed'`, store `aiIngestLastError`, log at `error` level (not just `warn` — this is the entire value proposition of the import, not a side effect).
  - **Never roll back the already-written `sales_transactions` rows if ingest fails** — data durability is independent of AI service availability.

### Endpoints

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/imports` | `manager` | Upload CSV (`multipart/form-data`) |
| POST | `/imports/:id/preview` | `manager` | Parse headers, return detected columns for mapping |
| POST | `/imports/:id/confirm` | `manager` | Validate + write rows + trigger AI ingest (for `sales_history`) |
| GET | `/imports` | `manager` | List import job history |
| GET | `/imports/:id` | `manager` | Full detail incl. `errors[]` and AI ingest status |
| POST | `/imports/:id/retry-ai-ingest` | `manager` | Manually re-trigger AI ingest for a job stuck at `ai_ingest_failed` |

## 4. AI Integration

**Endpoint:** `POST /integration/restomind/ingest`
```json
// Request (built by NestJS from the just-written sales_transactions rows)
{
  "restaurantId": "665f0a1b2c3d4e5f00000001",
  "records": [{ "date": "2026-07-01", "productId": "p1", "salesQty": 42 }],
  "products": [{ "productId": "p1", "title": "Chicken Pasta", "category": "Pasta" }]
}
```
Response is not further specified by the AI service beyond acknowledgment — treat any 2xx as success, anything else (including timeout) as a failure to be retried per the `AiIngestService` policy above.

## 5. Business Workflow

```
Manager uploads CSV
   ↓
POST /imports  →  ImportJob created, status: 'processing'
   ↓
POST /imports/:id/preview  →  detected columns shown, manager maps them
   ↓
POST /imports/:id/confirm
   ↓
CsvParsingService validates rows (per importType strategy)
   ↓
Valid rows written to target collection (sales_transactions gets source: 'csv_import', offerId: null unless the CSV supplied one)
   ↓
IF importType === 'sales_history': AiIngestService.ingest() called
   ├── Success → status: 'completed'
   └── All retries exhausted → status: 'ai_ingest_failed' (data already safely written)
   ↓
Manager can GET /imports/:id anytime to see status; if 'ai_ingest_failed', can POST /imports/:id/retry-ai-ingest later
```

## 6. Validation and Testing

**Postman tests:**
- Upload a clean `sales_history` CSV → confirm → verify `sales_transactions` rows exist and AI ingest succeeded (`status: 'completed'`).
- Upload a CSV with 2 malformed rows → confirm `invalidRows: 2` with specific row/column messages, and that the valid rows still imported.
- Upload a CSV including an offer-reference column → confirm the resulting `sales_transactions` rows have `offerId` correctly set; omit the column on a second file → confirm `offerId: null`.

**Failure scenarios (must be tested deliberately, not assumed):**
- Simulate the AI ingest endpoint being unreachable (wrong URL, or a mock returning 503) → confirm `sales_transactions` rows are still written, `ImportJob.status` becomes `ai_ingest_failed` after 3 retries, and the error is logged at `error` level.
- Call `POST /imports/:id/retry-ai-ingest` on a failed job → confirm it re-attempts and can transition to `completed`.

## 7. Completion Checklist

- [ ] `ImportJob` model implemented with the full status enum.
- [ ] `sales_transactions.offerId` added (additive, non-breaking).
- [ ] `CsvParsingService` and `AiIngestService` implemented as shared, reusable services (confirm Phase 5 will be able to call `AiIngestService` directly, not duplicate it).
- [ ] Retry + exhausted-retry handling verified via forced-failure test.
- [ ] Manual retry endpoint verified.
- [ ] No existing endpoint from Phases 0–3 modified or broken.

**⏸ STOP — confirm Phase 4 before continuing to Phase 5.**

---

# Phase 5 — Daily Production Planning (Primary AI Workflow) + Nightly AI Learning Sync

## 1. Phase Goal

Every morning, give a bakery/kitchen manager a concrete "bake this many of each item today" plan, generated from the AI microservice — this is the workflow real kitchen staff act on daily, distinct from the weekly purchasing forecast in Phase 6. A second, adjacent nightly job keeps the AI's daily-level learned model current from yesterday's actual sales, reusing Phase 4's ingest logic rather than re-implementing it.

## 2. Models / Schema Changes

**New:**
```typescript
// daily-production-plan.model.ts
_id                  ObjectId
restaurantId         ObjectId → Restaurant    required (index)
date                 String (YYYY-MM-DD)      required (index)
totalRecommendedQty  Number                   required
items                Array<{
  productId           ObjectId → Product
  recommendedQty       Number
  lowerBound           Number
  upperBound           Number
  confidence           'high' | 'medium' | 'low'
  source               'ai_model' | 'fallback_yesterday'   // which path produced this item's number
  factors              Array<any>
  actualProducedQty    Number, nullable       // corrected: per-item, not a single top-level field (this was the schema bug flagged in review)
}>
createdAt / updatedAt   Date
```
**Unique index:** `{ restaurantId: 1, date: 1 }` — prevents a cron run and an on-demand request from ever producing two competing plans for the same day.

**`avgDailySales` computation (explicit, not implicit):** rolling mean of `quantitySold` over the **last 14 days** for that product, from `sales_transactions`. This constant (14) should be a named, configurable value in the service, not a magic number inline.

## 3. Backend Implementation

- **`ProductionPlanningModule`**: `production-planning.controller.ts`, `production-planning.service.ts`, `dto/record-actuals.dto.ts`.
- **Cron:** `@Cron('0 0 * * *')` — every day at 12:00 AM, generates the plan for the current date, for every active product per restaurant.
- **On-demand generation:** `GET /predictions/production-plan?date=YYYY-MM-DD` — if a plan already exists for that `(restaurantId, date)`, return it; if `date` is today (or future) and none exists yet, generate it on demand using the same service method the cron calls (one code path, two triggers); if `date` is in the past with no existing plan, return `404` — there's no meaningful way to retroactively generate "what should we have baked yesterday."
- **Fallback policy (Constraint 5):** if the AI microservice call fails after retries (same retry wrapper pattern, 3 attempts / exponential backoff, reused from Phase 4), fall back to: reuse each product's `recommendedQty` from **yesterday's** plan if one exists (tag `source: 'fallback_yesterday'`, `confidence: 'low'`); if no prior plan exists either (first day for this restaurant), fall back to `avgDailySales` itself as the recommended quantity. Log a `critical`-level alert either way — a manager should be able to tell their production plan came from a fallback, not silently trust a degraded number as if it were the AI's real output.
- **Nightly AI Learning Sync cron:** `@Cron('0 2 * * *')` — every day at 2:00 AM, calls the exact same `AiIngestService.ingest()` from Phase 4 with yesterday's `sales_transactions`, so the AI's learned demand levels stay current. This is not a new integration — it is Phase 4's ingest service invoked on a schedule instead of after a manual import; do not write a second ingest client.

### Endpoints

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/predictions/production-plan` | `manager` | Get (or on-demand generate) today's plan. Query: `date` |
| POST | `/predictions/production-plan/actuals` | `manager` | Body: `{ items: [{ productId, actualProducedQty }] }` — record actuals per product |

## 4. AI Integration

**Endpoint:** `POST /integration/restomind/production-plan`
```json
// Request
{
  "restaurantId": "665f0a1b2c3d4e5f00000001",
  "date": "2026-07-25",
  "products": [
    { "productId": "p1", "title": "Croissant", "category": "Pastry", "price": 18, "freshnessWindow": 2, "avgDailySales": 180 }
  ]
}
// Response
{
  "restaurantId": "665f0a1b2c3d4e5f00000001",
  "date": "2026-07-25",
  "totalRecommendedQty": 210,
  "items": [
    { "productId": "p1", "recommendedQty": 90, "lowerBound": 70, "upperBound": 110, "confidence": "medium", "source": "rule_based", "factors": [] }
  ]
}
```
**Data preparation before calling:** for every active product, compute `avgDailySales` (14-day rolling mean, above) — this is the one piece of data the AI needs that isn't static product info; everything else (`title`, `category`, `price`, `freshnessWindow`) is read directly off the `Product` document.

## 5. Business Workflow

```
12:00 AM cron (or on-demand GET for today)
   ↓
For every active product: compute avgDailySales (14-day rolling mean from sales_transactions)
   ↓
Call POST /integration/restomind/production-plan (retry x3)
   ├── Success → persist daily_production_plans with source: 'ai_model' per item
   └── Exhausted retries → fallback (yesterday's plan, or avgDailySales itself) with source: 'fallback_yesterday', log critical alert
   ↓
Manager opens app in the morning → GET /predictions/production-plan
   ↓
Manager bakes; at day's end, POST /predictions/production-plan/actuals with per-item actualProducedQty
   ↓
(Feeds Phase 8's daily-accuracy reconciliation)

Separately, every night at 2:00 AM:
Nightly sync cron → AiIngestService.ingest() with yesterday's sales_transactions → AI's learned model refreshed
```

## 6. Validation and Testing

- Verify `items[].actualProducedQty` is stored per product, not as a single flat number.
- Verify the unique `(restaurantId, date)` index rejects a second cron-generated plan for a day that already has one.
- Simulate AI service failure → confirm fallback triggers, `source: 'fallback_yesterday'` is set, and a critical log/alert fires.
- `GET /predictions/production-plan?date=<yesterday-with-no-plan>` → confirm `404`, not a silently-generated plan.
- Confirm the nightly sync cron calls the *same* `AiIngestService` method Phase 4 uses (code review check, not just a behavioral test).

## 7. Completion Checklist

- [ ] `daily_production_plans` schema uses per-item `actualProducedQty`.
- [ ] Unique `(restaurantId, date)` index in place.
- [ ] `avgDailySales` 14-day rolling-mean formula implemented as a named, reusable calculation.
- [ ] Fallback path implemented, tagged, and logged at `critical` level.
- [ ] Nightly sync reuses Phase 4's `AiIngestService` — no duplicate ingest client.
- [ ] No existing endpoint from Phases 0–4 modified or broken.

**⏸ STOP — confirm Phase 5 before continuing to Phase 6.**

---

# Phase 6 — Weekly Demand Prediction & Purchasing Forecast (Secondary AI Workflow)

## 1. Phase Goal

Forecast next week's per-product demand for purchasing/supply decisions (a different audience and cadence than Phase 5's daily kitchen plan), and — critically — auto-draft purchase orders only after converting predicted product demand into actual ingredient quantities through each product's recipe, never comparing raw order counts to raw kilograms.

## 2. Models / Schema Changes

**New:**
```typescript
// prediction.model.ts
_id                ObjectId
restaurantId       ObjectId → Restaurant    required (index)
productId          ObjectId → Product       required (index)
modelVersionId     String                   required
targetWeek         String (YYYY-MM-DD)      required (index)
predictedOrders    Number                   required
confidence         'high' | 'medium' | 'low'
source             'ai_model' | 'fallback_naive'   // which path produced this prediction
featuresUsed       Object
factors            Array<any>
dailyBreakdown     Array<{ date: String, predictedQuantity: Number }>
actualOrders       Number, nullable         // populated in Phase 8
errorAbs           Number, nullable         // populated in Phase 8, per-row convenience value
createdAt / updatedAt   Date
```
**Unique index:** `{ restaurantId: 1, productId: 1, targetWeek: 1 }` — idempotent per product per week.

## 3. Backend Implementation

- **`WeeklyPredictionModule`**: reuses the existing `PredictionsModule` naming if one already exists from earlier scaffolding; otherwise new.
- **`SupplierAutoDraftService`** (new, the piece that must not repeat the original unit-mismatch bug): after a prediction is stored,
  1. Read the product's `Recipe` (Phase 1).
  2. `requiredIngredientQty = predictedOrders × recipe.quantityPerPortion / recipe.yieldPercentage` — **this conversion step is mandatory and non-optional (Constraint 3)**; nothing downstream may compare `predictedOrders` directly against any ingredient-unit quantity.
  3. Aggregate `requiredIngredientQty` across every product sharing that ingredient for the same target week.
  4. Compute `usableAvailableStock` exactly per Phase 3's formula: `SUM(inventory_batches.quantityRemaining WHERE expiryDate > targetWeekStart) + SUM(purchase_orders.items.quantity WHERE status='sent' AND expectedDeliveryDate <= targetWeekStart)`.
  5. If `requiredIngredientQty > usableAvailableStock`: draft a `PurchaseOrder` (Phase 3 model) with `status: 'draft'` (**never `'sent'` automatically** — a human still reviews and sends it), `source: 'ai_forecast'`, `items: [{ ingredientId, quantity: shortfall, unit, unitCost: <last known cost or supplier default> }]`. If no supplier is on file for that ingredient, do not fail the whole run — skip the draft for that ingredient and add it to a returned/logged "unassigned shortfalls" list instead.
- **Fallback policy:** if the AI prediction call fails after retries, fall back to a naive-seasonal estimate — **the same product/restaurant's actual orders from last week's equivalent period** — tagged `source: 'fallback_naive'`, `confidence: 'low'`, and still persisted (so Phase 8 can measure how the fallback itself performed, not just hide it from accuracy tracking).
- **Cron:** `@Cron('0 0 * * 0')` — every Sunday at 12:00 AM.

### Endpoints

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/predictions/recalculate` | `manager` | Recalculate for one product |
| POST | `/predictions/batch-recalculate` | `manager`, system | Recalculate all active products for a restaurant |
| GET | `/predictions` | `manager` | Query stored predictions (`restaurantId`, `targetWeek`) |
| GET | `/predictions/learned-status` | `manager` | AI learning progress per product |

## 4. AI Integration

**Endpoint:** `POST /integration/restomind/predict`
```json
// Request
{
  "restaurantId": "665f0a1b2c3d4e5f00000001", "productId": "665f0a1b2c3d4e5f00000042",
  "title": "Kanafeh", "category": "Middle Eastern Desserts",
  "targetWeek": "2026-07-27", "avgDailySales": 40, "promotionActive": false
}
// Response
{
  "restaurantId": "665f0a1b2c3d4e5f00000001", "productId": "665f0a1b2c3d4e5f00000042",
  "modelVersionId": "restomind-bridge/rule_based-v0.1", "targetWeek": "2026-07-27",
  "predictedOrders": 840, "confidence": "medium",
  "featuresUsed": { "mode": "rule_based", "baseDailyLevel": 40 },
  "factors": [], "dailyBreakdown": [{ "date": "2026-07-27", "predictedQuantity": 120 }]
}
```
`promotionActive` is resolved from `Offer` (`status: 'active'` or `'scheduled'` for the product/week), per the already-established Offer-centric convention — never from a removed `Product.discountedPrice`.

## 5. Business Workflow

```
Sunday 12:00 AM cron (or on-demand recalculate)
   ↓
For each active product: compute features (lags, rolling means, discount_pct from Offer, promo history)
   ↓
Call POST /integration/restomind/predict (retry x3)
   ├── Success → store prediction, source: 'ai_model'
   └── Exhausted retries → fallback (last equivalent week's actual), source: 'fallback_naive'
   ↓
SupplierAutoDraftService:
   predictedOrders → × recipe.quantityPerPortion / yieldPercentage → requiredIngredientQty
   ↓
   compare against usableAvailableStock (batches + confirmed incoming POs)
   ↓
   IF shortfall → draft PurchaseOrder (status: 'draft', source: 'ai_forecast')
   ↓
Manager reviews drafted POs → sends → (existing Phase 3 receive flow takes over from there)
```

## 6. Validation and Testing

- **Hand-verify the recipe conversion explicitly**: e.g. 120 predicted orders × 0.20 kg/portion = 24kg required — confirm the service computes exactly this, not a raw comparison of `120` against a kg-denominated stock figure.
- Confirm `PurchaseOrder` auto-drafts are always `status: 'draft'`, never `'sent'`.
- Confirm an ingredient with no assigned supplier is skipped (not a crash) and surfaced in a returned/logged list.
- Simulate AI failure → confirm fallback prediction is stored with `source: 'fallback_naive'`, not silently indistinguishable from a real model prediction.

## 7. Completion Checklist

- [ ] `Prediction` model implemented with the unique index.
- [ ] `SupplierAutoDraftService` performs the recipe conversion before any stock comparison — verified by the hand-check above.
- [ ] Auto-drafted POs are always `draft` status, `source: 'ai_forecast'`.
- [ ] Missing-supplier case handled gracefully, not a hard failure.
- [ ] Fallback path implemented and tagged.
- [ ] No existing endpoint from Phases 0–5 modified or broken.

**⏸ STOP — confirm Phase 6 before continuing to Phase 7.**

---

# Phase 7 — Waste Reports, Surplus Detection & Recommendations

## 1. Phase Goal

Detect stock genuinely at risk of being wasted, generate discount recommendations (with AI-authored promotional copy) a manager can approve into a real `Offer` — through the correct, already-established Offer pricing model, with zero interaction with the removed `Product.discountedPrice`.

## 2. Models / Schema Changes

**New:**
```typescript
// waste-report.model.ts
_id                     ObjectId
restaurantId            ObjectId → Restaurant   required (index)
predictionId            ObjectId → Prediction    optional — set when derived from Phase 6's weekly prediction rather than a same-day surplus scan
ingredientId            ObjectId → Ingredient    required
expectedConsumption     Number                   required
usableAvailableStock    Number                   required
expectedSurplus         Number                   required
riskLevel               'low' | 'medium' | 'high'   required
createdAt               Date

// recommendation.model.ts
_id                  ObjectId
restaurantId         ObjectId → Restaurant   required (index)
wasteReportId        ObjectId → WasteReport   optional
productId            ObjectId → Product      required
type                 'apply_discount' | 'reduce_purchase' | 'stop_production' | 'transfer_stock'   required
suggestedValue       Number                  optional — e.g. discount % or kg to reduce
targetRestaurantId   ObjectId → Restaurant   optional — set when type = transfer_stock
gptExplanation       String                  optional
status               'pending' | 'approved' | 'edited' | 'dismissed'   required
reviewedBy           ObjectId → User         optional
createdAt            Date
```

## 3. Backend Implementation

- **`WasteReportsModule`**, **`RecommendationsModule`** — standard CRUD/read structure matching existing conventions.

### Endpoints

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/waste-reports` | `manager` | List waste risk reports |
| GET | `/waste-reports/summary` | `manager` | Executive waste cost summary |
| GET | `/recommendations` | `manager` | Pending AI recommendations |
| POST | `/recommendations/scan-surplus` | `manager` | On-demand surplus scan via AI |
| PATCH | `/recommendations/:id/approve` | `manager` | Approve → creates `Offer` (see corrected workflow below) |
| PATCH | `/recommendations/:id/edit` | `manager` | Edit `suggestedValue` before approving |
| PATCH | `/recommendations/:id/dismiss` | `manager` | Dismiss |
| POST | `/predictions/validate-plan` | `manager` | Validate a manager's manual production quantity against the AI forecast |

## 4. AI Integration

**`POST /integration/restomind/surplus-offers`** (manager opens Surplus screen, or a pre-closing cron 2 hours before `closeHour`):
```json
// Request
{ "restaurantId": "...", "timestamp": "...", "closeHour": "22:00",
  "stock": [{ "productId": "p1", "title": "Kanafeh", "category": "Desserts", "price": 45, "freshnessWindow": 2, "avgDailySales": 40, "currentStock": 30 }] }
// Response
{ "restaurantId": "...", "checkedAt": "...",
  "itemsAtRisk": [{ "productId": "p1", "title": "Kanafeh", "currentStock": 30, "projectedSurplus": 18,
    "riskScore": 0.82, "urgency": "high", "suggestedDiscountPct": 25, "valueAtRiskEgp": 810, "offerCopyAr": "...", "newPrice": 34 }] }
```
**`POST /alerts/waste-prevention`** (manager enters a manual production quantity): request `{ sku, date, planned_quantity }`, response `{ forecast_qty, forecast_upper, excess_qty, severity, message, projected_waste_cost_egp }`. This is a validation call only — it does not persist a plan; `POST /predictions/validate-plan` simply proxies it and returns the result for the manager to see before they commit their own number via Phase 5's actuals/planning flow.

If either AI call is unreachable, return a clear `503`-equivalent response to the frontend ("AI temporarily unavailable — showing last computed report" for `/waste-reports`, or a plain validation-unavailable message for `/predictions/validate-plan`) rather than a raw 500 — these are request-triggered, not unattended cron jobs, so graceful degradation in the response is sufficient; no retry/fallback machinery is required here the way it is for Phases 5/6's cron-driven calls.

## 5. Business Workflow — Corrected Recommendation Approval

```
[Manager] ──> PATCH /recommendations/:id/approve
                    │
                    ├── 1. Fetch Recommendation (type: 'apply_discount')
                    ├── 2. Read Product.price fresh (read-only — Product is never written to)
                    ├── 3. Create Offer:
                    │        originalPrice = product.price        (snapshot, taken now)
                    │        discountPercentage = recommendation.suggestedValue
                    │        offerPrice = originalPrice × (1 − discountPercentage / 100)   [computed ONCE, stored only on Offer]
                    │        source = 'ai_recommendation', recommendationId = recommendation._id
                    ├── 4. Overlapping-offer check (Phase 0B's existing rule) — reject with ConflictException if this product already has an active/scheduled offer
                    └── 5. Update Recommendation.status = 'approved'

NO STEP HERE WRITES TO Product. Product.discountedPrice does not exist and this workflow must never create it.
```

## 6. Validation and Testing

- **Explicit regression test:** after approval, assert the `Product` document has no `discountedPrice` field/property at all — this is the single most important test in this phase given the prior review's finding.
- Confirm the Phase 0B overlapping-offer collision check fires correctly when two recommendations target the same product.
- Confirm `POST /recommendations/scan-surplus` and the pre-closing cron both call the same underlying service method (no duplicated surplus-detection logic).
- Confirm AI-unavailable responses degrade gracefully (documented message, not a raw 500).

## 7. Completion Checklist

- [ ] `WasteReport`/`Recommendation` models implemented.
- [ ] Approval workflow creates `Offer` exactly as specified above — zero writes to `Product`.
- [ ] Regression test confirming `Product.discountedPrice` does not exist passes.
- [ ] Overlapping-offer rule enforced on approval.
- [ ] Graceful AI-unavailable handling on both AI-calling endpoints.
- [ ] No existing endpoint from Phases 0–6 modified or broken.

**⏸ STOP — confirm Phase 7 before continuing to Phase 8.**

---

# Phase 8 — Feedback Loop, Reconciliation & AI Accuracy Analytics [FINAL PHASE]

## 1. Phase Goal

Close the loop on every AI-driven decision made in Phases 5–7: measure how accurate the daily plan was, how accurate the weekly prediction was, and how much an AI-recommended offer actually sold and recovered — using real, explicitly-defined metrics (WAPE, MASE), not an ad hoc per-row error percentage.

## 2. Models / Schema Changes

No new collections. This phase only *reads and writes back into* fields already defined in Phases 5–7 (`daily_production_plans.items[].actualProducedQty` was already added in Phase 5 for this purpose; `predictions.actualOrders`/`errorAbs`; `sales_transactions.offerId` from Phase 4 is what makes offer reconciliation precise now).

## 3. Backend Implementation

- **`ReconciliationModule`**, **`AccuracyModule`** (or one combined module if the project's convention prefers fewer, larger modules — check existing structure before deciding).
- **Weekly reconciliation cron:** `@Cron('0 3 * * 0')` — Sunday 3:00 AM (one hour after Phase 6's prediction cron, so the past week's predictions are stable before reconciling). For every `Prediction` with `targetWeek` in the past and `actualOrders: null`: aggregate `sales_transactions` for that `restaurantId`/`productId`/week, set `actualOrders`, compute `errorAbs = |predictedOrders - actualOrders|`. **Wrap each prediction's reconciliation in its own try/catch** — one malformed document must not abort the batch for every other restaurant/product.
- **Daily reconciliation** (runs after each day's actuals would reasonably be entered — e.g. `@Cron('0 23 * * *')`, 11:00 PM): for each `daily_production_plans` item with `actualProducedQty` now set, compute the same `errorAbs` at the item level.
- **Offer reconciliation** (part of the same weekly cron, or its own — your call given existing module boundaries): for every `Offer` with `source: 'ai_recommendation'` and `status` in `expired`/`sold_out`, aggregate `sales_transactions` **filtered by `offerId = offer._id`** (not product + date-range — this is the corrected version of the original bug) to set `actualUnitsSold`/`actualRevenueRecovered`.

**Explicit metric formulas — implement exactly these, not a placeholder:**

```
WAPE (Weighted Absolute Percentage Error), computed per restaurant per period:
  WAPE = ( Σ |actualOrders − predictedOrders| across all predictions in period )
         / ( Σ actualOrders across the same set )
         × 100

MASE (Mean Absolute Scaled Error), computed per restaurant per period:
  MAE_model  = mean( |actualOrders − predictedOrders| ) across the set
  MAE_naive  = mean( |actualOrders_thisWeek − actualOrders_previousEquivalentWeek| ) across the same set
               (for the daily workflow: previous DAY instead of previous week)
  MASE = MAE_model / MAE_naive

  MASE < 1.0  → the model beats a naive "just repeat last period" baseline
  MASE >= 1.0 → the model is no better than the naive baseline (this should be flagged, not hidden, in the accuracy response)
```
Both metrics are computed **on read** by `GET /predictions/accuracy` (aggregation pipeline over the reconciled `predictions`/`daily_production_plans` documents for the requested period), not pre-stored — the underlying `errorAbs` per document is stored (cheap, and independently useful for drill-down), but the aggregate WAPE/MASE numbers are always computed fresh from current data, avoiding a stale-cached-aggregate problem (the same principle already applied to `GroupOrder.overallStatus` staying read-derived elsewhere in this project, applied here to the raw per-document errors while the aggregate itself doesn't get cached — if query volume later makes this too slow, revisit as a targeted optimization, not by default now).

### Endpoints

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/predictions/reconcile` | `admin`, cron | Manually trigger reconciliation for completed periods |
| GET | `/predictions/accuracy` | `manager`, `admin` | Aggregate accuracy report |

**`GET /predictions/accuracy` response shape:**
```json
{
  "restaurantId": "...",
  "period": { "start": "2026-07-01", "end": "2026-07-25" },
  "weekly": { "wape": 12.4, "mase": 0.78, "totalPredictions": 34, "beatsNaiveBaseline": true },
  "daily":  { "wape": 9.1,  "mase": 0.85, "totalPlans": 25,      "beatsNaiveBaseline": true },
  "offers": { "totalOffers": 12, "totalActualUnitsSold": 340, "totalActualRevenueRecovered": 15200, "totalEstimatedRevenueRecovery": 16800 }
}
```

## 4. AI Integration

None directly — this phase reconciles data already produced by the AI-calling phases (5, 6, 7). No new calls to the Python microservice.

## 5. Business Workflow

```
Weekly cron (Sunday 3AM):
  For each unreconciled Prediction (targetWeek passed):
     aggregate actual sales → set actualOrders, errorAbs   [per-item try/catch]

Daily reconciliation (nightly):
  For each daily_production_plans item with actualProducedQty set:
     compute errorAbs at the item level

Offer reconciliation (same cron, or adjacent):
  For each expired/sold_out AI-recommendation Offer:
     aggregate sales_transactions WHERE offerId = offer._id
     → set actualUnitsSold, actualRevenueRecovered

On demand:
  GET /predictions/accuracy → aggregation pipeline computes WAPE/MASE fresh
     for both weekly and daily workflows, plus offer-effectiveness summary
```

## 6. Validation and Testing

- **Hand-verify WAPE and MASE against a small worked example** (3–4 predictions with known actual/predicted values) before trusting the aggregation pipeline's output.
- Confirm offer reconciliation uses `offerId`, not product + date-range — test with a product that has both offer and non-offer sales in the same window, confirm only the offer-linked sales count toward that offer's `actualUnitsSold`.
- Confirm both `weekly` and `daily` sections of the accuracy response are populated — not just one.
- Deliberately corrupt one `Prediction` document (e.g. missing `predictedOrders`) and confirm the weekly reconciliation batch still completes for every other document, logging the one failure rather than aborting.

## 7. Completion Checklist

- [ ] Weekly and daily reconciliation both implemented, both with per-item try/catch.
- [ ] Offer reconciliation filters by `offerId`.
- [ ] WAPE and MASE implemented exactly per the formulas above, hand-verified against a worked example.
- [ ] `GET /predictions/accuracy` returns both `weekly` and `daily` sections.
- [ ] No existing endpoint from Phases 0–7 modified or broken.

## Final Project Checklist — AI Integration Arc Complete

- [ ] Every cron job across Phases 4–8 has retry handling, a defined fallback, and error-level logging on exhausted retries.
- [ ] No phase anywhere writes to `Product.discountedPrice`.
- [ ] Every demand-vs-inventory comparison in the codebase goes through the recipe conversion.
- [ ] Both daily and weekly prediction workflows are measurably tracked for accuracy, independently.
- [ ] `sales_transactions.offerId` is populated for every offer-driven sale, enabling precise offer reconciliation.

**This is the final phase.** Once its checklist and the Final Project Checklist above are both confirmed, the AI integration arc described across the original Capstone Proposal, the AI Workflow Analysis, and every review in this conversation is complete.
