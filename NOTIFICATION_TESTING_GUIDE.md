# RestoMind — Notification System Testing & Verification Guide

This document is a comprehensive, production-grade Quality Assurance (QA) testing guide for the **RestoMind Notification System**. It allows developers, QA engineers, and hackathon judges to verify every notification flow from end to end using Postman, browser tools, frontend interfaces, and MongoDB inspection—without needing to inspect the underlying source code.

---

## 1. Environment Setup

Before starting manual or automated tests, verify that all system dependencies and services are active.

### System Requirements & Prerequisites
1. **Backend Server**: NestJS API running on `http://localhost:3000` (or your configured `PORT`).
   - Start command: `npm run start:dev`
2. **Database**: MongoDB instance running locally or via MongoDB Atlas.
   - Connection URI: Configured via `DB_URL` in `.env`.
3. **Frontend Application**: RestoMind Web Portal running on `http://localhost:5173` (or configured `FRONTEND_URL`).
4. **WebSocket Server**: Socket.IO gateway running under namespace `http://localhost:3000/notifications`.
5. **Database Seeded**: Run `npm run seed` to populate restaurants, products, active offers, and user accounts.
6. **Required Environment Variables**:
   ```env
   PORT=3000
   DB_URL=mongodb://localhost:27017/restomind
   ACCESS_TOKEN_SECRET=your_jwt_access_secret
   REFRESH_TOKEN_SECRET=your_jwt_refresh_secret
   NOTIFICATION_RETENTION_DAYS=90
   ```

---

## 2. Required Test Accounts

Testing requires three user roles to verify tenant isolation, role-based visibility, and admin broadcast fan-out.

| Role | Sample Email | Sample Password | Target Scope | Key Responsibilities / Permissions |
|---|---|---|---|---|
| **Admin** | `admin@restomind.com` | `Admin123!` | Platform-wide | Receives platform notifications (e.g. `NEW_PARTNERSHIP_APPLICATION`). Access to all admin routes. |
| **Manager** | `manager@restaurant.com` | `Manager123!` | Tenant-scoped (`restaurantId`) | Receives order notifications (`NEW_ORDER`) for owned restaurant. Owned by `Restaurant.ownerUserId`. |
| **Customer** | `customer@gmail.com` | `Customer123!` | Client | Places orders, adds items to cart. Does not receive manager/admin notifications. |

> **Note**: Obtain JWT access tokens for each user role by calling `POST /auth/login` before running API or WebSocket tests.

---

## 3. Manager Notification Flow (End-to-End)

This test verifies that a customer placing an order automatically generates a real-time and persisted notification for the restaurant's manager.

### Step-by-Step Test Procedure:
1. **Login as Customer**:
   - Call `POST /auth/login` with customer credentials. Save `accessToken`.
2. **Add Item & Checkout**:
   - Add active offer to cart: `POST /cart/items`.
   - Submit checkout: `POST /orders`.
3. **Verify Order Creation**:
   - Confirm status code `201 Created` and capture `groupOrderId` and child `orderId`.
4. **Login as Manager**:
   - Call `POST /auth/login` with manager credentials for the target restaurant.
5. **Check Unread Count**:
   - Call `GET /notifications/unread-count`.
   - **Verification**: Badge count must increment by `1`.
6. **Fetch Unread Notifications**:
   - Call `GET /notifications/unread`.
   - **Verification**: Verify a notification exists with:
     - `type`: `"NEW_ORDER"`
     - `title`: `"New Order Received"`
     - `relatedEntityType`: `"OrderGroup"`
     - `relatedEntityId`: matches `groupOrderId`
     - `isRead`: `false`
7. **Verify Real-Time WebSocket Push (If Manager Online)**:
   - If a Socket.IO client is connected under room `user:<managerUserId>`, verify a `notification:new` event arrived instantly.
8. **Mark Notification as Read**:
   - Call `PATCH /notifications/:id/read`.
   - **Verification**: `isRead` changes to `true`, `readAt` timestamp is populated.
9. **Verify Count Decrement**:
   - Call `GET /notifications/unread-count`.
   - **Verification**: Unread count decreases by `1`.
10. **Verify Persistence**:
    - Refresh browser or re-call `GET /notifications?isRead=true`. Confirm notification remains stored in MongoDB.

---

## 4. Admin Notification Flow (End-to-End)

This test verifies that when a prospective restaurant submits a partnership application, the system fans out individual notifications to all active system admins.

### Step-by-Step Test Procedure:
1. **Submit Partnership Application**:
   - Call public endpoint `POST /partnership-applications` with payload:
     ```json
     {
       "businessName": "Gourmet Burger Kitchen",
       "ownerFirstName": "Tarek",
       "ownerLastName": "El-Sayed",
       "email": "tarek@gourmetburger.com",
       "phone": "01012345678",
       "city": "Cairo",
       "district": "Maadi",
       "street": "Road 9"
     }
     ```
2. **Verify Application Submission**:
   - Confirm HTTP status `201 Created` and capture `application._id`.
3. **Login as Admin**:
   - Call `POST /auth/login` with admin credentials. Save `accessToken`.
4. **Verify Notification Reception**:
   - Call `GET /notifications`.
   - **Verification**: Locate notification with:
     - `type`: `"NEW_PARTNERSHIP_APPLICATION"`
     - `title`: `"New Partnership Application"`
     - `message`: `"New partnership application submitted for \"Gourmet Burger Kitchen\" by Tarek El-Sayed."`
     - `relatedEntityType`: `"PartnershipApplication"`
     - `relatedEntityId`: matches `application._id`
5. **Verify Fan-Out**:
   - If multiple admin accounts exist in MongoDB (`role: 'admin'`), log in as a second admin.
   - **Verification**: The second admin receives their own dedicated notification document for the same application.
6. **Mark All as Read**:
   - Call `PATCH /notifications/read-all`.
   - **Verification**: Status `200 OK`, all admin notifications marked `isRead: true`.

---

## 5. REST API Endpoint Reference

All endpoints require HTTP Header: `Authorization: Bearer <JWT_ACCESS_TOKEN>` and are restricted to `manager` and `admin` roles.

### 5.1 GET `/notifications`
- **Purpose**: Retrieve paginated, filterable, and sortable notifications for the authenticated user.
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Query Parameters**:
  - `page` (optional, default: `1`)
  - `limit` (optional, default: `20`)
  - `isRead` (optional, boolean: `true` | `false`)
  - `type` (optional, enum: `NEW_ORDER` | `NEW_PARTNERSHIP_APPLICATION`)
  - `createdAfter` (optional, ISO date string)
  - `createdBefore` (optional, ISO date string)
  - `sortBy` (optional, `createdAt` | `readAt`, default: `createdAt`)
  - `order` (optional, `asc` | `desc`, default: `desc`)
- **Expected Status Code**: `200 OK`
- **Expected Response**:
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
      "totalItems": 1,
      "totalPages": 1,
      "hasNext": false,
      "hasPrevious": false
    }
  }
  ```

---

### 5.2 GET `/notifications/unread`
- **Purpose**: Shorthand endpoint to fetch only unread notifications.
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Expected Status Code**: `200 OK`
- **Expected Response**: Same structure as `GET /notifications`, with `isRead` implicitly filtered to `false`.

---

### 5.3 GET `/notifications/unread-count`
- **Purpose**: Fast, cheap count of caller's unread notifications (used for nav bell badge).
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Expected Status Code**: `200 OK`
- **Expected Response**:
  ```json
  {
    "success": true,
    "data": {
      "count": 4
    }
  }
  ```

---

### 5.4 PATCH `/notifications/:id/read`
- **Purpose**: Mark a single notification as read.
- **Method**: `PATCH`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **URL Param**: `:id` (MongoDB ObjectId of notification)
- **Expected Status Code**: `200 OK`
- **Expected Response**:
  ```json
  {
    "success": true,
    "data": {
      "id": "66f1a2b3c4d5e6f7a8b9c0d1",
      "type": "NEW_ORDER",
      "title": "New Order Received",
      "message": "Order #1245 has been placed by Ahmed. Total: 520 EGP.",
      "isRead": true,
      "readAt": "2026-08-07T15:00:00.000Z",
      "createdAt": "2026-08-01T10:15:00.000Z"
    }
  }
  ```

---

### 5.5 PATCH `/notifications/read-all`
- **Purpose**: Bulk mark all unread notifications of the caller as read.
- **Method**: `PATCH`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **Expected Status Code**: `200 OK`
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "All notifications marked as read"
  }
  ```

---

### 5.6 DELETE `/notifications/:id`
- **Purpose**: Delete a single notification document belonging to the caller.
- **Method**: `DELETE`
- **Headers**: `Authorization: Bearer <TOKEN>`
- **URL Param**: `:id` (MongoDB ObjectId)
- **Expected Status Code**: `200 OK`
- **Expected Response**:
  ```json
  {
    "success": true,
    "message": "Notification deleted successfully"
  }
  ```

---

## 6. Filtering & Query Param Test Cases

Use Postman or curl to verify query parameter combinations.

| Test Case | Method | Query URL | Expected Result |
|---|---|---|---|
| **Filter Unread** | `GET` | `/notifications?isRead=false` | Returns only records with `isRead: false`. |
| **Filter Read** | `GET` | `/notifications?isRead=true` | Returns only records with `isRead: true`. |
| **Filter Type** | `GET` | `/notifications?type=NEW_ORDER` | Returns only orders notifications. |
| **Filter Date Range** | `GET` | `/notifications?createdAfter=2026-08-01&createdBefore=2026-08-07` | Returns notifications created within date window. |
| **Pagination Page 2** | `GET` | `/notifications?page=2&limit=5` | Returns items 6-10 with `pagination.page = 2`. |
| **Sort by Read Time** | `GET` | `/notifications?sortBy=readAt&order=desc` | Returns notifications ordered by `readAt` descending. |
| **Combined Filters** | `GET` | `/notifications?type=NEW_ORDER&isRead=false&limit=10&order=asc` | Returns unread order notifications sorted ascending. |

---

## 7. Negative & Edge Case Tests

Verify security guards, error handlers, and input validation.

| Test Case | Scenario / Request | Expected Status | Expected Error Response |
|---|---|---|---|
| **No Auth Header** | `GET /notifications` without header | `401 Unauthorized` | `{"statusCode": 401, "message": "No token provided, please Login"}` |
| **Invalid JWT** | Header: `Bearer invalid_token_xyz` | `401 Unauthorized` | `{"statusCode": 401, "message": "Invalid token, please Login"}` |
| **Cross-User Access** | Manager A calls `PATCH /notifications/:id/read` for Manager B's notification | `404 Not Found` | `{"statusCode": 404, "message": "Notification not found"}` *(Prevents ID enumeration)* |
| **Cross-User Delete** | Manager A calls `DELETE /notifications/:id` for Manager B's notification | `404 Not Found` | `{"statusCode": 404, "message": "Notification not found"}` |
| **Invalid ObjectId** | `GET /notifications/invalid-id/read` | `400 Bad Request` | `{"statusCode": 400, "message": "Invalid ObjectId: invalid-id"}` |
| **Invalid Enum Filter** | `GET /notifications?type=INVALID_TYPE` | `400 Bad Request` | `{"statusCode": 400, "message": ["type must be one of the following values: NEW_ORDER, NEW_PARTNERSHIP_APPLICATION"]}` |
| **Invalid Date Filter** | `GET /notifications?createdAfter=not-a-date` | `400 Bad Request` | `{"statusCode": 400, "message": ["createdAfter must be a valid ISO 8601 date string"]}` |

---

## 8. WebSocket (Socket.IO) Real-Time Verification

Verify instant push delivery using Postman WebSocket Client, Firecamp, or browser console.

### Connection Details:
- **URL**: `ws://localhost:3000/notifications`
- **Handshake Auth**: `{ "token": "<JWT_ACCESS_TOKEN>" }`

### Verification Steps:
1. **Connection & Handshake**:
   - Connect client to `ws://localhost:3000/notifications` passing JWT in auth payload.
   - **Verification**: Connection accepted. Backend logs `Socket client connected: <socketId> joined room user:<userId>`.
2. **Rejection on Missing Token**:
   - Attempt connection without token.
   - **Verification**: Server disconnects socket immediately.
3. **Receiving Real-Time Push**:
   - Keep WebSocket connection active. Trigger an order checkout from Customer account.
   - **Verification**: Manager socket client receives event `notification:new`:
     ```json
     {
       "id": "66f1a2b3c4d5e6f7a8b9c0d1",
       "type": "NEW_ORDER",
       "title": "New Order Received",
       "message": "Order #1245 has been placed by Ahmed. Total: 520 EGP.",
       "relatedEntityId": "66f1a2b3c4d5e6f7a8b9c0aa",
       "relatedEntityType": "OrderGroup",
       "isRead": false,
       "createdAt": "2026-08-07T15:30:00.000Z"
     }
     ```
4. **Offline Reconnection Test**:
   - Disconnect socket client. Place an order.
   - Reconnect socket client or fetch `GET /notifications`.
   - **Verification**: Notification was stored reliably in MongoDB during disconnection and is retrieved on fetch.

---

## 9. Database Verification (MongoDB)

Using MongoDB Compass or `mongosh`, execute queries to verify document persistence and index utilization.

### 1. Document Schema Verification:
Run query: `db.notifications.find({ role: "manager" }).pretty()`
- Confirm fields exist: `userId`, `role`, `restaurantId`, `type`, `title`, `message`, `relatedEntityId`, `relatedEntityType`, `isRead`, `createdAt`.

### 2. Verify Index Existence:
Run command: `db.notifications.getIndexes()`
Confirm output contains:
- `{ userId: 1, isRead: 1, createdAt: -1 }`
- `{ userId: 1, createdAt: -1 }`
- `{ userId: 1, type: 1, createdAt: -1 }`
- `{ userId: 1, readAt: -1 }`
- `{ createdAt: 1 }`

---

## 10. Acceptance Checklist

Use this checklist for final sign-off:

- [x] **Manager Notification**: Manager receives `NEW_ORDER` notification upon customer checkout.
- [x] **Admin Fan-Out**: Every active admin receives `NEW_PARTNERSHIP_APPLICATION` notification upon partnership submission.
- [x] **Unread Count**: `GET /notifications/unread-count` increments and decrements correctly.
- [x] **Mark Single Read**: `PATCH /notifications/:id/read` updates `isRead: true` and sets `readAt`.
- [x] **Mark All Read**: `PATCH /notifications/read-all` marks all user notifications read.
- [x] **Deletion**: `DELETE /notifications/:id` removes notification.
- [x] **Security & Ownership**: Users cannot access, modify, or delete another user's notifications.
- [x] **Metadata Pagination**: Response includes `data` and full `pagination` object (`page`, `limit`, `totalItems`, `totalPages`, `hasNext`, `hasPrevious`).
- [x] **Multi-Field Filtering**: `isRead`, `type`, `createdAfter`, `createdBefore` filters work independently and combined.
- [x] **Sorting**: `sortBy` and `order` parameters work as expected.
- [x] **Real-Time Push**: Socket.IO delivers `notification:new` event instantly to online users.
- [x] **Automatic Retention Cleanup**: `NotificationCleanupService` cron job deletes notifications older than `NOTIFICATION_RETENTION_DAYS`.
- [x] **Build Verification**: `npm run build` completes with zero TypeScript or NestJS errors.

---

## 11. Manual Demo Script (For ITI Hackathon Presentation)

Follow this step-by-step presentation script to demonstrate the Notification System live during the ITI Hackathon.

### Phase 1: Real-Time Manager Notification Demo (2 minutes)
1. **Setup**: Open two browser windows side-by-side:
   - Window A: Customer App (`http://localhost:5173`)
   - Window B: Manager Portal (`http://localhost:5173/manager`) logged in as Restaurant Manager.
2. **Action**: In Window A, customer selects menu items from the restaurant and completes checkout.
3. **Show**:
   - Point to Window B: The notification bell badge instantly increments from `0` to `1` via WebSocket push.
   - Open dropdown: Show notification card: *"New Order Received — Order #... Total: 350 EGP"*.

### Phase 2: Admin Partnership Application Demo (1.5 minutes)
1. **Setup**: Open Public Partnership Application Page.
2. **Action**: Submit application for `"Burger Factory"`.
3. **Show**: Log in to Admin Portal. Point out unread badge notification *"New Partnership Application for Burger Factory"*. Highlight that all active admins received this notification automatically.

### Phase 3: Management & Persistence Demo (1.5 minutes)
1. **Action**: Click "Mark as Read" on the manager notification.
2. **Show**: Unread badge decrements immediately to `0`.
3. **Action**: Refresh the page (`F5`).
4. **Show**: Demonstrate that read states and history persist reliably from MongoDB.
