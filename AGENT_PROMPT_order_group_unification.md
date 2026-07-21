# Task — GroupOrder: Aggregate Multi-Restaurant Checkout, Fully Offer-Centric

You are working in the existing **RestoMindApi** project (NestJS + Mongoose). This prompt supersedes the earlier "OrderGroup" prompt — that version predates the Offer-centric refactor and used stale field names (`discountedPrice`, `productId`-only items). Read this entire prompt before writing any code, and read `AGENT_PROMPT_offer_centric_refactor.md` alongside it — this task builds directly on top of that one and does not redefine anything it already specifies.

## Context (unchanged from the original design — do not redesign this part)

The checkout flow intentionally creates **one `Order` document per restaurant** when a cart spans multiple restaurants — this is correct and must not change. Each restaurant manages its own order independently (its own status lifecycle, visible only to that restaurant's manager via `GET /orders/restaurant/:restaurantId`).

`GET /orders/me` and the checkout response should present this to the customer as **one logical object** — `GroupOrder` — that aggregates the individual restaurant `Order` documents, not a flat array of unrelated orders.

## What's different in this revision

1. Naming: `OrderGroup` → **`GroupOrder`**, and its exposed order list is called **`orders`**, not `restaurantOrders`.
2. `GroupOrder` never computes its totals independently — it **sums the already-finalized totals of its child `Order` documents**, never raw cart data.
3. `GroupOrder` has **no `items` field of its own** — its only responsibility is aggregating `Order` documents; items live exclusively inside each child `Order`.
4. Every order item, wherever it appears (inside a `GroupOrder`'s child orders, inside `GET /orders/restaurant/:restaurantId`, anywhere), uses the **exact item snapshot schema from `AGENT_PROMPT_offer_centric_refactor.md`, Section 6** — `offerId`, `productId`, `productTitle`, `productImage`, `restaurantId`, `restaurantName`, `originalPrice`, `offerPrice`, `discountPercentage`, `quantity`, `purchasedAt`, `lineTotal`. That file is the single source of truth for this shape — this prompt does not redefine it, only references it, so the two documents can't drift apart.

## `offerId` vs `productId` — clarifying their roles here

`offerId` is the actual sellable entity the customer purchased — conceptually the primary reference for "what was bought." `productId` is retained purely for traceability/internal relationships (recipe/ingredient tracing, AI feedback loop attribution per the Offer-centric prompt's Section 6). Neither is ever read to *render* order history, though — per the immutability rule already established, both `Order` and `GroupOrder` display exclusively from the snapshotted fields (`productTitle`, `originalPrice`, `offerPrice`, etc.), never by joining out to the live `Offer`/`Product` documents. "Primary reference" describes *meaning*, not a live lookup path.

## `GroupOrder` model

```
_id                   ObjectId
orderGroupId          — the client-facing identifier; expose this as the response's primary ID field (an alias for _id — do not introduce a second, separate ID)
userId                ObjectId → User            required
orderIds               Array<ObjectId → Order>    required, min length 1
fullName              String                     required
phoneNumber           String                     required
emailAddress          String                     required
deliveryMethod        String enum                required   ('Home Delivery' | 'Store Pickup')
deliveryAddress       embedded                    required IF deliveryMethod = 'Home Delivery', else omitted
specialNotes          String                     optional
paymentMethod         String enum                required   ('Cash on Delivery')
totalOriginalPrice    Number                     required   — SUM of each child Order's own totalOriginalPrice
totalDiscount         Number                     required   — SUM of each child Order's own totalDiscount
finalTotalPrice       Number                     required   — SUM of each child Order's own finalTotalPrice
totalQuantity         Number                     required   — SUM of each child Order's own totalQuantity
createdAt / updatedAt Date
```

**No `items` field on this model.** These checkout-level fields (`fullName`, `phoneNumber`, `deliveryAddress`, etc.) are already identical across every `Order` from the same checkout today — hoisting them onto `GroupOrder` is not new data, just a new place to read them from once instead of duplicated N times.

### Existing `Order` model — one addition, otherwise unchanged
```
groupOrderId   ObjectId → GroupOrder   required going forward
```
`Order` keeps every field it has today, including its own `totalOriginalPrice`/`totalDiscount`/`finalTotalPrice`/`totalQuantity` (computed from its own items, as it already does) — **`GroupOrder` reads these, it does not replace them.** Do not remove anything from `Order` — `GET /orders/restaurant/:restaurantId` and `PATCH /orders/:id/status` consumers still expect its current shape unchanged.

## GroupOrder Lifecycle — exact order of operations

```
Checkout
   ↓
Create Orders — one per restaurant, each computing its own
   totalOriginalPrice / totalDiscount / finalTotalPrice / totalQuantity
   from its own items (exactly as Order creation already does today —
   unchanged, per AGENT_PROMPT_offer_centric_refactor.md Section 6)
   ↓
Create GroupOrder, referencing the created Order IDs
   ↓
Attach: set groupOrderId on each created Order
   ↓
Calculate GroupOrder aggregate totals by SUMMING each child Order's
   already-finalized totals — never recomputed from cart/offer data directly
   ↓
Return the GroupOrder (populated with its child orders) as the response
```

This ordering matters: `Order` is always the source of truth for "what did this restaurant's part of the checkout total," computed once, at creation, from its own items. `GroupOrder` is purely a summation layer on top — it must never have its own independent totals-calculation logic that could disagree with the sum of its children.

**Wrap the entire lifecycle in one Mongo transaction.** A checkout that creates orders but fails to create/link the group (or vice versa) is exactly the kind of partial-state bug this feature exists to prevent. This is also where the Offer-centric prompt's inventory reservation (Section 6 of that file) happens — same transaction, same atomicity guarantee, not a separate step bolted on afterward.

## Required changes, endpoint by endpoint

### 1. Checkout / order creation (existing `POST /orders`)
**Breaking response-shape change — flag it clearly, frontend must be coordinated separately.**

Response changes from an array of `Order` to a single `GroupOrder` object, populated with its child `orders[]` — this is the "one logical order" the frontend consumes immediately after checkout.

### 2. `GET /orders/me`
**Breaking change — the actual point of this feature.**

Change from: querying `Order` by `userId`, returning a flat array.
Change to: querying `GroupOrder` by `userId`, returning one object per group, each populated with its child orders. Target response shape:

```json
{
  "data": [
    {
      "orderGroupId": "6a5e2705a19eb6aa12779ceX",
      "userId": "6a5b9ff14b51f09df0fe1e25",
      "fullName": "ali Ahmed",
      "phoneNumber": "+2001098101012",
      "emailAddress": "ali@gmail.com",
      "deliveryMethod": "Home Delivery",
      "deliveryAddress": { "street": "12 Nile St", "city": "Cairo", "country": "Egypt" },
      "specialNotes": "Leave at front door",
      "paymentMethod": "Cash on Delivery",
      "totalOriginalPrice": 40,
      "totalDiscount": 11.5,
      "finalTotalPrice": 28.5,
      "totalQuantity": 2,
      "overallStatus": "Pending",
      "orders": [
        {
          "orderId": "6a5e2705a19eb6aa12779ce8",
          "restaurant": { "_id": "6a5b9a364a8ade9ab7e5c01b", "name": "Bella Italia" },
          "items": [
            {
              "offerId": "...", "productId": "...",
              "productTitle": "test123", "productImage": "https://...",
              "restaurantId": "6a5b9a364a8ade9ab7e5c01b", "restaurantName": "Bella Italia",
              "originalPrice": 20, "offerPrice": 8.5, "discountPercentage": 57.5,
              "quantity": 1, "purchasedAt": "2026-07-20T13:47:49.386Z", "lineTotal": 8.5
            }
          ],
          "totalOriginalPrice": 20,
          "totalDiscount": 11.5,
          "finalTotalPrice": 8.5,
          "totalQuantity": 1,
          "status": "Pending"
        },
        {
          "orderId": "6a5e2705a19eb6aa12779ce9",
          "restaurant": { "_id": "6a5ba00f4b51f09df0fe1e28", "name": "Abo ali" },
          "items": [
            {
              "offerId": "...", "productId": "...",
              "productTitle": "fresh milk", "productImage": "https://...",
              "restaurantId": "6a5ba00f4b51f09df0fe1e28", "restaurantName": "Abo ali",
              "originalPrice": 20, "offerPrice": 20, "discountPercentage": 0,
              "quantity": 1, "purchasedAt": "2026-07-20T13:47:49.580Z", "lineTotal": 20
            }
          ],
          "totalOriginalPrice": 20,
          "totalDiscount": 0,
          "finalTotalPrice": 20,
          "totalQuantity": 1,
          "status": "Pending"
        }
      ],
      "createdAt": "2026-07-20T13:47:49.386Z"
    }
  ]
}
```
Note every `discountedPrice` from the earlier draft of this prompt is now `offerPrice`, and the list is `orders`, not `restaurantOrders` — this is the naming correction driving this whole revision.

### 3. `overallStatus` — computed at read time, never stored; this is the answer to "partial success" behavior
Do **not** persist a `status` field on `GroupOrder` — it would become a second source of truth that drifts from the individual `Order.status` values every time one restaurant progresses its own order independently of the others. Compute it on every read, using this precedence (highest priority first) — **this is now the confirmed, final rule** (it was flagged as an open question in the earlier draft; treat it as settled unless you tell the implementing agent otherwise):

1. If every child order's status is `Cancelled` → `overallStatus: "Cancelled"`
2. Else if every child order shares the exact same status (e.g. all `Pending`, or all `Delivered`) → `overallStatus: <that status>`
3. Else if at least one child order is `Delivered` and the rest are not all `Delivered` → `overallStatus: "Partially Delivered"`
4. Else if at least one child order is `Cancelled` and the rest are not → `overallStatus: "Partially Cancelled"`
5. Else (a genuine mix of in-progress, non-cancelled, non-delivered statuses) → `overallStatus: "Processing"`

This directly answers the "one restaurant accepts, another cancels" scenario: the `GroupOrder` stays a single object the frontend always consumes, but `overallStatus` accurately reflects the mixed reality underneath — the frontend can drill into `orders[].status` for the per-restaurant detail whenever `overallStatus` indicates a partial/mixed state.

### 4. `GET /orders/me/:id`
`:id` refers to `GroupOrder`'s `orderGroupId`. Returns the same populated shape as one item from the `GET /orders/me` array above. `NotFoundException` if the group doesn't exist or doesn't belong to the requesting user.

### 5. `GET /orders/restaurant/:restaurantId` — **UNCHANGED, do not touch**
Still queries `Order` directly by `restaurantId`, returns the flat per-restaurant shape exactly as it does today (now including the Offer-centric item snapshot per the companion prompt, but that's that prompt's change, not this one's). Restaurant managers never need to know `GroupOrder` exists.

### 6. `PATCH /orders/:id/status` — **UNCHANGED at the route/shape level**
`:id` still refers to an individual `Order._id`. Each restaurant progresses its own suborder's status independently. `overallStatus` on the group simply reflects whatever the current child statuses are, computed live per Section 3 above. (This endpoint does gain the inventory-restoration/recommendation-reversal side effect on `Cancelled` transitions specified in the companion Offer-centric prompt — that's covered there, not duplicated here.)

### 7. `GET /orders` (admin, all orders)
Leave as-is (flat `Order` list). Admins need per-restaurant operational visibility, which the grouped view isn't designed for.

## Migration — required, not optional

Every `Order` document created before this change has no `groupOrderId`. Write a one-off migration script that, for every existing `Order` without a `groupOrderId`, creates a new `GroupOrder` wrapping just that single order (a 1:1 group), copying its shared fields up and setting `totalOriginalPrice`/etc. from that one order's already-existing totals. Run this before deploying the new `GET /orders/me` logic, not after.

## Non-breaking guarantees — verify explicitly

- [ ] `GET /orders/restaurant/:restaurantId` response shape and behavior: unchanged by this task specifically (it does change per the companion Offer-centric prompt, but not because of anything in this one).
- [ ] `PATCH /orders/:id/status` route/shape/terminal-state lock: unchanged by this task specifically.
- [ ] `GET /orders` (admin): unchanged.
- [ ] Existing `Order` fields: nothing removed, only `groupOrderId` added.
- [ ] Each child `Order`'s own totals (`totalOriginalPrice`/`totalDiscount`/`finalTotalPrice`/`totalQuantity`) are computed exactly as they are today, from that order's own items — `GroupOrder` never overrides or recalculates them, only sums them.

## Breaking changes — call these out explicitly in your summary

- [ ] Checkout endpoint's response shape changes from an array of `Order` to a single `GroupOrder` object.
- [ ] `GET /orders/me` and `GET /orders/me/:id` response shapes change entirely.
- [ ] Field/naming changes from any earlier draft: `OrderGroup` → `GroupOrder`, `restaurantOrders` → `orders`, `discountedPrice` → `offerPrice` (the last one is shared with the companion Offer-centric prompt — don't apply it twice under two different names).
- [ ] Any frontend code currently consuming the old array-of-orders shape, or the earlier `OrderGroup`/`restaurantOrders`/`discountedPrice` naming, needs coordinated updates.

## Dependency on the companion prompt

Do not implement this in isolation. `AGENT_PROMPT_offer_centric_refactor.md`'s Section 6 (Order item snapshot, inventory reservation, AI recommendation feedback) must be implemented consistently with this one — specifically, each child `Order`'s items use that file's schema, and the `groupOrderId` linkage described here happens inside the same transaction as that file's inventory reservation and recommendation-increment steps. Implement them together, not as two independent passes over the same code.

## Testing checklist

1. Checkout with a cart spanning 2 restaurants — confirm 2 `Order` documents are created (each with its own correctly-computed totals from its own items), 1 `GroupOrder` is created referencing both, and the checkout response is a single `GroupOrder` object (not an array).
2. Confirm `GroupOrder.totalOriginalPrice`/`totalDiscount`/`finalTotalPrice`/`totalQuantity` exactly equal the sum of the 2 child orders' own totals — not independently recomputed.
3. `GET /orders/me` — confirm the response uses `orderGroupId`, `orders[]` (not `restaurantOrders`), and every item uses `offerPrice` (not `discountedPrice`).
4. `GET /orders/me/:id` using the `orderGroupId` — confirm it returns the same populated shape.
5. Progress one child order to `Delivered` and cancel the other — confirm `overallStatus` returns `"Partially Delivered"` (not `"Partially Cancelled"` — verify the precedence order in Section 3 resolves this specific mixed case as intended).
6. Confirm `GET /orders/restaurant/:restaurantId` and `PATCH /orders/:id/status` still work exactly as before this specific task (any changes to their item shape or inventory side effects come from the companion prompt, tested there).
7. Run the migration script against pre-existing `Order` data (or a seeded equivalent) and confirm `GET /orders/me` correctly returns 1:1 `GroupOrder` wrappers for historical orders with no data loss.
