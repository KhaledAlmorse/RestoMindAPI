# Task — Implement the Dashboard Module (Admin Flow)

You are acting as a Senior NestJS + MongoDB Backend Architect working in the existing **RestoMindApi** project. Preserve the current architecture exactly: existing modules, repositories, DTOs, guards, and response patterns. Do not refactor unrelated code. Do not change any existing API contract. Reuse existing Mongoose models and repositories. Use MongoDB Aggregation Pipelines where specified.

**Before writing any code**, confirm these dependencies actually exist in the codebase as designed — this module reads from all of them:
- `GroupOrder` (with `orderGroupId`, `userId`/`fullName`, `finalTotalPrice`, and child `orders[]` — per `AGENT_PROMPT_order_group_unification.md`)
- `Offer` (with `status`, `isDeleted` — per `AGENT_PROMPT_offer_centric_refactor.md`)
- `Restaurant` (with `isActive`, `isDeleted`)
- `Order` (with `status`, `restaurantId`, `createdAt`)

If any of these don't match what's described, stop and report the actual shape you find before proceeding — don't silently adapt the dashboard to guessed field names.

---

## Architectural decision required before implementation — resolve this first

**The conflict:** `GroupOrder.overallStatus` was deliberately designed as a *computed-at-read-time* value in application code (a precedence function over its child orders' statuses), specifically to avoid a second, potentially-stale source of truth. This dashboard needs to `$match`/`$group`/`$count` by `overallStatus` across potentially large date ranges, in aggregation pipelines, for the Revenue KPI, Pending Orders KPI, `recentOrders`, and the `stuck_pending`/`high_cancellation` alerts. **A value computed in application code cannot be efficiently matched or grouped on inside a MongoDB aggregation pipeline** — you'd have to pull every candidate document out, compute the status in JS, and filter/group in memory, which defeats the entire point of the pipeline-based performance requirement below.

**Resolution — implement it this way:** denormalize `overallStatus` onto the `GroupOrder` document as a real, stored, indexed field — but it must still be derived from exactly one function (the same precedence logic already specified for `GroupOrder`), never computed independently a second way. Specifically:
1. Add `overallStatus: String` to the `GroupOrder` schema.
2. Extract the existing overallStatus precedence logic (Cancelled / uniform-status / Partially Delivered / Partially Cancelled / Processing) into a single reusable function if it isn't already isolated as one.
3. Call that function and **write the result to `GroupOrder.overallStatus`** every time it could change — specifically, inside `PATCH /orders/:id/status`'s existing handler (which already has other side effects on status changes per the Offer-centric refactor — inventory restoration, recommendation reversal), add "recompute and persist the parent `GroupOrder`'s `overallStatus`" as one more step in that same transaction.
4. This is a deliberate, narrow exception to "never store a derived value" — made specifically because this dashboard's query patterns require it, not a general reversal of that design principle. Note this explicitly in your implementation summary so it's not mistaken for an inconsistency.

Index `GroupOrder` on `{ overallStatus: 1, createdAt: -1 }` and (per manager scoping) `{ restaurantIds: 1, overallStatus: 1, createdAt: -1 }` if `GroupOrder` carries a denormalized restaurant reference, or rely on `$lookup` through `orders[]` otherwise — confirm which is cheaper given the actual data volumes you're designing for.

---

## Endpoints

### `GET /dashboard/admin`
`@Auth('admin')`

### `GET /dashboard/manager`
`@Auth('manager')` — scoped entirely to the authenticated manager's own restaurant. If `manager.restaurantId` is missing, throw `ForbiddenException` (this should be rare given Phase 0's onboarding auto-link, but must still be handled defensively, not assumed).

## Query parameters (both endpoints)

```
startDate?: string   // ISO date
endDate?: string     // ISO date
```
- If both omitted: default to the last 7 days.
- Validate ISO format and `startDate <= endDate` — reject with `BadRequestException` otherwise, per the project's standardized exception convention.
- Convert to `Date` objects once, use the identical range across every calculation in the same request.
- **Previous period**: the immediately preceding period of the *same length* as the current range — not hardcoded to 7 days. If the caller requests a custom 14-day range, the "previous" period is the 14 days immediately before it. Example given (`Jul 17-23` → previous `Jul 10-16`) is the default-7-days case, not a fixed rule.

## Response contracts — match exactly, field-for-field

### Admin — `GET /dashboard/admin`
```ts
interface DashboardStatsResponse {
  kpis: {
    revenue: { current: number; previous: number; changePercent: number }
    orders: { current: number; previous: number; changePercent: number }
    activeOffers: number
    pendingOrders: number
    activeRestaurants: number
  }
  revenueTrend: Array<{ date: string; revenue: number; orders: number }>
  ordersByStatus: {
    Pending: number; Confirmed: number; Preparing: number; Ready: number
    'Out For Delivery': number; Delivered: number; Cancelled: number
  }
  recentOrders: Array<{
    orderGroupId: string; customerName: string; restaurantNames: string[]
    finalTotalPrice: number; overallStatus: string; createdAt: string
  }>
  alerts: Array<{
    id: string
    type: 'stuck_pending' | 'high_cancellation' | 'no_active_offers' | 'inactive_restaurants'
    severity: 'critical' | 'warning' | 'info'
    message: string; count?: number; actionUrl?: string
  }>
}
```

### Manager — `GET /dashboard/manager`
Identical shape, **minus `activeRestaurants`** in `kpis`, plus a top-level `restaurantName: string`. Everything else — same fields, same filtering, scoped to the manager's one restaurant.

### Field-mapping notes (source data doesn't use these exact names — map explicitly, don't rename the underlying schema)
- `customerName` ← `GroupOrder.fullName`.
- `restaurantNames` ← collected from each child `Order` in `GroupOrder.orders[]` (one restaurant per child order, per the existing "one Order per restaurant" architecture) — resolve via the restaurant reference already on each `Order`, not a new lookup path.

## Business calculations

**Revenue KPI** — current: sum `GroupOrder.finalTotalPrice` where `overallStatus = 'Delivered'` and `createdAt` in range. Previous: same metric, previous period. `changePercent = ((current - previous) / previous) * 100`, guarded against division by zero (return `0` or `null` — pick one and apply it consistently across every KPI, don't mix).

**Orders KPI** — current/previous: count of `GroupOrder` documents in each period (not filtered by status — total order-group volume).

**Active Offers** — count `Offer` where `status: 'active'`, `isDeleted: false`, and its `Restaurant` is `isActive: true, isDeleted: false` (requires a `$lookup` to `Restaurant`).

**Pending Orders** — count `GroupOrder` where `overallStatus: 'Pending'` (now a real, indexed field per the resolution above).

**Active Restaurants** (admin only) — count `Restaurant` where `isActive: true, isDeleted: false`.

## Revenue trend
One point per day, ascending, **including zero-value days** in the range (don't skip days with no orders — the frontend chart needs a continuous series). Group by day via aggregation, then backfill any missing dates with `{ revenue: 0, orders: 0 }` in the service layer after the pipeline runs, since `$group` alone won't produce empty days.

## Orders by status
Always return all 7 keys, zero-filled — this counts individual `Order.status` values (not `GroupOrder.overallStatus`), scoped by the same date range (and by `restaurantId` for the manager endpoint).

## Recent orders
Latest 5 `GroupOrder` by `createdAt` descending, with the field mappings above.

## Alerts (generated server-side, not stored)
- **`stuck_pending`** (`warning`): `GroupOrder` with `overallStatus: 'Pending'` older than 30 minutes. Include `count`.
- **`high_cancellation`** (`critical`): cancellation rate > 20% in the current period. **Compute this at the same granularity as the Orders KPI** (cancelled `GroupOrder` count ÷ total `GroupOrder` count in period) for consistency with the rest of the dashboard — don't switch to individual-`Order`-level counting for this one alert while everything else operates at the group level.
- **`no_active_offers`** (`info`): a restaurant (or, for the manager endpoint, the manager's own restaurant) has zero active offers.
- **`inactive_restaurants`** (`warning`, **admin only** — omit entirely on the manager endpoint, don't return an empty/irrelevant version of it): restaurants where `isActive: false, isDeleted: false`.

Include `count`/`actionUrl` where they add value; omit where not applicable rather than sending `null`.

## Manager scoping — apply to every calculation above, not just the top-level query
Resolve `restaurantId` from the authenticated manager once, then filter every aggregation (`revenue`, `orders`, `trend`, `recentOrders`, `alerts`, `activeOffers`) by it. `recentOrders`/`revenueTrend` for the manager view will only ever show that one restaurant — don't return cross-restaurant data anywhere in that response.

## Performance
Use aggregation pipelines (`$match`, `$group`, `$facet`, `$lookup`, `$project`, `$sort`, `$count`). Use `$facet` to compute multiple KPIs/breakdowns from one pipeline pass over `GroupOrder` where the underlying collection and date filter are shared, rather than running near-identical queries repeatedly.

## File structure
```
dashboard.module.ts
dashboard.controller.ts
dashboard.service.ts
dto/dashboard-query.dto.ts
interfaces/dashboard.interface.ts   (or contracts/dashboard.contract.ts if a contracts folder convention already exists — check first)
```

## Swagger
`@ApiTags('Dashboard')`, `@ApiOperation`, `@ApiQuery` (for `startDate`/`endDate`), `@ApiOkResponse` on both endpoints, documenting the exact response shapes above.

---

## When done, report back

1. Modified files.
2. Created files.
3. Summary of implemented features.
4. Aggregation strategy used, including how you handled the `overallStatus` denormalization from the resolution section above.
5. Example response for `GET /dashboard/admin`.
6. Example response for `GET /dashboard/manager`.
7. Explicit confirmation the response matches both TypeScript interfaces field-for-field — not "close," exact.
8. Confirmation that no existing endpoint (especially `PATCH /orders/:id/status`, which now gains one more side effect) was broken — re-run its existing tests.
9. Indexes created or recommended: `GroupOrder.overallStatus`, `GroupOrder.createdAt`, `Order.restaurantId`, `Order.status`, `Offer.isDeleted`, `Restaurant.isActive`/`isDeleted`, plus anything else your actual pipeline design needs that isn't listed here.
