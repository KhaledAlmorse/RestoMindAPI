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

## Phase 3 — Inventory, Stock, Waste Events, Suppliers & Purchase Orders

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
