<p align="center">
  <img src="https://nestjs.com/img/logo-small.svg" width="100" alt="NestJS Logo" />
</p>

<h1 align="center">RestoMind API</h1>

<p align="center">
  <b>Enterprise AI-Driven Restaurant Management & Multi-Tenant Backend Ecosystem</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-v11.0-E0234E?style=flat-square&logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-v5.7-3178C6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MongoDB-Mongoose_v9.7-47A248?style=flat-square&logo=mongodb" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Security-RTR%20%26%20RBAC-000000?style=flat-square&logo=jsonwebtokens" alt="Security" />
  <img src="https://img.shields.io/badge/Cloud-Cloudinary-3448C5?style=flat-square&logo=cloudinary" alt="Cloudinary" />
  <img src="https://img.shields.io/badge/AI-Forecasting%20Engine-FF6F61?style=flat-square" alt="AI Engine" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License" />
</p>

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Ecosystem Repositories](#-ecosystem-repositories)
- [Key Features](#-key-features)
- [Security & Token Lifecycle Architecture](#-security--token-lifecycle-architecture)
- [System Architecture & Tech Stack](#-system-architecture--tech-stack)
- [Role-Based Access Control (RBAC)](#-role-based-access-control-rbac)
- [Directory Structure](#-directory-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Seeding](#database-seeding)
  - [Running the Application](#running-the-application)
- [Bulk Import Engine & Failure Handling](#-bulk-import-engine--failure-handling)
- [AI & ML Forecasting Integration](#-ai--ml-forecasting-integration)
- [Core API Modules & Endpoints Overview](#-core-api-modules--endpoints-overview)
- [Database Schema & Seed Credentials](#-database-schema--seed-credentials)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [License & Project Info](#-license--project-info)

---

## 🚀 Overview

**RestoMind API** is an enterprise-grade, multi-tenant backend engine built with **NestJS 11**, **MongoDB (Mongoose 9)**, and **TypeScript**. Designed for modern restaurant networks, cloud kitchens, and bakery chains, RestoMind combines operational restaurant management (order pipeline, catalog, FIFO inventory, suppliers, waste audit) with **AI-driven demand forecasting, smart daily production planning, and automated inventory replenishment**.

Whether managing independent outlets or multi-brand restaurant networks, RestoMind API guarantees strict tenant data isolation, multi-restaurant order group checkouts, real-time analytics, and seamless AI microservice interoperability.

---

## 🌐 Ecosystem Repositories

| Component | Repository Link | Tech Stack | Description |
| :--- | :--- | :--- | :--- |
| **Backend API** | [RestoMindAPI](https://github.com/KhaledAlmorse/RestoMindAPI) | NestJS 11, MongoDB, TypeScript | Core RESTful backend, authentication, multi-tenant DB engine |
| **Frontend Web App** | [restumint-app](https://github.com/AhmedMohO/restumint-app) | Next.js, React, Tailwind CSS | Merchant & Admin dashboard interface |
| **AI Prediction Engine** | [prediction-model](https://github.com/AmiraElsa3id/prediction-model) | Python, FastAPI, ML Models | Forecasting engine for weekly demand & inventory |

---

## ✨ Key Features

### 🤖 AI-Powered Intelligence & Forecasting
* **Weekly Demand Predictions**: Integrates with a Python AI microservice to generate machine-learning sales & ingredient consumption forecasts.
* **Smart Production Planning**: Auto-computes optimized daily baking/cooking schedules based on projected sales vs. current stock levels.
* **Automated Recommendations**: AI-driven discount suggestions, stock replenishment alerts, waste mitigation strategies, and best-selling product highlights.

### 🔐 Advanced Security & Token Revocation
* **Refresh Token Rotation (RTR)**: Single-use Refresh Tokens. Generating a new Access Token automatically revokes the old Refresh Token and issues a new pair.
* **Dual-Token Logout Invalidation**: Revokes Access Tokens, explicit Refresh Tokens, and records `tokensRevokedAt` timestamps to guarantee that logged-out tokens can never generate new sessions.
* **Multi-Role RBAC**: Strict permission enforcement across `admin`, `manager`, `staff`, and `customer` roles.

### 📥 Bulk CSV Import Pipeline & Detailed Failure Diagnostics
* **Multi-Category Imports**: Bulk import capabilities for `menu_items`, `ingredients`, `recipes`, `inventory_transactions`, and `sales_history`.
* **Prerequisite Dependency Guards**: Validates relational dependencies prior to execution (e.g. menu items & ingredients before recipes).
* **Sanitized Failure Reason Tracking**: Exposes user-safe `failureReason` field on `GET /imports` and `GET /imports/:id` while preserving detailed row-level error arrays and keeping internal stack traces safe in server logs.

### 📦 Comprehensive Inventory & Supply Chain Management
* **Batch Tracking & Expiry Management**: FIFO inventory batch tracking with shelf-life metrics and automated expiration warnings.
* **Supplier & Purchase Order Workflows**: Supplier lead times, purchase order creation, approval, and receiving with auto-updated inventory batches.
* **Waste Tracking & Audit Logs**: Detailed waste logging (spoilage, expiration, damage) with cost impact analytics.

---

## 🔒 Security & Token Lifecycle Architecture

RestoMind API uses a state-of-the-art authentication lifecycle designed to prevent session hijacking and token theft:

```
[LOGIN] ──────────────────> Issue 15m Access Token + 7d Refresh Token
                                  │
[REFRESH / TOKEN RENEWAL] ──> Validate Current Refresh Token
                                  │
                             Revoke OLD Refresh Token (jti recorded in RevokedToken DB)
                                  │
                             Issue NEW Access Token + NEW Refresh Token (RTR)
                                  │
[LOGOUT] ─────────────────> Revoke Access Token (jti)
                             Revoke Refresh Token (jti)
                             Update User.tokensRevokedAt = timestamp
                             (Post-logout refresh attempts return 401 Unauthorized)
```

---

## 🛠 System Architecture & Tech Stack

| Layer | Technology / Library | Purpose |
| :--- | :--- | :--- |
| **Framework** | [NestJS 11](https://nestjs.com/) | Progressive Node.js framework for scalable server-side code |
| **Language** | [TypeScript 5.7](https://www.typescriptlang.org/) | Strongly typed JavaScript execution environment |
| **Database** | [MongoDB](https://www.mongodb.com/) + [Mongoose 9](https://mongoosejs.com/) | NoSQL Document database & Object Data Modeling |
| **Authentication** | [NestJS JWT](https://jwt.io/) + [bcrypt](https://www.npmjs.com/package/bcrypt) | Dual-token authentication (RTR), password hashing, OTP verification |
| **File Storage** | [Cloudinary](https://cloudinary.com/) + [Multer](https://github.com/expressjs/multer) | Cloud asset management for product & restaurant imagery |
| **Mailing** | [Nodemailer](https://nodemailer.com/) | Transactional email & OTP verification code delivery |
| **Task Scheduling** | `@nestjs/schedule` | Automated background cron jobs for payment sweeper & stock monitoring |
| **AI Integration** | RxJS HTTP Client & Bedrock Gateway | RESTful communication with Python Forecasting Microservice |

---

## 🛡 Role-Based Access Control (RBAC)

RestoMind API enforces strict authorization levels across four main user roles:

| Role | Scope | Key Capabilities |
| :--- | :--- | :--- |
| `admin` | System-Wide | Full access across all restaurants, user management, partnership approvals, system configuration. |
| `manager` | Assigned Restaurant | Manages restaurant profile, staff accounts, products, recipes, ingredients, inventory, suppliers, purchase orders, sales. |
| `staff` | Assigned Restaurant | Processes orders, manages inventory batches, records stock transactions & waste reports, receives purchase orders. |
| `customer` | Public / Consumer | Browses active products & offers, manages shopping cart, places multi-restaurant order groups, manages saved addresses & favorites. |

---

## 📂 Directory Structure

```text
RestoMindAPI/
├── src/
│   ├── main.ts                       # Application entrypoint & global validation pipes
│   ├── app.module.ts                 # Master module registering all feature modules
│   ├── global.module.ts              # Global Auth & Guard bindings
│   ├── Common/                       # Shared guards, decorators, filters, DTOs & AI Client
│   │   ├── Guards/                   # AuthGuard & RolesGuard
│   │   ├── Services/                 # TokenService, AiClientService & UploadCloudFileService
│   │   └── Types/                    # Shared TypeScript interfaces & enums
│   ├── DB/                           # Mongoose schemas, data models & repositories
│   ├── auth/                         # Authentication, RTR, OTP & address management
│   ├── user/                         # User management (RBAC & staff assignment)
│   ├── restaurant/                   # Multi-tenant restaurant entity management
│   ├── categories/                   # Menu item categories
│   ├── products/                     # Product catalog & recipe definitions
│   ├── ingredients/                  # Raw ingredient management & stock thresholds
│   ├── inventory/                    # Inventory batches & stock movement transactions
│   ├── suppliers/                    # Vendor profiles & lead-time data
│   ├── purchase-orders/              # Supply purchase order creation, approval, & receiving
│   ├── cart/                         # Shopping cart session management
│   ├── orders/                       # Single and Multi-restaurant Order Groups
│   ├── offers/                       # Promotional discounts & deal management
│   ├── favorites/                    # Customer favorite product lists
│   ├── sales/                        # POS sales transactions & revenue records
│   ├── dashboard/                    # Restaurant & Admin analytics endpoints
│   ├── production-planning/          # AI-generated daily production schedules
│   ├── weekly-prediction/            # AI weekly sales & ingredient demand forecasts
│   ├── recommendations/              # AI smart recommendations engine
│   ├── waste-reports/                # Spoilage & waste tracking events
│   ├── partnership-applications/     # Restaurant onboarding partner applications
│   ├── imports/                      # Bulk CSV import engine & failure diagnostics
│   └── scripts/                      # DB Seeding & Migration scripts
├── API_STRUCTURE_AND_ENDPOINTS.md    # Exhaustive endpoint documentation & payload specs
├── test/                             # End-to-end (E2E) & unit test suites
├── .env.example                      # Environment variables template
├── package.json                      # Project metadata & dependencies
└── tsconfig.json                     # TypeScript configuration
```

---

## ⚡ Getting Started

### Prerequisites

Ensure you have the following installed on your machine:
* **Node.js**: `v18.x` or `v20.x`+
* **npm** or **pnpm**
* **MongoDB**: Local MongoDB instance (v6.0+) or MongoDB Atlas connection string

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/KhaledAlmorse/RestoMindAPI.git
   cd RestoMindAPI
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

### Environment Variables

Create a `.env` file in the project root directory by copying `.env.example`:

```bash
cp .env.example .env
```

Configure your `.env` variables:

```env
# Server & Database Configuration
PORT=3000
DB_URL=mongodb://127.0.0.1:27017/restomind
FRONTEND_URL=http://localhost:3000

# Authentication & JWT Secrets
ACCESS_TOKEN_SECRET=your_super_secret_access_key
ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=your_super_secret_refresh_key
REFRESH_EXPIRES_IN=7d
RESET_PASSWORD_TOKEN_SECRET=your_super_secret_reset_key
RESET_PASSWORD_EXPIRES_IN=15m

# Transactional Email (Nodemailer)
USER_EMAIL=your-email@gmail.com
USER_PASS=your-app-password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
EMAIL_SECURE=true

# Security Encryption & Hashing
Encryption_SECRET=your_32_character_encryption_key
SALT_ROUNDS=10

# Cloudinary Storage Configuration
CLOUD_NAME=your_cloud_name
CLOUD_API_KEY=your_api_key
CLOUD_API_SECRET=your_api_secret
CLOUD_FOLDER_NAME=restomind

# AI Forecasting Microservice
AI_SERVICE_URL=http://127.0.0.1:8200
AI_SHARED_SECRET=your_ai_microservice_shared_secret
```

### Database Seeding

Seed the database with pre-configured initial data (Admin, Manager, El-Sultan Bakery, Categories, Ingredients, Products, Recipes, Inventory Batches, Suppliers, and Offers):

```bash
npm run seed
```

### Running the Application

```bash
# Development Mode
npm run start

# Watch / Hot Reload Mode (Recommended for development)
npm run start:dev

# Production Build
npm run build
npm run start:prod
```

---

## 📥 Bulk Import Engine & Failure Handling

RestoMind API provides a multi-tenant bulk import system allowing managers to upload CSV files for catalog and historical data:

### Import Lifecycle Flow

```
POST /imports ──> POST /imports/:id/preview ──> POST /imports/:id/confirm
                        (Top 5 mapped rows)              │
                                                         ▼
                                                [Validation & Strategy]
                                                         │
                                            ┌────────────┴────────────┐
                                            ▼                         ▼
                                    Status: COMPLETED         Status: FAILED
                                    (failureReason: null)     (failureReason populated)
```

### Safe Failure Reason Output (`GET /imports`)
When an import job fails due to prerequisite dependency guards, validation errors, or unexpected system exceptions, the system populates a user-safe `failureReason` field without exposing database stack traces:

```json
{
  "_id": "669fc1234567890abcdef124",
  "importType": "recipes",
  "fileName": "recipes.csv",
  "status": "failed",
  "failureReason": "Cannot import recipes before onboarding menu items. Please import menu_items first.",
  "errors": [
    {
      "row": 0,
      "column": "productId",
      "message": "Cannot import recipes before onboarding menu items. Please import menu_items first."
    }
  ]
}
```

---

## 🤖 AI & ML Forecasting Integration

RestoMind API integrates with an external Python-based AI microservice repository ([prediction-model](https://github.com/AmiraElsa3id/prediction-model)) via `AiClientService`.

```
┌─────────────────┐        HTTP / JSON         ┌──────────────────────────────┐
│  RestoMind API  │ ────────────────────────>  │   AI Forecasting Service     │
│   (NestJS)      │ <────────────────────────  │   (Python / FastAPI / ML)    │
└─────────────────┘  Shared Secret Handshake   └──────────────────────────────┘
```

* **Weekly Predictions (`GET /predictions`)**: Pulls ML forecasting data for weekly sales & ingredient usage.
* **Production Planning (`POST /predictions/production-plan`)**: Uses AI forecast numbers to suggest exact batch quantities to prepare, minimizing daily waste.
* **Recommendations (`GET /recommendations`)**: Analyzes historical sales velocity and stock levels to generate actionable business alerts.

---

## 📋 Core API Modules & Endpoints Overview

| Module | Base Path | Description | Access |
| :--- | :--- | :--- | :--- |
| **Auth** | `/auth` | Authentication, Sign Up, Login, Token Renewal (RTR), Logout, Address Book | Public / Authenticated |
| **Users** | `/users` | User management, role assignment, status toggle, manager safety checks | `admin`, `manager` |
| **Restaurants** | `/restaurants` | Multi-tenant restaurant entity CRUD & owner bindings | `admin`, `manager`, `staff` |
| **Categories** | `/categories` | Menu classification hierarchy | Public / Manager |
| **Products** | `/products` | Catalog items, variants, prices & recipe definitions | Public / Manager |
| **Ingredients** | `/ingredients` | Inventory items, units, minimum stock & safety thresholds | `manager`, `staff` |
| **Inventory** | `/inventory` | Batches, FIFO stock movements, stock adjustments | `manager`, `staff` |
| **Suppliers** | `/suppliers` | Supplier profiles, contact info, and lead time metrics | `manager`, `staff` |
| **Purchase Orders** | `/purchase-orders` | Supply purchase order creation, approval, & receiving into inventory | `manager`, `staff` |
| **Cart** | `/cart` | Customer cart management supporting multi-restaurant items | `customer` |
| **Orders** | `/orders` | Order creation, status pipeline, Order Groups | `customer`, `staff`, `manager` |
| **Offers** | `/offers` | Promotional discounts & banner campaign management | Public / Manager |
| **Favorites** | `/favorites` | Customer saved favorite items | `customer` |
| **Sales** | `/sales` | POS sales transaction logging & historical revenue streams | `manager` |
| **Dashboard** | `/dashboard` | Executive KPIs, order distribution, ingredient consumption | `admin`, `manager` |
| **Production Plan** | `/predictions/production-plan` | AI-assisted production schedule generation | `manager` |
| **Waste Reports** | `/waste-reports` | Logging ingredient & product waste events with financial audit | `manager`, `staff` |
| **Predictions** | `/predictions` | Fetch AI sales & ingredient forecasts | `manager` |
| **Recommendations**| `/recommendations` | AI smart operational suggestions | `manager` |
| **Partnerships** | `/partnership-applications` | Restaurant partner request submissions & admin review | Public / `admin` |
| **Imports** | `/imports` | Bulk CSV data import engine & failure diagnostics | `manager`, `admin` |

> 📖 For full request/response DTO schemas, query parameters, and example JSON payloads, refer to [`API_STRUCTURE_AND_ENDPOINTS.md`](./API_STRUCTURE_AND_ENDPOINTS.md).

---

## 🔑 Database Schema & Seed Credentials

Running `npm run seed` sets up default sandbox accounts for immediate development & testing:

### Seed Accounts Credentials:

| Account Type | Email | Password | Assigned Entity / Role |
| :--- | :--- | :--- | :--- |
| **System Admin** | `admin@restomind.com` | `Password123!` | System Administrator (`admin`) |
| **Restaurant Manager** | `manager@restomind.com` | `Password123!` | Manager of **El-Sultan Bakery** (`manager`) |

### Seeded Mock Data Includes:
* **Restaurant**: *El-Sultan Bakery* (مخبز السلطان)
* **Categories**: Pastries (معجنات), Oriental Sweets (حلويات شرقية), Fresh Bread (خبز)
* **Ingredients**: Premium Flour (ING-001), Butter (ING-002), Sugar (ING-003), Milk (ING-004)
* **Products & Recipes**: Butter Croissant, Kunafa with Nuts, Fresh Baladi Bread
* **Suppliers**: Al-Nahar Flour Mills
* **Inventory**: Active inventory batch `FLOUR-PO-001` with stock history & waste logs.

---

## 🧪 Testing & Quality Assurance

RestoMind API includes unit tests and end-to-end (E2E) integration test suites powered by **Jest** and **Supertest**.

```bash
# Run all unit tests
npm run test

# Run specific auth security & RTR unit tests
npx jest src/auth/auth.service.spec.ts

# Run import failure reason unit tests
npx jest src/imports/imports.service.spec.ts

# Run tests with coverage report
npm run test:cov

# Run E2E integration tests
npm run test:e2e
```

---

## 📄 License & Credits

This project is created as part of the **RestoMind Graduation Project Ecosystem**.

* **Framework**: NestJS & Node.js
* **License**: UNLICENSED / Graduation Project Repository

---

<p align="center">
  Made with ❤️ by the RestoMind Team
</p>
