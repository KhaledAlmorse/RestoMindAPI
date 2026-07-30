# Phase 7 Refactor — Convert Weekly Waste Scan into Daily Operational Waste Workflow

Version: 2.0
Status: Design Approved (Pending Implementation)

---

# 1. Background

After auditing the entire AI workflow, we found that the architecture currently mixes two completely different business horizons:

- Weekly Planning (Phase 6)
- Daily Operations (Phase 7)

These two concepts should never be mixed.

Currently:

Weekly Prediction
↓
scanSurplus()
↓
Waste Report
↓
AI Recommendation

The problem is that the AI recommendation service itself was designed to optimize today's remaining stock before store closing.

It is NOT designed to optimize an entire week's inventory.

Therefore Phase 7 should become a DAILY operational workflow.

---

# 2. Current Problem

Today Phase 7 calculates:

Current Inventory (Now)

VS

Weekly Expected Consumption

This comparison is mathematically inconsistent.

Example:

Current Flour
50 kg

Weekly Consumption
29 kg

Expected Surplus
21 kg

That number does NOT represent today's waste.

It represents remaining inventory after one week.

Meanwhile the AI service calculates:

Current Stock

VS

Today's Remaining Sales

These two horizons are different.

So currently:

Backend → Weekly

AI → Daily

This is inconsistent.

---

# 3. Correct Business Architecture

Restaurant AI has TWO completely different decisions.

---

Decision 1

"Will next week's inventory be enough?"

Owner:

Phase 6

Output:

Purchase Orders

Inventory Planning

Supplier Planning

NO Discounts

NO Waste Reports

---

Decision 2

"What products are likely to remain unsold before today's closing time?"

Owner:

Phase 7

Output:

Waste Reports

Discount Recommendations

Offer Suggestions

Marketing Messages

---

These two decisions should never share business logic.

---

# 4. New Business Flow

Every Sunday 12:00 AM

↓

Phase 6

Predict next week's demand

↓

Manager reviews inventory

↓

Purchase Orders generated

↓

Restaurant buys ingredients

↓

Week begins

---

Every Day

Manager opens dashboard

↓

Clicks Scan Surplus

↓

Backend computes today's surplus

↓

Waste Report generated

↓

AI recommends discounts

↓

Manager approves offers

↓

Customers buy discounted products

↓

Reduced waste

---

Weekly Planning

≠

Daily Operations

---

# 5. Phase 6 Responsibilities (No Change)

Phase 6 continues to own:

✔ Weekly prediction

✔ Purchase forecast

✔ Purchase Order drafting

✔ Supplier planning

✔ Weekly inventory planning

Phase 6 NEVER:

Creates discounts

Creates waste reports

Creates offers

Creates marketing copy

Nothing changes here.

---

# 6. Phase 7 Responsibilities (Updated)

Phase 7 becomes:

Daily Operational Waste Management

Responsibilities:

✔ Daily surplus detection

✔ Daily waste reports

✔ AI recommendations

✔ Discount suggestions

✔ Offer generation

✔ Marketing copy

✔ Manager approval

Nothing related to purchasing.

---

# 7. Waste Report Changes

Current

expectedConsumption

=

Weekly Consumption

New

expectedConsumptionToday

=

Today's Expected Consumption

Formula

Daily Prediction

×

Recipe Quantity

×

Yield

Instead of

Weekly Prediction

×

Recipe Quantity

×

Yield

---

# 8. Prediction Source

Current:

prediction.predictedOrders

(weekly)

New priority:

prediction.dailyBreakdown[today]

If daily breakdown exists

↓

Use today's prediction

Else

↓

predictedOrders / 7

This keeps compatibility with old Prediction documents.

---

# 9. Waste Report Formula

Current

Expected Surplus

=

Current Inventory

-

Weekly Consumption

Remove.

New

Expected Surplus

=

Current Inventory

-

Today's Consumption

If result < 0

Expected Surplus = 0

---

# 10. Risk Level

Keep exactly the same thresholds.

No changes.

Risk calculation still based on:

Expected Surplus

Current Inventory

No schema changes required.

---

# 11. AI Microservice

NO changes.

Current AI already expects

avgDailySales

This is exactly what we now send.

No Python changes.

No model retraining.

No endpoint changes.

No prompt changes.

---

# 12. Recommendation Logic

No business logic changes.

Recommendation still generated ONLY IF

ExpectedSurplus > 0

AND

Risk != LOW

Exactly the same.

---

# 13. Waste Report Endpoint

GET /waste-reports

No API changes.

Response stays exactly the same.

Only values become daily.

---

# 14. Scan Endpoint

POST /recommendations/scan-surplus

No endpoint changes.

Business logic changes internally.

Response shape stays identical.

---

# 15. Recommendation Endpoint

GET /recommendations

No changes.

Same DTO

Same Response

Same Status

Same Approval Flow

---

# 16. Database Schema

Prediction

No changes.

WasteReport

No changes.

Recommendation

No changes.

InventoryBatch

No changes.

Recipe

No changes.

Product

No changes.

Offer

No changes.

---

# 17. Cron Jobs

Weekly Prediction Cron

No changes.

Daily Scan

Still manual.

Future enhancement:

Optional nightly auto scan.

Not required now.

---

# 18. Frontend

No breaking changes.

Dashboard still calls:

POST /recommendations/scan-surplus

↓

GET /waste-reports

↓

GET /recommendations

No UI modifications required.

Only labels may change:

Weekly Waste

↓

Today's Waste

---

# 19. Testing Plan

## Step 1

Generate Weekly Prediction

Verify:

Prediction exists

dailyBreakdown exists

---

Step 2

Run Scan

Verify:

Only today's prediction is used

---

Step 3

Verify Waste Report

expectedConsumption

=

Today's consumption

NOT weekly

---

Step 4

Verify Recommendation

Recommendation only generated when

ExpectedSurplus > 0

---

Step 5

Approve Recommendation

Offer created

---

Step 6

Customer purchases

Offer stock decreases

---

Step 7

Run Scan Again

Waste Report reflects updated inventory

---

Step 8

Verify Purchase Orders

Still generated ONLY by Phase 6

---

# 20. Acceptance Criteria

The refactor is complete when:

✓ Weekly Prediction still works.

✓ Purchase Orders unchanged.

✓ Scan uses today's prediction.

✓ Waste Reports become daily.

✓ AI recommendation remains unchanged.

✓ AI receives avgDailySales.

✓ No schema changes.

✓ No endpoint changes.

✓ No DTO changes.

✓ No controller changes.

✓ No Phase 6 logic modified.

✓ No regression outside Phase 7.

---

# 21. Files Expected to Change

recommendations.service.ts

Primary business logic.

---

waste-reports.service.ts

Daily calculations.

---

No changes expected in:

prediction.service.ts

prediction.model.ts

offer.service.ts

inventory.service.ts

recipe.service.ts

product.service.ts

controllers

DTOs

schemas

AI microservice

---

# 22. Implementation Order

1. Replace weekly expectedConsumption with today's expectedConsumption.
2. Read today's value from prediction.dailyBreakdown.
3. Fallback to predictedOrders / 7 only if dailyBreakdown is unavailable.
4. Recalculate expectedSurplus using today's consumption.
5. Keep risk thresholds unchanged.
6. Keep recommendation logic unchanged.
7. Keep AI payload (avgDailySales) unchanged.
8. Run end-to-end tests.
9. Verify no regression in Phase 6.
10. Final business validation with sample scenarios.

---

# 23. Final Architecture

Phase 6 (Weekly)
│
▼
Predict Weekly Demand
│
▼
Purchase Planning
│
▼
Purchase Orders
│
──────── Week Starts ────────
│
▼
Phase 7 (Daily)
│
▼
Scan Current Inventory
│
▼
Calculate Today's Surplus
│
▼
Generate Daily Waste Report
│
▼
AI Discount Recommendation
│
▼
Manager Approval
│
▼
Offer Published
│
▼
Customer Purchase
│
▼
Reduced Food Waste
