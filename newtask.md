You need to fix the remaining Phase 7 Waste Reports & Surplus Detection issues.

Important:

- Do NOT change existing Phase 0-6 behavior.
- Do NOT modify Offer workflow.
- Do NOT add Product.discountedPrice or write to Product pricing.
- Keep the existing architecture and repository/service conventions.
- After implementation, run tests and provide a report of what was changed.

Current Problem:
Phase 7 scanSurplus() is generating WasteReports, but the calculations are incorrect because some values are hardcoded or not derived from real inventory/prediction/recipe data.

Fix the following issues:

====================================================

1. Fix Inventory Batch Calculation
   \====================================================

Location:
recommendations.service.ts -> scanSurplus()

Current issue:
The inventory batch query does not correctly filter batches by ingredientId.
This causes incorrect usableAvailableStock calculations.

Required behavior:

For each product:

1. Resolve the product recipe.
2. Get all ingredients from:
   Product -> Recipe -> Recipe.ingredients[]

3. For every ingredient:

Query InventoryBatch using:

{
restaurantId,
ingredientId,
isDeleted: false
}

Only include non-expired batches.

Calculate:

usableAvailableStock =
SUM(batch.quantityRemaining)

Do NOT use another ingredient's stock.

Example:

Flour batches:
50 + 70 = 120 kg

Chicken batches:
20 + 100 = 120 kg

They must not share the same stock value.

==================================================== 2. Remove Fake Reduce Initial Value
====================================================

Current issue:

reduce() starts with a fake value:

reduce((sum,batch)=>sum+batch.quantityRemaining,20)

This creates fake inventory.

Change it to:

reduce((sum,batch)=>sum+batch.quantityRemaining,0)

If no stock exists:
return 0.

Do not create artificial stock.

==================================================== 3. Remove Hardcoded avgDailySales
====================================================

Current issue:

avgDailySales is hardcoded:

avgDailySales: 15

Replace it with real data.

Priority:

1. Use Phase 6 Prediction data if available.

Get:

Prediction.predictedOrders

OR

2. Calculate from SalesTransaction history.

Example:

Last 14 days sales:

total quantity sold / number of days

avgDailySales =
real calculated value

Never use static values.

==================================================== 4. Calculate Expected Consumption Correctly
====================================================

Current issue:

WasteReport.expectedConsumption is currently coming from AI output.

This is incorrect.

Expected consumption must be calculated internally.

Formula:

expectedConsumption =
predictedOrders × ingredient quantity per portion

Source:

Prediction:
predictedOrders

Recipe:
ingredients[].quantityPerPortion

Example:

Prediction:

predictedOrders = 100

Recipe:

Burger requires:
Chicken = 0.2 kg

Expected consumption:

100 × 0.2

= 20 kg

Use this value in WasteReport.

==================================================== 5. Calculate Expected Surplus Locally
====================================================

Do not trust AI projectedSurplus.

Calculate:

expectedSurplus =
usableAvailableStock - expectedConsumption

Example:

usableAvailableStock = 120 kg

expectedConsumption = 20 kg

expectedSurplus:

100 kg

==================================================== 6. Make Risk Level Deterministic
====================================================

Do not rely on AI riskLevel.

Calculate:

surplusRatio =
expectedSurplus / usableAvailableStock

Rules:

if surplusRatio >= 0.7

riskLevel = "high"

if surplusRatio >= 0.4

riskLevel = "medium"

else:

riskLevel = "low"

Handle division by zero:

If usableAvailableStock = 0:

riskLevel = "low"

==================================================== 7. WasteReport Creation Logic
====================================================

When scanSurplus detects surplus:

Create WasteReport with:

{
restaurantId,
predictionId,
ingredientId,
expectedConsumption,
usableAvailableStock,
expectedSurplus,
riskLevel
}

Do NOT store AI values.

The database must contain calculated backend values.

==================================================== 8. Handle Multi Ingredient Recipes
====================================================

Current issue:

Only first ingredient is considered.

Example:

Recipe:

Pizza:

- Flour 0.3kg
- Cheese 0.1kg
- Chicken 0.2kg

Create WasteReport for every ingredient.

Loop through:

recipe.ingredients[]

Create separate report per ingredient.

==================================================== 9. Prevent Duplicate Waste Reports
====================================================

Before creating:

Check existing WasteReport:

{
restaurantId,
ingredientId,
createdAt same day
}

If exists:

update existing document.

Do not create duplicates every scan.

==================================================== 10. Keep Recommendation Workflow Working
====================================================

After fixing WasteReports:

Recommendation creation must still work:

WasteReport
|
|
Recommendation
|
|
Approve Recommendation
|
|
Create Offer

Recommendation.wasteReportId must reference the created WasteReport.

====================================================
Testing Requirements
====================================================

Add/update tests for:

1. Different ingredients have different inventory quantities.

2. No fake stock is added when inventory is empty.

3. avgDailySales is not hardcoded.

4. expectedConsumption uses:
   Prediction × Recipe quantityPerPortion

5. expectedSurplus calculation is correct.

6. Risk level calculation:
   70%+ high
   40%-70% medium
   below 40% low

7. Multi ingredient recipe creates multiple WasteReports.

8. Running scanSurplus twice same day updates existing WasteReport instead of duplicating.

After finishing:

- Run all Phase 7 tests.
- Run regression tests for Phase 0-6.
- Provide final implementation report.
