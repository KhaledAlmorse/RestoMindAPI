# Task — Unify Multi-Restaurant Checkout into a Single Logical Order (OrderGroup)

You are working in the existing **RestoMindApi** project (NestJS + Mongoose). Read this entire prompt before writing any code — it contains schema, exact endpoint behavior, and several decisions that must be confirmed with the user before implementation, not assumed.

## Context (do not redesign this part)

The checkout flow intentionally creates **one `Order` document per restaurant** when a cart spans multiple restaurants — this is correct and must not change. Each restaurant manages its own order independently (its own status lifecycle, visible only to that restaurant's manager via `GET /orders/restaurant/:restaurantId`).

The problem is purely on the **customer-facing read side**: `GET /orders/me` currently returns a flat array of `Order` documents, so a single checkout that touched 2 restaurants shows up to the customer as 2 unrelated orders instead of 1 logical order with 2 parts.

## The fix: a new `OrderGroup` entity, not a merge of `Order`

Do **not** try to infer which `Order` documents belong together by matching fields like `userId` + `createdAt` proximity — that's fragile and will misgroup two genuinely separate checkouts placed close together with similar details. Instead, create an explicit link at checkout time.

### New model: `order-group.model.ts`
```
_id                   ObjectId
userId                ObjectId → User            required
restaurantOrderIds    Array<ObjectId → Order>    required, min length 1
fullName              String                     required
phoneNumber           String                     required
emailAddress          String                     required
deliveryMethod        String enum                required   ('Home Delivery' | 'Store Pickup')
deliveryAddress       embedded                    required IF deliveryMethod = 'Home Delivery', else omitted
specialNotes          String                     optional
paymentMethod         String enum                required   ('Cash on Delivery')
totalOriginalPrice    Number                     required   — sum across all suborders
totalDiscount         Number                     required   — sum across all suborders
finalTotalPrice       Number                     required   — sum across all suborders
totalQuantity         Number                     required   — sum across all suborders
createdAt / updatedAt Date
```

These checkout-level fields (`fullName`, `phoneNumber`, `deliveryAddress`, etc.) are already identical across every `Order` from the same checkout today — hoisting them onto `OrderGroup` is not new data, just a new place to read them from once instead of duplicated N times.

### Existing `Order` model — one addition
```
orderGroupId   ObjectId → OrderGroup   required going forward
```
`Order` keeps every field it has today (including the duplicated `fullName`/`phoneNumber`/etc.) — **do not remove anything from `Order`**, since `GET /orders/restaurant/:restaurantId` and `PATCH /orders/:id/status` consumers still expect its current shape unchanged.

## Required changes, endpoint by endpoint

### 1. Checkout / order creation (existing `POST /orders` — locate the actual current route/controller/service, this prompt describes behavior, not a guessed path)
**This is a breaking response-shape change — flag it clearly in your PR/summary, since the frontend must be coordinated separately.**

Current behavior: splits cart items by `restaurantId`, creates N `Order` documents, returns an array of them.

New behavior, same split logic, plus:
1. Create the N `Order` documents as today (unchanged fields/logic).
2. Create **one** `OrderGroup`, with `restaurantOrderIds` set to the N order IDs just created, and the aggregated/shared fields computed as described above.
3. Set `orderGroupId` on each of the N `Order` documents to point at this new group (single update, or set at creation time — your call on the cleanest way to do this in one transaction).
4. **Wrap steps 1–3 in a single Mongo transaction.** A checkout that creates orders but fails to create/link the group is exactly the kind of partial-state bug this whole feature exists to prevent.
5. Response changes from an array of `Order` to a single `OrderGroup` object, populated with its suborders (see response shape below) — this is the new "one logical order" the frontend consumes immediately after checkout.

### 2. `GET /orders/me`
**Breaking change — this is the actual point of the request.**

Change from: querying `Order` by `userId`, returning a flat array.
Change to: querying `OrderGroup` by `userId`, returning one object per group, each populated with its suborders. Target response shape:

```json
{
  "data": [
    {
      "_id": "<orderGroupId>",
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
      "restaurantOrders": [
        {
          "orderId": "6a5e2705a19eb6aa12779ce8",
          "restaurant": { "_id": "6a5b9a364a8ade9ab7e5c01b", "name": "Bella Italia" },
          "items": [ { "productId": "...", "title": "test123", "price": 20, "discountedPrice": 8.5, "quantity": 1 } ],
          "totalOriginalPrice": 20,
          "totalDiscount": 11.5,
          "finalTotalPrice": 8.5,
          "status": "Pending"
        },
        {
          "orderId": "6a5e2705a19eb6aa12779ce9",
          "restaurant": { "_id": "6a5ba00f4b51f09df0fe1e28", "name": "Abo ali" },
          "items": [ { "productId": "...", "title": "fresh milk", "price": 20, "discountedPrice": 20, "quantity": 1 } ],
          "totalOriginalPrice": 20,
          "totalDiscount": 0,
          "finalTotalPrice": 20,
          "status": "Pending"
        }
      ],
      "createdAt": "2026-07-20T13:47:49.386Z"
    }
  ]
}
```

### 3. `overallStatus` — computed at read time, never stored
Do **not** persist a `status` field on `OrderGroup` — it would become a second source of truth that can drift out of sync with the individual `Order.status` values every time one restaurant progresses its own order. Compute it on every read instead, using this precedence (highest priority first) — **confirm this exact rule with the user before implementing it, it's a product decision, not a technical one:**

1. If every suborder's status is `Cancelled` → `overallStatus: "Cancelled"`
2. Else if every suborder shares the exact same status (e.g. all `Pending`, or all `Delivered`) → `overallStatus: <that status>`
3. Else if at least one suborder is `Delivered` and the rest are not all `Delivered` → `overallStatus: "Partially Delivered"`
4. Else if at least one suborder is `Cancelled` and the rest are not → `overallStatus: "Partially Cancelled"`
5. Else (a genuine mix of in-progress, non-cancelled, non-delivered statuses) → `overallStatus: "Processing"`

### 4. `GET /orders/me/:id`
`:id` now refers to `OrderGroup._id`, not `Order._id`. Returns the same populated shape as one item from the `GET /orders/me` array above. `NotFoundException` if the group doesn't exist or doesn't belong to the requesting user (existing ownership-check convention).

### 5. `GET /orders/restaurant/:restaurantId` — **UNCHANGED, do not touch**
Still queries `Order` directly by `restaurantId`, returns the flat per-restaurant shape exactly as it does today. Restaurant managers should never need to know `OrderGroup` exists — they only ever operate on their own restaurant's individual orders.

### 6. `PATCH /orders/:id/status` — **UNCHANGED, do not touch**
`:id` still refers to an individual `Order._id`. Each restaurant progresses its own suborder's status independently — this is the entire reason `Order` stays per-restaurant. `overallStatus` on the group simply reflects whatever the current suborder statuses are, computed live per Section 3.

### 7. `GET /orders` (admin, all orders)
Leave as-is (flat `Order` list) for this task — admins need per-restaurant operational visibility, which the grouped view isn't designed for. Do not add grouping here unless explicitly asked.

## Migration — required, not optional

Every `Order` document created before this change has no `orderGroupId`, and `GET /orders/me`'s new implementation will break for any user with historical orders unless this is handled. Write a one-off migration script that, for every existing `Order` without an `orderGroupId`, creates a new `OrderGroup` wrapping just that single order (a 1:1 group), copying its shared fields up. Run this before deploying the new `GET /orders/me` logic, not after.

## Non-breaking guarantees — verify explicitly, don't just assume

- [ ] `GET /orders/restaurant/:restaurantId` response shape and behavior: byte-for-byte unchanged. Re-run existing tests for this endpoint.
- [ ] `PATCH /orders/:id/status` behavior, including the terminal-state rejection (`Delivered`/`Cancelled` block further changes): unchanged. Re-run existing tests.
- [ ] `GET /orders` (admin): unchanged.
- [ ] Existing `Order` fields: nothing removed, only `orderGroupId` added.

## Breaking changes — call these out explicitly in your summary, do not bury them

- [ ] Checkout endpoint's response shape changes from an array of `Order` to a single `OrderGroup` object.
- [ ] `GET /orders/me` and `GET /orders/me/:id` response shapes change entirely (this is the intended fix).
- [ ] Any frontend code currently consuming the old array-of-orders shape from checkout or `GET /orders/me` will need to be updated in step with this backend change — flag this dependency clearly, it's outside this task's scope but blocks it from being usable.

## Before you write any code

Confirm these two decisions with the user — do not silently pick a default and build around it:
1. **The `overallStatus` precedence rule in Section 3** — is this exactly the logic wanted, or should any case (e.g. "Partially Delivered" vs. "Processing") resolve differently?
2. **Whether the migration script should run automatically on deploy or be a manually-triggered one-off** — given it touches every historical order, confirm the preferred approach before scripting it.

## When done

Report back: what you built, the exact final `OrderGroup` schema, confirmation that all "Non-breaking guarantees" checklist items pass with evidence (test output, not just "should work"), and the migration script's location and how to run it.
