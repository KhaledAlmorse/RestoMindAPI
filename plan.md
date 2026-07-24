# RestoMind Backend — Single Source of Truth Implementation Plan (AI-Integrated)

**Source of truth used to build this plan:**

- `API_STRUCTURE_AND_ENDPOINTS.md` — current live implementation in `RestoMindApi`.
- `RestoMind Database Schema` + `RestoMind API Documentation` — target design for Admin/Manager & AI pipeline.
- `INTEGRATION_GUIDE.md` + `ENDPOINTS.md` (in `prediction-model`) — FastAPI AI microservice contracts, payloads, and integration bridge schemas.

---

## 🚦 Project Status Summary

| Phase | Description | Status |
|---|---|---|
| **Phase 0** | Onboarding & Restaurant-Owner Enforcements | ✅ **COMPLETE** |
| **Phase 0B** | Offers Entity & Discount Sync Architecture | ✅ **COMPLETE** |
| **Phase 1** | Categories, Ingredients, and Recipes | ✅ **COMPLETE** |
| **Phase 2** | Sales Transactions & Order → Sales Sync | ✅ **COMPLETE** |
| **Phase 3** | Inventory, Batches, Waste Events, Suppliers & POs | ⏳ **UP NEXT (Phase 3)** |
| **Phase 4** | Import Center (CSV Upload Pipeline + AI Auto-Ingest) | ⏳ **Phase 4** |
| **Phase 5** | AI Demand Prediction Pipeline & Microservice Bridge | ⏳ **Phase 5** |
| **Phase 6** | Waste Reports, Surplus Detection & Recommendations | ⏳ **Phase 6** |
| **Phase 7** | Feedback Loop, Reconciliation & AI Accuracy Analytics | ⏳ **Phase 7** |
| **Phase 8** | Executive Dashboards & Operational Hardening | ⏳ **Phase 8** |

---

## 📐 Established Architecture & Integration Rules

1. **Service Decoupling**: The FastAPI AI microservice operates independently on `AI_SERVICE_URL` (default: `http://127.0.0.1:8200`). Frontend applications **NEVER** call the AI microservice directly. All communications pass through NestJS backend services (`AiService`).
2. **Database Storage of AI Outputs**: All predictions, AI features, waste reports, and generated offer copies returned by the AI microservice are persisted into MongoDB (`predictions`, `waste_reports`, `recommendations`, `offers`) to maintain audit logs and drive analytics.
3. **Exceptions**: Standardized NestJS exceptions (`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`, `ServiceUnavailableException`).
4. **Denormalized Discount Cache**: `Product.discountedPrice` is an automated read-cache maintained via `Offer` lifecycle triggers (`draft → scheduled → active → expired/cancelled`).

---

## Phase 0 — Onboarding Hardening ✅ COMPLETE

*All 5 edge cases resolved. Owner 1:1 constraint, atomic creation, and soft-delete cleanup verified.*

---

## Phase 0B — Offers Entity & Discount Architecture ✅ COMPLETE

*Separate `Offer` model implemented with automated `Product.discountedPrice` sync and overlapping-offer collision checks.*

---

## Phase 1 — Categories, Ingredients & Recipes ✅ COMPLETE

*Ingredients CRUD, recipe model (1 recipe per product), and restaurant-scoped ingredient validation verified.*

---

## Phase 2 — Sales Transactions & Order → Sales Sync ✅ COMPLETE

*`sales_transactions` model active. Completed marketplace orders (`Delivered`) auto-create `sales_transactions` rows in a fire-and-forget safe wrapper with `promotionActive` flags.*

---

## Phase 3 — Inventory, Batches, Waste Events, Suppliers & Purchase Orders

**Primary Role in AI Pipeline:** Provides stock availability, expiration dates, unit costs, and incoming purchase orders needed for **Phase 6 Waste Risk Formulas** (`usableAvailableStock = sum(batches where expiryDate > targetDate)`).

### Endpoints to Implement

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/inventory/batches` | `manager` | Create stock batch with expiry date & unit cost |
| GET | `/inventory/batches` | `manager` | List batches (filterable by `ingredientId`, `expiringBefore`) |
| POST | `/inventory/transactions` | `manager` | Record stock transactions (`purchase`, `consumption`, `waste`, `adjustment`) |
| GET | `/inventory/transactions` | `manager` | Query transaction ledger |
| POST | `/inventory/waste-events` | `manager` | Log detailed waste events (`wasteReason`, `estimatedCost`) |
| GET | `/inventory/waste-events` | `manager` | Query waste events for reporting |
| POST | `/suppliers` | `manager` | Create supplier record (`leadTimeDays`, `contactInfo`) |
| GET | `/suppliers` | `manager` | List suppliers |
| POST | `/purchase-orders` | `manager` | Draft or send purchase order |
| GET | `/purchase-orders` | `manager` | List purchase orders |
| PATCH | `/purchase-orders/:id/receive` | `manager` | Receive PO → auto-creates `inventory_batches` |

### Database Models Required

```typescript
// inventory-batch.model.ts
_id                ObjectId
restaurantId       ObjectId → Restaurant         required (index)
ingredientId       ObjectId → Ingredient         required (index)
batchNumber        String                        required
quantityRemaining  Number                        required (min 0)
unitCost           Number                        required
expiryDate         Date                          required (index for AI waste formula)
receivedDate       Date                          default Date.now

// waste-event.model.ts
_id                ObjectId
restaurantId       ObjectId → Restaurant         required (index)
ingredientId       ObjectId → Ingredient         required
batchId            ObjectId → InventoryBatch     optional
quantity           Number                        required
unit               String                        required
wasteReason        expired|overproduction|prep_loss|spoiled|damaged|other  required
estimatedCost      Number                        required
date               Date                          default Date.now (index)

// supplier.model.ts & purchase-order.model.ts
// purchase-order: includes expectedDeliveryDate & status (draft|sent|received|cancelled)
```

### AI Integration Support & Indexes
- **Compound Index Required**: `inventory_batches.createIndex({ restaurantId: 1, ingredientId: 1, expiryDate: 1 })` so Phase 6 waste calculations can instantly query non-expired usable stock.
- `PATCH /purchase-orders/:id/receive` automatically populates `inventory_batches` so incoming stock is recognized by the AI waste formula.

---

## Phase 4 — Import Center (CSV Upload Pipeline & AI Auto-Ingest)

**Primary Role in AI Pipeline:** Onboards historical sales/inventory CSV data and **immediately triggers AI learning (`POST /integration/restomind/ingest`)** so new restaurants promote from rule-based estimates to trained demand levels instantly.

### Endpoints to Implement

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/imports` | `manager` | Upload CSV file (`multipart/form-data`) |
| POST | `/imports/:id/preview` | `manager` | Parse headers & map columns |
| POST | `/imports/:id/confirm` | `manager` | Validate & write rows to database + **Trigger AI Ingest** |
| GET | `/imports` | `manager` | List import job history |
| GET | `/imports/:id` | `manager` | Get detailed import job status & error log |

### Models

- **`import-job.model.ts`**: `restaurantId, uploadedBy, importType (menu_items|sales_history|recipes|inventory_transactions|waste_events|offers|inventory_batches), fileName, status (processing|validated|failed), totalRows, validRows, invalidRows, errors[]`.

### ⚡ AI Integration Trigger in Confirmation Step (`POST /imports/:id/confirm`)
When `importType === 'sales_history'` is confirmed:
1. Valid rows are written into MongoDB `sales_transactions` with `source: 'csv_import'`.
2. **AI Ingest Step**: NestJS automatically calls AI microservice **`POST /integration/restomind/ingest`**:
   - **Payload Sent**:
     ```json
     {
       "restaurantId": "665f...",
       "records": [ { "date": "2025-07-20", "productId": "665f...", "salesQty": 115 } ],
       "products": [ { "productId": "665f...", "title": "كنافة", "category": "حلويات شرقية" } ]
     }
     ```
   - **Result**: The AI microservice learns the real demand level for imported products immediately without waiting for the nightly cron job.

---

## Phase 5 — AI Demand Prediction Pipeline & Microservice Bridge

**Primary Objective**: Integrate NestJS backend with FastAPI AI Microservice to generate, persist, and serve weekly demand predictions and daily production plans.

### 🔌 AI Microservice Endpoints Used in Phase 5

| AI Endpoint | Method | Trigger / Frequency | Request Payload | Expected Response |
|---|---|---|---|---|
| `/integration/restomind/predict` | `POST` | On-demand recalculation or scheduled weekly job | `{ restaurantId, productId, title, category, targetWeek, avgDailySales, promotionActive }` | `{ restaurantId, productId, modelVersionId, targetWeek, predictedOrders, confidence, featuresUsed, factors, dailyBreakdown }` |
| `/integration/restomind/production-plan` | `POST` | Admin opens daily production screen | `{ restaurantId, date, products: [{ productId, title, category, price, freshnessWindow, avgDailySales }] }` | `{ restaurantId, date, totalRecommendedQty, items: [{ productId, recommendedQty, lowerBound, upperBound, confidence, source, factors }] }` |
| `/integration/restomind/ingest` | `POST` | Nightly Cron Job (`EVERY_DAY_AT_2AM`) | `{ restaurantId, records: [{ date, productId, salesQty }], products: [{ productId, title, category }] }` | `{ restaurantId, rowsIngested, updatedProducts }` |
| `/integration/restomind/status/{id}` | `GET` | Admin views restaurant AI progress bar | *None (Path Parameter)* | `{ restaurantId, totalProducts, learnedProducts, estimatedProducts, products: [{ productId, mode, observedDays, learnedLevel }] }` |

---

### Backend Endpoints to Implement (RestoMindApi)

| Method | Backend Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/predictions/recalculate` | `manager` | Recalculate weekly prediction for one product |
| POST | `/predictions/batch-recalculate` | `manager`, system | Recalculate weekly predictions for all restaurant products |
| GET | `/predictions` | `manager` | Query stored weekly predictions (`restaurantId`, `targetWeek`) |
| GET | `/predictions/production-plan` | `manager` | Get daily production plan for Admin UI |
| GET | `/predictions/learned-status` | `manager` | Get AI learning progress per product (learned vs estimated) |

---

### Database Models Required

```typescript
// prediction.model.ts
_id                ObjectId
restaurantId       ObjectId → Restaurant         required (index)
productId          ObjectId → Product            required (index)
modelVersionId     String                        required ("restomind-bridge/rule_based-v0.1" or ML version)
targetWeek         String                        required (YYYY-MM-DD format, index)
predictedOrders    Number                        required
confidence         high|medium|low               required
featuresUsed       Object                        required (snapshot of baseDailyLevel, calendar context, etc.)
factors            Array<{ factor: string, impact_pct: number, direction: string }>
dailyBreakdown     Array<{ date: string, predictedQuantity: number, factors: Array<any> }>
actualOrders       Number                        nullable (populated in Phase 7 reconciliation)
createdAt/updatedAt Date

// Compound Index: { restaurantId: 1, productId: 1, targetWeek: 1 } (Unique)
```

---

### Detailed Workflow & Data Flow

#### 1. Weekly Prediction Flow (`POST /predictions/recalculate`)
```
[Manager / Cron] ──> POST /predictions/recalculate { restaurantId, productId, targetWeek }
                           │
                           ├── 1. Fetch Product, Category name, and check active Offer for targetWeek
                           ├── 2. HTTP POST -> AI_SERVICE_URL/integration/restomind/predict
                           ├── 3. Parse JSON response & factors
                           └── 4. Upsert document into MongoDB `predictions` collection
```

#### 2. Daily Production Plan Flow (`GET /predictions/production-plan?date=YYYY-MM-DD`)
```
[Admin UI] ──> GET /predictions/production-plan?restaurantId=...&date=2025-03-15
                   │
                   ├── 1. Query all active Products for restaurant (with price, freshnessWindow, avgDailySales)
                   ├── 2. HTTP POST -> AI_SERVICE_URL/integration/restomind/production-plan
                   └── 3. Return totalRecommendedQty and item breakdowns directly to Admin UI
```

#### 3. Nightly AI Sales Ingestion Cron (`EVERY_DAY_AT_2AM`)
```typescript
@Cron(CronExpression.EVERY_DAY_AT_2AM)
async handleNightlyAiSync() {
  const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');
  const sales = await this.salesTransactionModel.find({ date: yesterday });
  
  // Group by restaurantId and call AI /integration/restomind/ingest
  await this.aiService.ingestSales({ restaurantId, records: sales, products });
}
```

#### 4. Cold-Start & Graceful Fallback Strategy
If the AI microservice is unreachable or training (HTTP 503 / timeout):
- NestJS catches the exception and generates a rule-based fallback using `product.avgDailySales` (owner estimate) multiplied by category calendar priors.
- Sets `confidence: "low"` and `featuresUsed.fallback = true`, ensuring Admin UI never crashes.

---

## Phase 6 — Waste Reports, Surplus Detection & Recommendations

**Primary Objective**: Detect stock at risk of being wasted near closing hours, generate recommended discount offers with Egyptian Arabic promotional copy, and validate manual manager production plans.

### 🔌 AI Microservice Endpoints Used in Phase 6

| AI Endpoint | Method | Trigger / Frequency | Request Payload | Expected Response |
|---|---|---|---|---|
| `/integration/restomind/surplus-offers` | `POST` | 1. Manager opens Stores Surplus screen<br>2. Cron job 2 hours before closing hour | `{ restaurantId, timestamp, closeHour, stock: [{ productId, title, category, price, freshnessWindow, avgDailySales, currentStock }] }` | `{ restaurantId, checkedAt, itemsAtRisk: [{ productId, title, currentStock, projectedSurplus, riskScore, urgency, suggestedDiscountPct, valueAtRiskEgp, offerCopyAr, newPrice }] }` |
| `/alerts/waste-prevention` | `POST` | Manager enters manual production quantity in Admin UI | `{ sku, date, planned_quantity }` | `{ forecast_qty, forecast_upper, excess_qty, severity, message, projected_waste_cost_egp }` |

---

### Backend Endpoints to Implement (RestoMindApi)

| Method | Backend Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/waste-reports` | `manager` | List generated waste risk reports |
| GET | `/waste-reports/summary` | `manager` | Executive waste financial cost summary (EGP) |
| GET | `/recommendations` | `manager` | Get pending AI recommendations (discounts/production stops) |
| POST | `/recommendations/scan-surplus` | `manager` | Trigger on-demand surplus scan via AI microservice |
| PATCH | `/recommendations/:id/approve` | `manager` | Approve recommendation → **Auto-creates `Offer` (Phase 0B)** |
| PATCH | `/recommendations/:id/edit` | `manager` | Edit discount % before approving |
| PATCH | `/recommendations/:id/dismiss` | `manager` | Dismiss recommendation |
| POST | `/predictions/validate-plan` | `manager` | Validate manual manager plan via `/alerts/waste-prevention` |

---

### Database Models Required

```typescript
// waste-report.model.ts
_id                        ObjectId
restaurantId               ObjectId → Restaurant         required (index)
productId                  ObjectId → Product            required
checkedAt                  Date                          required
currentStock               Number                        required
expectedSurplus            Number                        required
riskScore                  Number                        required (0.0 to 1.0)
valueAtRiskEgp             Number                        required

// recommendation.model.ts
_id                        ObjectId
restaurantId               ObjectId → Restaurant         required (index)
wasteReportId              ObjectId → WasteReport        optional
productId                  ObjectId → Product            required
type                       apply_discount|reduce_purchase|stop_production|transfer_stock required
suggestedValue             Number                        required (e.g. 35 for 35% discount)
offerCopyAr                String                        optional (Egyptian Arabic ad copy)
estimatedWasteReduction    Number                        optional (units)
estimatedRevenueRecovery   Number                        optional (EGP)
status                     pending|approved|edited|dismissed required
reviewedBy                 ObjectId → User               optional
createdAt/updatedAt        Date
```

---

### Detailed Workflow: Recommendation Approval (`PATCH /recommendations/:id/approve`)

```
[Manager] ──> PATCH /recommendations/:id/approve
                    │
                    ├── 1. Fetch Recommendation document (type: 'apply_discount')
                    ├── 2. Create Offer (Phase 0B) document:
                    │      {
                    │        productId: rec.productId,
                    │        restaurantId: rec.restaurantId,
                    │        discountPercentage: rec.suggestedValue,
                    │        startDate: now,
                    │        endDate: endOfDay (or closeHour),
                    │        status: 'active',
                    │        source: 'ai_recommendation',
                    │        recommendationId: rec._id,
                    │        estimatedWasteReduction: rec.estimatedWasteReduction,
                    │        estimatedRevenueRecovery: rec.estimatedRevenueRecovery
                    │      }
                    ├── 3. Trigger Phase 0B Sync: Product.discountedPrice = price * (1 - discount/100)
                    └── 4. Update Recommendation status = 'approved'
```

---

## Phase 7 — Feedback Loop, Reconciliation & AI Accuracy Analytics

**Primary Objective**: Reconcile predictions against actual end-of-week sales, evaluate AI accuracy metrics (WAPE / MASE), and measure financial waste reduction of AI-recommended offers.

### Endpoints to Implement

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/predictions/reconcile` | `admin`, cron | Run reconciliation job for completed target weeks |
| GET | `/predictions/accuracy` | `manager`, `admin` | View prediction accuracy & financial recovery metrics |

---

### ⚙️ Reconciliation Cron Job (`EVERY_SUNDAY_AT_3AM`)

```typescript
@Cron('0 3 * * 0') // Every Sunday at 3 AM
async reconcilePastWeek() {
  const pastWeek = moment().subtract(1, 'week').startOf('isoWeek').format('YYYY-MM-DD');
  
  // 1. Reconcile Predictions
  const predictions = await this.predictionModel.find({ targetWeek: pastWeek, actualOrders: null });
  for (const pred of predictions) {
    const actualSales = await this.salesTransactionModel.aggregate([
      { $match: { restaurantId: pred.restaurantId, productId: pred.productId, date: { $gte: weekStart, $lte: weekEnd } } },
      { $group: { _id: null, total: { $sum: '$quantitySold' } } }
    ]);
    const actualOrders = actualSales[0]?.total || 0;
    const errorPct = Math.abs(pred.predictedOrders - actualOrders) / Math.max(actualOrders, 1);
    
    await this.predictionModel.updateOne({ _id: pred._id }, { actualOrders, errorPct });
  }

  // 2. Reconcile AI Offers
  const expiredOffers = await this.offerModel.find({ source: 'ai_recommendation', status: 'expired', actualUnitsSold: null });
  for (const offer of expiredOffers) {
    const sales = await this.salesTransactionModel.aggregate([
      { $match: { restaurantId: offer.restaurantId, productId: offer.productId, date: { $gte: offer.startDate, $lte: offer.endDate } } },
      { $group: { _id: null, units: { $sum: '$quantitySold' }, revenue: { $sum: { $multiply: ['$quantitySold', '$sellingPrice'] } } } }
    ]);
    
    await this.offerModel.updateOne(
      { _id: offer._id },
      { actualUnitsSold: sales[0]?.units || 0, actualRevenueRecovered: sales[0]?.revenue || 0 }
    );
  }
}
```

---

## Phase 8 — Executive Dashboards & Operational Hardening

**Primary Objective**: Deliver unified reporting dashboards for Admins and Restaurant Managers combining sales analytics, AI prediction accuracy, financial waste recovered (EGP), and system health.

### Endpoints to Implement

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/analytics/dashboard` | `manager` | Executive manager dashboard (sales, AI accuracy, waste saved EGP) |
| GET | `/analytics/ai-impact` | `admin`, `manager` | ROI report: Waste prevented vs revenue recovered via AI offers |

---

## 🔒 Verification & Phase Transition Rules

1. **Strict Phase Sequencing**: Phase 3 (Inventory) and Phase 4 (Import Center) **MUST** be implemented and tested before starting Phase 5 (AI Integration).
2. **Postman Test Requirements**: Each phase must pass automated Postman integration tests covering happy paths, edge cases, and AI microservice fallback scenarios before declaring complete.
