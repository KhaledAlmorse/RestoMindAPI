# Task — Refactor User Flow to Be Offer-Centric (RestoMind Daily)

You are working in the existing **RestoMindApi** project (NestJS + Mongoose). Read this entire prompt before writing any code. This is a genuine architecture change to Favorites, Cart, Orders, and Product visibility — follow it exactly, and confirm the two open questions in the "Before you write any code" section before implementing anything that depends on them.

## Business context (why this refactor is correct, not just requested)

RestoMind Daily is a food-waste-reduction platform, not general e-commerce. The intended flow is: `Product (internal) → AI flags surplus → Manager creates Offer → Offer is the only thing customers can browse/buy`. A `Product` with no `Offer` is not meant to be purchasable — that's the point of the platform, not a gap. Customers interact with `Offer` exclusively; `Product` becomes an internal/manager-facing entity only.

---

## 1. Offer model amendments (do this first — everything else depends on it) — CONFIRMED, build exactly this

Add/rename on the existing `offer.model.ts` (from the earlier Offers implementation) — these exact field names, confirmed by the business requirements doc:
```
originalPrice        Number    required — snapshotted from Product.price at Offer creation time (see below), NOT a live reference
offerPrice            Number    required — computed once at creation: originalPrice × (1 − discountPercentage / 100)
discountPercentage    Number    required — as today

availableQuantity     Number    required — the batch size published at creation. Not optional in this business model: every Offer represents a limited surplus batch, per Section "Business Context" — there is no unlimited-quantity Offer case.
remainingQuantity     Number    required — set equal to availableQuantity at creation; decremented on each successful order

maxPerCustomer         Number    optional — if set, caps total quantity one customer may purchase of this offer across all their orders (see Section 5's checkout validation)
```
**Correction to the earlier version of this prompt:** `discountedPrice`/price sync was previously described as recomputed live from the product's *current* price. That's wrong for this business model and must not be built that way. See Section 2 below for the correct snapshot behavior.

Add `sold_out` to the `status` enum: `draft | scheduled | active | expired | cancelled | sold_out`.

**Status transition:**
- When `remainingQuantity` reaches `0`, transition status to `sold_out` automatically, in the *same* service call/transaction that decrements it during order creation — not a separate scheduled job. This must be atomic with the decrement (e.g. a single `findOneAndUpdate` with a `remainingQuantity >= requestedQuantity` filter condition, not a read-then-write) to prevent two concurrent checkouts both succeeding past the last unit.
- `sold_out` behaves like `expired` for purchasing purposes (blocks new cart additions/checkout) but is tracked as a distinct status so waste-reduction reporting (Phase 8 of `plan.md`) can distinguish "we sold everything" from "the window passed unsold" — these are opposite outcomes for a waste-reduction platform and must not be conflated.

## 2. Offer price snapshot — the single source of customer-visible pricing

`Product` keeps only `price` (its base/original price) — **remove `discountedPrice` from `Product` entirely.** There is exactly one place customer-visible pricing lives now: `Offer`. This isn't just "don't sync it live" (the earlier framing) — the field shouldn't exist on `Product` at all, to avoid two documents that could ever disagree about what a customer is charged.

When an `Offer` is created from a `Product`:
1. Read the product's **current** `price` at that exact moment.
2. Store it as `Offer.originalPrice` — a copy, never a reference.
3. Compute `Offer.offerPrice = originalPrice × (1 − discountPercentage / 100)` once, and store it.
4. From this point forward, **`Offer.originalPrice`/`offerPrice` never change automatically**, even if `Product.price` changes later. A later product price change affects only *future* offers created from it — existing published offers keep displaying their original snapshot.

**Consequences of removing `Product.discountedPrice` — handle both of these, don't leave them dangling:**
- **Remove `PATCH /products/:id/discount` entirely.** It existed to write `Product.discountedPrice` directly; that field no longer exists, so this endpoint has nothing left to do. Discounting a product is now done exactly one way: create an `Offer` for it (`POST /offers`). If any existing code path still calls this endpoint, it should be migrated to create an Offer instead, not kept as a no-op.
- **Remove `GET /products/recommendations` entirely.** It existed to surface "products that currently have `discountedPrice` set" — that concept no longer exists on `Product`. It's fully superseded by `GET /offers?featured=true` (Section 7), which is the actual customer-facing equivalent now.

## 3. Product visibility — permission change to an existing endpoint

Restrict the following, currently public/customer-readable, to `manager`/`admin` only:
- `GET /products`
- `GET /products/:id`

(`GET /products/recommendations` is not just restricted — per Section 2, it's removed entirely, since the field it depended on no longer exists.)

Customers now reach product information only *through* an Offer (Section 4). This is a deliberate breaking change to who can call these endpoints — call it out explicitly in your summary; it is not a bug if a customer-role request to these now returns `403 Forbidden`.

## 4. Favorites — refactor to `offerId`, with explicit status rules

### Schema change
`favorite.model.ts`: replace `productId` with `offerId: ObjectId → Offer, required`. Update the unique index from `(userId, productId)` to `(userId, offerId)`.

### Endpoints (same shape as today, `:productId` params become `:offerId`)
| Method | Endpoint | Notes |
|---|---|---|
| `POST /favorites/:offerId` | Validate the offer exists (`NotFoundException` if not), **then validate its status is favoritable** — see rule below. |
| `DELETE /favorites/:offerId` | Always allowed regardless of the offer's current status — removing a favorite is never business-restricted. |
| `GET /favorites` | Response includes the full `Offer` (including its current `status`), and — nested inside it — the related `Product` info (title, image, category) via populate/join, matching the existing "response DTOs include related info" pattern already used elsewhere in the project. |
| `GET /favorites/:offerId/status` | |

### New-favorite status rule (applies only to `POST /favorites/:offerId` — never retroactively to existing favorites)
This rule is derived directly from Section 7's browsing visibility rule, so the two stay consistent by construction rather than being two independently-maintained lists:
- **Allowed:** `active` — this is the only status customers see by default when browsing (Section 7), so it's the only status they should normally be able to reach and favorite.
- **Allowed:** `scheduled` — **only if** Section 7's browsing decision is to surface scheduled/"coming soon" offers to customers. If scheduled offers aren't shown in browsing, don't allow favoriting them either (there'd be no way for a customer to discover one to favorite in the first place, so this only matters if you build a "coming soon" view). Confirm this against whatever Section 7 ends up doing.
- **Not allowed → `BadRequestException`:** `draft`, `cancelled` — these are never customer-visible at any point, so they should never be favoritable.
- **Not allowed → `BadRequestException`:** `sold_out` — same reasoning as `expired` below (it's a terminal, no-longer-purchasable state), but a customer shouldn't be able to *newly* favorite something already gone. This wasn't explicitly named in the business rules doc's allowed/not-allowed examples, so flag this inference in your summary rather than silently assuming — it follows the same logic as `expired` but wasn't stated outright.
- **Not allowed → `BadRequestException`:** `expired` — a customer can't discover and newly favorite something whose window already closed. (This is distinct from the case below, where a favorite *becomes* expired after the fact — that's fine and expected.)

### Behavior when an *already-favorited* offer's status changes
Do **not** cascade-delete the favorite when its offer expires/sells out/is cancelled after being favorited — a customer's "I liked this" signal is still meaningful, and the business rules doc explicitly says expired offers may remain in Favorites for historical purposes. `GET /favorites` always includes the offer's current `status` in the response so the frontend can show "this deal has ended" rather than either silently vanishing the favorite or erroring.

## 5. Cart — refactor to `offerId`

### Schema change
`cart.model.ts`: items become `[{ offerId: ObjectId → Offer, quantity: Number }]`, replacing `productId`.

### Validation on `POST /cart` (add) and `PATCH /cart/:offerId` (update quantity)
In this order, each with a specific, distinguishable error (use the project's standardized exceptions):
1. Offer exists → `NotFoundException` if not.
2. Offer status is `active` (explicitly reject `draft`, `scheduled`, `expired`, `cancelled`, **and `sold_out`** individually — don't lump them into one generic check, since the error message should be able to say "sold out" specifically rather than a vague "unavailable") → `BadRequestException`.
3. Current date is within `[startDate, endDate]` → same error class as #2 (this should rarely disagree with `status: active` if your status-transition job is correct, but check both — don't trust status alone if the scheduled job that flips `scheduled → active`/`active → expired` could ever lag).
4. `remainingQuantity >= requested quantity` → `BadRequestException` ("Only N left") if not. (`availableQuantity` is always set per Section 1's confirmed model — this check always applies, not conditionally.)
5. **If `maxPerCustomer` is set**: sum this customer's already-*ordered* quantity of this specific offer (across their past orders — query `Order.items` where `offerId` matches and `Order.userId`/customer matches, not the cart, since a customer could re-add after removing) plus the quantity being requested now, and reject if it exceeds `maxPerCustomer` → `BadRequestException` ("You've reached the purchase limit for this offer").

### Re-validation at checkout (order creation)
Repeat all five checks above for every cart item at the moment the order is created — **not** just at add-to-cart time, since time has passed and the offer's state may have changed. If any item fails validation:
- Do not create a partial order.
- Return a clear, structured error identifying *which* cart item(s) failed and why (e.g. `{ offerId, reason: "sold_out" | "expired" | "insufficient_quantity" | "max_per_customer_exceeded" }` per failed item), so the frontend can tell the customer exactly what to remove or update — a generic "checkout failed" is not sufficient here per your own spec.

## 6. Orders — refactor to immutable Offer-sourced snapshots, with cash-payment inventory reservation and AI feedback

### Schema change — `Order.items[]`
Each line item must snapshot everything needed to render order history correctly **forever**, independent of the current state of the `Product` or `Offer`. Field names below match the confirmed business requirements exactly:
```
offerId              ObjectId → Offer     required (reference for provenance/analytics only — never read for display)
productId            ObjectId → Product   required (same — provenance only)
productTitle          String               required — snapshotted at order time
productImage          String               optional — snapshotted at order time
restaurantId          ObjectId → Restaurant required
restaurantName        String               required — snapshotted at order time
originalPrice          Number               required — copied from Offer.originalPrice (itself already a snapshot, per Section 2 — not re-derived from Product at order time)
offerPrice             Number               required — copied from Offer.offerPrice (the price actually charged); renamed from "discountedPrice" in earlier drafts of this prompt to match confirmed naming
discountPercentage     Number               required — copied from Offer.discountPercentage
quantity                Number               required — quantity purchased
purchasedAt             Date                 required — timestamp of this line's purchase (normally equals the order's createdAt, but stored per-item so it stays correct even if order-level timestamp semantics ever change, e.g. under the OrderGroup multi-restaurant split)
lineTotal               Number               required — offerPrice × quantity
```
**Order history reads must never join out to the live `Product` or `Offer` documents for display purposes.** `offerId`/`productId` stay on the item strictly so the AI feedback loop below (and Phase 8 of `plan.md`) can trace a sale back to the offer/recommendation that produced it — not for rendering.

### Order creation logic — inventory is reserved at order creation, not at payment

The MVP is Cash on Delivery / Cash on Pickup only — there is no online payment step to gate on. **Inventory must be reserved the moment the Order is successfully created, not deferred until cash changes hands.** Waiting until payment would let multiple customers simultaneously "buy" the same last unit of a limited surplus batch, since cash payment happens later, in person, completely outside the API's control.

1. Run the full validation from Section 5 (Cart re-validation, all 5 checks) against each cart item's live `Offer`.
2. On success, build each order item as the full snapshot above — copying `Offer.originalPrice`/`offerPrice`/`discountPercentage` directly (these are already frozen snapshots per Section 2; do not recompute anything from the live `Product` at order time).
3. Create the `Order` with initial `status: 'Pending'`.
4. **In the same transaction as step 3**, atomically decrement `Offer.remainingQuantity` by the ordered quantity (the same atomic conditional update from Section 1 — `remainingQuantity >= requestedQuantity` as the update filter, not read-then-write) and flip to `sold_out` if it hits zero. This is inventory *reservation*, not a side effect that can be skipped or deferred — an `Order` must never exist without its inventory having been decremented in the same atomic operation that created it.
5. If step 4's conditional update fails for any item (someone else claimed the last unit between validation and commit), roll back the entire order creation — do not create a partial order or leave some items reserved and others not. Surface this the same way Section 5 already handles a failed checkout validation (itemized, per-offer reason).
6. **AI recommendation feedback (new capability):** for every order item whose `Offer.recommendationId` is set, increment that `Recommendation`'s own analytics fields by this order's contribution:
   ```
   Recommendation.actualUnitsSold        += item.quantity           // NEW field, add to recommendation.model.ts, default 0
   Recommendation.actualRevenueRecovered += item.lineTotal            // NEW field, add to recommendation.model.ts, default 0
   ```
   **Do not touch `Recommendation.estimatedWasteReduction`/`estimatedRevenueRecovery`** (existing fields, per Phase 6 of `plan.md`) — those are the AI's original prediction and must stay immutable once set, so they remain comparable against the new `actual*` fields later. Overwriting an estimate with an actual value would destroy the only record of what the AI predicted, which defeats the entire point of building this feedback loop (`AI Prediction → Manager Creates Offer → Customer Purchases → Recommendation Statistics Updated → Future AI Model Evaluation`). This increment happens in the same transaction as steps 3–5, guarded the same way — if order creation rolls back, this must not have been applied either.

### Inventory restoration on order failure — the other half of reservation

If an `Order` is later **cancelled** (by the customer, or rejected by the restaurant) via the existing `PATCH /orders/:id/status` endpoint, the inventory reserved at creation must be given back:
1. When a status update transitions an order to `'Cancelled'`, for each item in that order, atomically **increment** `Offer.remainingQuantity` by `item.quantity`.
2. If the offer's status is currently `sold_out` and this restoration brings `remainingQuantity` back above zero, flip its status back to `active` (assuming it's still within its `[startDate, endDate]` window — if the window has since passed, leave it `expired` instead; check the date range, don't blindly reactivate).
3. **Also reverse the Section 6 recommendation increment**: if the order's items had `Offer.recommendationId` set, decrement that `Recommendation`'s `actualUnitsSold`/`actualRevenueRecovered` by the same amounts that were added at order creation — a cancelled order was never a real sale, and the AI feedback loop must not count it as one.
4. This is a required addition to `PATCH /orders/:id/status`'s internal behavior — **the endpoint's route, request/response shape, and the existing terminal-state lock (no further changes once `Delivered`/`Cancelled` is reached) stay exactly as they are today; only the side effect on the specific `Cancelled` transition is new.** This is the same pattern already used for Phase 2's order→sales_transactions sync in `plan.md`: same endpoint, same shape, new side effect, wrapped so a failure here doesn't corrupt the status update itself — though unlike Phase 2's fire-and-forget sales sync, this restoration is business-critical (it directly prevents overselling on the *next* customer's checkout), so log any failure loudly and consider it a page-worthy error, not a silent warning.
5. There is no separate "order failed before completion, roll back inventory" path to build beyond this — per step 4's transaction guarantee, an `Order` is never created without its inventory already having been reserved atomically, so the only way reserved inventory needs restoring is through an explicit cancellation after the fact, not a partial/failed creation.

Everything else about order creation (restaurant-splitting, `fullName`/delivery fields, `OrderGroup` if that refactor is already in place) stays as currently implemented — this task only changes what a line item references/snapshots and adds the reservation/restoration/feedback behavior above, not the surrounding order/checkout mechanics.

## 7. Offer browsing API — full parity with the existing Product module

Implement on `GET /offers` everything the Product module already has: search, pagination, sorting, category filtering, restaurant filtering, price filtering, status filtering, plus a **new** `featured` filter (`Offer.featured` already exists per the earlier Offers implementation). This becomes the primary customer-facing browsing endpoint — treat it with the same completeness as `GET /products` has today, not a stripped-down version.

Default behavior: unless a `status` filter is explicitly passed, `GET /offers` (public/customer-facing) should only return `active` offers — customers browsing the storefront shouldn't see `draft`/`scheduled`/`cancelled` offers by default. `manager`/`admin` callers should be able to pass `?status=` to see any state (for managing their own offers). **This decision is what Section 4's favoriting rule derives its "allowed statuses" from** — if you later decide to surface `scheduled` offers here (e.g. a "coming soon" view), update Section 4's allowed list to match, don't let the two drift apart independently.

## 8. Permissions

Mirror whatever role rules currently gate the Product module onto the equivalent Offer endpoints (e.g. `manager` creates/edits offers for their own restaurant, same ownership-scoping pattern already used for Products). `GET /offers` (active-only) is public/customer-readable, matching what `GET /products` used to be before Section 3's restriction.

## 9. Architecture conventions — unchanged, follow exactly

Same repository pattern (extend `base.service.ts`), same DTO/class-validator style, same standardized exceptions (`NotFoundException`/`BadRequestException`/`ConflictException`/`ForbiddenException`), same response envelope, same `@Auth()`/`@Roles()` guarding, same compound-uniqueness-over-global convention, same slug+ID dual resolution pattern where a lookup applies. Nothing about *how* the code is structured should change — only *what* Favorites/Cart/Orders reference.

---

## Previously-open questions — now resolved, confirmed by the business requirements doc

Both questions from the earlier version of this prompt are now answered — build accordingly, no need to re-ask:
1. **Quantity management is required, not optional.** `availableQuantity` is always set (never unlimited) — every Offer represents a limited surplus batch. `maxPerCustomer` is optional per-offer.
2. **Product visibility restriction is confirmed.** `GET /products`, `GET /products/:id`, `GET /products/recommendations` reject customer-role callers with `403` — this is intended, not a regression.

## Non-breaking guarantees to verify explicitly

- [ ] Manager/admin-facing Product CRUD (`POST/PATCH/DELETE /products`, availability toggle) is completely unaffected. (The discount endpoint is a deliberate exception — see Breaking changes below, it's removed, not preserved.)
- [ ] `GET /orders/restaurant/:restaurantId` (manager/admin) is unaffected in shape.
- [ ] `PATCH /orders/:id/status`'s route, request/response shape, and existing terminal-state lock (`Delivered`/`Cancelled` block further changes) are unchanged — only its *internal* behavior gains the inventory-restoration and recommendation-reversal side effects on the `Cancelled` transition specifically (Section 6). Every other status transition (`Confirmed`, `Preparing`, `Out For Delivery`, `Delivered`) has no new side effects and must behave exactly as it does today.
- [ ] Existing standardized-exception, repository, and response-envelope conventions are used throughout — no ad hoc patterns introduced for this refactor.
- [ ] The concurrent-checkout race condition on `remainingQuantity` (Section 1, and the reservation step in Section 6) is handled with an atomic conditional update, not a read-then-write — this is the one place a subtle bug directly causes overselling, which is worse than a normal bug because it's a business/trust problem, not just a technical one.
- [ ] Order creation (Section 6) and the inventory reservation are in the same transaction — there must be no window where an `Order` exists but its inventory hasn't been decremented, or vice versa.

## Breaking changes to call out explicitly in your summary

- [ ] `GET /products`, `GET /products/:id` now reject customer-role callers with `403`.
- [ ] `PATCH /products/:id/discount` and `GET /products/recommendations` are **removed entirely** (not just restricted) — `Product.discountedPrice`, the field both endpoints depended on, no longer exists. Any code still calling either needs to migrate to `POST /offers` / `GET /offers?featured=true` respectively.
- [ ] `Favorite.productId` → `Favorite.offerId`; `Cart.items[].productId` → `Cart.items[].offerId`; any existing test/seed data referencing the old fields needs updating.
- [ ] `Order.items[]` shape changes to the full snapshot in Section 6, including the `discountedPrice` → `offerPrice` rename — any existing frontend code reading order items by the old shape/field names needs coordinated updates.
- [ ] `Recommendation` gains two new fields (`actualUnitsSold`, `actualRevenueRecovered`) — additive, not breaking on its own, but flag it since it's a schema change to a collection from `plan.md`'s Phase 6, not something invented fresh in this task.
- [ ] `PATCH /orders/:id/status` gains a new side effect (inventory restoration + recommendation reversal) specifically on the transition to `Cancelled` — the route/shape is unchanged, but behavior is not identical to before, so call this out even though it's not a contract-breaking change.

## Testing checklist — includes the 5 confirmed business scenarios verbatim

**Scenario 1 — Offer Sold Out**
1. Create an `Offer` with `availableQuantity: 20`. Purchase all 20 units (across one or more orders/customers). Confirm `remainingQuantity` reaches 0 and `status` automatically flips to `sold_out`. Confirm the offer is no longer purchasable (cart/checkout reject it) but is still visible in past order history and in `GET /offers?status=sold_out` (manager/admin view).

**Scenario 2 — Offer Expired While in Cart**
2. Add an offer to cart, then let it pass its `endDate` (or manually expire it) before checkout. Confirm checkout is rejected with a clear, itemized business error asking the customer to update the cart — not a generic failure.

**Scenario 3 — Product Price Changes**
3. Create an Offer from a Product priced at 100 with a 20% discount — confirm `originalPrice: 100, offerPrice: 80`. Change the Product's price to 120. Confirm the *existing* offer still shows `originalPrice: 100, offerPrice: 80` (unchanged). Create a *new* offer from the same product now — confirm it correctly snapshots `originalPrice: 120` and recomputes `offerPrice` from the new price.

**Scenario 4 — Historical Orders**
4. Place a successful order. Afterward, change the underlying Product's title/image, and let the Offer expire or become sold out. Confirm `GET /orders/me` for that order still displays the exact original snapshotted `productTitle`, `productImage`, `originalPrice`, `offerPrice`, and `discountPercentage` — completely unaffected by either change.

**Scenario 5 — Customer Browsing**
5. As a customer, call `GET /products` directly — confirm `403`. Call `GET /offers` with no status filter — confirm only `active` offers are returned, and that search/pagination/sort/category/restaurant/price/featured filters all work with the same completeness as `GET /products` does today for manager/admin.

**Additional checks beyond the 5 named scenarios:**
6. Set `maxPerCustomer: 2` on an offer. As one customer, successfully order 2 units total (in one or two separate orders). Attempt a third unit — confirm rejection with the `max_per_customer_exceeded` reason, even though `remainingQuantity` may still be well above zero.
7. Fire two near-simultaneous checkout requests for the same offer when only 1 unit remains — confirm only one succeeds and the other receives a clear "insufficient quantity"/sold-out rejection, not a negative `remainingQuantity` or two successful orders for one unit.
8. Favorite an offer, then let it expire — confirm the favorite record still exists in `GET /favorites` (not cascade-deleted) and its returned `status` reflects `expired`.
9. Attempt `POST /favorites/:offerId` on a `draft` offer, a `cancelled` offer, and a `sold_out` offer — confirm all three are rejected with `BadRequestException`, before any payment/order step is ever reached.

**Inventory reservation & restoration (new in this revision):**
10. Create an `Offer` with `remainingQuantity: 5`. Place an order for 2 units with `status: 'Pending'` — confirm `remainingQuantity` drops to 3 **immediately upon order creation**, before any payment/delivery has happened (this is the core rule: reservation is tied to order creation, not payment).
11. Cancel that same order via `PATCH /orders/:id/status` (`status: 'Cancelled'`) — confirm `remainingQuantity` returns to 5.
12. Repeat step 10 until `remainingQuantity` hits 0 and the offer becomes `sold_out`. Cancel one of the orders that contributed to it — confirm `remainingQuantity` goes back above 0 **and** the offer's status flips back to `active` (assuming still within its date range).
13. Progress an order all the way to `Delivered` instead of cancelling it — confirm `remainingQuantity` stays decremented (correctly, since the sale completed) and no restoration happens.

**AI recommendation feedback loop (new in this revision):**
14. Create a `Recommendation` with `type: 'apply_discount'`, approve it so it produces an `Offer` with `recommendationId` set (per the existing Phase 6 flow in `plan.md`). Place and complete an order against that offer — confirm `Recommendation.actualUnitsSold`/`actualRevenueRecovered` increment by the correct amounts, while `estimatedWasteReduction`/`estimatedRevenueRecovery` remain exactly as originally set (untouched).
15. Cancel an order placed against a `recommendationId`-linked offer — confirm the `Recommendation`'s `actualUnitsSold`/`actualRevenueRecovered` are decremented back down by the same amounts (Section 6's reversal step), so a cancelled order never inflates the AI's measured performance.

