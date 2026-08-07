# RestoMind — Notification System Implementation Guide

This document specifies a complete, implementation-ready design for the RestoMind notification system, scoped strictly to the current MVP: manager notifications on new orders, and admin notifications on new partnership applications. It is built to extend cleanly to every future notification type (Section 10) without requiring a redesign.

---

## 1. Overall Architecture

### The options, and why the choice is "database-first, real-time-enhanced" rather than any single mechanism alone

| Option | Fit for this MVP |
|---|---|
| **Polling only** | Simple, but adds latency and unnecessary load — a manager waiting on "did a new order just come in" deserves better than a 30-second-stale badge. Rejected as the *only* mechanism, though it remains the correct fallback when a socket isn't connected. |
| **Server-Sent Events (SSE)** | A reasonable, simpler one-directional alternative to WebSockets, since notifications only ever flow server → client. Worth knowing this option exists, but not recommended here — see below. |
| **WebSockets (Socket.IO)** | Bidirectional, real-time, well-supported in NestJS (`@nestjs/websockets`), and directly matches what this project's requirements already call for (JWT-authenticated, per-user rooms). Adds operational complexity (connection state, horizontal-scaling considerations) that should be layered on *after* the core system works, not built first. |
| **Database-backed notifications** | The required foundation regardless of delivery mechanism — a notification must exist and be retrievable even if the recipient wasn't online when it was created, or their socket had disconnected. This is not optional infrastructure; it's the source of truth. |

**Recommendation:** persist every notification to MongoDB as the single source of truth, and treat Socket.IO purely as a **delivery acceleration layer** on top of it — never as the only place a notification exists. This is deliberately phased in the Implementation Roadmap (Section 11): the system is fully functional (manager/admin can see new notifications via the REST API) before any WebSocket code is written at all. Real-time delivery makes the experience feel instant; it is not what makes the system correct. If Socket.IO is ever unavailable (a deploy, a dropped connection, a scaling event), no notification is ever lost — it's simply picked up the next time the client fetches or reconnects.

This also directly serves Section 10's scalability requirement: because the database layer is authoritative and the real-time layer is additive, every future notification type is built the same two-phase way — persist first, push second — without touching this architecture.

---

## 2. Database Design

```typescript
// notification.model.ts
_id                 ObjectId
userId              ObjectId → User          required, index    // the specific recipient — see "why per-user, not role-broadcast" below
role                'admin' | 'manager'      required            // the recipient's role at creation time, for filtering/display — not used for access control (userId is)
restaurantId        ObjectId → Restaurant    optional, index     // set for manager notifications (tenant-scoped); null for admin notifications (platform-level)
type                NotificationType (enum)  required, index     // see Section 3
title               String                   required
message             String                   required
relatedEntityId     ObjectId                 optional            // e.g. the OrderGroup._id or PartnershipApplication._id this notification is about
relatedEntityType   'OrderGroup' | 'PartnershipApplication'   optional   // paired with relatedEntityId, lets the frontend build a deep link
isRead              Boolean                  default false, index
readAt              Date                     optional, nullable
createdAt           Date                     (timestamps — no updatedAt needed beyond what timestamps: true already provides)
```

### Field-by-field reasoning
- **`userId` (always set, never a role-only broadcast row):** a restaurant has exactly one manager (per the project's established 1:1 owner rule), so targeting a manager notification by `userId` is precise and unambiguous. For admin notifications, since more than one admin account can exist, this design **fans out one Notification document per admin** at creation time (Section 4), rather than creating one shared "role: admin" row with some form of per-admin read tracking bolted on. Fan-out is simpler, avoids the "did someone else already read this for the whole team" ambiguity, and keeps the ownership model identical for every notification type: one document, one recipient, one `isRead` state. This also makes Section 9's "users only access their own notifications" trivial — it's always a plain `userId` match, never a role-based visibility rule with extra logic.
- **`restaurantId`:** nullable specifically because admin notifications are platform-level, not tied to any one restaurant. Present for manager notifications so future restaurant-scoped queries/filtering (e.g. an admin later wanting to see "all notifications for restaurant X") are a simple indexed filter, not a join.
- **`relatedEntityId` / `relatedEntityType`:** a generic pair rather than a dedicated foreign key per notification type — this is what lets Section 10's future types (inventory alerts, AI alerts, offer approvals) plug in without a schema migration each time; the pattern already generalizes.
- **`isRead` / `readAt`:** kept as two fields rather than inferring "read" from the presence of `readAt` alone, so the read/unread query (`isRead: false`, indexed) stays a simple boolean filter rather than an existence check — a minor but real query-performance choice given this is the single most frequent query this collection will serve (unread badge count).

### Indexes
- `{ userId: 1, isRead: 1, createdAt: -1 }` — the primary access pattern: "this user's unread notifications, newest first."
- `{ userId: 1, createdAt: -1 }` — the full notification list/history view.

---

## 3. Notification Types

```typescript
// notification-type.enum.ts
export enum NotificationType {
  NEW_ORDER = 'NEW_ORDER',
  NEW_PARTNERSHIP_APPLICATION = 'NEW_PARTNERSHIP_APPLICATION',
}
```

| Type | Recipient | Created When |
|---|---|---|
| `NEW_ORDER` | The restaurant's manager (`userId` = `Restaurant.ownerUserId`) | Immediately after a customer's checkout successfully creates an `Order` (and its parent `GroupOrder`) for that restaurant |
| `NEW_PARTNERSHIP_APPLICATION` | Every active admin (fan-out) | Immediately after a `PartnershipApplication` is successfully submitted |

The enum is intentionally a flat string union rather than a class hierarchy — this keeps it trivial to extend (Section 10) by adding a value, with no structural change to the model or service layer required.

---

## 4. Trigger Points

Notifications are created from **existing service methods**, as a step after the primary action succeeds — never from the controller layer directly, and never as something that can fail the primary action if notification creation itself has a problem.

| Trigger | Existing Service / Method | Notification Created |
|---|---|---|
| A customer completes checkout | `OrdersService` (the method backing `POST /orders`, which creates one `Order` per restaurant plus the parent `GroupOrder`) | One `NEW_ORDER` notification per restaurant included in that checkout, targeted at each restaurant's manager |
| A partnership application is submitted | `PartnershipApplicationsService.create()` (backing `POST /partnership-applications`) | One `NEW_PARTNERSHIP_APPLICATION` notification per active admin |

**Reliability rule, consistent with how side effects are already handled elsewhere in this project** (e.g. the order → sales-transaction sync, and approval emails in the Partnership flow): notification creation must be **fire-and-forget-safe**. If it fails for any reason, the checkout or application-submission request must still succeed — a broken notification pipeline must never block a customer's order or a restaurant's application. Wrap notification creation in a try/catch at the call site (or rely on the event-driven pattern in Section 5, which naturally isolates this), and log failures rather than surfacing them to the end user.

---

## 5. Backend Module Design

### Recommended pattern: event-driven creation, not direct service-to-service calls

Rather than having `OrdersService` import and directly call `NotificationService` (which couples order logic to notification logic, and gets messier every time a new module needs to react to "an order was placed"), use NestJS's built-in `@nestjs/event-emitter`:

- `OrdersService` emits an `order.created` event after a successful checkout, carrying the minimal payload the listener needs (`restaurantId`, `orderGroupId`, `customerName`, `totalAmount`).
- `PartnershipApplicationsService` emits a `partnership-application.created` event after successful submission.
- `NotificationModule` contains listeners for both events, which call into `NotificationService` to build and persist the actual notification(s).

This is the single most important structural decision in this document for Section 10's scalability requirement: **new notification types are added by writing a new listener, never by modifying `OrdersService` or any other existing module again.** A future "notify staff when an order is marked Ready" requirement is a second listener on the same `order.statusChanged` event (once that event exists) — `OrdersService` doesn't change.

### Module structure
```
src/notification/
  notification.module.ts
  notification.controller.ts
  notification.service.ts          // createNotification(), fan-out helper, typed builder methods
  notification.gateway.ts          // Socket.IO gateway — added in Phase 2, Section 7
  listeners/
    order-created.listener.ts       // @OnEvent('order.created')
    partnership-application-created.listener.ts   // @OnEvent('partnership-application.created')
  dto/
    query-notifications.dto.ts      // pagination + isRead filter — the only DTO needed; see security note below
  enums/
    notification-type.enum.ts
  interfaces/
    notification-payload.interface.ts   // shape emitted over the WebSocket gateway

src/DB/Models/notification.model.ts
src/DB/Repositories/notification.repository.ts   // extends base.service.ts, per existing convention
```

**Deliberately no `CreateNotificationDto` exposed to any controller.** There is no public or even authenticated "create a notification" endpoint anywhere in this design — notifications are only ever created by internal listeners calling `NotificationService` directly. This is the primary defense against notification spoofing (Section 9) and is a structural guarantee, not just a guard check: the capability to create a notification simply isn't reachable from the HTTP layer at all.

### `NotificationService` core methods
```typescript
createForUser(userId, role, type, title, message, relatedEntityId?, relatedEntityType?): Promise<Notification>
createForManager(restaurantId, type, title, message, relatedEntityId?, relatedEntityType?): Promise<Notification>
  // resolves Restaurant.ownerUserId internally, then calls createForUser
fanOutToAdmins(type, title, message, relatedEntityId?, relatedEntityType?): Promise<Notification[]>
  // queries all active admin users, calls createForUser once per admin
```
Keeping typed, purpose-named methods (`createForManager`, `fanOutToAdmins`) rather than one generic method every caller has to configure correctly reduces the chance of a listener accidentally mis-targeting a notification.

---

## 6. REST API Design

All endpoints require authentication; all are scoped to the caller's own `userId` — see Section 9.

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/notifications` | `manager`, `admin` | Paginated list of the caller's own notifications, newest first. Query: `page`, `limit`, `isRead` (optional filter) |
| GET | `/notifications/unread` | `manager`, `admin` | Shorthand for `?isRead=false` — kept as a distinct route since "unread list" and "unread count" are the two highest-frequency calls this API will get (bell icon polling) |
| GET | `/notifications/unread-count` | `manager`, `admin` | Returns just the count — cheaper than fetching the full unread list purely to render a badge number |
| PATCH | `/notifications/:id/read` | `manager`, `admin` | Marks one notification read, sets `readAt` |
| PATCH | `/notifications/read-all` | `manager`, `admin` | Marks every one of the caller's unread notifications read in one call |
| DELETE | `/notifications/:id` | `manager`, `admin` | Removes a notification from the caller's own list |

### Request / response examples

```json
// GET /notifications?page=1&limit=20&isRead=false
// 200 Response
{
  "success": true,
  "data": [
    {
      "id": "66f1a2b3c4d5e6f7a8b9c0d1",
      "type": "NEW_ORDER",
      "title": "New Order Received",
      "message": "Order #1245 has been placed by Ahmed. Total: 520 EGP.",
      "relatedEntityId": "66f1a2b3c4d5e6f7a8b9c0aa",
      "relatedEntityType": "OrderGroup",
      "isRead": false,
      "createdAt": "2026-08-01T10:15:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 4 }
}
```

```json
// GET /notifications/unread-count
// 200 Response
{ "success": true, "data": { "count": 4 } }
```

```json
// PATCH /notifications/:id/read
// 200 Response
{ "success": true, "data": { "id": "66f1a2b3c4d5e6f7a8b9c0d1", "isRead": true, "readAt": "2026-08-01T10:20:00Z" } }
```

`DELETE /notifications/:id` and `PATCH /notifications/:id/read` both resolve `:id` **only within the caller's own notifications** — attempting either on another user's notification returns `404`, matching the project's established "don't confirm existence of something the caller shouldn't see" convention.

---

## 7. Real-Time Flow

### Connection & authentication
- The frontend connects to a Socket.IO namespace (e.g. `/notifications`) with the user's existing JWT access token passed in the connection handshake (`auth: { token }`), **reusing the same `TokenService` verification logic already used by the REST `AuthGuard`** — not a second, separate JWT-checking implementation.
- `NotificationGateway.handleConnection(client)` verifies the token; on success, joins the client to a room named after their `userId` (e.g. `user:66f1a2b3c4d5e6f7a8b9c0d1`). On failure, the connection is rejected immediately.
- `handleConnection` supports multiple simultaneous connections per user transparently (the same user open in two browser tabs both join the same room and both receive the same event) — Socket.IO rooms handle this natively, no extra logic needed.

### Delivery flow
```
Event emitted (order.created / partnership-application.created)
   ↓
Listener calls NotificationService → notification persisted to MongoDB (source of truth)
   ↓
NotificationService calls NotificationGateway.emitToUser(userId, notificationPayload)
   ↓
Gateway emits a 'notification:new' event to room `user:<userId>`
   ↓
Any currently-connected client(s) for that user receive it instantly
   ↓
(If the user isn't connected right now: nothing is lost — the notification is already
 persisted, and the next GET /notifications or /unread-count call picks it up normally)
```

### Event payload
```typescript
// notification-payload.interface.ts
interface NotificationPayload {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  createdAt: string;
}
```
The emitted payload deliberately mirrors the REST response shape — the frontend should not need two different parsing paths depending on whether a notification arrived via the initial fetch or a live push.

---

## 8. Frontend Integration Notes

- **Notification bell** in the manager/admin navigation, showing the unread count from `GET /notifications/unread-count` on initial page load.
- **Unread badge**: updated on load, and incremented live whenever a `notification:new` socket event arrives — no need to re-fetch the count from the API on every event, the client can simply increment locally and reconcile on next full fetch.
- **Dropdown / panel**: backed by `GET /notifications` (paginated), showing the most recent notifications with their `title`/`message`/`createdAt`, visually distinguishing `isRead: false` entries.
- **Mark as read**: clicking a notification (or an explicit "mark read" action) calls `PATCH /notifications/:id/read`; a "mark all read" action calls `PATCH /notifications/read-all`.
- **Real-time updates**: on app load (for `manager`/`admin` sessions only), establish the Socket.IO connection described in Section 7, and prepend any incoming `notification:new` event to the dropdown's in-memory list.
- **Deep linking**: use `relatedEntityType`/`relatedEntityId` to route directly to the relevant order or partnership application when a notification is clicked, rather than only showing static text.

---

## 9. Security Considerations

- **JWT authentication**: every REST endpoint in Section 6 sits behind the existing `AuthGuard`; the Socket.IO handshake reuses the same `TokenService` verification — one authentication implementation, two transports, not two separate auth systems to keep in sync.
- **Authorization**: all endpoints are restricted to `manager`/`admin` roles for this MVP (matching who actually receives notifications today) — `customer`/`staff` are simply not yet applicable, per the current scope, and should return `403` if they somehow reach these routes rather than an empty (but seemingly valid) list.
- **Ownership — ("users only access their own notifications")**: every query and mutation in `NotificationService` filters by the authenticated caller's own `userId`, resolved server-side from the JWT, exactly like the tenant-scoping principle already established (and flagged as a Critical fix target) in this project's Security Implementation Guide. No endpoint in this module accepts a client-supplied `userId` anywhere, on any route, under any circumstance.
- **Rate limiting**: notification endpoints sit behind the same global rate-limiting tier already specified in the Security Implementation Guide — no dedicated stricter tier is needed here, since these aren't authentication or AI-triggering endpoints, but they must not be left unprotected either.
- **Validation**: `query-notifications.dto.ts` validates `page`/`limit`/`isRead` via the project's standard `class-validator` + global `ValidationPipe` convention (whitelist, forbid unknown properties) — same as every other module.
- **Input sanitization**: `title`/`message` are only ever generated server-side from internal listener code — there is no path by which a client-supplied string becomes a notification's text. Where dynamic values are interpolated into a message (e.g. a customer's name in "Order #1245 has been placed by Ahmed"), treat that value as plain text only on the frontend (never rendered as HTML), as a defense-in-depth measure in case a name field ever contains unexpected characters.
- **Preventing notification spoofing**: enforced structurally, not just by a guard — there is no `POST /notifications` endpoint, and no DTO anywhere in this module accepts a `userId`, `type`, `title`, or `message` from an HTTP request body. The only way a notification comes into existence is through an internal event listener calling `NotificationService` directly from server-side code.

---

## 10. Scalability

This design extends to every listed future notification type without a redesign, because of three deliberate choices already made above:

| Future Requirement | How It's Already Supported |
|---|---|
| **Customers** | Add `'customer'` to the `role` field's type; add a `createForCustomer()` method to `NotificationService` following the same pattern as `createForManager()`. No schema change. |
| **Staff** | Same as customers — `role: 'staff'`, a new typed creation method, no schema change. Staff-relevant events (e.g. `order.statusChanged`) simply gain a new listener. |
| **Inventory alerts** (e.g. low stock) | New `NotificationType` enum value (`LOW_STOCK`); a new listener on an `inventory.batchLow` event (or a scheduled job that emits one); `relatedEntityId`/`relatedEntityType` already generalizes to point at the `InventoryBatch`/`Ingredient`. |
| **AI alerts** (predictions ready, accuracy report available) | New enum value + listener on the existing AI-pipeline's own internal events/cron completions — the notification layer doesn't need to know anything about how predictions are computed, only that "a prediction became available" is an event it can listen for. |
| **Waste alerts** (high waste risk detected) | New enum value + listener on the Waste Report generation step from the AI Integration Roadmap — same pattern exactly. |
| **Offer approvals** (a recommendation was approved into a live Offer) | New enum value + listener on the existing recommendation-approval flow. |
| **System announcements** (broadcast to everyone, or everyone of a role) | The fan-out pattern already used for admins (Section 2/5) generalizes directly — "fan out to all admins" and "fan out to all users" are the same mechanism with a different recipient query. No new capability needs to be built, only a new recipient-resolution function feeding the same `createForUser()` core method. |

The one thing to actively avoid as this grows: resist the temptation to special-case new notification types with their own bespoke service methods and one-off controller logic. Every future type should fit the same shape — an event, a listener, a typed `createFor*()` call, a `NotificationType` enum value — specifically so this section's promise ("without redesigning the architecture") stays true in practice, not just on paper.

---

## 11. Implementation Roadmap

Phased so the system is fully correct (Section 1's "database-first") before any real-time complexity is introduced.

**Step 1 — Schema & Repository**
Create `notification.model.ts` and `notification.repository.ts` (extending `base.service.ts`), plus the indexes from Section 2.

**Step 2 — Core Module & Service**
Create `NotificationModule`, `NotificationService` with `createForUser`/`createForManager`/`fanOutToAdmins`, and the `NotificationType` enum. No triggers wired yet — this step is unit-testable in isolation.

**Step 3 — Event Emitters on Existing Services**
Add `@nestjs/event-emitter`'s `EventEmitter2` to `OrdersService` (emit `order.created` after successful checkout) and `PartnershipApplicationsService` (emit `partnership-application.created` after successful submission). Minimal, additive changes to existing, working code — no behavior change to either flow's existing response.

**Step 4 — Listeners**
Create the two listener classes (Section 5), each calling the appropriate `NotificationService` method in response to its event, wrapped in try/catch per Section 4's reliability rule.

**Step 5 — REST API**
Implement the controller, DTO, and all six endpoints from Section 6, guarded per Section 9.

**Step 6 — Manual Verification (Phase 1 complete, no real-time yet)**
Place a test order → confirm a `NEW_ORDER` notification appears via `GET /notifications` for the correct manager. Submit a test partnership application → confirm every active admin receives their own `NEW_PARTNERSHIP_APPLICATION` notification. Confirm `PATCH .../read`, `read-all`, and `DELETE` all work and are correctly scoped to the caller.

**Step 7 — Socket.IO Gateway**
Implement `NotificationGateway` with JWT-authenticated `handleConnection` (reusing `TokenService`) and per-user rooms, per Section 7.

**Step 8 — Wire Real-Time Delivery**
Extend `NotificationService`'s creation methods to call `NotificationGateway.emitToUser(...)` immediately after a successful DB write.

**Step 9 — Frontend Integration**
Bell, badge, dropdown, mark-as-read interactions, and the Socket.IO client connection, per Section 8.

**Step 10 — Security & Load Review**
Confirm every item in Section 9 against the actual implementation (ownership checks, rate limiting applied, no spoofing path exists) before considering this feature production-ready.

**Step 11 — Documented Extension Point**
Add a short internal note (in this file or a follow-up) pointing future contributors at Section 10 before they add a new notification type — so the "event + listener + typed method" pattern is followed consistently rather than reinvented per feature.

---

## 12. Production Improvements & Maintenance

### Retention Policy & Automatic Cleanup
- **Expiration**: Notifications expire after a configurable retention period controlled by `NOTIFICATION_RETENTION_DAYS` (default: 90 days).
- **Cleanup Service**: `NotificationCleanupService` utilizes NestJS `@nestjs/schedule` (`@Cron(CronExpression.EVERY_DAY_AT_2AM)`) to run automatically every day at 2:00 AM server time.
- **Repository Execution**: Calls `NotificationRepository.deleteExpiredNotifications(retentionDays)` querying `{ createdAt: { $lt: thresholdDate } }`.
- **Fault-Tolerance**: Wrapped in try/catch to ensure database or server operations are never interrupted, logging execution metrics (start, deleted count, completion, failure).

### Production Pagination, Filtering & Sorting Schema
- **REST Endpoint**: `GET /notifications`
- **Supported Parameters**:
  - `page`: Page number (default: `1`, min: `1`)
  - `limit`: Items per page (default: `20`, min: `1`)
  - `isRead`: Boolean filter (`true` | `false`)
  - `type`: Enum filter (`NEW_ORDER` | `NEW_PARTNERSHIP_APPLICATION`)
  - `createdAfter`: ISO date string filter (e.g. `2026-08-01`)
  - `createdBefore`: ISO date string filter (e.g. `2026-08-07`)
  - `sortBy`: Field to sort by (`createdAt` | `readAt`, default: `createdAt`)
  - `order`: Sort direction (`asc` | `desc`, default: `desc`)

- **Response Format**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "66f1a2b3c4d5e6f7a8b9c0d1",
        "type": "NEW_ORDER",
        "title": "New Order Received",
        "message": "Order #1245 has been placed by Ahmed. Total: 520 EGP.",
        "relatedEntityId": "66f1a2b3c4d5e6f7a8b9c0aa",
        "relatedEntityType": "OrderGroup",
        "isRead": false,
        "createdAt": "2026-08-01T10:15:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 150,
      "totalPages": 8,
      "hasNext": true,
      "hasPrevious": false
    }
  }
  ```

### New Environment Variables
```env
NOTIFICATION_RETENTION_DAYS=90
```

### MongoDB Performance Indexing Strategy
To optimize query performance for unread badge counts, pagination, multi-field filtering, sorting, and TTL retention cleanup, the following indexes are enabled on the `notifications` collection:
- `{ userId: 1, isRead: 1, createdAt: -1 }` (unread listing & badge count)
- `{ userId: 1, createdAt: -1 }` (default history pagination)
- `{ userId: 1, type: 1, createdAt: -1 }` (filtering by notification type)
- `{ userId: 1, readAt: -1 }` (sorting by readAt timestamp)
- `{ createdAt: 1 }` (daily retention cleanup queries)
