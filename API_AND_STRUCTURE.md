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
│   │   │   ├── ingredient.model.ts # Raw material ingredient inventory schema
│   │   │   ├── recipe.model.ts     # Product portion recipe mapping schema
│   │   │   └── revoked-token.model.ts  # Blacklisted tokens schema (logout, refresh rotation)
│   │   ├── Repositories/          # Encapsulated Mongoose repository operations
│   │   │   ├── user.repository.ts
│   │   │   ├── otp.repository.ts
│   │   │   ├── offer.repository.ts
│   │   │   ├── ingredient.repository.ts
│   │   │   ├── recipe.repository.ts
│   │   │   └── revoke-token.repository.ts
│   │   └── base.service.ts        # Base repository service (contains generic CRUD queries)
│   │
│   ├── auth/                      # Authentication module
│   │   ├── dto/                   # Auth validation data transfer objects (DTOs)
│   │   ├── auth.controller.ts     # Auth HTTP controllers & routing
│   │   ├── auth.service.ts        # Auth business logic
│   │   └── auth.module.ts
│   │
│   ├── ingredients/               # Ingredients module (raw materials management)
│   │   ├── dto/                   # Ingredient validation DTOs (create, update, query)
│   │   ├── ingredients.controller.ts # Ingredients HTTP controllers
│   │   ├── ingredients.service.ts    # Ingredients business logic
│   │   └── ingredients.module.ts
│   │
│   ├── offers/                    # Offers module (promotional discounts & scheduling)
│   │   ├── dto/                   # Offer validation DTOs (create, update, query)
│   │   ├── offers.controller.ts   # Offers HTTP controllers
│   │   ├── offers.service.ts      # Offers business logic & sync
│   │   └── offers.module.ts
│   │
│   ├── restaurant/                # Restaurant module
│   │   ├── dto/                   # Restaurant validation DTOs
│   │   ├── restaurant.controller.ts  # Restaurant HTTP controllers
│   │   ├── restaurant.service.ts  # Restaurant business logic
│   │   └── restaurant.module.ts
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

- **Description**: Places an order using the items in the current cart. Calculates totals, saves payment method as `Cash on Delivery`, order status as `Pending`, and clears the cart on success. **If the cart contains products from more than one restaurant, it automatically splits checkout into multiple Order documents (one per restaurantId) and returns an array of orders.**

#### 2. Get My Orders

- **Method / URL**: `GET /orders/me`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query Params**:
  - `restaurantId` (e.g. `<restaurant_object_id>`, optional)

#### 3. Get My Order Details

- **Method / URL**: `GET /orders/me/:id`
- **Auth required**: Access Token (`customer`)
- **Headers**: `Authorization: Bearer <accessToken>`

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
- **Description**: Creates an offer for a product. Verifies that the product belongs to the manager's owned/assigned restaurant (`403 Forbidden` if not). Accepts date-only strings (`YYYY-MM-DD`) or full ISO datetimes.
- **Body (`raw JSON`)**:
  ```json
  {
    "productId": "<product_object_id>",
    "discountPercentage": 20,
    "startDate": "2026-07-20",
    "endDate": "2026-07-30",
    "featured": true
  }
  ```

#### 2. Get Restaurant Offers (Manager)

- **Method / URL**: `GET /offers`
- **Auth required**: Access Token (`manager`)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Description**: Returns offers scoped exclusively to the manager's own restaurant.
- **Query Params**:
  - `status` (e.g. `active`, `scheduled`, `expired`, `cancelled`, `draft`)
  - `productId` (e.g. `<product_object_id>`)
  - `source` (e.g. `manual`, `ai_recommendation`)

#### 3. Get Active Offers (Public Customer Store)

- **Method / URL**: `GET /offers/active`
- **Auth required**: Public (No tokens required)
- **Description**: Returns all currently active, non-deleted offers across all restaurants within the active date window (`startDate <= now <= endDate`), with internal management fields omitted.
- **Query Params**:
  - `page` (e.g. `1`, default: `1`)
  - `limit` (e.g. `10`, default: `10`)

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
