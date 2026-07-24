# RestoMind Backend — Single Source of Truth Implementation Plan (AI-Integrated)

**Source of truth used to build this plan:**

- `API_STRUCTURE_AND_ENDPOINTS.md` — current live implementation in `RestoMindApi`.
- `RestoMind Database Schema` + `RestoMind API Documentation` — target design for Admin/Manager & AI pipeline.
- `INTEGRATION_GUIDE.md` + `ENDPOINTS.md` (in `prediction-model`) — FastAPI AI microservice contracts, payloads, and integration bridge schemas.

---

## 🚦 Project Status Summary

| Phase        | Description                                                      | Status                   |
| ------------ | ---------------------------------------------------------------- | ------------------------ |
| **Phase 0**  | Onboarding & Restaurant-Owner Enforcements                       | ✅ **COMPLETE**          |
| **Phase 0B** | Offers Entity & Discount Sync Architecture                       | ✅ **COMPLETE**          |
| **Phase 1**  | Categories, Ingredients, and Recipes                             | ✅ **COMPLETE**          |
| **Phase 2**  | Sales Transactions & Order → Sales Sync                          | ✅ **COMPLETE**          |
| **Phase 3**  | Inventory, Batches, Waste Events, Suppliers & POs                | ⏳ **UP NEXT (Phase 3)** |
| **Phase 4**  | Import Center (CSV Upload Pipeline + AI Auto-Ingest)             | ⏳ **Phase 4**           |
| **Phase 5**  | AI Demand Prediction Pipeline (Daily Primary + Weekly Secondary) | ⏳ **Phase 5**           |
| **Phase 6**  | Waste Reports, Surplus Detection & Recommendations               | ⏳ **Phase 6**           |
| **Phase 7**  | Feedback Loop, Reconciliation & AI Accuracy Analytics            | ⏳ **Phase 7**           |
| **Phase 8**  | Executive Dashboards & Operational Hardening                     | ⏳ **Phase 8**           |

---

## 📐 Dual AI Workflow Architecture & Rules

In our Egyptian bakery production model, predictions serve two distinct operational workflows:

```
                               ┌────────────────────────────────────────────────────────┐
                               │                 NestJS Backend System                  │
                               └───────────────────────────┬────────────────────────────┘
                                                           │
              ┌────────────────────────────────────────────┴────────────────────────────────────────────┐
              ▼                                                                                         ▼
  🥇 PRIMARY WORKFLOW (Daily Production)                                                  🥈 SECONDARY WORKFLOW (Weekly Strategy)
  ---------------------------------------                                                  ---------------------------------------
  • Frequency: Every Day @ 12:00 AM Cron                                                   • Frequency: Every Sunday @ 12:00 AM Cron
  • Target: Next-Day Kitchen Baking Checklist                                              • Target: 7-Day Demand Horizon & DB Archive
  • AI Endpoint: POST /integration/restomind/production-plan                               • AI Endpoint: POST /integration/restomind/predict
  • Beneficiaries: Bakery Managers & Kitchen Staff                                         • Beneficiaries: Purchasing, Suppliers & DB Analytics
  • Model Saved: `daily_production_plans` Collection                                       • Model Saved: `predictions` Collection
```

### Core Architecture Rules:

1. **Service Decoupling**: The FastAPI AI microservice runs on `AI_SERVICE_URL` (default: `http://127.0.0.1:8200`). Frontend applications **NEVER** call the AI service directly — all calls route through NestJS `AiService`.
2. **Primary Daily Flow**: The 12:00 AM daily cron job drives day-to-day kitchen baking quantities for the next business day (`recommendedQty`, `lowerBound`, `upperBound`, `factors`).
3. **Secondary Weekly Flow**: The Sunday 12:00 AM cron job drives supplier purchase orders (`purchase_orders`), long-term stock planning, and stores 7-day prediction documents in MongoDB `predictions` collection (`targetWeek`, `predictedOrders`, `dailyBreakdown`).

---

## Phase 0 — Onboarding Hardening ✅ COMPLETE

_All 5 edge cases resolved. Owner 1:1 constraint, atomic creation, and soft-delete cleanup verified._

---

## Phase 0B — Offers Entity & Discount Architecture ✅ COMPLETE

_Separate `Offer` model implemented with automated `Product.discountedPrice` sync and overlapping-offer collision checks._

---

## Phase 1 — Categories, Ingredients & Recipes ✅ COMPLETE

_Ingredients CRUD, recipe model (1 recipe per product), and restaurant-scoped ingredient validation verified._

---

## Phase 2 — Sales Transactions & Order → Sales Sync ✅ COMPLETE

_`sales_transactions` model active. Completed marketplace orders (`Delivered`) auto-create `sales_transactions` rows in a fire-and-forget safe wrapper with `promotionActive` flags._

---

## Phase 3 — Inventory, Batches, Waste Events, Suppliers & Purchase Orders

**Primary Role in AI Pipeline:** Provides stock availability, expiration dates, unit costs, and incoming purchase orders needed for **Weekly Supplier Planning (Secondary Flow)** and **Phase 6 Waste Risk Formulas** (`usableAvailableStock = sum(batches where expiryDate > targetDate)`).

### Endpoints to Implement

| Method | Endpoint                       | Roles     | Description                                                                  |
| ------ | ------------------------------ | --------- | ---------------------------------------------------------------------------- |
| POST   | `/inventory/batches`           | `manager` | Create stock batch with expiry date & unit cost                              |
| GET    | `/inventory/batches`           | `manager` | List batches (filterable by `ingredientId`, `expiringBefore`)                |
| POST   | `/inventory/transactions`      | `manager` | Record stock transactions (`purchase`, `consumption`, `waste`, `adjustment`) |
| GET    | `/inventory/transactions`      | `manager` | Query transaction ledger                                                     |
| POST   | `/inventory/waste-events`      | `manager` | Log detailed waste events (`wasteReason`, `estimatedCost`)                   |
| GET    | `/inventory/waste-events`      | `manager` | Query waste events for reporting                                             |
| POST   | `/suppliers`                   | `manager` | Create supplier record (`leadTimeDays`, `contactInfo`)                       |
| GET    | `/suppliers`                   | `manager` | List suppliers                                                               |
| POST   | `/purchase-orders`             | `manager` | Draft or send purchase order (fed by Weekly AI Forecasts)                    |
| GET    | `/purchase-orders`             | `manager` | List purchase orders                                                         |
| PATCH  | `/purchase-orders/:id/receive` | `manager` | Receive PO → auto-creates `inventory_batches`                                |

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
```

---

## Phase 4 — Import Center (CSV Upload Pipeline & AI Auto-Ingest)

**Primary Role in AI Pipeline:** Onboards historical sales/inventory CSV data and **immediately triggers AI learning (`POST /integration/restomind/ingest`)** so new restaurants promote from rule-based estimates to trained demand levels instantly.

### Endpoints to Implement

| Method | Endpoint               | Roles     | Description                                              |
| ------ | ---------------------- | --------- | -------------------------------------------------------- |
| POST   | `/imports`             | `manager` | Upload CSV file (`multipart/form-data`)                  |
| POST   | `/imports/:id/preview` | `manager` | Parse headers & map columns                              |
| POST   | `/imports/:id/confirm` | `manager` | Validate & write rows to DB + **Trigger AI Auto-Ingest** |
| GET    | `/imports`             | `manager` | List import job history                                  |
| GET    | `/imports/:id`         | `manager` | Get detailed import job status & error log               |

### ⚡ AI Integration Trigger in Confirmation Step (`POST /imports/:id/confirm`)

When `importType === 'sales_history'` is confirmed:

1. Valid rows are written into MongoDB `sales_transactions` with `source: 'csv_import'`.
2. **AI Ingest Step**: NestJS automatically calls AI microservice **`POST /integration/restomind/ingest`**:
   - **Payload Sent**: `{ restaurantId, records: [{ date, productId, salesQty }], products: [{ productId, title, category }] }`
   - **Result**: The AI microservice learns the real demand level for imported products immediately.

---

## Phase 5 — AI Demand Prediction Pipeline (Dual Workflow Architecture)

**Primary Objective**: Implement the 12:00 AM Daily Production Plan workflow as the main kitchen system, and the 12:00 AM Sunday Weekly Prediction workflow for supplier orders and MongoDB predictions archiving.

---

### 🥇 WORKFLOW 1: Primary Daily Production Planning (12:00 AM Nightly Cron)

- **Trigger**: Scheduled Cron Job running **Every Day at 12:00 AM (`@Cron('0 0 * * *')`)** OR On-Demand API (`GET /predictions/production-plan?date=YYYY-MM-DD`).
- **Target Audience**: Bakery Managers & Kitchen Bakers.
- **AI Endpoint Called**: **`POST /integration/restomind/production-plan`**
- **Request Payload Sent from NestJS**:
  ```json
  {
    "restaurantId": "665f0a1b2c3d4e5f00000001",
    "date": "2025-03-15",
    "products": [
      {
        "productId": "p1",
        "title": "كرواسون",
        "category": "معجنات",
        "price": 18,
        "freshnessWindow": 2,
        "avgDailySales": 180
      },
      {
        "productId": "p2",
        "title": "كنافة",
        "category": "حلويات شرقية",
        "price": 45,
        "freshnessWindow": 2,
        "avgDailySales": 40
      }
    ]
  }
  ```
- **Expected Response from AI Microservice**:
  ```json
  {
    "restaurantId": "665f0a1b2c3d4e5f00000001",
    "date": "2025-03-15",
    "totalRecommendedQty": 210,
    "items": [
      {
        "productId": "p1",
        "recommendedQty": 90,
        "lowerBound": 70,
        "upperBound": 110,
        "confidence": "medium",
        "source": "rule_based",
        "factors": []
      },
      {
        "productId": "p2",
        "recommendedQty": 120,
        "lowerBound": 100,
        "upperBound": 140,
        "confidence": "high",
        "source": "rule_based",
        "factors": []
      }
    ]
  }
  ```
- **Backend Processing & Database Writes**:
  - NestJS persists the daily plan in `daily_production_plans` MongoDB collection:
    ```typescript
    // daily-production-plan.model.ts
    _id                  ObjectId
    restaurantId         ObjectId → Restaurant (required, index)
    date                 String (YYYY-MM-DD, required, index)
    totalRecommendedQty  Number
    items                Array<{ productId: ObjectId, recommendedQty: Number, lowerBound: Number, upperBound: Number, confidence: String, factors: Array<any> }>
    actualProducedQty    Number (nullable, filled in by manager at end of day)
    createdAt/updatedAt   Date
    ```

---

### 🥈 WORKFLOW 2: Secondary Weekly Demand Prediction (Sunday 12:00 AM Cron)

- **Trigger**: Scheduled Cron Job running **Every Sunday at 12:00 AM (`@Cron('0 0 * * 0')`)** OR On-Demand API (`POST /predictions/recalculate`).
- **Target Audience**: Restaurant Owners, Purchasing Managers & DB Analytics.
- **AI Endpoint Called**: **`POST /integration/restomind/predict`**
- **Request Payload Sent from NestJS**:
  ```json
  {
    "restaurantId": "665f0a1b2c3d4e5f00000001",
    "productId": "665f0a1b2c3d4e5f00000042",
    "title": "كنافة",
    "category": "حلويات شرقية",
    "targetWeek": "2025-03-10",
    "avgDailySales": 40,
    "promotionActive": false
  }
  ```
- **Expected Response from AI Microservice**:
  ```json
  {
    "restaurantId": "665f0a1b2c3d4e5f00000001",
    "productId": "665f0a1b2c3d4e5f00000042",
    "modelVersionId": "restomind-bridge/rule_based-v0.1",
    "targetWeek": "2025-03-10",
    "predictedOrders": 840,
    "confidence": "medium",
    "featuresUsed": {
      "mode": "rule_based",
      "baseDailyLevel": 40,
      "calendar": { "isRamadan": true }
    },
    "factors": [
      { "factor": "Ramadan", "impact_pct": 150.0, "direction": "increase" }
    ],
    "dailyBreakdown": [{ "date": "2025-03-10", "predictedQuantity": 120 }]
  }
  ```
- **Backend Processing & Database Writes**:
  - NestJS upserts into MongoDB `predictions` collection:
    ```typescript
    // prediction.model.ts
    _id                ObjectId
    restaurantId       ObjectId → Restaurant (index)
    productId          ObjectId → Product (index)
    modelVersionId     String
    targetWeek         String (YYYY-MM-DD, index)
    predictedOrders    Number
    confidence         high|medium|low
    featuresUsed       Object
    factors            Array<any>
    dailyBreakdown     Array<{ date: String, predictedQuantity: Number }>
    actualOrders       Number (nullable, populated in Phase 7 reconciliation)
    createdAt/updatedAt Date
    ```
  - **Supplier Order Auto-Draft**: If weekly predicted demand exceeds available inventory batches, NestJS automatically drafts a recommended `purchase_order` for the required raw ingredients (Phase 3 integration).

---

### 🌙 WORKFLOW 3: Nightly AI Sales Sync Cron (`EVERY_DAY_AT_2AM`)

- **Trigger**: Scheduled Cron Job running **Every Day at 2:00 AM (`@Cron('0 2 * * *')`)**.
- **AI Endpoint Called**: **`POST /integration/restomind/ingest`**
- **Request Payload Sent**: `{ restaurantId, records: [{ date, productId, salesQty }], products: [{ productId, title, category }] }`
- **Result**: Python AI microservice updates learned store levels from yesterday's actual sales.

---

### Backend Endpoints to Implement (RestoMindApi)

| Method | Backend Endpoint                       | Roles             | Description                                                                     |
| ------ | -------------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| GET    | `/predictions/production-plan`         | `manager`         | **Primary:** Get daily production plan for target date                          |
| POST   | `/predictions/production-plan/actuals` | `manager`         | Record actual baking quantities produced today                                  |
| POST   | `/predictions/recalculate`             | `manager`         | **Secondary:** Recalculate weekly prediction for one product                    |
| POST   | `/predictions/batch-recalculate`       | `manager`, system | **Secondary:** Recalculate weekly predictions for all products                  |
| GET    | `/predictions`                         | `manager`         | Query stored weekly predictions (`restaurantId`, `targetWeek`)                  |
| GET    | `/predictions/learned-status`          | `manager`         | Get AI learning progress per product (`GET /integration/restomind/status/{id}`) |

---

## Phase 6 — Waste Reports, Surplus Detection & Recommendations

**Primary Objective**: Detect stock at risk of being wasted near closing hours, generate recommended discount offers with Egyptian Arabic promotional copy, and validate manual manager production plans.

### 🔌 AI Microservice Endpoints Used in Phase 6

| AI Endpoint                             | Method | Trigger / Frequency                                                               | Request Payload                                                                                                                        | Expected Response                                                                                                                                                                   |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/integration/restomind/surplus-offers` | `POST` | 1. Manager opens Stores Surplus screen<br>2. Cron job 2 hours before closing hour | `{ restaurantId, timestamp, closeHour, stock: [{ productId, title, category, price, freshnessWindow, avgDailySales, currentStock }] }` | `{ restaurantId, checkedAt, itemsAtRisk: [{ productId, title, currentStock, projectedSurplus, riskScore, urgency, suggestedDiscountPct, valueAtRiskEgp, offerCopyAr, newPrice }] }` |
| `/alerts/waste-prevention`              | `POST` | Manager enters manual production quantity in Admin UI                             | `{ sku, date, planned_quantity }`                                                                                                      | `{ forecast_qty, forecast_upper, excess_qty, severity, message, projected_waste_cost_egp }`                                                                                         |

---

### Backend Endpoints to Implement (RestoMindApi)

| Method | Backend Endpoint                | Roles     | Description                                                  |
| ------ | ------------------------------- | --------- | ------------------------------------------------------------ |
| GET    | `/waste-reports`                | `manager` | List generated waste risk reports                            |
| GET    | `/waste-reports/summary`        | `manager` | Executive waste financial cost summary (EGP)                 |
| GET    | `/recommendations`              | `manager` | Get pending AI recommendations (discounts/production stops)  |
| POST   | `/recommendations/scan-surplus` | `manager` | Trigger on-demand surplus scan via AI microservice           |
| PATCH  | `/recommendations/:id/approve`  | `manager` | Approve recommendation → **Auto-creates `Offer` (Phase 0B)** |
| PATCH  | `/recommendations/:id/edit`     | `manager` | Edit discount % before approving                             |
| PATCH  | `/recommendations/:id/dismiss`  | `manager` | Dismiss recommendation                                       |
| POST   | `/predictions/validate-plan`    | `manager` | Validate manual manager plan via `/alerts/waste-prevention`  |

---

### Detailed Workflow: Recommendation Approval (`PATCH /recommendations/:id/approve`)

```
[Manager] ──> PATCH /recommendations/:id/approve
                    │
                    ├── 1. Fetch Recommendation document (type: 'apply_discount')
                    ├── 2. Create Offer (Phase 0B) document with source: 'ai_recommendation'
                    ├── 3. Trigger Phase 0B Sync: Product.discountedPrice = price * (1 - discount/100)
                    └── 4. Update Recommendation status = 'approved'
```

---

## Phase 7 — Feedback Loop, Reconciliation & AI Accuracy Analytics

**Primary Objective**: Reconcile predictions against actual end-of-week sales, evaluate AI accuracy metrics (WAPE / MASE), and measure financial waste reduction of AI-recommended offers.

### Endpoints to Implement

| Method | Endpoint                 | Roles              | Description                                           |
| ------ | ------------------------ | ------------------ | ----------------------------------------------------- |
| POST   | `/predictions/reconcile` | `admin`, cron      | Run reconciliation job for completed target weeks     |
| GET    | `/predictions/accuracy`  | `manager`, `admin` | View prediction accuracy & financial recovery metrics |

---

### ⚙️ Reconciliation Cron Job (`EVERY_SUNDAY_AT_3AM`)

```typescript
@Cron('0 3 * * 0') // Every Sunday at 3 AM
async reconcilePastWeek() {
  const pastWeek = moment().subtract(1, 'week').startOf('isoWeek').format('YYYY-MM-DD');

  // 1. Reconcile Weekly Predictions
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

## 🔒 Verification & Phase Transition Rules

1. **Strict Phase Sequencing**: Phase 3 (Inventory) and Phase 4 (Import Center) **MUST** be implemented and tested before starting Phase 5 (AI Integration).
2. **Postman Test Requirements**: Each phase must pass automated Postman integration tests covering happy paths, edge cases, and AI microservice fallback scenarios before declaring complete.
