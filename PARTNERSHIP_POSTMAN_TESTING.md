# RestoMind — Partnership & Restaurant Onboarding Postman Testing Guide

This document is an exhaustive, step-by-step Postman testing guide for the **Partnership & Restaurant Onboarding** feature in RestoMind API. It reflects the exact, production-verified backend implementation (`c33db95..5607529`).

---

## Environment & Prerequisites

### Postman Environment Variables
Set up a Postman Environment containing the following variables:

| Variable Name | Description / Example Value |
|---|---|
| `baseUrl` | `http://localhost:3000` (or `http://127.0.0.1:3000`) |
| `adminAccessToken` | Access JWT for an Admin user (`role: "admin"`) |
| `managerAccessToken` | Access JWT for a Restaurant Manager (`role: "manager"`) |
| `customerAccessToken` | Access JWT for a Customer (`role: "customer"`) |
| `applicationId` | Stored `_id` of the created `PartnershipApplication` |
| `submittedEmail` | Stored email used in testing (e.g., `bistro.owner@example.com`) |
| `setupToken` | Extracted `setup` token from email or application response |
| `createdUserId` | Stored `_id` of created manager user |
| `createdRestaurantId` | Stored `_id` of created restaurant |

---

## Endpoints Deep-Dive & Testing Reference

---

### 1. Submit Partnership Application

Public endpoint for prospective restaurant owners to submit a business partnership application.

- **HTTP Method**: `POST`
- **URL**: `{{baseUrl}}/partnership-applications`
- **Authentication**: **Public** (No Auth required)
- **Headers**:
  ```http
  Content-Type: application/json
  ```

#### Request Body Schema
| Field Name | Type | Required? | Constraints / Notes |
|---|---|---|---|
| `businessName` | String | **Yes** | Cannot be empty |
| `businessType` | String | **Yes** | Must be one of: `restaurant`, `bakery`, `cafe`, `catering`, `supermarket` |
| `ownerFirstName` | String | **Yes** | Cannot be empty |
| `ownerLastName` | String | **Yes** | Cannot be empty |
| `email` | String | **Yes** | Valid email format |
| `phone` | String | **Yes** | Cannot be empty |
| `city` | String | **Yes** | Cannot be empty |
| `district` | String | No | Optional address district |
| `street` | String | No | Optional street address |
| `description` | String | No | Optional business description |
| `estimatedOrdersPerDay` | Number | No | Integer $\ge 0$ |
| `estimatedWasteKgPerDay` | Number | No | Integer $\ge 0$ |
| `website` | String | No | Optional website URL |
| `facebookPage` | String | No | Optional social link |
| `instagramPage` | String | No | Optional social link |
| `operatingHours` | Object | No | Optional operating hours JSON |
| `commercialRegistration` | String | No | Commercial registration number |
| `taxId` | String | No | Tax identification number |
| `notes` | String | No | Additional notes |

#### Example Request
```json
{
  "businessName": "El-Zeytouna Bistro",
  "businessType": "restaurant",
  "ownerFirstName": "Tarek",
  "ownerLastName": "El-Sayed",
  "email": "tarek.bistro@example.com",
  "phone": "+201012345678",
  "city": "Cairo",
  "district": "Maadi",
  "street": "Road 9",
  "description": "Authentic Mediterranean & Egyptian Grill",
  "estimatedOrdersPerDay": 150,
  "estimatedWasteKgPerDay": 12,
  "commercialRegistration": "CR-99887766",
  "taxId": "TAX-11223344"
}
```

#### Expected Success Response
- **Status Code**: `201 Created`
- **Body**:
```json
{
  "message": "Partnership application submitted successfully.",
  "application": {
    "businessName": "El-Zeytouna Bistro",
    "businessType": "restaurant",
    "ownerFirstName": "Tarek",
    "ownerLastName": "El-Sayed",
    "email": "tarek.bistro@example.com",
    "phone": "+201012345678",
    "city": "Cairo",
    "district": "Maadi",
    "street": "Road 9",
    "description": "Authentic Mediterranean & Egyptian Grill",
    "estimatedOrdersPerDay": 150,
    "estimatedWasteKgPerDay": 12,
    "commercialRegistration": "CR-99887766",
    "taxId": "TAX-11223344",
    "status": "PENDING",
    "isDeleted": false,
    "_id": "66abb1234f5e6d7c8b9a0123",
    "createdAt": "2026-08-01T13:30:00.000Z",
    "updatedAt": "2026-08-01T13:30:00.000Z",
    "__v": 0
  }
}
```

#### Database Verification (MongoDB)
Query `partnershipapplications` collection:
```javascript
db.partnershipapplications.findOne({ email: "tarek.bistro@example.com" })
```
- `status`: `"PENDING"`
- `email`: Normalized to lowercase (`"tarek.bistro@example.com"`)
- `userId`: `null` (not created yet)
- `restaurantId`: `null` (not created yet)
- `isDeleted`: `false`

#### Negative Test Cases
1. **Missing Required Fields** (`400 Bad Request`):
   - Omit `businessName` or `email` -> Returns `class-validator` error message array.
2. **Invalid `businessType` Enum** (`400 Bad Request`):
   - Body: `"businessType": "gym"` -> Rejects with enum error (`businessType must be one of the following values: restaurant, bakery, cafe, catering, supermarket`).
3. **Invalid Email Format** (`400 Bad Request`):
   - Body: `"email": "not-an-email"` -> Rejects with `email must be an email`.
4. **Duplicate Pending Application** (`409 Conflict`):
   - Submit a second application with `tarek.bistro@example.com` while the first is `PENDING` or `UNDER_REVIEW` -> Rejects with `You already have a pending or under-review partnership application.`.

---

### 2. Check Application Status (Public)

Public endpoint allowing applicants to track their application status using their Mongo ID and email address.

- **HTTP Method**: `GET`
- **URL**: `{{baseUrl}}/partnership-applications/status/:id?email={{submittedEmail}}`
- **Authentication**: **Public**
- **Path Parameters**:
  - `id`: The Mongo ObjectId of the application (`66abb1234f5e6d7c8b9a0123`).
- **Query Parameters**:
  - `email`: Applicant's email address (`tarek.bistro@example.com`).

#### Example Request
```http
GET {{baseUrl}}/partnership-applications/status/66abb1234f5e6d7c8b9a0123?email=tarek.bistro@example.com
```

#### Expected Success Response
- **Status Code**: `200 OK`
- **Body**:
```json
{
  "id": "66abb1234f5e6d7c8b9a0123",
  "businessName": "El-Zeytouna Bistro",
  "status": "PENDING",
  "createdAt": "2026-08-01T13:30:00.000Z"
}
```

#### Negative Test Cases
1. **Invalid ObjectId Format** (`400 Bad Request`):
   - `GET /status/123-invalid-id?email=tarek.bistro@example.com` -> Returns `Invalid ObjectId: 123-invalid-id`.
2. **Missing Email Query Parameter** (`400 Bad Request`):
   - `GET /status/66abb1234f5e6d7c8b9a0123` -> Returns `email must be an email`.
3. **Mismatched Email Factor** (`404 Not Found`):
   - `GET /status/66abb1234f5e6d7c8b9a0123?email=hacker@example.com` -> Returns `Application not found` (Prevents application ID enumeration).
4. **Non-Existent ID** (`404 Not Found`):
   - `GET /status/507f1f77bcf86cd799439011?email=tarek.bistro@example.com` -> Returns `Application not found`.

---

### 3. List All Partnership Applications (Admin)

Admin endpoint to list, paginate, and filter submitted applications.

- **HTTP Method**: `GET`
- **URL**: `{{baseUrl}}/admin/partnership-applications?page=1&limit=10&status=PENDING`
- **Authentication**: **Admin JWT** (`@Auth('admin')`)
- **Headers**:
  ```http
  Authorization: Bearer {{adminAccessToken}}
  ```
- **Query Parameters**:
  - `page` (optional, default `1`): Page number (min 1).
  - `limit` (optional, default `10`, max `100`): Results per page.
  - `status` (optional): Filter by `PENDING`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, or `ONBOARDED`.

#### Example Request
```http
GET {{baseUrl}}/admin/partnership-applications?page=1&limit=10&status=PENDING
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Expected Success Response
- **Status Code**: `200 OK`
- **Body**:
```json
{
  "items": [
    {
      "_id": "66abb1234f5e6d7c8b9a0123",
      "businessName": "El-Zeytouna Bistro",
      "businessType": "restaurant",
      "ownerFirstName": "Tarek",
      "ownerLastName": "El-Sayed",
      "email": "tarek.bistro@example.com",
      "phone": "+201012345678",
      "city": "Cairo",
      "status": "PENDING",
      "createdAt": "2026-08-01T13:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 1,
  "totalPages": 1
}
```

#### Negative Test Cases
1. **Missing Bearer Token** (`401 Unauthorized`):
   - Request without `Authorization` header -> `No token provided, please Login`.
2. **Forbidden Access** (`403 Forbidden`):
   - Send `Authorization: Bearer {{managerAccessToken}}` or `{{customerAccessToken}}` -> Returns `Forbidden resource` / `Role unauthorized`.
3. **Invalid Status Filter** (`400 Bad Request`):
   - `?status=INVALID_STATUS` -> Returns enum validation error.

---

### 4. Get Partnership Application Details (Admin)

Admin endpoint to fetch complete details of a specific application.

- **HTTP Method**: `GET`
- **URL**: `{{baseUrl}}/admin/partnership-applications/:id`
- **Authentication**: **Admin JWT** (`@Auth('admin')`)
- **Headers**:
  ```http
  Authorization: Bearer {{adminAccessToken}}
  ```
- **Path Parameters**:
  - `id`: Mongo ObjectId of the application.

#### Expected Success Response
- **Status Code**: `200 OK`
- **Body**: Returns complete `PartnershipApplication` document with populated refs (`reviewedBy`, `approvedBy`, `userId`, `restaurantId`).

#### Negative Test Cases
1. **Non-Admin Access** (`403 Forbidden`).
2. **Invalid ID** (`400 Bad Request`).
3. **Application Not Found** (`404 Not Found`).

---

### 5. Mark Application Under Review (Admin)

Admin endpoint to transition an application from `PENDING` to `UNDER_REVIEW`.

- **HTTP Method**: `PATCH`
- **URL**: `{{baseUrl}}/admin/partnership-applications/:id/review`
- **Authentication**: **Admin JWT** (`@Auth('admin')`)
- **Headers**:
  ```http
  Authorization: Bearer {{adminAccessToken}}
  ```
- **Path Parameters**:
  - `id`: Mongo ObjectId of the application.

#### Expected Success Response
- **Status Code**: `200 OK`
- **Body**:
```json
{
  "_id": "66abb1234f5e6d7c8b9a0123",
  "businessName": "El-Zeytouna Bistro",
  "status": "UNDER_REVIEW",
  "reviewedBy": "66a001122334455667788990",
  "updatedAt": "2026-08-01T13:35:00.000Z"
}
```

#### Database Verification (MongoDB)
- `partnershipapplications.status`: Updated to `"UNDER_REVIEW"`.
- `partnershipapplications.reviewedBy`: Set to Admin's `User._id`.

#### Negative Test Cases
1. **Idempotency**: Calling `PATCH .../review` when status is already `UNDER_REVIEW` returns `200 OK` without error.
2. **Terminal State Lock Guard** (`409 Conflict`):
   - Attempting to mark `UNDER_REVIEW` on an application whose status is already `REJECTED`, `APPROVED`, or `ONBOARDED` -> Rejects with `Cannot transition application from current status "<status>" to UNDER_REVIEW.`.

---

### 6. Reject Partnership Application (Admin)

Admin endpoint to reject an application, requiring a rejection reason.

- **HTTP Method**: `POST`
- **URL**: `{{baseUrl}}/admin/partnership-applications/:id/reject`
- **Authentication**: **Admin JWT** (`@Auth('admin')`)
- **Headers**:
  ```http
  Authorization: Bearer {{adminAccessToken}}
  Content-Type: application/json
  ```
- **Path Parameters**:
  - `id`: Mongo ObjectId of the application.

#### Request Body
```json
{
  "reason": "Incomplete tax documentation and unverified commercial registration number."
}
```

#### Expected Success Response
- **Status Code**: `201 Created`
- **Body**:
```json
{
  "_id": "66abb1234f5e6d7c8b9a0123",
  "businessName": "El-Zeytouna Bistro",
  "status": "REJECTED",
  "rejectionReason": "Incomplete tax documentation and unverified commercial registration number.",
  "reviewedBy": "66a001122334455667788990",
  "updatedAt": "2026-08-01T13:40:00.000Z"
}
```

#### Database & Side Effects Verification
- **MongoDB**: `status` -> `"REJECTED"`, `rejectionReason` stored.
- **Email**: Rejection email dispatched asynchronously to `tarek.bistro@example.com`.

#### Negative Test Cases
1. **Missing Rejection Reason** (`400 Bad Request`):
   - Body: `{}` -> Returns `reason must be a string`, `reason should not be empty`.
2. **Terminal State Guard** (`409 Conflict`):
   - Rejecting an application already in `REJECTED`, `APPROVED`, or `ONBOARDED` status -> `Application is in status "<status>" and cannot be rejected.`.

---

### 7. Approve Partnership Application (Admin)

Admin endpoint executing an **atomic Mongoose transaction** to provision a `User` (Manager) account and `Restaurant` entity.

- **HTTP Method**: `POST`
- **URL**: `{{baseUrl}}/admin/partnership-applications/:id/approve`
- **Authentication**: **Admin JWT** (`@Auth('admin')`)
- **Headers**:
  ```http
  Authorization: Bearer {{adminAccessToken}}
  ```
- **Path Parameters**:
  - `id`: Mongo ObjectId of the application.

#### Expected Success Response
- **Status Code**: `201 Created`
- **Body**:
```json
{
  "message": "Application approved successfully.",
  "userId": "66b112233445566778899001",
  "restaurantId": "66c223344556677889900112",
  "status": "APPROVED"
}
```

#### Database & Side Effects Verification (CRITICAL)
1. **`users` Collection**:
   - `_id`: Matches `userId` (`66b112233445566778899001`).
   - `role`: `"manager"`.
   - `email`: `"tarek.bistro@example.com"`.
   - `firstName`: `"Tarek"`, `lastName`: `"El-Sayed"`.
   - `restaurantId`: Matches `restaurantId` (`66c223344556677889900112`).
   - `password`: Contains hashed random placeholder bytes (user cannot log in until setup token is completed).
2. **`restaurants` Collection**:
   - `_id`: Matches `restaurantId` (`66c223344556677889900112`).
   - `name`: `"El-Zeytouna Bistro"`.
   - `ownerUserId`: Matches `userId` (`66b112233445566778899001`).
   - `address`: `{ city: "Cairo", district: "Maadi", street: "Road 9" }`.
   - `isActive`: `true`.
3. **`partnershipapplications` Collection**:
   - `status`: `"APPROVED"`.
   - `userId`: `ObjectId("66b112233445566778899001")`.
   - `restaurantId`: `ObjectId("66c223344556677889900112")`.
   - `approvedBy`: Admin `User._id`.
   - `approvedAt`: ISO Timestamp.
4. **Email / Token**:
   - Non-blocking activation email sent to `tarek.bistro@example.com` containing setup link: `https://restomind.com/setup-account?token=<setup_jwt>`.

#### Negative Test Cases
1. **Invalid Initial State** (`409 Conflict`):
   - Approving an application whose status is `REJECTED`, `APPROVED`, or `ONBOARDED` -> `Application in status "<status>" cannot be approved.`.
2. **Duplicate User Email Guard** (`409 Conflict`):
   - Approving an application when a user with email `tarek.bistro@example.com` already exists in `users` collection -> `A user account with email "tarek.bistro@example.com" already exists. Manual resolution required.`. Transaction rolls back cleanly.

---

### 8. Resend Approval Setup Email (Admin)

Admin endpoint to regenerate and resend the 72-hour setup token email for approved applications.

- **HTTP Method**: `POST`
- **URL**: `{{baseUrl}}/admin/partnership-applications/:id/resend-approval-email`
- **Authentication**: **Admin JWT** (`@Auth('admin')`)
- **Headers**:
  ```http
  Authorization: Bearer {{adminAccessToken}}
  ```

#### Expected Success Response
- **Status Code**: `201 Created`
- **Body**:
```json
{
  "message": "Approval setup email resent successfully."
}
```

#### Negative Test Cases
1. **Application Not Approved** (`400 Bad Request`):
   - Resending email on `PENDING`, `UNDER_REVIEW`, `REJECTED`, or `ONBOARDED` application -> `Can only resend setup email for approved applications awaiting setup completion.`.

---

### 9. Complete Account Setup (Public Owner Setup)

Public endpoint invoked when the restaurant owner clicks their email setup link to set their password.

- **HTTP Method**: `POST`
- **URL**: `{{baseUrl}}/auth/setup-account`
- **Authentication**: **Public** (Guarded by setup token in body)
- **Headers**:
  ```http
  Content-Type: application/json
  ```

#### Request Body
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "password": "NewManagerPassword123!"
}
```

#### Expected Success Response
- **Status Code**: `201 Created`
- **Body**:
```json
{
  "message": "Account password setup completed successfully. You can now log in."
}
```

#### Database Verification (MongoDB)
1. **`users` Collection**:
   - `password`: Updated to `bcrypt` hash of `"NewManagerPassword123!"`.
   - `passwordChangedAt`: Set to current Date.
2. **`partnershipapplications` Collection**:
   - `status`: Transitioned from `"APPROVED"` to `"ONBOARDED"`.

#### Negative Test Cases
1. **Expired / Invalid Token** (`401 Unauthorized`):
   - Invalid JWT string -> `Invalid or expired setup token.`.
2. **Wrong Token Type** (`401 Unauthorized`):
   - Passing standard user `access` or `refresh` token instead of `setup` token -> `Invalid token type for account setup.`.
3. **Password Validation** (`400 Bad Request`):
   - Password shorter than 6 characters -> `password must be longer than or equal to 6 characters`.

---

### 10. Manager Login Verification (Post-Setup)

Verify that the onboarded manager can log in using their credentials.

- **HTTP Method**: `POST`
- **URL**: `{{baseUrl}}/auth/login`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Request Body**:
```json
{
  "email": "tarek.bistro@example.com",
  "password": "NewManagerPassword123!"
}
```

#### Expected Success Response
- **Status Code**: `200 OK`
- **Body**:
```json
{
  "message": "Login successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "_id": "66b112233445566778899001",
      "email": "tarek.bistro@example.com",
      "role": "manager",
      "restaurantId": "66c223344556677889900112"
    }
  }
}
```

---

## Complete Postman Integration Testing Flow

Follow this exact sequence to test the entire lifecycle in Postman:

```
[1. Submit Application] ---> [2. Duplicate Check Guard] ---> [3. Status Check]
                                                                    |
[6. Reject Test Application] <--- [5. Mark Under Review] <---------+
                                        |
[7. Approve Application] <--------------+
         |
         v
[8. Database Verification] ---> [9. Resend Setup Email] ---> [10. Setup Password] ---> [11. Login as Manager]
```

### Execution Steps:
1. **Submit Application #1**:
   - `POST /partnership-applications` with email `reject.test@example.com`.
   - Save `applicationId1`. Status is `PENDING`.
2. **Verify Duplicate Prevention**:
   - `POST /partnership-applications` again with `reject.test@example.com`.
   - Assert `409 Conflict`.
3. **Check Status Publicly**:
   - `GET /partnership-applications/status/{{applicationId1}}?email=reject.test@example.com`.
   - Assert `200 OK`, `status: "PENDING"`.
   - `GET /partnership-applications/status/{{applicationId1}}?email=wrong@email.com`.
   - Assert `404 Not Found`.
4. **Admin Review & Rejection Flow**:
   - `PATCH /admin/partnership-applications/{{applicationId1}}/review` (Admin Token).
   - Assert `status: "UNDER_REVIEW"`.
   - `POST /admin/partnership-applications/{{applicationId1}}/reject` with reason.
   - Assert `status: "REJECTED"`.
   - `PATCH /admin/partnership-applications/{{applicationId1}}/review` again.
   - Assert `409 Conflict` (Terminal state lock).
5. **Submit Application #2 (For Approval Flow)**:
   - `POST /partnership-applications` with `tarek.bistro@example.com`.
   - Save `applicationId2`.
6. **Approve Application**:
   - `POST /admin/partnership-applications/{{applicationId2}}/approve` (Admin Token).
   - Assert `201 Created`, save `userId` and `restaurantId`. Application status is `APPROVED`.
7. **Verify Database Transaction**:
   - Query MongoDB for `user` and `restaurant`. Confirm bi-directional `ownerUserId` and `restaurantId` linking.
8. **Resend Email**:
   - `POST /admin/partnership-applications/{{applicationId2}}/resend-approval-email`.
   - Assert `201 Created`.
9. **Complete Account Setup**:
   - `POST /auth/setup-account` with `token` and `password: "NewManagerPassword123!"`.
   - Assert `201 Created`.
10. **Verify Onboarded Status**:
    - Query MongoDB `partnershipapplications`: status is now `"ONBOARDED"`.
11. **Login as Onboarded Manager**:
    - `POST /auth/login` with `tarek.bistro@example.com` and `"NewManagerPassword123!"`.
    - Assert `200 OK`, receive manager tokens.
12. **Verify Role Authorization Guards**:
    - Attempt `GET /admin/partnership-applications` using the manager access token.
    - Assert `403 Forbidden`.

---

## Testing Checklist Table

| # | Test Scenario / Endpoint | Expected Status | Status | Notes / Verified Behavior |
|---|---|---|---|---|
| 1 | `POST /partnership-applications` (Valid payload) | `201 Created` | [ ] | Status set to `PENDING`, email lowercased |
| 2 | `POST /partnership-applications` (Duplicate email) | `409 Conflict` | [ ] | Blocked while previous application is pending |
| 3 | `POST /partnership-applications` (Invalid enum) | `400 Bad Request` | [ ] | Invalid `businessType` rejected |
| 4 | `GET /partnership-applications/status/:id` (Correct email) | `200 OK` | [ ] | Returns basic status info |
| 5 | `GET /partnership-applications/status/:id` (Wrong email) | `404 Not Found` | [ ] | Security data leak prevention |
| 6 | `GET /admin/partnership-applications` (Admin Auth) | `200 OK` | [ ] | Returns paginated items |
| 7 | `GET /admin/partnership-applications` (Manager Auth) | `403 Forbidden` | [ ] | Role guard enforced |
| 8 | `GET /admin/partnership-applications/:id` | `200 OK` | [ ] | Populates refs |
| 9 | `PATCH /admin/partnership-applications/:id/review` | `200 OK` | [ ] | Transitions to `UNDER_REVIEW` |
| 10 | `POST /admin/partnership-applications/:id/reject` | `201 Created` | [ ] | Stores reason, status `REJECTED` |
| 11 | `PATCH .../review` on `REJECTED` application | `409 Conflict` | [ ] | Terminal state locked |
| 12 | `POST /admin/partnership-applications/:id/approve` | `201 Created` | [ ] | Atomic transaction: User + Restaurant created |
| 13 | `POST .../approve` when user email exists | `409 Conflict` | [ ] | Transaction aborted cleanly |
| 14 | `POST .../resend-approval-email` | `201 Created` | [ ] | Sends fresh 72h setup token email |
| 15 | `POST /auth/setup-account` (Valid setup token) | `201 Created` | [ ] | Hashes password, status -> `ONBOARDED` |
| 16 | `POST /auth/setup-account` (Wrong tokenType) | `401 Unauthorized` | [ ] | Rejects access/refresh tokens |
| 17 | `POST /auth/login` (New manager credentials) | `200 OK` | [ ] | Manager logs in successfully |
