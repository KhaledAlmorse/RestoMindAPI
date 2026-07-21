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
│   │   │   ├── offer.model.ts     # Special offers & promotional discount schema
│   │   │   ├── favorite.model.ts  # Customer favorite offers schema
│   │   │   ├── cart.model.ts      # Customer shopping cart schema
│   │   │   ├── order.model.ts     # Customer order schema
│   │   │   ├── category.model.ts  # Category schema
│   │   │   ├── product.model.ts   # Product catalog schema
│   │   │   ├── ingredient.model.ts # Raw material ingredient inventory schema
│   │   │   ├── recipe.model.ts     # Product portion recipe mapping schema
│   │   │   └── revoked-token.model.ts  # Blacklisted tokens schema (logout, refresh rotation)
│   │   ├── Repositories/          # Encapsulated Mongoose repository operations
│   │   └── base.service.ts        # Base repository service (contains generic CRUD queries)
│   │
│   ├── auth/                      # Authentication module
│   ├── cart/                      # Cart module (offer-centric shopping cart)
│   ├── categories/                # Categories module (product categorization)
│   ├── favorites/                 # Favorites module (offer-centric customer favorites)
│   ├── ingredients/               # Ingredients module (raw materials management)
│   ├── offers/                    # Offers module (promotional discounts & scheduling)
│   ├── orders/                    # Orders module (order group unification & checkout)
│   ├── products/                  # Products module (product catalog & recipes)
│   ├── restaurant/                # Restaurant module
│   ├── scripts/                   # Data migration & utility scripts
│   └── user/                      # User module (CRUD management)
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
- **Body**: _None_

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
- **Body**: _None_

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
  _(Note: "type" can be either `"confirmation"` or `"reset-password"`)_

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

- Method / URL: `PATCH /auth/update-me`
- Auth required: Access Token (`admin`, `customer`)
- Headers: `Authorization: Bearer <accessToken>`
- Body (`form-data`):
  - `firstName`: `Johnny` (text, optional)
  - `lastName`: `Doey` (text, optional)
  - `phone`: `+1987654321` (text, optional)
  - `image`: `[File]` (file, optional profile picture upload)

#### 12. Add Delivery Address

- Method / URL: `POST /auth/addresses`
- Auth required: Access Token (`admin`, `customer`)
- Headers: `Authorization: Bearer <accessToken>`
- Body (`raw JSON`):
  ```json
  {
    "label": "Home",
    "phoneNumber": "+1234567890",
    "street": "12 Nile St",
    "city": "Cairo",
    "country": "Egypt",
    "isDefault": true
  }
  ```

#### 13. Get My Saved Addresses

- Method / URL: `GET /auth/addresses`
- Auth required: Access Token (`admin`, `customer`)
- Headers: `Authorization: Bearer <accessToken>`

#### 14. Update Saved Address

- Method / URL: `PATCH /auth/addresses/:addressId`
- Auth required: Access Token (`admin`, `customer`)
- Headers: `Authorization: Bearer <accessToken>`
- Body (`raw JSON`):
  ```json
  {
    "label": "Work",
    "street": "44 Pyramids Rd"
  }
  ```

#### 15. Delete Saved Address

- Method / URL: `DELETE /auth/addresses/:addressId`
- Auth required: Access Token (`admin`, `customer`)
- Headers: `Authorization: Bearer <accessToken>`

#### 16. Set Address as Default

- Method / URL: `PATCH /auth/addresses/:addressId/default`
- Auth required: Access Token (`admin`, `customer`)
- Headers: `Authorization: Bearer <accessToken>`

---

### 3.2 User Management Module (`/users`)

#### 1. Create User (Admin/Manager)

- Method / URL: `POST /users`
- Auth required: Access Token (`admin`, `manager`)
- Headers: `Authorization: Bearer <accessToken>`
- Body (`raw JSON`):
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
  _(Note: `restaurantId` is optional and can be omitted even when `role` is `"manager"`)_

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
- Body (`form-data`):
  - `title`: `Fresh Organic Spinach` (text)
  - `description`: `Rich in iron, fresh green spinach leaves.` (text)
  - `longDescription`: `Harvested early in the morning and delivered straight to your door. Great for salads and cooking.` (text)
  - `price`: `10.00` (text/number)
  - `discountedPrice`: `8.50` (text/number)
  - `image`: `[File]` (select an image file)
  - `category`: `<category_object_id>` (text)
  - `restaurantId`: `6a5b9402bd9903547f7c8405` (text, required)
  - `freshnessWindow`: `5` (text/number)
  - `tags[]`: `organic` (text, optional)
  - `tags[]`: `greens` (text, optional)
  - `tags[]`: `spinach` (text, optional)
  - `isBestseller`: `true` (text/boolean, optional)

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
    "discountedPrice": 7.0
  }
  ```

#### 6. Get All Products (Filtered & Paginated)

- **Method / URL**: `GET /products`
- **Auth required**: Public
- Query Params:
  - `page` (e.g. `1`)
  - `limit` (e.g. `10`)
  - `category` (e.g. `<category_object_id>`)
  - `restaurantId` (e.g. `<restaurant_object_id>`)
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

#### 9. Upsert Product Recipe

- **Method / URL**: `PUT /products/:productId/recipe`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Creates or updates the portion recipe for a product. Validates that all ingredients belong to the manager's restaurant, units match ingredient base units, `yieldPercentage > 0`, and no duplicate ingredients exist. Accepts product ObjectId or slug.
- **Body (`raw JSON`)**:
  ```json
  {
    "ingredients": [
      {
        "ingredientId": "<ingredient_object_id_1>",
        "quantityPerPortion": 0.25,
        "unit": "kg",
        "yieldPercentage": 95
      },
      {
        "ingredientId": "<ingredient_object_id_2>",
        "quantityPerPortion": 0.1,
        "unit": "liter",
        "yieldPercentage": 100
      }
    ]
  }
  ```

#### 10. Get Product Recipe

- **Method / URL**: `GET /products/:productId/recipe`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Retrieves the recipe mapping for a product in the manager's restaurant with populated ingredient details. Accepts product ObjectId or slug.

---

### 3.5 Favorites Module (`/favorites`)

#### 1. Add Offer to Favorites

- **Method / URL**: `POST /favorites/:offerId`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Adds an active/scheduled offer to the customer's favorites list. Returns `400 Bad Request` if offer status is not allowed, or `409 Conflict` if already in favorites.

#### 2. Remove Offer from Favorites

- **Method / URL**: `DELETE /favorites/:offerId`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Removes an offer from the customer's favorites list.

#### 3. Get All Favorite Offers

- **Method / URL**: `GET /favorites`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns all favorite offers with populated offer details (including product and restaurant info).

#### 4. Check If Offer is Favorite

- **Method / URL**: `GET /favorites/:offerId/status`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns `{ "isFavorite": true/false }` for a specific offer ID.

---

### 3.6 Cart Module (`/cart`)

#### 1. Get Current Cart

- **Method / URL**: `GET /cart`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns all cart items along with unit prices, discounted prices, total item prices, and calculated cart totals (original price, discount, final price, total quantity).

#### 2. Add Offer to Cart

- **Method / URL**: `POST /cart`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "offerId": "<offer_object_id>",
    "quantity": 2
  }
  ```

#### 3. Remove Offer from Cart

- **Method / URL**: `DELETE /cart/:offerId`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 4. Update Item Quantity in Cart

- **Method / URL**: `PATCH /cart/:offerId`
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
- **Body (`raw JSON`)**:

##### Example 1: Home Delivery (New Address + Save to Profile option)

```json
{
  "deliveryMethod": "Home Delivery",
  "deliveryAddress": {
    "street": "12 Nile St",
    "city": "Cairo",
    "country": "Egypt"
  },
  "specialNotes": "Ring the bell twice",
  "paymentMethod": "Cash on Delivery",
  "saveAddress": true
}
```

##### Example 2: Home Delivery (Using Saved `addressId` from Profile)

```json
{
  "deliveryMethod": "Home Delivery",
  "deliveryAddress": {
    "addressId": "6a5ba23151009582b2453125"
  },
  "specialNotes": "Leave at front door",
  "paymentMethod": "Cash on Delivery"
}
```

##### Example 3: Store Pickup

```json
{
  "deliveryMethod": "Store Pickup",
  "specialNotes": "Prepare it hot",
  "paymentMethod": "Cash on Delivery"
}
```

_(Note: Alternately, specify `"addressId": "<saved_address_id>"` instead of street, city, country to use profile saved address)_

- **Description**: Places an order using items from current cart. Aggregates all items under a single root `GroupOrder` object containing customer info, payment, delivery, overall status, and total prices, with individual restaurant orders contained inside the `orders` array.

#### 2. Get My Orders (Order History)

- **Method / URL**: `GET /orders/me`
- **Auth required**: Access Token (`customer`, `admin`, `manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns an array of previous checkout `GroupOrder` objects for the customer.
- **Query Params**:
  - `restaurantId` (e.g. `<restaurant_object_id>`, optional)

#### 3. Get Checkout Details

- **Method / URL**: `GET /orders/me/:id` or `GET /order-groups/:id`
- **Auth required**: Access Token (`customer`, `admin`, `manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns details for a single checkout as a single `data` object containing the aggregated `GroupOrder` (including customer info, totals, overallStatus, and `orders` array). Accepts either `orderGroupId` or a sub-order `orderId`.

#### 4. Get All Orders (Admin Only)

- **Method / URL**: `GET /orders`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query Params**:
  - `restaurantId` (e.g. `<restaurant_object_id>`, optional)

#### 5. Get Restaurant Orders (Admin/Manager)

- **Method / URL**: `GET /orders/restaurant/:restaurantId`
- **Auth required**: Access Token (`admin`, `manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Retrieves orders for a specific restaurant. Managers can only query their own assigned `restaurantId`.

#### 6. Update Order Status (Admin Only)

- **Method / URL**: `PATCH /orders/:id/status`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "status": "Confirmed"
  }
  ```
  _(Note: "status" can be: `"Pending"`, `"Confirmed"`, `"Preparing"`, `"Out For Delivery"`, `"Delivered"`, or `"Cancelled"`)_

---

### 3.8 Restaurant Module (`/restaurants`)

#### 1. Create Restaurant

- **Method / URL**: `POST /restaurants`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "name": "Bella Italia",
    "ownerUserId": "6a5a2f79ae2f9fc49c9681d3",
    "description": "Authentic Italian restaurant",
    "phone": "+1122334455",
    "address": {
      "street": "15 Roma St",
      "city": "Cairo",
      "country": "Egypt"
    }
  }
  ```

#### 2. Get All Restaurants

- **Method / URL**: `GET /restaurants`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query Params**:
  - `page` (e.g. `1`)
  - `limit` (e.g. `10`)
  - `search` (e.g. `Bella`)

#### 3. Get My Restaurant

- **Method / URL**: `GET /restaurants/me`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Automatically resolves and returns the restaurant associated with the logged-in manager's `restaurantId`.

#### 4. Get Restaurant by ID

- **Method / URL**: `GET /restaurants/:id`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`

#### 5. Update Restaurant

- **Method / URL**: `PATCH /restaurants/:id`
- **Auth required**: Access Token (`admin`, `manager` - own only)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (`raw JSON`)**:
  ```json
  {
    "description": "Premium authentic Italian dining experience",
    "isActive": true
  }
  ```

#### 6. Delete Restaurant (Soft Delete)

- **Method / URL**: `DELETE /restaurants/:id`
- **Auth required**: Access Token (`admin`)
- **Headers**: `Authorization: Bearer <accessToken>`

---

### 3.9 Offers Module (`/offers`)

#### 1. Create Offer

- **Method / URL**: `POST /offers`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Creates an offer for a product. Verifies that the product belongs to the manager's owned/assigned restaurant (`403 Forbidden` if not). Requires `availableQuantity` ($\ge 1$), which automatically initializes `remainingQuantity = availableQuantity`. `remainingQuantity` is system-managed and must not be sent in client requests. Accepts date-only strings (`YYYY-MM-DD`) or full ISO datetimes.
- **Body (`raw JSON`)**:
  ```json
  {
    "productId": "<product_object_id>",
    "discountPercentage": 20,
    "availableQuantity": 50,
    "startDate": "2026-07-20",
    "endDate": "2026-07-30",
    "featured": true
  }
  ```

#### 2. Get Restaurant Offers (Manager)

- **Method / URL**: `GET /offers`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns offers scoped exclusively to the authenticated manager's restaurant. If `status` is omitted, returns all offers across all statuses (`active`, `scheduled`, `draft`, `expired`, `cancelled`, `sold_out`).

##### Query Parameters Table

| Parameter | Type | Valid Options / Pattern | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `status` | string | `active`, `scheduled`, `draft`, `expired`, `cancelled`, `sold_out` | Filter by lifecycle status. Omit to fetch all statuses. | `?status=active` |
| `productId` | string | Valid Mongo ObjectId | Filter offers for a specific product. | `?productId=6a5f62b318d38b42b8bc4824` |
| `categoryId` | string | Valid Mongo ObjectId | Filter offers for products in a specific category. | `?categoryId=6a5a4a16e5012931a7867bd0` |
| `source` | string | `manual`, `ai_recommendation` | Filter by creation origin. | `?source=manual` |
| `featured` | boolean | `true`, `false` | Filter by featured highlight. | `?featured=true` |
| `minPrice` | number | $\ge 0$ | Minimum `offerPrice` threshold. | `?minPrice=10` |
| `maxPrice` | number | $\ge 0$ | Maximum `offerPrice` threshold. | `?maxPrice=50` |
| `search` | string | Text search string | Case-insensitive search in product title/description. | `?search=milk` |
| `sortBy` | string | `createdAt`, `offerPrice`, `discountPercentage`, `startDate`, `endDate` | Field to sort by (Default: `createdAt`). | `?sortBy=offerPrice` |
| `sortOrder` | string | `asc`, `desc` | Sorting direction (Default: `desc`). | `?sortOrder=asc` |
| `page` | number | Positive integer | Page number (Default: `1`). | `?page=1` |
| `limit` | number | Positive integer | Items per page (Default: `10`). | `?limit=5` |

##### Test Scenarios & Postman URLs

1. **Get Active Offers Only**:
   - `GET {{URL}}/offers?status=active`
2. **Get Scheduled Offers (Starting in Future)**:
   - `GET {{URL}}/offers?status=scheduled`
3. **Price Range Filtering ($10 to $30)**:
   - `GET {{URL}}/offers?minPrice=10&maxPrice=30`
4. **Search by Keyword**:
   - `GET {{URL}}/offers?search=fresh`
5. **Filter Featured Offers Only**:
   - `GET {{URL}}/offers?featured=true`
6. **Filter by Category**:
   - `GET {{URL}}/offers?categoryId=6a5a4a16e5012931a7867bd0`
7. **Sort by Price Ascending**:
   - `GET {{URL}}/offers?sortBy=offerPrice&sortOrder=asc`
8. **Combined Complex Filter + Pagination**:
   - `GET {{URL}}/offers?status=active&minPrice=10&maxPrice=50&sortBy=discountPercentage&sortOrder=desc&page=1&limit=5`

##### Sample JSON Response (`200 OK`)

```json
{
  "items": [
    {
      "_id": "6a5f640218d38b42b8bc482a",
      "productId": {
        "_id": "6a5f62b318d38b42b8bc4824",
        "title": "fresh milk",
        "description": "Rich in iron, fresh milk.",
        "price": 25,
        "isAvailable": true,
        "category": {
          "_id": "6a5a4a16e5012931a7867bd0",
          "name": "Dairy"
        },
        "slug": "fresh-milk"
      },
      "restaurantId": {
        "_id": "6a5f605813012e65590dad1f",
        "name": "Abo ali"
      },
      "originalPrice": 25,
      "offerPrice": 20,
      "discountPercentage": 20,
      "availableQuantity": 10,
      "remainingQuantity": 10,
      "startDate": "2026-07-21T00:00:00.000Z",
      "endDate": "2026-07-25T23:59:59.999Z",
      "status": "active",
      "source": "manual",
      "featured": true,
      "createdAt": "2026-07-21T12:20:18.422Z"
    }
  ],
  "page": 1,
  "limit": 5,
  "total": 1,
  "totalPages": 1
}
```

#### 3. Get Active Offers (Public Customer Store)

- **Method / URL**: `GET /offers/active`
- **Auth required**: Public (No tokens required)
- **Description**: Returns currently active, non-deleted offers across restaurants (`status = active` and `endDate >= now`), with internal management fields omitted (`createdBy`, `isDeleted`, `updatedAt`, `__v`). Supports full searching, filtering by restaurant, category, price range, featured status, sorting, and pagination.

##### Supported Query Parameters Table

| Parameter | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `restaurantId` | string | Filter active offers for a specific restaurant | `?restaurantId=6a5f605813012e65590dad1f` |
| `categoryId` | string | Filter active offers by product category ID | `?categoryId=6a5a4a16e5012931a7867bd0` |
| `productId` | string | Filter active offers for a specific product ID | `?productId=6a5f62b318d38b42b8bc4824` |
| `search` | string | Search active offers by product title/description | `?search=milk` |
| `featured` | boolean | Filter active featured offers | `?featured=true` |
| `minPrice` | number | Minimum `offerPrice` threshold | `?minPrice=10` |
| `maxPrice` | number | Maximum `offerPrice` threshold | `?maxPrice=50` |
| `sortBy` | string | Sort field (`createdAt`, `offerPrice`, `discountPercentage`, `startDate`, `endDate`) | `?sortBy=offerPrice` |
| `sortOrder` | string | Sort direction (`asc`, `desc`, Default: `desc`) | `?sortOrder=asc` |
| `page` | number | Pagination page number (Default: `1`) | `?page=1` |
| `limit` | number | Items per page (Default: `10`) | `?limit=5` |

##### Ready-to-Use Customer Test Scenarios & Postman URLs

1. **Browse All Active Offers**:
   - `GET {{URL}}/offers/active`
2. **Filter Active Offers by Restaurant**:
   - `GET {{URL}}/offers/active?restaurantId=6a5f605813012e65590dad1f`
3. **Filter Active Offers by Category**:
   - `GET {{URL}}/offers/active?categoryId=6a5a4a16e5012931a7867bd0`
4. **Search Active Offers by Keyword**:
   - `GET {{URL}}/offers/active?search=milk`
5. **Filter Active Featured Offers Only**:
   - `GET {{URL}}/offers/active?featured=true`
6. **Price Range ($10 to $50)**:
   - `GET {{URL}}/offers/active?minPrice=10&maxPrice=50`
7. **Sort by Offer Price Ascending**:
   - `GET {{URL}}/offers/active?sortBy=offerPrice&sortOrder=asc`
8. **Combined Search, Filter & Pagination**:
   - `GET {{URL}}/offers/active?restaurantId=6a5f605813012e65590dad1f&minPrice=10&maxPrice=50&sortBy=discountPercentage&sortOrder=desc&page=1&limit=5`

#### 4. Get Active Offer Details (Public Customer Store)

- **Method / URL**: `GET /offers/active/:id`
- **Auth required**: Public (No tokens required)
- **Description**: Returns details for a single active, non-deleted offer within its active date window without exposing internal management fields (`createdBy`, etc.).

#### 5. Get Offer by ID (Manager)

- **Method / URL**: `GET /offers/:id`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Retrieves detailed offer data if it belongs to the manager's own restaurant (`403 Forbidden` if belonging to another restaurant).

#### 6. Update Offer (Manager)

- **Method / URL**: `PATCH /offers/:id`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Allows updating `discountPercentage`, `startDate`, `endDate`, `featured`, or `productId` for offers with `draft` or `scheduled` status belonging to the manager's restaurant.
- **Body (`raw JSON`)**:
  ```json
  {
    "discountPercentage": 25,
    "endDate": "2026-08-05",
    "featured": false
  }
  ```

#### 7. Cancel Offer (Manager)

- **Method / URL**: `PATCH /offers/:id/cancel`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Cancels an active or scheduled offer belonging to the manager's restaurant and recalculates/resets the associated product's discounted price.

---

### 3.10 Ingredients Module (`/ingredients`)

#### 1. Create Ingredient

- **Method / URL**: `POST /ingredients`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Creates a new raw material ingredient scoped to the manager's restaurant. Checks code uniqueness per restaurant.
- **Body (`raw JSON`)**:
  ```json
  {
    "ingredientCode": "ING-FLOUR-01",
    "name": "Wheat Flour",
    "unit": "kg",
    "shelfLifeDays": 30,
    "minimumStock": 10,
    "safetyStock": 5
  }
  ```
  _(Note: `unit` must be one of `"kg"`, `"liter"`, or `"piece"`)_

#### 2. Get All Ingredients (Paginated & Filtered)

- **Method / URL**: `GET /ingredients`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns all non-deleted ingredients for the manager's restaurant.
- **Query Params**:
  - `page` (e.g. `1`, default: `1`)
  - `limit` (e.g. `10`, default: `10`)
  - `search` (e.g. `Flour`, searches name and ingredient code)

#### 3. Get Ingredient by ID

- **Method / URL**: `GET /ingredients/:id`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Retrieves details for a specific ingredient belonging to the manager's restaurant.

#### 4. Update Ingredient

- **Method / URL**: `PATCH /ingredients/:id`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Updates fields of an ingredient belonging to the manager's restaurant.
- **Body (`raw JSON`)**:
  ```json
  {
    "name": "Premium Wheat Flour",
    "minimumStock": 15,
    "safetyStock": 8
  }
  ```

#### 5. Delete Ingredient (Soft Delete)

- **Method / URL**: `DELETE /ingredients/:id`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Soft deletes an ingredient. Returns `400 Bad Request` if the ingredient is currently used in any active recipe.

---
