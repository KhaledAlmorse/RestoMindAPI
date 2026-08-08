# RestoMind API - Comprehensive API Structure & Endpoints Guide

This document is the **single source of truth** for the **RestoMindApi** backend. It details every module, controller, endpoint, route, role-based authorization guard, query parameter, DTO validation rule, and JSON response payload.

---

## Table of Contents

1. [Project Overview & Architecture](#1-project-overview--architecture)
2. [Authentication & Authorization Headers](#2-authentication--authorization-headers)
3. [Global Error & Response Formats](#3-global-error--response-formats)
4. [Modules & Endpoints](#4-modules--endpoints)
   - [4.1 Auth Module (`/auth`)](#41-auth-module-auth)
   - [4.2 User Module (`/users`)](#42-user-module-users)
   - [4.3 Restaurant Module (`/restaurants`)](#43-restaurant-module-restaurants)
   - [4.4 Products Module (`/products`)](#44-products-module-products)
   - [4.5 Categories Module (`/categories`)](#45-categories-module-categories)
   - [4.6 Ingredients Module (`/ingredients`)](#46-ingredients-module-ingredients)
   - [4.7 Offers Module (`/offers`)](#47-offers-module-offers)
   - [4.8 Cart Module (`/cart`)](#48-cart-module-cart)
   - [4.9 Orders & Order Groups Module (`/orders`)](#49-orders--order-groups-module-orders)
   - [4.10 Favorites Module (`/favorites`)](#410-favorites-module-favorites)
   - [4.11 Sales Module (`/sales`)](#411-sales-module-sales)
   - [4.12 Dashboard Module (`/dashboard`)](#412-dashboard-module-dashboard)
   - [4.13 Inventory Module (`/inventory`)](#413-inventory-module-inventory)
   - [4.14 Suppliers Module (`/suppliers`)](#414-suppliers-module-suppliers)
   - [4.15 Purchase Orders Module (`/purchase-orders`)](#415-purchase-orders-module-purchase-orders)
   - [4.16 Production Planning Module (`/predictions/production-plan`)](#416-production-planning-module-predictionsproduction-plan)
   - [4.17 Waste Reports Module (`/waste-reports`)](#417-waste-reports-module-waste-reports)
   - [4.18 Weekly Prediction Module (`/predictions`)](#418-weekly-prediction-module-predictions)
   - [4.19 Recommendations Module (`/recommendations`)](#419-recommendations-module-recommendations)
   - [4.20 Partnership Applications Module (`/partnership-applications`)](#420-partnership-applications-module-partnership-applications)
   - [4.21 Imports Module (`/imports`)](#421-imports-module-imports)
   - [4.22 App Root Module (`/`)](#422-app-root-module-)

---

## 1. Project Overview & Architecture

**RestoMindApi** is built with NestJS, MongoDB (Mongoose), TypeScript, and JWT Authentication.

### Roles in the System (`RolesEnum`):

- `admin`: Super administrator with full system permissions across all modules.
- `manager`: Restaurant manager assigned to a specific restaurant. Can manage their restaurant details, staff users, products, recipes, ingredients, offers, inventory, suppliers, purchase orders, and process orders.
- `staff`: Restaurant staff members (managed by managers). Authorized to view profile/restaurant, manage inventory batches/transactions/waste, process purchase orders, view products/ingredients/offers, and process restaurant orders.
- `customer`: End consumer who can view active products/offers, maintain shopping cart, place multi-restaurant order groups, manage personal saved addresses, and save favorites.

---

## 2. Authentication & Authorization Headers

For all protected endpoints:

```text
Authorization: Bearer <JWT_ACCESS_TOKEN>
```

For Refresh Token endpoints (e.g., `POST /auth/generate-access-token`):

```text
Authorization: Bearer <JWT_REFRESH_TOKEN>
```

For Reset Token endpoints (e.g., `PATCH /auth/reset-password`):

```text
Authorization: Bearer <JWT_RESET_TOKEN>
```

---

## 3. Global Error & Response Formats

### Standard Success Response

Most endpoints return objects wrapped in data containers or structured objects:

```json
{
  "data": { ... }
}
```

Or for paginated lists:

```json
{
  "items": [ ... ],
  "data": [ ... ],
  "total": 25,
  "page": 1,
  "limit": 10,
  "totalPages": 3
}
```

### Common Error Responses

- **400 Bad Request**: Input validation failed (class-validator) or invalid MongoDB `ObjectId`.
- **401 Unauthorized**: Missing, expired, or invalid JWT token.
- **403 Forbidden**: User role does not have permission for this route or access across restaurant boundary.
- **404 Not Found**: Resource does not exist or soft-deleted.
- **409 Conflict**: Duplicate key violation (e.g. email, phone, name) or business rule conflict (e.g. `MANAGER_HAS_ACTIVE_RESTAURANT`).

---

## 4. Modules & Endpoints

---

### 4.1 Auth Module (`/auth`)

#### 1. Sign Up

- **Route**: `POST /auth/signUp`
- **Auth Required**: No
- **Allowed Roles**: Public
- **Request Body**:
  ```json
  {
    "firstName": "John",
    "lastName": "Doe",
    "email": "johndoe@example.com",
    "password": "Password123",
    "phone": "+1234567890",
    "role": "customer",
    "gender": "male",
    "DOB": "1995-05-15"
  }
  ```
- **Validation Rules**:
  - `firstName`: string, required, min length 3, max length 20
  - `lastName`: string, required, min length 3, max length 20
  - `email`: valid email string, required
  - `password`: string, required, min length 6
  - `phone`: string, required
  - `role`: optional string enum (`customer`, `manager`, `admin`, `staff`)
  - `gender`: optional string enum (`male`, `female`)
  - `DOB`: optional ISO date string
- **Success Response** (201 Created):
  ```json
  {
    "message": "User registered successfully. Verification code sent to email.",
    "user": {
      "_id": "669fc1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "johndoe@example.com",
      "role": "customer",
      "isEmailVerified": false
    }
  }
  ```
- **Error Responses**:
  - 400 Bad Request: Validation failed
  - 409 Conflict: Email or phone already registered

---

#### 2. Login

- **Route**: `POST /auth/login`
- **Auth Required**: No
- **Allowed Roles**: Public
- **Request Body**:
  ```json
  {
    "email": "johndoe@example.com",
    "password": "Password123"
  }
  ```
- **Validation Rules**:
  - `email`: valid email string, required
  - `password`: string, required, min length 6
- **Success Response** (200 OK):
  ```json
  {
    "accessToken": "eyJhbGciOiJIUzI1Ni...",
    "refreshToken": "eyJhbGciOiJIUzI1Ni...",
    "user": {
      "_id": "669fc1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "johndoe@example.com",
      "role": "customer"
    }
  }
  ```
- **Error Responses**:
  - 400 Bad Request: Invalid credentials or unverified email

---

#### 3. Get Authenticated User Profile (`me`)

- **Route**: `GET /auth/me`
- **Auth Required**: Yes (Access Token)
- **Allowed Roles**: `admin`, `customer`, `manager`, `staff`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc1234567890abcdef123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "johndoe@example.com",
      "phone": "+1234567890",
      "role": "customer",
      "addresses": []
    }
  }
  ```

---

#### 4. Confirm Email Verification OTP

- **Route**: `PATCH /auth/confirm-email`
- **Auth Required**: No
- **Allowed Roles**: Public
- **Request Body**:
  ```json
  {
    "email": "johndoe@example.com",
    "otp": "123456"
  }
  ```
- **Validation Rules**:
  - `email`: valid email string, required
  - `otp`: string, required
- **Success Response** (200 OK):
  ```json
  {
    "message": "Email confirmed successfully"
  }
  ```

---

#### 5. Logout

- **Route**: `POST /auth/logout`
- **Auth Required**: Yes (Access Token in Authorization Header)
- **Allowed Roles**: `admin`, `customer`, `manager`, `staff`
- **Request Body** (Optional):
  ```json
  {
    "refreshToken": "eyJhbGciOiJIUzI1Ni..."
  }
  ```
- **Behavior**: Revokes the Access Token presented in header, revokes the passed Refresh Token (if provided), and updates `tokensRevokedAt` on the user record so that all active tokens for this user are invalidated.
- **Success Response** (200 OK):
  ```json
  {
    "message": "Logout successfully"
  }
  ```

---

#### 6. Send OTP

- **Route**: `POST /auth/send-otp`
- **Auth Required**: No
- **Allowed Roles**: Public
- **Request Body**:
  ```json
  {
    "email": "johndoe@example.com",
    "type": "confirmEmail"
  }
  ```
- **Validation Rules**:
  - `email`: valid email string, required
  - `type`: enum required (`confirmEmail`, `resetPassword`)
- **Success Response** (200 OK):
  ```json
  {
    "message": "OTP sent successfully"
  }
  ```

---

#### 7. Forgot Password

- **Route**: `POST /auth/forgot-password`
- **Auth Required**: No
- **Allowed Roles**: Public
- **Request Body**:
  ```json
  {
    "email": "johndoe@example.com"
  }
  ```
- **Validation Rules**:
  - `email`: valid email string, required
- **Success Response** (200 OK):
  ```json
  {
    "message": "Password reset OTP sent to email"
  }
  ```

---

#### 8. Generate Access Token (Refresh Token Rotation)

- **Route**: `POST /auth/generate-access-token`
- **Auth Required**: Yes (Refresh Token in Authorization Header)
- **Allowed Roles**: `admin`, `customer`, `manager`, `staff`
- **Behavior**: Validates the current Refresh Token, revokes it (Rotation), and returns a brand new Access Token + Refresh Token pair. Reusing a revoked Refresh Token returns 401 Unauthorized.
- **Success Response** (200 OK):
  ```json
  {
    "accessToken": "eyJhbGciOiJIUzI1Ni...",
    "refreshToken": "eyJhbGciOiJIUzI1Ni..."
  }
  ```

---

#### 9. Confirm Reset Password OTP

- **Route**: `PATCH /auth/confirm-reset-otp`
- **Auth Required**: No
- **Allowed Roles**: Public
- **Request Body**:
  ```json
  {
    "email": "johndoe@example.com",
    "otp": "654321"
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "resetToken": "eyJhbGciOiJIUzI1Ni..."
  }
  ```

---

#### 10. Reset Password

- **Route**: `PATCH /auth/reset-password`
- **Auth Required**: Headers Authorization with Reset Token
- **Allowed Roles**: Public (Token validated via Header)
- **Request Body**:
  ```json
  {
    "password": "NewPassword123",
    "confirmPassword": "NewPassword123"
  }
  ```
- **Validation Rules**:
  - `password`: string, required, min length 6
  - `confirmPassword`: string, required, min length 6
- **Success Response** (200 OK):
  ```json
  {
    "message": "Password reset successfully"
  }
  ```

---

#### 11. Update Current Profile (`update-me`)

- **Route**: `PATCH /auth/update-me`
- **Auth Required**: Yes (Access Token)
- **Allowed Roles**: `admin`, `customer`, `manager`, `staff`
- **Content-Type**: `multipart/form-data` or `application/json`
- **Request Body**:
  ```json
  {
    "firstName": "Johnathan",
    "lastName": "Doe",
    "phone": "+1987654321",
    "gender": "male",
    "DOB": "1995-05-15"
  }
  ```
- **File Upload**: Optional file field `image` (avatar image upload).
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc1234567890abcdef123",
      "firstName": "Johnathan",
      "lastName": "Doe"
    }
  }
  ```

---

#### 12. Add Delivery Address

- **Route**: `POST /auth/addresses`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `customer`
- **Request Body**:
  ```json
  {
    "label": "Home",
    "phoneNumber": "+1234567890",
    "street": "123 Main St",
    "city": "Metropolis",
    "country": "USA",
    "isDefault": true
  }
  ```
- **Success Response** (201 Created):
  ```json
  {
    "data": [
      {
        "_id": "669fc9999999999abcdef111",
        "label": "Home",
        "street": "123 Main St",
        "city": "Metropolis",
        "country": "USA",
        "phoneNumber": "+1234567890",
        "isDefault": true
      }
    ]
  }
  ```

---

#### 13. Get Saved Addresses

- **Route**: `GET /auth/addresses`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `customer`
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ]
  }
  ```

---

#### 14. Update Delivery Address

- **Route**: `PATCH /auth/addresses/:addressId`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `customer`
- **Path Parameters**: `addressId`
- **Request Body**:
  ```json
  {
    "street": "456 Oak Ave",
    "city": "Metropolis"
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ]
  }
  ```

---

#### 15. Delete Delivery Address

- **Route**: `DELETE /auth/addresses/:addressId`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `customer`
- **Path Parameters**: `addressId`
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ]
  }
  ```

---

#### 16. Set Default Delivery Address

- **Route**: `PATCH /auth/addresses/:addressId/default`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `customer`
- **Path Parameters**: `addressId`
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ]
  }
  ```

---

### 4.2 User Module (`/users`)

#### 1. Create User

- **Route**: `POST /users`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Request Body**:
  ```json
  {
    "firstName": "Staff",
    "lastName": "Member",
    "email": "staff@restaurant.com",
    "password": "Password123",
    "phone": "+1122334455",
    "role": "staff",
    "restaurantId": "669fc8888888888abcdef222"
  }
  ```
- **Validation Rules**:
  - `firstName`, `lastName`, `email`, `password`, `phone`: required
  - `role`: optional enum (`customer`, `manager`, `admin`, `staff`)
  - `restaurantId`: optional Mongo ObjectId string
  - Managers can only create `staff` role assigned to their own restaurant.
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc7777777777abcdef333",
      "firstName": "Staff",
      "lastName": "Member",
      "email": "staff@restaurant.com",
      "role": "staff"
    }
  }
  ```

---

#### 2. Get All Users (Paginated & Filtered)

- **Route**: `GET /users`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Query Parameters**:
  - `page`: string (default `1`)
  - `limit`: string (default `10`)
  - `search`: string (matches firstName, lastName, email, phone)
  - `role`: string enum (`customer`, `manager`, `admin`, `staff`)
  - `restaurantId`: Mongo ObjectId string
  - `isDeleted`: boolean string (`true`, `false`)
  - `sort` / `sortBy`: string (default `createdAt`)
  - `order` / `sortOrder`: string (`asc`, `desc`, default `desc`)
  - `createdAt`: ISO date string
  - `updatedAt`: ISO date string
- **Example**: `GET /users?page=1&limit=10&role=manager`
- **Success Response** (200 OK):
  ```json
  {
    "data": [
      {
        "_id": "669fc7777777777abcdef333",
        "firstName": "Staff",
        "lastName": "Member",
        "email": "staff@restaurant.com",
        "role": "staff"
      }
    ],
    "totalItems": 1,
    "totalPages": 1,
    "currentPage": 1,
    "pageSize": 10,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
  ```

---

#### 3. Get User By Id

- **Route**: `GET /users/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc7777777777abcdef333",
      "firstName": "Staff",
      "lastName": "Member",
      "email": "staff@restaurant.com",
      "role": "staff"
    }
  }
  ```

---

#### 4. Update User

- **Route**: `PATCH /users/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "firstName": "UpdatedName",
    "phone": "+1999888777"
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc7777777777abcdef333",
      "firstName": "UpdatedName"
    }
  }
  ```

---

#### 5. Update User Status

- **Route**: `PATCH /users/:id/status`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "isActive": true
  }
  ```
- **Validation Rules**:
  - `isActive`: boolean, required
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc7777777777abcdef333",
      "isActive": true
    }
  }
  ```

---

#### 6. Resend User Setup Email

- **Route**: `POST /users/:id/resend-setup-email`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "message": "Account setup email resent successfully"
  }
  ```

---

#### 7. Trigger User Password Reset

- **Route**: `POST /users/:id/reset-password`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "message": "Password reset instructions sent successfully"
  }
  ```

---

#### 8. Delete User (Soft Delete)

- **Route**: `DELETE /users/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Path Parameters**: `id`
- **Business Rule & Check**:
  - If the target user is a manager currently assigned as owner of an active restaurant, returns **HTTP 409 Conflict** with error code `MANAGER_HAS_ACTIVE_RESTAURANT`.
- **Success Response** (200 OK):
  ```json
  {
    "message": "User deleted successfully"
  }
  ```
- **Error Response** (409 Conflict):
  ```json
  {
    "statusCode": 409,
    "message": "Unable to delete this manager because they are currently assigned as the owner of an active restaurant. Please delete the restaurant or transfer its ownership before deleting this manager.",
    "code": "MANAGER_HAS_ACTIVE_RESTAURANT"
  }
  ```

---

### 4.3 Restaurant Module (`/restaurants`)

#### 1. Create Restaurant

- **Route**: `POST /restaurants`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Content-Type**: `multipart/form-data`
- **Request Body**:
  ```json
  {
    "name": "Pizza Gourmet",
    "ownerUserId": "669fc5555555555abcdef111",
    "description": "Authentic Italian Pizza",
    "phone": "+1555444333",
    "address": {
      "street": "100 Broadway",
      "city": "New York",
      "country": "USA"
    }
  }
  ```
- **File Upload**: Optional file field `image`.
- **Validation Rules**:
  - `name`: string, required
  - `ownerUserId`: Mongo ObjectId string, required (user must have role `manager`)
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc8888888888abcdef222",
      "name": "Pizza Gourmet",
      "ownerUserId": "669fc5555555555abcdef111",
      "isActive": true,
      "isDeleted": false
    }
  }
  ```

---

#### 2. Get All Restaurants (Paginated & Filtered)

- **Route**: `GET /restaurants`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Query Parameters**:
  - `page`: string (default `1`)
  - `limit`: string (default `10`)
  - `search`: string (matches restaurant name)
  - `status`: string
  - `ownerUserId`: Mongo ObjectId string (validated)
  - `isActive`: boolean string (`true`, `false`)
  - `isDeleted`: boolean string (`true`, `false`, default `false`)
  - `sort`: string (default `createdAt`)
  - `order`: string (`asc`, `desc`, default `desc`)
- **Examples**:
  - `GET /restaurants?page=1&limit=10`
  - `GET /restaurants?page=1&limit=10&search=pizza`
  - `GET /restaurants?page=1&limit=10&isActive=true`
  - `GET /restaurants?page=1&limit=10&ownerUserId=669fc5555555555abcdef111`
- **Success Response** (200 OK):
  ```json
  {
    "items": [
      {
        "_id": "669fc8888888888abcdef222",
        "name": "Pizza Gourmet",
        "ownerUserId": {
          "_id": "669fc5555555555abcdef111",
          "firstName": "Manager",
          "lastName": "Owner"
        },
        "isActive": true
      }
    ],
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
  ```

---

#### 3. Get Authenticated User's Restaurant (`me`)

- **Route**: `GET /restaurants/me`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc8888888888abcdef222",
      "name": "Pizza Gourmet",
      "ownerUserId": { ... }
    }
  }
  ```

---

#### 4. Get Restaurant By Id

- **Route**: `GET /restaurants/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc8888888888abcdef222",
      "name": "Pizza Gourmet"
    }
  }
  ```

---

#### 5. Update Restaurant

- **Route**: `PATCH /restaurants/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Content-Type**: `multipart/form-data` or `application/json`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "name": "Pizza Gourmet Express",
    "description": "Updated description",
    "isActive": true
  }
  ```
- **File Upload**: Optional file field `image`.
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc8888888888abcdef222",
      "name": "Pizza Gourmet Express"
    }
  }
  ```

---

#### 6. Delete Restaurant (Soft Delete)

- **Route**: `DELETE /restaurants/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Business Behavior**:
  - Soft-deletes restaurant (`isDeleted: true`, `deletedAt: new Date()`).
  - Sets `restaurant.ownerUserId = null`.
  - Sets `manager.restaurantId = null`.
  - Soft-deletes all offers belonging to this restaurant.
- **Success Response** (200 OK):
  ```json
  {
    "message": "Restaurant deleted successfully"
  }
  ```

---

### 4.4 Products Module (`/products`)

#### 1. Create Product

- **Route**: `POST /products`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Content-Type**: `multipart/form-data`
- **Request Body**:
  ```json
  {
    "title": "Margherita Pizza",
    "description": "Classic tomato and mozzarella",
    "price": 12.99,
    "category": "669fc4444444444abcdef333",
    "restaurantId": "669fc8888888888abcdef222"
  }
  ```
- **File Upload**: Required file field `image`.
- **Validation Rules**:
  - `title`: string, required
  - `description`: string, required
  - `price`: number string, required, min 0
  - `category`: Mongo ObjectId string, required
  - `restaurantId`: optional Mongo ObjectId string (required for admin, inferred for manager)
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc3333333333abcdef444",
      "title": "Margherita Pizza",
      "price": 12.99,
      "slug": "pizza-gourmet-margherita-pizza",
      "isAvailable": true
    }
  }
  ```

---

#### 2. Update Product

- **Route**: `PATCH /products/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Path Parameters**: `id`
- **Content-Type**: `multipart/form-data` or `application/json`
- **File Upload**: Optional file field `image`.
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc3333333333abcdef444",
      "title": "Margherita Pizza Updated"
    }
  }
  ```

---

#### 3. Delete Product (Soft Delete)

- **Route**: `DELETE /products/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "message": "Product deleted successfully"
  }
  ```

---

#### 4. Change Product Availability

- **Route**: `PATCH /products/:id/availability`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "isAvailable": false
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc3333333333abcdef444",
      "isAvailable": false
    }
  }
  ```

---

#### 5. Get All Products (Paginated & Filtered)

- **Route**: `GET /products`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**:
  - `page`: string (default `1`)
  - `limit`: string (default `10`)
  - `search`: string (matches title & description)
  - `categoryId`: Mongo ObjectId string
  - `restaurantId`: Mongo ObjectId string
  - `isAvailable`: boolean string (`true`, `false`)
  - `isDeleted`: boolean string (`true`, `false`, default `false`)
  - `minPrice`: string number
  - `maxPrice`: string number
  - `sortBy`: string (default `createdAt`)
  - `sortOrder`: string (`asc`, `desc`, default `desc`)
- **Example**: `GET /products?page=1&limit=10&categoryId=669fc4444444444abcdef333`
- **Success Response** (200 OK):
  ```json
  {
    "items": [ ... ],
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
  ```

---

#### 6. Get Product By Id or Slug

- **Route**: `GET /products/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Path Parameters**: `id` (can be Mongo ObjectId or product slug)
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc3333333333abcdef444",
      "title": "Margherita Pizza",
      "slug": "pizza-gourmet-margherita-pizza"
    }
  }
  ```

---

#### 7. Upsert Product Recipe

- **Route**: `PUT /products/:productId/recipe`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `productId`
- **Request Body**:
  ```json
  {
    "ingredients": [
      {
        "ingredientId": "669fc2222222222abcdef555",
        "quantity": 150
      }
    ]
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc1111111111abcdef666",
      "productId": "669fc3333333333abcdef444",
      "ingredients": [ ... ]
    }
  }
  ```

---

#### 8. Get Product Recipe

- **Route**: `GET /products/:productId/recipe`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Path Parameters**: `productId`
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

### 4.5 Categories Module (`/categories`)

#### 1. Create Category

- **Route**: `POST /categories`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Content-Type**: `multipart/form-data`
- **Request Body**:
  ```json
  {
    "name": "Pizzas",
    "description": "Delicious stone-baked pizzas"
  }
  ```
- **File Upload**: Required file field `image`.
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc4444444444abcdef333",
      "name": "Pizzas",
      "image": {
        "public_id": "categories/...",
        "secure_url": "https://res.cloudinary.com/..."
      }
    }
  }
  ```

---

#### 2. Update Category

- **Route**: `PATCH /categories/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Content-Type**: `multipart/form-data` or `application/json`
- **File Upload**: Optional file field `image`.
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc4444444444abcdef333",
      "name": "Pizzas Updated"
    }
  }
  ```

---

#### 3. Delete Category

- **Route**: `DELETE /categories/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Business Behavior**: Products under this category are automatically reassigned to the default category before soft-deleting the category.
- **Success Response** (200 OK):
  ```json
  {
    "message": "Category deleted successfully"
  }
  ```

---

#### 4. Get All Categories (Paginated & Searchable)

- **Route**: `GET /categories`
- **Auth Required**: No (Public)
- **Allowed Roles**: Public
- **Query Parameters**:
  - `page`: string (optional)
  - `limit`: string (optional)
  - `search`: string (matches category name)
  - `isDeleted`: boolean string (`true`, `false`, default `false`)
- **Examples**:
  - `GET /categories`
  - `GET /categories?page=1&limit=10&search=pizza`
- **Success Response** (200 OK):
  ```json
  {
    "data": [
      {
        "_id": "669fc4444444444abcdef333",
        "name": "Pizzas"
      }
    ],
    "items": [ ... ],
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
  ```

---

#### 5. Get Category By Id

- **Route**: `GET /categories/:id`
- **Auth Required**: No (Public)
- **Allowed Roles**: Public
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc4444444444abcdef333",
      "name": "Pizzas"
    }
  }
  ```

---

### 4.6 Ingredients Module (`/ingredients`)

#### 1. Create Ingredient

- **Route**: `POST /ingredients`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Request Body**:
  ```json
  {
    "name": "Mozzarella Cheese",
    "quantity": 5000,
    "unit": "grams",
    "minStockAlert": 1000
  }
  ```
- **Validation Rules**:
  - `name`: string, required
  - `quantity`: number, required, min 0
  - `unit`: string, required
  - `minStockAlert`: optional number
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc2222222222abcdef555",
      "name": "Mozzarella Cheese",
      "quantity": 5000,
      "unit": "grams"
    }
  }
  ```

---

#### 2. Get All Ingredients (Paginated & Filtered)

- **Route**: `GET /ingredients`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**:
  - `page`: string (default `1`)
  - `limit`: string (default `10`)
  - `search`: string (matches ingredient name)
  - `minQuantity`: string number
  - `maxQuantity`: string number
  - `unit`: string
  - `sortBy`: string (default `createdAt`)
  - `sortOrder`: string (`asc`, `desc`, default `desc`)
  - `isDeleted`: boolean string (`true`, `false`, default `false`)
- **Success Response** (200 OK):
  ```json
  {
    "items": [ ... ],
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
  ```

---

#### 3. Get Ingredient By Id

- **Route**: `GET /ingredients/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 4. Update Ingredient

- **Route**: `PATCH /ingredients/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "quantity": 8000
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 5. Delete Ingredient (Soft Delete)

- **Route**: `DELETE /ingredients/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "message": "Ingredient deleted successfully"
  }
  ```

---

### 4.7 Offers Module (`/offers`)

#### 1. Create Offer

- **Route**: `POST /offers`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Request Body**:
  ```json
  {
    "productId": "669fc3333333333abcdef444",
    "discountPercentage": 20,
    "startDate": "2026-07-24",
    "endDate": "2026-08-01",
    "availableQuantity": 50,
    "maxPerCustomer": 2,
    "featured": true,
    "status": "active"
  }
  ```
- **Validation Rules**:
  - `productId`: Mongo ObjectId string, required
  - `discountPercentage`: number, required, min 1, max 100
  - `startDate`: valid date string, required
  - `endDate`: valid date string, required
  - `availableQuantity`: number, required, min 1
  - `maxPerCustomer`: optional number, min 1
  - `featured`: optional boolean
  - `status`: optional enum (`draft`, `scheduled`, `active`, `expired`, `sold_out`, `cancelled`). If omitted, auto-computed.
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc0000000000abcdef777",
      "productId": "669fc3333333333abcdef444",
      "originalPrice": 12.99,
      "offerPrice": 10.39,
      "status": "active"
    }
  }
  ```

---

#### 2. Get Active Offers (Customer Public List)

- **Route**: `GET /offers/active`
- **Auth Required**: No (Public)
- **Allowed Roles**: Public
- **Query Parameters**:
  - `productId`: Mongo ObjectId string
  - `restaurantId`: Mongo ObjectId string
  - `source`: enum (`manual`, `recommendation`)
  - `categoryId`: Mongo ObjectId string
  - `search`: string (matches product title/description)
  - `featured`: boolean string (`true`, `false`)
  - `minPrice`: string number
  - `maxPrice`: string number
  - `startDate`: date string
  - `endDate`: date string
  - `sortBy`: string (default `createdAt`)
  - `sortOrder`: string (`asc`, `desc`, default `desc`)
  - `page`: string (default `1`)
  - `limit`: string (default `10`)
- **Example**: `GET /offers/active?page=1&limit=10`
- **Success Response** (200 OK):
  ```json
  {
    "items": [
      {
        "_id": "669fc0000000000abcdef777",
        "offerPrice": 10.39,
        "discountPercentage": 20,
        "productId": { ... },
        "restaurantId": { ... }
      }
    ],
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
  ```

---

#### 3. Get Active Offer By Id or Product Slug

- **Route**: `GET /offers/active/:id`
- **Auth Required**: No (Public)
- **Allowed Roles**: Public
- **Path Parameters**: `id` (Mongo ObjectId or Product slug)
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 4. Get Recommended Offers

- **Route**: `GET /offers/recommendations`
- **Auth Required**: No (Public)
- **Allowed Roles**: Public
- **Query Parameters**: `categoryId`, `restaurantId`, `search`, `minPrice`, `maxPrice`, `page`, `limit`
- **Success Response** (200 OK):
  ```json
  {
    "items": [ ... ],
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
  ```

---

#### 5. Get Offers Listing (Management)

- **Route**: `GET /offers`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**: Same as `QueryOfferDto` (`status`, `productId`, `source`, `categoryId`, `restaurantId`, `search`, `featured`, `minPrice`, `maxPrice`, `startDate`, `endDate`, `sortBy`, `sortOrder`, `page`, `limit`)
- **Success Response** (200 OK):
  ```json
  {
    "items": [ ... ],
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
  ```

---

#### 6. Get Offer By Id

- **Route**: `GET /offers/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 7. Update Offer

- **Route**: `PATCH /offers/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "discountPercentage": 25,
    "endDate": "2026-08-05"
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 8. Cancel Offer

- **Route**: `PATCH /offers/:id/cancel`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc0000000000abcdef777",
      "status": "cancelled"
    }
  }
  ```

---

### 4.8 Cart Module (`/cart`)

#### 1. Get User Cart

- **Route**: `GET /cart`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc111222333abcdef888",
      "userId": "669fc1234567890abcdef123",
      "items": [
        {
          "offer": {
            "_id": "669fc0000000000abcdef777",
            "offerPrice": 10.39,
            "originalPrice": 12.99
          },
          "quantity": 2,
          "totalItemPrice": 20.78
        }
      ],
      "totalQuantity": 2,
      "totalOriginalPrice": 25.98,
      "totalDiscount": 5.2,
      "finalTotalPrice": 20.78
    }
  }
  ```

---

#### 2. Add Item to Cart

- **Route**: `POST /cart`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Request Body**:
  ```json
  {
    "offerId": "669fc0000000000abcdef777",
    "quantity": 2
  }
  ```
- **Validation Rules**:
  - `offerId`: Mongo ObjectId string, required
  - `quantity`: number, required, min 1
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 3. Update Cart Item Quantity

- **Route**: `PATCH /cart/:offerId`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Path Parameters**: `offerId`
- **Request Body**:
  ```json
  {
    "quantity": 3
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 4. Remove Item from Cart

- **Route**: `DELETE /cart/:offerId`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Path Parameters**: `offerId`
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 5. Clear Entire Cart

- **Route**: `DELETE /cart`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Success Response** (200 OK):
  ```json
  {
    "message": "Cart cleared successfully"
  }
  ```

---

### 4.9 Orders & Order Groups Module (`/orders`)

#### 1. Create Order (Checkout Cart)

- **Route**: `POST /orders`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Request Body**:
  ```json
  {
    "fullName": "John Doe",
    "phoneNumber": "+1234567890",
    "emailAddress": "johndoe@example.com",
    "deliveryMethod": "Home Delivery",
    "deliveryAddress": {
      "street": "123 Main St",
      "city": "Metropolis",
      "country": "USA"
    },
    "specialNotes": "Ring doorbell"
  }
  ```
- **Validation Rules**:
  - `fullName`, `phoneNumber`, `emailAddress`: required strings
  - `deliveryMethod`: enum required (`Home Delivery`, `Store Pickup`)
  - `deliveryAddress`: object required when deliveryMethod is `Home Delivery`
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "orderGroupId": "669fc999888777abcdef999",
      "overallStatus": "Pending",
      "orders": [ ... ]
    }
  }
  ```

---

#### 2. Get Order Group By Id

- **Route**: `GET /orders/group/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`, `admin`
- **Path Parameters**: `id` (Order Group ObjectId)
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc999888777abcdef999",
      "userId": "669fc1234567890abcdef123",
      "overallStatus": "Pending",
      "totalOriginalPrice": 25.98,
      "totalDiscount": 5.20,
      "finalTotalPrice": 20.78,
      "childOrders": [ ... ]
    }
  }
  ```

---

#### 3. Cancel Order Group

- **Route**: `PATCH /orders/group/:id/cancel`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Path Parameters**: `id` (Order Group ObjectId)
- **Security Check**: Customer can only cancel their own order group if it is still in `Pending` state.
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "orderGroupId": "669fc999888777abcdef999",
      "overallStatus": "Cancelled"
    }
  }
  ```

---

#### 4. Get Child Order By Id

- **Route**: `GET /orders/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`, `manager`, `admin`, `staff`
- **Path Parameters**: `id` (Child Order ObjectId)
- **Security Check**: Customers can only view their own orders; Managers and Staff can only view orders assigned to their restaurant.
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc999888777abcdef999",
      "groupOrderId": "669fc888777666abcdef888",
      "restaurant": {
        "_id": "669fc8888888888abcdef222",
        "name": "Pizza Gourmet Express"
      },
      "items": [ ... ],
      "finalTotalPrice": 20.78,
      "status": "Pending"
    }
  }
  ```

---

#### 5. Update Child Order Status

- **Route**: `PATCH /orders/:id/status`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Path Parameters**: `id` (Child Order ObjectId)
- **Security Check**: Managers and Staff can only update status of orders belonging to their own restaurant.
- **Request Body**:
  ```json
  {
    "status": "Preparing"
  }
  ```
- **Validation Rules**:
  - `status`: enum string required (`OrderStatusEnum`: `Pending`, `Confirmed`, `Preparing`, `Ready`, `Out For Delivery`, `Delivered`, `Cancelled`)
- **Side Effects**:
  - `Delivered`: Idempotently creates `SalesTransaction` records for each order line item (`source: marketplace_order`).
  - `Cancelled`: Restores offer remaining quantity and reactivates offer if previously `sold_out`.
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc999888777abcdef999",
      "status": "Preparing"
    }
  }
  ```

---

#### 6. Get All Orders (Role-Aware Listing)

- **Route**: `GET /orders`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`, `manager`, `admin`, `staff`
- **Behavior by Role**:
  - `customer`: Automatically scoped to current customer's orders (`userId`).
  - `manager` / `staff`: Automatically scoped to current user's restaurant (`restaurantId`).
  - `admin`: Can view all orders or filter by any `restaurantId`.
- **Query Parameters**:
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
  - `search`: string (matches `fullName`, `emailAddress`, `phoneNumber`, `groupOrderId`, or order `_id`)
  - `status`: enum string (`Pending`, `Confirmed`, `Preparing`, `Ready`, `Out For Delivery`, `Delivered`, `Cancelled`)
  - `paymentMethod`: string (`Cash on Delivery`)
  - `deliveryMethod`: string (`Home Delivery`, `Store Pickup`)
  - `startDate`: ISO date string (filters `createdAt >= startDate 00:00:00.000Z`)
  - `endDate`: ISO date string (filters `createdAt <= endDate 23:59:59.999Z`)
  - `minTotalPrice`: number (filters `finalTotalPrice >= minTotalPrice`)
  - `maxTotalPrice`: number (filters `finalTotalPrice <= maxTotalPrice`)
  - `restaurantId`: Mongo ObjectId string (filter by restaurant for Admin)
  - `sortBy` / `sort`: string (`createdAt`, `updatedAt`, `finalTotalPrice`, `totalQuantity`, `status`; default `createdAt`)
  - `sortOrder` / `order`: string (`asc`, `desc`; default `desc`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [
      {
        "_id": "669fc999888777abcdef999",
        "groupOrderId": "669fc888777666abcdef888",
        "userId": "669fc1234567890abcdef123",
        "restaurant": {
          "_id": "669fc8888888888abcdef222",
          "name": "Pizza Gourmet Express"
        },
        "items": [ ... ],
        "totalOriginalPrice": 25.98,
        "totalDiscount": 5.20,
        "finalTotalPrice": 20.78,
        "totalQuantity": 2,
        "fullName": "John Doe",
        "phoneNumber": "+1234567890",
        "emailAddress": "johndoe@example.com",
        "deliveryMethod": "Home Delivery",
        "paymentMethod": "Cash on Delivery",
        "status": "Pending",
        "createdAt": "2026-07-23T20:00:00.000Z",
        "updatedAt": "2026-07-23T20:00:00.000Z"
      }
    ],
    "totalItems": 1,
    "totalPages": 1,
    "currentPage": 1,
    "pageSize": 10,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
  ```

---

### 4.10 Favorites Module (`/favorites`)

#### 1. Add Favorite Offer

- **Route**: `POST /favorites/:offerId`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Path Parameters**: `offerId` (Mongo ObjectId string)
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc777666555abcdef111",
      "userId": "669fc1234567890abcdef123",
      "offerId": "669fc0000000000abcdef777"
    }
  }
  ```

---

#### 2. Remove Favorite Offer

- **Route**: `DELETE /favorites/:offerId`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Path Parameters**: `offerId` (Mongo ObjectId string)
- **Success Response** (200 OK):
  ```json
  {
    "message": "Favorite removed successfully"
  }
  ```

---

#### 3. Get User Favorites

- **Route**: `GET /favorites`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Success Response** (200 OK):
  ```json
  {
    "data": [
      {
        "_id": "669fc777666555abcdef111",
        "offer": {
          "_id": "669fc0000000000abcdef777",
          "offerPrice": 10.39,
          "originalPrice": 12.99,
          "product": {
            "title": "Margherita Pizza"
          }
        }
      }
    ]
  }
  ```

---

#### 4. Check Favorite Status

- **Route**: `GET /favorites/:offerId/status`
- **Auth Required**: Yes
- **Allowed Roles**: `customer`
- **Path Parameters**: `offerId` (Mongo ObjectId string)
- **Success Response** (200 OK):
  ```json
  {
    "isFavorite": true
  }
  ```

---

### 4.11 Sales Module (`/sales`)

#### 1. Get Sales Transactions (Paginated & Filtered)

- **Route**: `GET /sales`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Security Check**: Managers are automatically scoped to their own assigned `restaurantId`.
- **Query Parameters**:
  - `restaurantId`: Mongo ObjectId string (Admin only; Managers restricted to their own)
  - `productId`: Mongo ObjectId string
  - `startDate`: ISO date string (filters `date >= startDate 00:00:00.000Z`)
  - `endDate`: ISO date string (filters `date <= endDate 23:59:59.999Z`)
  - `source`: enum string (`csv_import`, `marketplace_order`, `pos_sync`)
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
  - `sort`: string (default `date`)
  - `order`: string (`asc`, `desc`; default `desc`)
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "items": [
        {
          "_id": "669fd1111111111abcdef000",
          "restaurantId": {
            "_id": "669fc8888888888abcdef222",
            "name": "Pizza Gourmet Express"
          },
          "productId": {
            "_id": "669fc3333333333abcdef444",
            "title": "Margherita Pizza",
            "price": 12.99,
            "discountedPrice": 10.39
          },
          "date": "2026-07-23T20:00:00.000Z",
          "quantitySold": 2,
          "basePrice": 12.99,
          "sellingPrice": 10.39,
          "promotionActive": true,
          "featured": true,
          "salesChannel": "marketplace",
          "source": "marketplace_order",
          "orderId": "669fc999888777abcdef999"
        }
      ],
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
  ```

---

#### 2. Get Sales Summary Statistics

- **Route**: `GET /sales/summary`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`
- **Security Check**: Managers are automatically scoped to their own assigned `restaurantId`.
- **Query Parameters**:
  - `restaurantId`: Mongo ObjectId string (Admin only)
  - `productId`: Mongo ObjectId string
  - `startDate`: ISO date string (full day bounds)
  - `endDate`: ISO date string (full day bounds)
  - `source`: enum string (`csv_import`, `marketplace_order`, `pos_sync`)
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "totalTransactions": 15,
      "totalQuantitySold": 42,
      "totalGrossRevenue": 545.58,
      "totalNetRevenue": 436.38,
      "totalDiscountsGiven": 109.2,
      "promotionalSalesCount": 42,
      "featuredSalesCount": 42,
      "averageSellingPrice": 10.39
    }
  }
  ```

---

### 4.12 Dashboard Module (`/dashboard`)

#### 1. Get Admin Dashboard

- **Route**: `GET /dashboard/admin`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Query Parameters**:
  - `startDate`: ISO date string (optional)
  - `endDate`: ISO date string (optional)
- **Success Response** (200 OK):
  ```json
  {
    "kpis": {
      "revenue": {
        "current": 436.38,
        "previous": 350.0,
        "changePercent": 24.68
      },
      "orders": {
        "current": 15,
        "previous": 12,
        "changePercent": 25.0
      },
      "activeOffers": 8,
      "pendingOrders": 2,
      "activeRestaurants": 5,
      "netProfit": 375.29,
      "taxDeduction": 61.09,
      "avgOrderValue": 29.09,
      "totalUsers": 120,
      "totalRestaurants": 6
    },
    "topProducts": [
      {
        "id": "669fc3333333333abcdef444",
        "rank": 1,
        "name": "Margherita Pizza",
        "count": 42,
        "maxCount": 42
      }
    ],
    "topCategories": [
      {
        "id": "669fc4444444444abcdef333",
        "rank": 1,
        "name": "Pizza",
        "count": 65,
        "maxCount": 65
      }
    ],
    "topRestaurants": [
      {
        "id": "669fc8888888888abcdef222",
        "rank": 1,
        "name": "Pizza Gourmet Express",
        "count": 28,
        "maxCount": 28
      }
    ],
    "fulfillmentMethods": [
      {
        "id": "home_delivery",
        "type": "Home Delivery",
        "name": "Home Delivery",
        "count": 12,
        "percentage": 80
      },
      {
        "id": "store_pickup",
        "type": "Store Pickup",
        "name": "Store Pickup",
        "count": 3,
        "percentage": 20
      }
    ]
  }
  ```

---

#### 2. Get Manager Dashboard

- **Route**: `GET /dashboard/manager`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Security Check**: Scoped strictly to the manager's assigned restaurant (`restaurantId`). System-wide metrics (`activeRestaurants`, `totalUsers`, `totalRestaurants`, `topRestaurants`) are completely excluded.
- **Query Parameters**:
  - `startDate`: ISO date string (optional)
  - `endDate`: ISO date string (optional)
- **Success Response** (200 OK):
  ```json
  {
    "restaurantName": "Pizza Gourmet Express",
    "kpis": {
      "revenue": {
        "current": 250.0,
        "previous": 200.0,
        "changePercent": 25.0
      },
      "orders": {
        "current": 8,
        "previous": 6,
        "changePercent": 33.33
      },
      "activeOffers": 3,
      "pendingOrders": 1,
      "netProfit": 215.0,
      "taxDeduction": 35.0,
      "avgOrderValue": 31.25
    },
    "topProducts": [
      {
        "id": "669fc3333333333abcdef444",
        "rank": 1,
        "name": "Margherita Pizza",
        "count": 20,
        "maxCount": 20
      }
    ],
    "topCategories": [
      {
        "id": "669fc4444444444abcdef333",
        "rank": 1,
        "name": "Pizza",
        "count": 30,
        "maxCount": 30
      }
    ],
    "fulfillmentMethods": [
      {
        "id": "home_delivery",
        "type": "Home Delivery",
        "name": "Home Delivery",
        "count": 6,
        "percentage": 75
      },
      {
        "id": "store_pickup",
        "type": "Store Pickup",
        "name": "Store Pickup",
        "count": 2,
        "percentage": 25
      }
    ]
  }
  ```

---

### 4.13 Inventory Module (`/inventory`)

#### 1. Create Batch (Single or Bulk)

- **Route**: `POST /inventory/batches`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Request Body**: Accepts single `CreateBatchDto`, array of `CreateBatchDto`, or `CreateBatchesDto` object `{ "batches": [...] }`.
  ```json
  {
    "ingredientId": "669fc2222222222abcdef555",
    "batchNumber": "BATCH-2026-001",
    "quantityRemaining": 5000,
    "unitCost": 2.5,
    "expiryDate": "2026-12-31T00:00:00.000Z",
    "receivedDate": "2026-08-01T00:00:00.000Z"
  }
  ```
- **Validation Rules**:
  - `ingredientId`: Mongo ObjectId string, required
  - `batchNumber`: string, required
  - `quantityRemaining`: number, required, min 0
  - `unitCost`: number, required, min 0
  - `expiryDate`: ISO date string, required
  - `receivedDate`: ISO date string, optional
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc555444333abcdef111",
      "restaurantId": "669fc8888888888abcdef222",
      "ingredientId": "669fc2222222222abcdef555",
      "batchNumber": "BATCH-2026-001",
      "quantityRemaining": 5000,
      "unitCost": 2.5
    }
  }
  ```

---

#### 2. Get Batches (Paginated & Filtered)

- **Route**: `GET /inventory/batches`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**:
  - `ingredientId`: Mongo ObjectId string
  - `isExpired`: boolean string (`true`, `false`)
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ],
    "total": 10,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
  ```

---

#### 3. Create Stock Transaction

- **Route**: `POST /inventory/transactions`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Request Body**:
  ```json
  {
    "ingredientId": "669fc2222222222abcdef555",
    "type": "in",
    "quantity": 1000,
    "unitCost": 2.5,
    "reason": "Restock shipment",
    "batchId": "669fc555444333abcdef111"
  }
  ```
- **Validation Rules**:
  - `ingredientId`: Mongo ObjectId string, required
  - `type`: enum required (`in`, `out`, `adjustment`, `waste`)
  - `quantity`: number, required, min 0.001
  - `unitCost`: number, optional
  - `reason`: string, optional
  - `batchId`: Mongo ObjectId string, optional
- **Success Response** (201 Created):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 4. Get Stock Transactions

- **Route**: `GET /inventory/transactions`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**:
  - `ingredientId`: Mongo ObjectId string
  - `type`: enum string (`in`, `out`, `adjustment`, `waste`)
  - `startDate`: ISO date string
  - `endDate`: ISO date string
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ],
    "total": 5,
    "page": 1,
    "limit": 10
  }
  ```

---

#### 5. Create Waste Event

- **Route**: `POST /inventory/waste-events`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Request Body**:
  ```json
  {
    "ingredientId": "669fc2222222222abcdef555",
    "quantity": 250,
    "reason": "spoiled",
    "batchId": "669fc555444333abcdef111",
    "notes": "Expired due to refrigeration fault"
  }
  ```
- **Validation Rules**:
  - `ingredientId`: Mongo ObjectId string, required
  - `quantity`: number, required, min 0.001
  - `reason`: enum required (`expired`, `spoiled`, `damaged`, `prep_waste`, `other`)
  - `batchId`: Mongo ObjectId string, optional
  - `notes`: string, optional
- **Success Response** (201 Created):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 6. Get Waste Events

- **Route**: `GET /inventory/waste-events`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**:
  - `ingredientId`: Mongo ObjectId string
  - `reason`: enum string (`expired`, `spoiled`, `damaged`, `prep_waste`, `other`)
  - `startDate`: ISO date string
  - `endDate`: ISO date string
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ],
    "total": 3
  }
  ```

---

### 4.14 Suppliers Module (`/suppliers`)

#### 1. Create Supplier

- **Route**: `POST /suppliers`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Request Body**:
  ```json
  {
    "name": "Fresh Dairy Co.",
    "contactPerson": "Alice Smith",
    "email": "alice@freshdairy.com",
    "phone": "+18885551234",
    "leadTimeDays": 2,
    "paymentTerms": "Net 30"
  }
  ```
- **Validation Rules**:
  - `name`: string, required
  - `contactPerson`, `email`, `phone`, `paymentTerms`: optional strings
  - `leadTimeDays`: number, optional, min 0
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc666555444abcdef222",
      "restaurantId": "669fc8888888888abcdef222",
      "name": "Fresh Dairy Co.",
      "leadTimeDays": 2
    }
  }
  ```

---

#### 2. Get Suppliers

- **Route**: `GET /suppliers`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**:
  - `search`: string (matches supplier name or contact person)
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ],
    "total": 5
  }
  ```

---

### 4.15 Purchase Orders Module (`/purchase-orders`)

#### 1. Create Purchase Order

- **Route**: `POST /purchase-orders`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Request Body**:
  ```json
  {
    "supplierId": "669fc666555444abcdef222",
    "items": [
      {
        "ingredientId": "669fc2222222222abcdef555",
        "quantityOrdered": 50,
        "unitCost": 3.0
      }
    ],
    "notes": "Urgent delivery required"
  }
  ```
- **Validation Rules**:
  - `supplierId`: Mongo ObjectId string, required
  - `items`: array required (min 1 item, each containing `ingredientId`, `quantityOrdered`, `unitCost`)
  - `notes`: optional string
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc777666555abcdef333",
      "poNumber": "PO-2026-0001",
      "status": "draft",
      "totalCost": 150.0
    }
  }
  ```

---

#### 2. Get Purchase Orders

- **Route**: `GET /purchase-orders`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**:
  - `supplierId`: Mongo ObjectId string
  - `status`: enum string (`draft`, `ordered`, `received`, `cancelled`)
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ],
    "total": 4
  }
  ```

---

#### 3. Receive Purchase Order

- **Route**: `PATCH /purchase-orders/:id/receive`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Path Parameters**: `id` (PO Mongo ObjectId)
- **Side Effects**: Automatically updates inventory stock levels and creates inventory batches/stock transactions for received items.
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc777666555abcdef333",
      "status": "received",
      "receivedDate": "2026-08-02T14:00:00.000Z"
    }
  }
  ```

---

#### 4. Update Purchase Order Status

- **Route**: `PATCH /purchase-orders/:id/status`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "status": "ordered"
  }
  ```
- **Validation Rules**:
  - `status`: enum string required (`draft`, `ordered`, `received`, `cancelled`)
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc777666555abcdef333",
      "status": "ordered"
    }
  }
  ```

---

### 4.16 Production Planning Module (`/predictions/production-plan`)

#### 1. Get Daily Production Plan

- **Route**: `GET /predictions/production-plan`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Query Parameters**:
  - `date`: ISO date string (YYYY-MM-DD, e.g. `2026-08-02`)
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "date": "2026-08-02",
      "restaurantId": "669fc8888888888abcdef222",
      "items": [
        {
          "productId": "669fc3333333333abcdef444",
          "productName": "Margherita Pizza",
          "predictedDemand": 45,
          "plannedProduction": 48,
          "bufferPercentage": 6.67
        }
      ]
    }
  }
  ```

---

#### 2. Record Actual Production / Sales

- **Route**: `POST /predictions/production-plan/actuals`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`, `manager`, `staff`
- **Request Body**:
  ```json
  {
    "date": "2026-08-02",
    "actuals": [
      {
        "productId": "669fc3333333333abcdef444",
        "actualQuantity": 42
      }
    ]
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "message": "Actuals recorded successfully"
  }
  ```

---

### 4.17 Waste Reports Module (`/waste-reports`)

#### 1. Get Waste Reports List

- **Route**: `GET /waste-reports`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Query Parameters**:
  - `startDate`: ISO date string
  - `endDate`: ISO date string
  - `reason`: enum string (`expired`, `spoiled`, `damaged`, `prep_waste`, `other`)
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ],
    "total": 8
  }
  ```

---

#### 2. Get Waste Reports Summary

- **Route**: `GET /waste-reports/summary`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "totalWasteEvents": 12,
      "totalWasteCost": 345.5,
      "byReason": {
        "expired": 150.0,
        "spoiled": 120.0,
        "prep_waste": 75.5
      }
    }
  }
  ```

---

### 4.18 Weekly Prediction Module (`/predictions`)

#### 1. Recalculate Single Product Prediction

- **Route**: `POST /predictions/recalculate`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Request Body**:
  ```json
  {
    "productId": "669fc3333333333abcdef444",
    "targetWeek": "2026-W32"
  }
  ```
- **Validation Rules**:
  - `productId`: Mongo ObjectId string, required
  - `targetWeek`: ISO week string (e.g. `2026-W32`), required
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "productId": "669fc3333333333abcdef444",
      "targetWeek": "2026-W32",
      "predictedDemand": 280,
      "confidenceScore": 0.92
    }
  }
  ```

---

#### 2. Batch Recalculate Predictions

- **Route**: `POST /predictions/batch-recalculate`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Request Body**:
  ```json
  {
    "targetWeek": "2026-W32"
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "message": "Batch predictions recalculated successfully",
    "processedCount": 24
  }
  ```

---

#### 3. Get Predictions Listing

- **Route**: `GET /predictions`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Query Parameters**:
  - `targetWeek`: ISO week string
  - `productId`: Mongo ObjectId string
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ]
  }
  ```

---

#### 4. Get AI Learned Status

- **Route**: `GET /predictions/learned-status`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Success Response** (200 OK):
  ```json
  {
    "isTrained": true,
    "lastTrainedAt": "2026-08-01T12:00:00.000Z",
    "totalHistoricalDays": 90,
    "modelAccuracy": 0.89
  }
  ```

---

#### 5. Get Prediction Accuracy Metrics

- **Route**: `GET /predictions/accuracy`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Query Parameters**:
  - `weeks`: string number (range 1-52, default `8`)
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "windowWeeks": 8,
      "overallAccuracy": 91.5,
      "mape": 8.5,
      "weeklyTrends": [ ... ]
    }
  }
  ```

---

#### 6. Trigger AI Backfill

- **Route**: `POST /predictions/ai-backfill`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Request Body**:
  ```json
  {
    "days": 60
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "backfilledDays": 60,
      "status": "completed"
    }
  }
  ```

---

### 4.19 Recommendations Module (`/recommendations`)

#### 1. Get Active AI Recommendations

- **Route**: `GET /recommendations`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Query Parameters**:
  - `status`: enum string (`pending`, `approved`, `edited`, `dismissed`)
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [
      {
        "_id": "669fc888777666abcdef444",
        "type": "surplus_discount",
        "ingredientId": "669fc2222222222abcdef555",
        "productId": "669fc3333333333abcdef444",
        "suggestedDiscount": 25,
        "suggestedQuantity": 30,
        "status": "pending"
      }
    ]
  }
  ```

---

#### 2. Scan Surplus Inventory

- **Route**: `POST /recommendations/scan-surplus`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Success Response** (200 OK):
  ```json
  {
    "message": "Surplus scan complete",
    "newRecommendationsGenerated": 3
  }
  ```

---

#### 3. Approve Recommendation

- **Route**: `PATCH /recommendations/:id/approve`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `id` (Recommendation ObjectId)
- **Request Body**:
  ```json
  {
    "autoPublishOffer": true
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc888777666abcdef444",
      "status": "approved",
      "createdOfferId": "669fc0000000000abcdef777"
    }
  }
  ```

---

#### 4. Edit Recommendation

- **Route**: `PATCH /recommendations/:id/edit`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "discountPercentage": 30,
    "quantity": 25
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc888777666abcdef444",
      "status": "edited"
    }
  }
  ```

---

#### 5. Dismiss Recommendation

- **Route**: `PATCH /recommendations/:id/dismiss`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc888777666abcdef444",
      "status": "dismissed"
    }
  }
  ```

---

#### 6. Validate Production Plan (`/predictions/validate-plan`)

- **Route**: `POST /predictions/validate-plan`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`
- **Request Body**:
  ```json
  {
    "date": "2026-08-03",
    "productionPlan": [
      {
        "productId": "669fc3333333333abcdef444",
        "quantity": 50
      }
    ]
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "isValid": true,
    "stockDeficits": [],
    "warnings": []
  }
  ```

---

### 4.20 Partnership Applications Module (`/partnership-applications`)

#### 1. Submit Partnership Application (Public)

- **Route**: `POST /partnership-applications`
- **Auth Required**: No (Public)
- **Allowed Roles**: Public
- **Request Body**:
  ```json
  {
    "restaurantName": "Luigi's Bistro",
    "ownerFirstName": "Luigi",
    "ownerLastName": "Mario",
    "email": "luigi@bistro.com",
    "phone": "+15559998888",
    "commercialRegister": "CR-99887766",
    "taxNumber": "TAX-11223344",
    "address": {
      "street": "777 Mushroom Way",
      "city": "Metropolis",
      "country": "USA"
    }
  }
  ```
- **Validation Rules**:
  - `restaurantName`, `ownerFirstName`, `ownerLastName`, `email`, `phone`: required strings
  - `commercialRegister`, `taxNumber`: optional strings
- **Success Response** (201 Created):
  ```json
  {
    "message": "Partnership application submitted successfully",
    "applicationId": "669fc999000111abcdef555"
  }
  ```

---

#### 2. Check Application Status (Public)

- **Route**: `GET /partnership-applications/status/:id`
- **Auth Required**: No (Public)
- **Allowed Roles**: Public
- **Path Parameters**: `id` (Application ObjectId)
- **Query Parameters**:
  - `email`: string, required
- **Success Response** (200 OK):
  ```json
  {
    "status": "under_review",
    "submittedAt": "2026-08-01T10:00:00.000Z"
  }
  ```

---

#### 3. Setup Approved Partner Account (`/auth/setup-account`)

- **Route**: `POST /auth/setup-account`
- **Auth Required**: No (Public with Token)
- **Allowed Roles**: Public
- **Request Body**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1Ni...",
    "password": "SecurePassword123"
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "message": "Account setup successfully. You can now log in as manager."
  }
  ```

---

#### 4. Get All Applications (Admin)

- **Route**: `GET /admin/partnership-applications`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Query Parameters**:
  - `status`: enum string (`pending`, `under_review`, `approved`, `rejected`)
  - `search`: string
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ],
    "total": 5
  }
  ```

---

#### 5. Get Application By Id (Admin)

- **Route**: `GET /admin/partnership-applications/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": { ... }
  }
  ```

---

#### 6. Mark Application Under Review (Admin)

- **Route**: `PATCH /admin/partnership-applications/:id/review`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc999000111abcdef555",
      "status": "under_review"
    }
  }
  ```

---

#### 7. Reject Application (Admin)

- **Route**: `POST /admin/partnership-applications/:id/reject`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "rejectionReason": "Incomplete commercial documentation"
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc999000111abcdef555",
      "status": "rejected"
    }
  }
  ```

---

#### 8. Approve Application (Admin)

- **Route**: `POST /admin/partnership-applications/:id/approve`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Side Effects**: Automatically creates Manager User profile and Restaurant document in system, sends setup email with registration token.
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc999000111abcdef555",
      "status": "approved",
      "createdRestaurantId": "669fc8888888888abcdef222"
    }
  }
  ```

---

#### 9. Resend Approval Email (Admin)

- **Route**: `POST /admin/partnership-applications/:id/resend-approval-email`
- **Auth Required**: Yes
- **Allowed Roles**: `admin`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "message": "Approval setup email resent successfully"
  }
  ```

---

### 4.21 Imports Module (`/imports`)

#### 1. Upload File for Import

- **Route**: `POST /imports`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`, `admin`
- **Content-Type**: `multipart/form-data`
- **Request Body**:
  ```text
  file: <binary .csv or .xlsx file>
  type: "sales_history"
  ```
- **Validation Rules**:
  - `file`: required upload field (Multer file)
  - `type`: enum required (`sales_history`, `inventory_initial`, `products_catalog`)
- **Success Response** (201 Created):
  ```json
  {
    "data": {
      "_id": "669fc111222333abcdef999",
      "filename": "sales_july_2026.csv",
      "detectedColumns": ["Date", "Item Name", "Qty", "Price"],
      "status": "uploaded"
    }
  }
  ```

---

#### 2. Preview Import Column Mapping

- **Route**: `POST /imports/:id/preview`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`, `admin`
- **Path Parameters**: `id` (Import Job ObjectId)
- **Request Body**:
  ```json
  {
    "columnMapping": {
      "Date": "date",
      "Item Name": "productName",
      "Qty": "quantity",
      "Price": "unitPrice"
    }
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "validRows": 150,
      "invalidRows": 2,
      "previewRows": [ ... ]
    }
  }
  ```

---

#### 3. Confirm & Process Import Job

- **Route**: `POST /imports/:id/confirm`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`, `admin`
- **Path Parameters**: `id`
- **Request Body**:
  ```json
  {
    "columnMapping": {
      "Date": "date",
      "Item Name": "productName",
      "Qty": "quantity",
      "Price": "unitPrice"
    }
  }
  ```
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc111222333abcdef999",
      "status": "completed",
      "importedRecordsCount": 150
    }
  }
  ```

---

#### 4. Get Import Jobs Listing

- **Route**: `GET /imports`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`, `admin`
- **Query Parameters**:
  - `status`: enum string (`uploaded`, `previewed`, `processing`, `completed`, `failed`)
  - `page`: number (default `1`)
  - `limit`: number (default `10`)
- **Success Response** (200 OK):
  ```json
  {
    "data": [ ... ],
    "total": 5
  }
  ```

---

#### 5. Get Import Job By Id

- **Route**: `GET /imports/:id`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`, `admin`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "data": {
      "_id": "669fc111222333abcdef999",
      "filename": "sales_july_2026.csv",
      "status": "completed",
      "importedRecordsCount": 150
    }
  }
  ```

---

#### 6. Retry AI Ingestion for Import Job

- **Route**: `POST /imports/:id/retry-ai-ingest`
- **Auth Required**: Yes
- **Allowed Roles**: `manager`, `admin`
- **Path Parameters**: `id`
- **Success Response** (200 OK):
  ```json
  {
    "message": "AI Ingest retry initiated successfully"
  }
  ```

---

### 4.22 App Root Module (`/`)

#### 1. Health / Root Hello

- **Route**: `GET /`
- **Auth Required**: No (Public)
- **Allowed Roles**: Public
- **Success Response** (200 OK): `"Hello World!"`
