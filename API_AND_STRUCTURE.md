# RestoMind API - Project Structure, API & Postman Guide

This document describes the structure of the **RestoMindApi** project, details every endpoint, and provides exact JSON body payloads and query parameters for testing on Postman.

---

## 1. Project Directory Structure

```text
RestoMindApi/
├── dist/                          # Compiled build output
├── node_modules/                  # Node dependencies
├── src/                           # Application source code
│   ├── main.ts                    # Application entry point (registers pipes, CORS, starts server)
│   ├── app.module.ts              # Root NestJS module
│   ├── app.controller.ts          # Root controller
│   ├── app.service.ts             # Root service
│   ├── global.module.ts           # Declares global providers (DB connection, TokenService)
│   │
│   ├── Common/                    # Shared utilities, decorators, and guards
│   │   ├── Constants/             # Shared constants
│   │   │   └── constants.ts       # File extension lists and Reflector metadata keys
│   │   ├── Decorators/            # Composed decorators
│   │   │   ├── auth-compose.decorator.ts  # Dynamic @Auth() decorator (supports roles and tokenType)
│   │   │   ├── roles.decorator.ts          # @Roles() decorator
│   │   │   └── index.ts
│   │   ├── Guards/                # Route authorization guards
│   │   │   ├── auth.guard.ts      # Unified AuthGuard (verifies access/refresh tokens dynamically)
│   │   │   ├── roles.guard.ts     # RolesGuard (checks user roles)
│   │   │   └── index.ts
│   │   ├── Interceptors/          # Interceptors (e.g., performance interceptors)
│   │   ├── Services/              # Shared core services (TokenService for JWTs, UploadFileService)
│   │   └── Types/                 # Shared interfaces, types, and enums
│   │
│   ├── DB/                        # Mongoose database abstraction layer
│   │   ├── Models/                # Mongoose database schemas & models
│   │   │   ├── user.model.ts      # User schema, hooks for encryption & hashing
│   │   │   ├── otp.model.ts       # Verification OTP schema
│   │   │   └── revoked-token.model.ts  # Blacklisted tokens schema (logout, refresh rotation)
│   │   ├── Repositories/          # Encapsulated Mongoose repository operations
│   │   │   ├── user.repository.ts
│   │   │   ├── otp.repository.ts
│   │   │   └── revoke-token.repository.ts
│   │   └── base.service.ts        # Base repository service (contains generic CRUD queries)
│   │
│   ├── auth/                      # Authentication module
│   │   ├── dto/                   # Auth validation data transfer objects (DTOs)
│   │   ├── auth.controller.ts     # Auth HTTP controllers & routing
│   │   ├── auth.service.ts        # Auth business logic
│   │   └── auth.module.ts
│   │
│   └── user/                      # User module (CRUD management)
│       ├── dto/                   # User validation DTOs
│       ├── user.controller.ts     # User HTTP controllers
│       ├── user.service.ts        # User business logic
│       └── user.module.ts
│
├── test/                          # e2e and integration tests
├── .env                           # Local environment configurations (secrets, ports)
├── nest-cli.json                  # NestJS CLI configuration
├── package.json                   # Project scripts and dependencies
├── tsconfig.json                  # TypeScript compiler options
└── vercel.json                    # Vercel serverless deployment config
```

---

## 2. Postman Authentication Guide

To call protected endpoints, you must include the token in your headers:

- **Key**: `Authorization`
- **Value**: `Bearer <token>`

In Postman, you can set this in the **Auth** tab:
1. Select Type: **Bearer Token**.
2. Paste your Access Token or Refresh Token in the token field (depending on the endpoint requirements).

---

## 3. Endpoints & Postman Payloads

### 3.1 Authentication Module (`/auth`)

#### 1. Sign Up
- **Method / URL**: `POST /auth/signUp`
- **Description**: Registers a new customer and sends an email verification OTP.
- **Body (`raw JSON`)**:
  ```json
  {
    "firstName": "John",
    "lastName": "Doe",
    "email": "johndoe@example.com",
    "password": "securepassword123",
    "phone": "+1234567890",
    "gender": "male",
    "DOB": "1995-10-15"
  }
  ```

#### 2. Log In
- **Method / URL**: `POST /auth/login`
- **Description**: Logs in a verified user and returns an `accessToken` and `refreshToken`.
- **Body (`raw JSON`)**:
  ```json
  {
    "email": "johndoe@example.com",
    "password": "securepassword123"
  }
  ```

#### 3. Get My Profile
- **Method / URL**: `GET /auth/me`
- **Auth required**: Access Token (`admin`, `customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: *None*

#### 4. Confirm Email
- **Method / URL**: `PATCH /auth/confirm-email`
- **Description**: Confirms email address using the 6-digit OTP sent via email.
- **Body (`raw JSON`)**:
  ```json
  {
    "email": "johndoe@example.com",
    "otp": "123456"
  }
  ```

#### 5. Log Out
- **Method / URL**: `POST /auth/logout`
- **Auth required**: Access Token (`admin`, `customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: *None*

#### 6. Send OTP
- **Method / URL**: `POST /auth/send-otp`
- **Description**: Resends email confirmation or password reset OTP.
- **Body (`raw JSON`)**:
  ```json
  {
    "email": "johndoe@example.com",
    "type": "confirmation" 
  }
  ```
  *(Note: "type" can be either `"confirmation"` or `"reset-password"`)*

#### 7. Forgot Password
- **Method / URL**: `POST /auth/forgot-password`
- **Description**: Generates and sends a password reset OTP.
- **Body (`raw JSON`)**:
  ```json
  {
    "email": "johndoe@example.com"
  }
  ```

#### 8. Generate Access Token
- **Method / URL**: `POST /auth/generate-access-token`
- **Auth required**: **Refresh Token** (`admin`, `customer`, `manager`)
- **Headers**: `Authorization: Bearer <refreshToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "token": "<refreshToken>"
  }
  ```

#### 9. Confirm Reset OTP
- **Method / URL**: `PATCH /auth/confirm-reset-otp`
- **Auth required**: None (Public endpoint)
- **Body (`raw JSON`)**:
  ```json
  {
    "email": "johndoe@example.com",
    "otp": "123456"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "OTP verified successfully",
    "resetToken": "ey..."
  }
  ```

#### 10. Reset Password
- **Method / URL**: `PATCH /auth/reset-password`
- **Auth required**: Reset Token
- **Headers**: `Authorization: Bearer <resetToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "password": "newSecurePassword123",
    "confirmPassword": "newSecurePassword123"
  }
  ```

#### 11. Update Me
- **Method / URL**: `PATCH /auth/update-me`
- **Auth required**: Access Token (`admin`, `customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`form-data`)**:
  - `firstName`: `Johnny` (text, optional)
  - `lastName`: `Doey` (text, optional)
  - `phone`: `+1987654321` (text, optional)
  - `image`: `[File]` (file, optional profile picture upload)

---

### 3.2 User Management Module (`/users`)

#### 1. Create User (Admin/Manager)
- **Method / URL**: `POST /users`
- **Auth required**: Access Token (`admin`, `manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "janedoe@example.com",
    "password": "securepassword456",
    "phone": "+1555555555",
    "role": "manager",
    "gender": "female"
  }
  ```

#### 2. Find All Users
- **Method / URL**: `GET /users`
- **Auth required**: Access Token (`admin`, `manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query Params**:
  - `page` (e.g. `1`)
  - `limit` (e.g. `10`)
  - `search` (e.g. `Jane`)
  - `role` (e.g. `manager`)

#### 3. Find User by ID
- **Method / URL**: `GET /users/:id`
- **Auth required**: Access Token (`admin`, `manager`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 4. Update User by ID
- **Method / URL**: `PATCH /users/:id`
- **Auth required**: Access Token (`admin`, `manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "firstName": "Jane Modified",
    "phone": "+1444444444"
  }
  ```

#### 5. Soft Delete User
- **Method / URL**: `DELETE /users/:id`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`

---

### 3.3 Categories Module (`/categories`)

#### 1. Create Category
- **Method / URL**: `POST /categories`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`form-data`)**:
  - `name`: `Fresh Vegetables` (text)
  - `description`: `Organic farm-fresh green vegetables and herbs.` (text)
  - `image`: `[File]` (select an image file)

#### 2. Update Category
- **Method / URL**: `PATCH /categories/:id`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`form-data`)**:
  - `name`: `Organic Farm Vegetables` (text, optional)
  - `description`: `100% organic farm-fresh greens.` (text, optional)
  - `image`: `[File]` (optional, select a new image file to replace old)

#### 3. Delete Category (Soft Delete)
- **Method / URL**: `DELETE /categories/:id`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 4. View All Categories
- **Method / URL**: `GET /categories`
- **Auth required**: Public (No tokens required)

#### 5. Get Category by ID
- **Method / URL**: `GET /categories/:id`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`

---

### 3.4 Products Module (`/products`)

#### 1. Create Product
- **Method / URL**: `POST /products`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`form-data`)**:
  - `title`: `Fresh Organic Spinach` (text)
  - `description`: `Rich in iron, fresh green spinach leaves.` (text)
  - `longDescription`: `Harvested early in the morning and delivered straight to your door. Great for salads and cooking.` (text)
  - `price`: `10.00` (text/number)
  - `discountedPrice`: `8.50` (text/number)
  - `image`: `[File]` (select an image file)
  - `category`: `<category_object_id>` (text)
  - `freshnessWindow`: `5` (text/number)
  - `tags[]`: `organic` (text, optional)
  - `tags[]`: `greens` (text, optional)
  - `tags[]`: `spinach` (text, optional)
  - `isBestseller`: `true` (text/boolean, optional)
  - `isAvailable`: `true` (text/boolean, optional)

#### 2. Update Product
- **Method / URL**: `PATCH /products/:id`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`form-data`)**:
  - `price`: `12.00` (text/number, optional)
  - `discountedPrice`: `10.00` (text/number, optional)
  - `image`: `[File]` (optional, select a new image file to replace old)

#### 3. Delete Product (Soft Delete)
- **Method / URL**: `DELETE /products/:id`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 4. Change Availability
- **Method / URL**: `PATCH /products/:id/availability`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "isAvailable": false
  }
  ```

#### 5. Update Discount
- **Method / URL**: `PATCH /products/:id/discount`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "discountedPrice": 7.00
  }
  ```

#### 6. Get All Products (Filtered & Paginated)
- **Method / URL**: `GET /products`
- **Auth required**: Public
- **Query Params**:
  - `page` (e.g. `1`)
  - `limit` (e.g. `10`)
  - `category` (e.g. `<category_object_id>`)
  - `search` (e.g. `Spinach`)
  - `tag` (e.g. `organic`)
  - `sort` (e.g. `price` or `rating`)
  - `order` (e.g. `asc` or `desc`)

#### 7. Get Recommended Discounted Products
- **Method / URL**: `GET /products/recommendations`
- **Auth required**: Public
- **Query Params**:
  - `page` (e.g. `1`)
  - `limit` (e.g. `10`)

#### 8. Get Product Details
- **Method / URL**: `GET /products/:id`
- **Auth required**: Public

---

### 3.5 Favorites Module (`/favorites`)

#### 1. Add Product to Favorites
- **Method / URL**: `POST /favorites/:productId`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 2. Remove Product from Favorites
- **Method / URL**: `DELETE /favorites/:productId`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 3. Get All Favorite Products
- **Method / URL**: `GET /favorites`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 4. Check If Product is Favorite
- **Method / URL**: `GET /favorites/:productId/status`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

---

### 3.6 Cart Module (`/cart`)

#### 1. Get Current Cart
- **Method / URL**: `GET /cart`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns all cart items along with unit prices, discounted prices, total item prices, and calculated cart totals (original price, discount, final price, total quantity).

#### 2. Add Product to Cart
- **Method / URL**: `POST /cart`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "productId": "<product_object_id>",
    "quantity": 2
  }
  ```

#### 3. Remove Product from Cart
- **Method / URL**: `DELETE /cart/:productId`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 4. Update Item Quantity in Cart
- **Method / URL**: `PATCH /cart/:productId`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "quantity": 5
  }
  ```

#### 5. Clear Entire Cart
- **Method / URL**: `DELETE /cart`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

---

### 3.7 Orders Module (`/orders`)

#### 1. Create Order from Cart
- **Method / URL**: `POST /orders`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: None (Empty `{}`)
- **Description**: Places an order using the items in the current cart. Calculates totals, saves payment method as `CASH`, order status as `Pending`, and clears the cart on success.

#### 2. Get My Orders
- **Method / URL**: `GET /orders/me`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 3. Get My Order Details
- **Method / URL**: `GET /orders/me/:id`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 4. Get All Orders (Admin Only)
- **Method / URL**: `GET /orders`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 5. Update Order Status (Admin Only)
- **Method / URL**: `PATCH /orders/:id/status`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "status": "Confirmed"
  }
  ```
  *(Note: "status" can be: `"Pending"`, `"Confirmed"`, `"Preparing"`, `"Out For Delivery"`, `"Delivered"`, or `"Cancelled"`)*

---

## 4. End-to-End Shopping & Order Workflow

To place a successful order, follow this sequence of requests in Postman:

1. **Create Category & Product** (Admin):
   * Create categories and products using `POST /categories` and `POST /products`.
2. **Add Products to Cart** (Customer):
   * Call `POST /cart` with `{ "productId": "<productId>", "quantity": 2 }` to add items to your cart.
3. **Verify Cart Totals** (Customer):
   * Call `GET /cart` to see the computed final prices, discount details, and items.
4. **Place the Order** (Customer):
   * Call `POST /orders` with an **empty body** (`{}`). This turns your active cart items into a pending order and clears your cart.
5. **Retrieve Orders** (Customer/Admin):
   * Customer: View orders with `GET /orders/me`.
   * Admin: View all orders with `GET /orders`.
6. **Update Order Status** (Admin):
   * Admin: Update the status using `PATCH /orders/:id/status` to progress it. Finalized orders (`Delivered` or `Cancelled`) cannot be changed further.
