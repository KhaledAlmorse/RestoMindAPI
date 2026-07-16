# 🍽️ RestoMind API — Project Structure & API Documentation

> Built with **NestJS** · **MongoDB (Mongoose)** · **TypeScript**

---

## 📦 Tech Stack

| Layer        | Technology                            |
|--------------|---------------------------------------|
| Framework    | NestJS v11                            |
| Language     | TypeScript v5                         |
| Database     | MongoDB via Mongoose v9               |
| Auth         | JWT (Access + Refresh tokens)         |
| Validation   | class-validator + class-transformer   |
| File Upload  | Multer + Cloudinary                   |
| Emails       | Nodemailer                            |
| Security     | bcrypt (hashing) + crypto-js (AES)    |

---

## 🗂️ Project Directory Structure

```
RestoMindApi/
├── src/
│   ├── main.ts                          # App bootstrap & global pipes
│   ├── app.module.ts                    # Root module
│   ├── app.controller.ts                # Root controller
│   ├── app.service.ts                   # Root service
│   ├── global.module.ts                 # Global providers (Auth, Token, User)
│   │
│   ├── auth/                            # 🔐 Authentication module
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── dto/
│   │       └── auth.dto.ts              # Request body DTOs
│   │
│   ├── DB/                              # 🗃️ Database layer
│   │   ├── base.service.ts              # Generic abstract CRUD service
│   │   ├── Models/
│   │   │   ├── index.ts
│   │   │   ├── user.model.ts            # User schema & model
│   │   │   ├── otp.model.ts             # OTP schema & model
│   │   │   └── revoked-token.model.ts   # Revoked tokens schema & model
│   │   └── Repositories/
│   │       ├── index.ts
│   │       ├── user.repository.ts
│   │       ├── otp.repository.ts
│   │       └── revoke-token.repository.ts
│   │
│   └── Common/                          # 🧰 Shared utilities
│       ├── Config/
│       │   ├── index.ts
│       │   └── cloudinary.config.ts     # Cloudinary SDK config
│       ├── Constants/
│       │   └── constants.ts
│       ├── Decorators/
│       │   ├── index.ts
│       │   ├── auth-compose.decorator.ts # @Auth() composed decorator
│       │   └── roles.decorator.ts        # @Roles() metadata decorator
│       ├── Guards/
│       │   ├── index.ts
│       │   ├── auth.guard.ts             # JWT verification guard
│       │   └── roles.guard.ts            # Role-based access guard
│       ├── Interceptors/
│       │   ├── indes.ts
│       │   └── performance.interceptors.ts
│       ├── Pipes/                        # (empty — reserved)
│       ├── Security/
│       │   ├── index.ts
│       │   ├── hash.security.ts          # bcrypt hash & compare
│       │   └── encryption.security.ts    # AES encrypt/decrypt
│       ├── Services/
│       │   ├── index.ts
│       │   ├── token-service.ts          # JWT generate & verify
│       │   └── uploadFile.service.ts     # Cloudinary upload
│       ├── Types/
│       │   ├── index.ts
│       │   ├── types.ts                  # Enums (Roles, Gender, OTP)
│       │   └── interfaces.ts             # IAuthUser interface
│       └── Utils/
│           ├── index.ts
│           ├── multer.utils.ts           # File filter & storage config
│           └── send-email.utils.ts       # Nodemailer email sender
│
├── test/                                # E2E tests
├── dist/                                # Compiled output
├── .env                                 # Environment variables
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── package.json
└── .gitignore
```

---

## 🗃️ Database Models

### 👤 User
| Field             | Type    | Required | Notes                               |
|-------------------|---------|----------|-------------------------------------|
| `firstName`       | String  | ✅        | min:3, max:20                       |
| `lastName`        | String  | ✅        | min:3, max:20                       |
| `email`           | String  | ✅        | Unique, lowercase, indexed          |
| `password`        | String  | ✅        | Auto-hashed (bcrypt) on save        |
| `role`            | Enum    | —        | `admin` \| `customer` (default: customer)   |
| `gender`          | Enum    | —        | `male` \| `female`                  |
| `phone`           | String  | ✅        | Unique, AES-encrypted on save       |
| `isEmailVerified` | Boolean | —        | default: `false`                    |
| `DOB`             | Date    | —        | Date of birth                       |
| `isDeleted`       | Boolean | —        | Soft delete flag, default: `false`  |
| `createdAt`       | Date    | —        | Auto (timestamps)                   |
| `updatedAt`       | Date    | —        | Auto (timestamps)                   |

### 🔑 OTP
| Field        | Type     | Required | Notes                               |
|--------------|----------|----------|-------------------------------------|
| `otp`        | String   | ✅        | Hashed OTP value                    |
| `userId`     | ObjectId | ✅        | Ref → User                          |
| `expireTime` | Date     | ✅        | OTP expiry timestamp                |
| `otpType`    | Enum     | ✅        | `confirmation` \| `reset-password`  |

### 🚫 RevokedToken
| Field        | Type     | Required | Notes                          |
|--------------|----------|----------|--------------------------------|
| `tokenId`    | String   | ✅        | JWT `jti` claim                |
| `userId`     | ObjectId | ✅        | Ref → User                     |
| `expiryTime` | Date     | ✅        | Token original expiry time     |

---

## 🔐 Common Enums

```typescript
enum RolesEnum  { ADMIN = 'admin', MANAGER = 'manager', STAFF = 'staff', CUSTOMER = 'customer' }
enum GenderEnum { MALE  = 'male',          FEMALE = 'female'       }
enum OtpTypeEnum{ CONFIRMATION = 'confirmation', RESET_PASSWORD = 'reset-password' }
```

---

## 🛡️ Security Architecture

| Mechanism          | Implementation                                                      |
|--------------------|---------------------------------------------------------------------|
| Password Hashing   | `bcrypt` — applied automatically in Mongoose `pre('save')` hook     |
| Phone Encryption   | AES via `crypto-js` — applied in `pre('save')` hook                 |
| Token Strategy     | Access Token + Refresh Token (JWT with separate secrets)            |
| Token Revocation   | Revoked `jti` stored in `RevokedToken` collection                   |
| Auth Guard         | Verifies JWT, checks revocation list, loads user into `req.user`    |
| Role Guard         | Checks `RolesEnum` metadata set by `@Roles()` decorator             |
| Composed Decorator | `@Auth(...roles)` = `@UseGuards(AuthGuard, RolesGuard)` + `@Roles()`|

---

## 🏗️ Architecture Patterns

### BaseService (Generic CRUD)
All repositories extend `BaseService<TDocument>` which provides:

| Method                                   | Description                      |
|------------------------------------------|----------------------------------|
| `create(doc)`                            | Insert one document              |
| `findOne({ filters, select, populate })` | Find by `_id` or filter          |
| `findMany({ filters, select, populate })`| Find multiple documents          |
| `update({ filters, body })`              | Update one document              |
| `delete({ filters })`                    | Delete one document              |
| `deleteMany({ filters })`                | Delete multiple documents        |
| `save(doc)`                              | Save a modified document         |

### Global Module
`GlobalAuthModule` is marked `@Global()` and exports these providers app-wide:

- `UserRepository`
- `RevokeTokenRepository`
- `TokenService`
- `JwtService`

---

## ✅ Completed API Endpoints

### 🔐 Auth Module — Base: `/auth`

---

#### `POST /auth/singup`
Register a new user account.

- **Auth required:** ❌ Public
- **Request Body:**
```json
{
  "firstName": "string (3–20 chars, required)",
  "lastName":  "string (3–20 chars, required)",
  "email":     "string (valid email, required)",
  "password":  "string (min 6 chars, required)",
  "phone":     "string (valid phone, optional)",
  "gender":    "male | female (optional)",
  "DOB":       "ISO date string (optional)"
}
```
- **Response:** `201 Created` — New user object
- **Flow:**
  1. Check if email already exists → `409 Conflict` if true
  2. Create user (password auto-hashed, phone auto-encrypted via Mongoose hooks)
  3. Generate 6-digit OTP → hash & store in `Otp` collection (`type: confirmation`)
  4. Send verification email with plain OTP via Nodemailer

---

#### `POST /auth/login`
Login with credentials and receive JWT tokens.

- **Auth required:** ❌ Public
- **Request Body:**
```json
{
  "email":    "string (required)",
  "password": "string (min 6 chars, required)"
}
```
- **Response:** `200 OK`
```json
{
  "accessToken":  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```
- **Flow:**
  1. Find user by email → `409` if not found
  2. Compare password with bcrypt hash → `409` if mismatch
  3. Check `isEmailVerified` → `400` if email not confirmed yet
  4. Generate Access Token + Refresh Token (JWT, each with unique `jti` via `uuid`)

---

#### `PATCH /auth/confirm-email`
Verify email address using the OTP received during signup.

- **Auth required:** ❌ Public
- **Request Body:**
```json
{
  "email": "string (required)",
  "otp":   "string (6-digit code, required)"
}
```
- **Response:** `200 OK`
```json
{ "message": "Email confirmed successfully" }
```
- **Flow:**
  1. Find user by email → `404` if not found
  2. Find OTP by `userId` + `otpType: confirmation` → `404` if not found
  3. Compare submitted OTP with stored bcrypt hash → `404` if invalid
  4. Check `expireTime < now` → `400` if OTP expired
  5. Set `isEmailVerified = true` on user document
  6. Delete OTP document from database

---

#### `GET /auth/me`
Get the authenticated user's own profile data.

- **Auth required:** ✅ JWT required
- **Allowed roles:** `admin`, `customer`
- **Header:** `Authorization: Bearer <accessToken>`
- **Response:** `200 OK` — Full user document from database
- **Notes:** Wrapped with `performanceInterceptor` to log response time

---

#### `POST /auth/logout`
Revoke the current access token (server-side blacklisting).

- **Auth required:** ✅ JWT required
- **Allowed roles:** `admin`, `customer`
- **Header:** `Authorization: Bearer <accessToken>`
- **Response:** `200 OK`
```json
{ "message": "Logout successfully" }
```
- **Flow:**
  1. `AuthGuard` decodes and attaches token to `req.user`
  2. Extract `jti` (JWT unique ID) and `exp` from decoded token
  3. Store entry in `RevokedToken` collection
  4. Subsequent requests with this token fail `AuthGuard` check

---

## 📊 API Summary Table

| Method  | Endpoint              | Auth    | Roles        | Description              |
|---------|-----------------------|---------|--------------|--------------------------|
| `POST`  | `/auth/singup`        | ❌ None  | —            | Register new user        |
| `POST`  | `/auth/login`         | ❌ None  | —            | Login & receive tokens   |
| `PATCH` | `/auth/confirm-email` | ❌ None  | —            | Verify email with OTP    |
| `GET`   | `/auth/me`            | ✅ JWT   | admin / customer | Get own profile          |
| `POST`  | `/auth/logout`        | ✅ JWT   | admin / customer | Revoke access token      |

---

## ⚙️ Environment Variables

| Variable                  | Description                              |
|---------------------------|------------------------------------------|
| `PORT`                    | Server listening port (default: 3000)    |
| `DB_URL`                  | MongoDB connection string                |
| `ACCESS_TOKEN_SECRET`     | JWT secret for access tokens             |
| `ACCESS_TOKEN_EXPIRES_IN` | Access token TTL (e.g. `15m`)            |
| `REFRESH_TOKEN_SECRET`    | JWT secret for refresh tokens            |
| `REFRESH_EXPIRES_IN`      | Refresh token TTL (e.g. `7d`)            |
| `Encryption_SECRET`       | AES secret key for phone number encryption|
| Cloudinary variables      | Cloudinary cloud name, API key & secret  |
| Email SMTP variables      | Nodemailer host, port, user, pass        |

---

## 🚀 Running the Project

```bash
# Install dependencies
npm install

# Development (watch mode)
npm run start:dev

# Production
npm run build
npm run start:prod

# Tests
npm test              # unit tests
npm run test:e2e      # end-to-end tests
npm run test:cov      # coverage report
```

---

*Last updated: 2026-07-16*
