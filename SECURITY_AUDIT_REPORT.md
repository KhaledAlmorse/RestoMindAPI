# RestoMind Backend Security Audit Report

## Overall Security Score

**Overall Compliance:**  
**65%** (17 out of 23 Security Controls Implemented or Partially Implemented)

---

## Executive Summary

A comprehensive security audit of the RestoMind backend codebase was conducted against the specification detailed in `SECURITY_IMPLEMENTATION.md`. The codebase exhibits strong architectural foundations, particularly regarding core authentication, role-based authorization (RBAC), multi-tenant isolation, DTO input validation, and standardized exception handling.

### Biggest Strengths:
1. **Manager Tenant Scoping (Verified Closed Gap):** Contrary to earlier review concerns, all major list/query endpoints (`GET /users`, `GET /products`, `GET /orders`, `GET /offers`, etc.) strictly enforce manager/staff tenant boundaries server-side derived from the authenticated caller's JWT context, completely ignoring client-supplied `restaurantId` overrides.
2. **DTO Input Sanitization:** Global `ValidationPipe` is strictly configured with `whitelist: true`, `forbidNonWhitelisted: true`, and `transform: true` in `main.ts`.
3. **Multi-Token Auth & Revocation Blacklist:** JWT handling via `AuthGuard` supports multi-token types (`access`, `refresh`), token revocation checking via `RevokeTokenRepository`, and password-change invalidation.
4. **Resilient AI Client Layer:** `AiClientService` centralizes outbound HTTP requests with exponential backoff retries, timeouts, non-retryable 4xx handling, and header forwarding (`X-RestoMind-Key`).

### Biggest Risks:
1. **Insecure CORS Configuration (`main.ts`):** `app.enableCors({ origin: true, credentials: true })` reflects back *any* requesting origin while allowing credentials, exposing authenticated sessions to potential Cross-Origin attacks from untrusted domains.
2. **Missing HTTP Security Headers (Helmet):** `helmet` is not installed or registered, leaving the application vulnerable to clickjacking (`X-Frame-Options`), MIME-sniffing, and missing HSTS controls.
3. **Missing Rate Limiting:** `@nestjs/throttler` is not integrated. Critical auth endpoints (`/auth/login`, `/auth/signUp`, `/auth/send-otp`, `/partnership-applications`) and expensive AI trigger endpoints are vulnerable to brute-force and Denial-of-Service (DoS) attacks.
4. **Missing Payload & Upload Size Limits:** Neither Express body parsers nor Multer interceptors configure payload size caps (`MAX_JSON_BODY_SIZE`, `MAX_UPLOAD_SIZE`), risking memory exhaustion via oversized requests.
5. **Lack of Startup Environment Validation:** No schema validation exists on startup (`process.env`), allowing the application to launch with missing or weak secrets.

---

## Compliance Table

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | JWT Multi-Token-Type Auth | ✅ Implemented | `AuthGuard` handles access/refresh types with blacklist checking & `passwordChangedAt` invalidation. |
| 2 | Password Hashing | ✅ Implemented | `bcrypt` with 10 salt rounds used consistently across signup and user creation. |
| 3 | Role-Based Access Control (RBAC) | ✅ Implemented | `@Auth()` decorator composed with `AuthGuard` & `RolesGuard` enforcing `admin`, `manager`, `staff`, `customer`. |
| 4 | Tenant Isolation (General) | ✅ Implemented | Cross-tenant access attempts return `404` or `403` appropriately across services. |
| 5 | **Manager `restaurantId` Scoping on List Endpoints** | ✅ Implemented | Server-side forcing of `currentUser.restaurantId` in `user.service.ts`, `products.service.ts`, `orders.service.ts`, etc. |
| 6 | Standardized Exception Handling | ✅ Implemented | Clean use of NestJS standard exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`, `ConflictException`). |
| 7 | DTO Validation (`ValidationPipe`) | ✅ Implemented | Configured globally in `main.ts` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. |
| 8 | Soft-Delete Convention | ✅ Implemented | Applied uniformly across Users, Restaurants, Products, Categories, Offers, Recipes. |
| 9 | Revoked-Token Blacklist | ✅ Implemented | Checked on every guarded request via `RevokeTokenRepository`. |
| 10 | Shared Upload MIME / Extension Filter | 🟡 Partial | `multer.utils.ts` checks file extensions (`.jpg`, `.png`, etc.), but does not verify magic bytes/MIME or cap file size. |
| 11 | CORS Allow-List | ⚠ Needs Improvement | `main.ts` sets `origin: true`, reflecting any requesting origin with `credentials: true`. |
| 12 | Helmet Security Headers | ❌ Missing | Package not installed; headers like `X-Frame-Options` and `X-Content-Type-Options` are absent. |
| 13 | Rate Limiting (3 Tiers) | ❌ Missing | No rate limiting on Global, Auth, or AI-triggering endpoints. |
| 14 | Request Body & Upload Size Limits | ❌ Missing | No explicit body size limits configured on Express or Multer. |
| 15 | AI Microservice Authentication | 🟡 Partial | `AiClientService` forwards `X-RestoMind-Key` if `AI_SHARED_SECRET` is set, but degrades silently without error when missing. |
| 16 | Structured Logging & Sensitive Value Redaction | ❌ Missing | Standard Nest `Logger` used without redaction interceptor for passwords/JWTs/tokens. |
| 17 | Production Exception Detail Suppression | 🟡 Partial | Standard NestJS exception filter used; no explicit production filter suppressing unexpected error details/stacks. |
| 18 | Swagger Lockdown in Production | 🟡 Partial | Swagger decorators present on DTOs/controllers, but `SwaggerModule` is not currently mounted in `main.ts`. |
| 19 | File Upload Extension & Size Double-Check | 🟡 Partial | Extension check exists; double verification against MIME type and size limits is missing. |
| 20 | Environment Startup Validation | ❌ Missing | Application boots without validating presence/length of required JWT secrets or DB URLs. |
| 21 | Production Infrastructure (HTTPS, Proxy, Docker) | ❌ Missing | No Dockerfile present; `trust proxy` setting not enabled in Express. |
| 22 | Distinct JWT Secrets per Token Type | 🟡 Partial | `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and `RESET_PASSWORD_TOKEN_SECRET` exist; `setup` tokens fall back to `ACCESS_TOKEN_SECRET`. |
| 23 | Generic Login Error Messages | ⚠ Needs Improvement | Uses generic text ("Invalid Email or password"), but throws `ConflictException` (HTTP 409) instead of `UnauthorizedException` (HTTP 401) or `BadRequestException`. |

---

## Missing Implementations

1. **Helmet HTTP Security Headers**
   - **Affected Files:** `package.json`, `src/main.ts`
   - **Why It Matters:** Leaves application vulnerable to clickjacking, MIME-sniffing, and drive-by content injection.
   - **Priority:** High

2. **Rate Limiting (`@nestjs/throttler`)**
   - **Affected Files:** `package.json`, `src/app.module.ts`, `src/auth/auth.controller.ts`, `src/partnership-applications/partnership-applications.controller.ts`, `src/assistant/assistant.controller.ts`
   - **Why It Matters:** Protects against credential brute-forcing, OTP flooding, and AI infrastructure denial of service.
   - **Priority:** High

3. **Request Payload Size Limits**
   - **Affected Files:** `src/main.ts`, `src/Common/Utils/multer.utils.ts`
   - **Why It Matters:** Prevents memory exhaustion attacks via massive JSON payloads or multi-gigabyte file uploads.
   - **Priority:** Medium

4. **Environment Startup Validation**
   - **Affected Files:** `src/main.ts`, `src/Common/Config/env.validation.ts` (new)
   - **Why It Matters:** Prevents silent deployment failures or running in production with default/empty secrets.
   - **Priority:** Medium

5. **Sensitive Log Masking Interceptor**
   - **Affected Files:** `src/Common/Interceptors/logging.interceptor.ts` (new), `src/app.module.ts`
   - **Why It Matters:** Prevents leakage of passwords, OTPs, and JWT bearer tokens into application logs.
   - **Priority:** High

6. **Docker Configuration & Non-Root Setup**
   - **Affected Files:** `Dockerfile` (new), `.dockerignore` (new)
   - **Why It Matters:** Ensures reproducible, hardened container builds that run without root privileges.
   - **Priority:** Medium

---

## Incorrect Implementations

1. **CORS Configuration (`src/main.ts`)**
   - **Current Code:**
     ```ts
     app.enableCors({
       origin: true,
       methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
       credentials: true,
     });
     ```
   - **Why It Is Incorrect:** `origin: true` dynamically mirrors whatever `Origin` header the client sends while setting `Access-Control-Allow-Credentials: true`. This effectively bypasses CORS security for authenticated web clients.
   - **Correction Needed:** Parse `ALLOWED_ORIGINS` environment variable into an explicit array and validate incoming origin headers against it.

2. **HTTP Status Code on Login Failure (`src/auth/auth.service.ts`)**
   - **Current Code:**
     ```ts
     if (!user || !CompareHash(password, user.password)) {
       throw new ConflictException('Invalid Email or password');
     }
     ```
   - **Why It Is Incorrect:** Returning HTTP 409 `ConflictException` for bad login credentials violates HTTP semantics and standard API expectations (should be HTTP 401 `UnauthorizedException`).
   - **Correction Needed:** Throw `UnauthorizedException('Invalid email or password')`.

3. **Token Secret for Setup Flow (`src/user/user.service.ts`)**
   - **Current Code:**
     ```ts
     const setupToken = this.tokenService.generate(..., {
       secret: process.env.ACCESS_TOKEN_SECRET,
       expiresIn: '72h',
     });
     ```
   - **Why It Is Incorrect:** Staff account activation setup tokens use `ACCESS_TOKEN_SECRET` rather than a dedicated `JWT_SETUP_SECRET`.
   - **Correction Needed:** Use `process.env.JWT_SETUP_SECRET` for setup tokens.

---

## Security Risks

- **Brute Force Risk:** Without rate limiting on `/auth/login`, `/auth/send-otp`, and `/auth/forgot-password`, attackers can execute automated credential stuffing and OTP enumeration attacks.
- **Cross-Site Request Hijacking / CORS Abuse:** Permissive CORS allows malicious third-party websites visited by authenticated users to issue cross-domain requests.
- **Resource Exhaustion (DoS):** Uncapped body parsers and AI endpoint calls allow malicious clients to consume server memory and upstream Bedrock/Forecasting quota.
- **Information Disclosure:** Unredacted logs risks writing JWTs and password reset tokens into system logs or external log aggregators.

---

## OWASP API Security Top 10 Mapping

| OWASP Category | Finding / Gap | Severity |
|---|---|---|
| **API1:2023 Broken Object Level Authorization** | Tenant scoping on list endpoints verified **SECURE** ✅ | Low Risk |
| **API2:2023 Broken Authentication** | Missing rate limits on login/OTP, HTTP 409 status code on bad login, shared setup JWT secret | High Risk |
| **API4:2023 Unrestricted Resource Consumption** | Missing rate limiting, uncapped JSON body size, missing file upload size limits | High Risk |
| **API7:2023 Server Side Request Forgery / Integration** | AI Microservice shared secret optional/degrades silently without validation | Medium Risk |
| **API8:2023 Security Misconfiguration** | Wildcard CORS (`origin: true`), missing Helmet headers, unvalidated environment variables at startup | High Risk |
| **API9:2023 Improper Inventory Management** | Swagger endpoints not gated or hardened for production deployment | Low Risk |

---

## Files That Need Modification

| File | Required Changes | Priority |
|---|---|---|
| `src/main.ts` | Configure explicit CORS allow-list, add Helmet middleware, add body size limits, configure `trust proxy`. | High |
| `src/app.module.ts` | Register `ThrottlerModule` (Rate Limiter) and global Logging/Sanitization Interceptor. | High |
| `src/auth/auth.service.ts` | Change login failure exception from `ConflictException` (409) to `UnauthorizedException` (401). | Medium |
| `src/user/user.service.ts` | Use `JWT_SETUP_SECRET` instead of `ACCESS_TOKEN_SECRET` for staff invitation setup tokens. | Low |
| `src/Common/Utils/multer.utils.ts` | Add explicit `fileSize` limit to Multer storage configuration and MIME magic check. | Medium |
| `.env.example` | Add missing security variables (`ALLOWED_ORIGINS`, `JWT_SETUP_SECRET`, rate limit thresholds). | Medium |

---

## Recommended Implementation Order

### Phase 1: Critical Security Hardening
1. Fix CORS configuration in `src/main.ts` to restrict origins via `ALLOWED_ORIGINS`.
2. Add `helmet` middleware in `src/main.ts`.
3. Fix HTTP status code on login failure in `src/auth/auth.service.ts`.

### Phase 2: Rate Limiting & Resource Protection
1. Install and configure `@nestjs/throttler` in `src/app.module.ts`.
2. Apply strict rate limits to auth, partnership application, and AI assistant routes.
3. Configure JSON, URL-encoded, and Multer file upload size limits.

### Phase 3: Secret Hygiene & Environment Validation
1. Create startup environment variable validation schema.
2. Separate `JWT_SETUP_SECRET` from `ACCESS_TOKEN_SECRET`.
3. Add sensitive data redaction interceptor for system logs.

### Phase 4: Production Infrastructure Hardening
1. Create multi-stage non-root `Dockerfile` and `.dockerignore`.
2. Enable `trust proxy` for reverse-proxy deployments.
