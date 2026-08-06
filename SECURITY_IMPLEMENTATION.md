# Backend Security Implementation Guide

## 1. Overview

This document is a production-readiness security implementation guide for the RestoMind backend (NestJS + MongoDB/Mongoose, JWT authentication, role-based authorization, REST API, Swagger, AI microservice integration, Docker-ready). Its purpose is to take the backend from its current state to a production-grade security posture **without breaking any existing endpoint, request/response shape, or frontend integration** — every recommendation below is additive (new middleware, new guards, new environment-driven configuration) rather than a rewrite of existing business logic.

**A note on how this document was built:** it is grounded in the architecture, conventions, and security decisions already established and confirmed across this project's design and review process — the JWT multi-token-type pattern, the RBAC/guard structure, the standardized-exception convention, tenant-isolation rules, and the AI integration contracts. Where a security control has been explicitly confirmed as already implemented, it is marked ✅. Where something was never addressed in any prior design or review, it is marked ⚠️ or ❌ rather than assumed — **each finding below should be verified against the actual current source before being treated as ground truth**, the same way any audit finding should be spot-checked, not taken on faith. This document is the checklist to verify against and implement from, not a substitute for reading the code.

---

## 2. Current Security Review

### ✅ Already Implemented (confirmed)
- JWT-based authentication with a multi-token-type pattern (`access`, `refresh`, `reset-password`, `setup`) handled by one unified `AuthGuard`/`TokenService`, rather than separate ad hoc mechanisms per flow.
- Password storage is hashed (never plaintext), applied consistently across all account-creation paths, including secure setup-token-based onboarding (Partnership and Staff flows) that avoids ever transmitting a password directly.
- Role-Based Access Control via a composed `@Auth()`/`@Roles()` decorator and `RolesGuard`, covering four roles (`admin`, `manager`, `staff`, `customer`).
- Tenant isolation / ownership scoping: manager- and staff-scoped resources are restricted to the caller's own restaurant, with cross-tenant access attempts returning `404` (not `403`), to avoid confirming the existence of another tenant's resource.
- Standardized exception handling (`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`) applied consistently — no silent failures or unhandled generic errors.
- DTO validation via `class-validator`, with a global `ValidationPipe` configured with `whitelist`/`forbidNonWhitelisted`/`transform` (confirmed by the fact that removing a field from a DTO is sufficient to block clients from sending it — this only works if `forbidNonWhitelisted` is active).
- Soft-delete convention applied uniformly (Users, Restaurants, Products, Categories, Offers) — no accidental hard deletes of business-critical data.
- Revoked-token blacklist checked on every authenticated request, invalidating tokens on logout and refresh rotation.
- A shared, reusable file-upload MIME-type validation service used across every upload endpoint.
- Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiOkResponse`, etc.) present on documented endpoints.

### ⚠️ Missing (not addressed anywhere in prior design/review — treat as unverified gaps, not confirmed absent)
- CORS configuration (allowed origins, credentials handling).
- Helmet / HTTP security headers.
- Rate limiting — was recommended once, specifically for the public partnership-application submission endpoint, but never confirmed as a global policy.
- Request body / payload size limits (JSON, multipart, URL-encoded).
- Structured logging with sensitive-value masking.
- Startup-time environment variable validation.
- Production-mode Swagger lockdown.
- Explicit authentication between the NestJS backend and the external AI microservice (the AI integration design specifies retry/backoff/timeout behavior extensively, but never specifies how the AI service authenticates the backend's calls to it, or vice versa).

### ❌ Needs Improvement (partially implemented, with a specific known gap identified during prior review)
- **Manager-scoped `restaurantId` filtering on list endpoints** (e.g. `GET /users`): this was explicitly flagged during the Staff Flow design review as needing verification — if a manager can pass an arbitrary `restaurantId` query parameter and receive results for a restaurant that isn't their own, that is a live cross-tenant data leak, not a theoretical one. This must be confirmed fixed (server-side forcing of the caller's own `restaurantId`, ignoring any client-supplied value) before this document's Authorization Review (Section 10) can be considered closed.
- JWT secret and expiration configuration: a multi-token-type pattern exists, but concrete expiry durations and whether each token type uses a distinct signing secret have not been formally specified anywhere — see Section 9.
- Generic authentication error messages: not yet confirmed whether login failures distinguish "wrong password" from "no such account" in their response — see Section 9.

---

## 3. Environment Variables

Create (or extend) `.env.example` with every security-relevant variable below, each with a safe example value and no real secrets committed.

```dotenv
# ---- Core ----
NODE_ENV=development                  # development | staging | production
PORT=3000

# ---- Database ----
MONGODB_URI=mongodb://localhost:27017/restomind

# ---- JWT / Auth ----
JWT_ACCESS_SECRET=change-me-access-secret-min-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=change-me-refresh-secret-min-32-chars
JWT_REFRESH_EXPIRES_IN=7d
JWT_RESET_SECRET=change-me-reset-secret-min-32-chars
JWT_RESET_EXPIRES_IN=15m
JWT_SETUP_SECRET=change-me-setup-secret-min-32-chars
JWT_SETUP_EXPIRES_IN=24h

# ---- CORS ----
ALLOWED_ORIGINS=https://app.restomind.com,https://admin.restomind.com

# ---- Rate Limiting ----
ENABLE_RATE_LIMIT=true
RATE_LIMIT_TTL=60                     # seconds
RATE_LIMIT_LIMIT=100                  # requests per TTL window, global default
LOGIN_RATE_LIMIT=5                    # stricter limit for auth endpoints, per TTL window
AI_ENDPOINT_RATE_LIMIT=20             # protects the AI microservice from retry storms

# ---- Request Size ----
MAX_JSON_BODY_SIZE=1mb
MAX_URLENCODED_BODY_SIZE=1mb
MAX_UPLOAD_SIZE=5mb

# ---- Security Headers / Middleware ----
ENABLE_HELMET=true
ENABLE_COMPRESSION=true
TRUST_PROXY=true                      # required when behind a reverse proxy / load balancer

# ---- Swagger ----
ENABLE_SWAGGER=true                   # should be false (or auth-gated) in production
SWAGGER_PATH=/api/docs

# ---- AI Microservice Integration ----
AI_SERVICE_BASE_URL=https://ai.restomind.internal
AI_SERVICE_API_KEY=change-me-shared-secret
AI_SERVICE_TIMEOUT_MS=8000
AI_SERVICE_MAX_RETRIES=3

# ---- Logging ----
LOG_LEVEL=info                        # error | warn | info | debug
```

### Variable Explanations
| Variable | Purpose |
|---|---|
| `JWT_*_SECRET` (four distinct secrets) | Each token type (`access`, `refresh`, `reset`, `setup`) should be signed with its **own** secret, not one shared secret. This means a leaked reset-token secret can't be used to forge a long-lived access token — see Section 9. |
| `ALLOWED_ORIGINS` | Comma-separated allow-list consumed by the CORS configuration (Section 4) — never `*` in production. |
| `RATE_LIMIT_*` / `LOGIN_RATE_LIMIT` / `AI_ENDPOINT_RATE_LIMIT` | Drive the three-tier rate-limiting strategy in Section 6. |
| `MAX_*_SIZE` | Enforced at the body-parser/multer level — see Section 8. |
| `ENABLE_HELMET` / `ENABLE_RATE_LIMIT` / `ENABLE_SWAGGER` | Feature flags so each control can be toggled per environment without a code change — useful for staging environments that need Swagger on but rate limiting relaxed, for example. |
| `TRUST_PROXY` | Required for rate limiting and IP-based logic to see the real client IP when the app sits behind a reverse proxy/load balancer, not the proxy's own IP. |
| `AI_SERVICE_API_KEY` | The shared secret authenticating backend → AI microservice calls — currently missing entirely from the integration design (Section 11). |
| `LOG_LEVEL` | Controls verbosity; `debug` should never be the default in production given the masking requirements in Section 12. |

---

## 4. CORS

**Current status:** ⚠️ Not confirmed configured — treat as open (or default NestJS behavior) until verified.

**Required improvements:** an explicit origin allow-list driven by `ALLOWED_ORIGINS`, rather than a wildcard or unconfigured default, with credentials support enabled only for the specific origins that need it (the authenticated web app), not globally.

**Implementation steps:**
1. In `main.ts`, parse `ALLOWED_ORIGINS` into an array at startup.
2. Configure `app.enableCors({...})` with:
   - `origin`: a function checking the request's origin against the parsed allow-list (reject with no CORS headers, not a 500, if it doesn't match).
   - `credentials: true` (only if cookies are ever used — if the app is purely bearer-token based, this can stay `false`).
   - `methods`: explicit list (`GET,POST,PATCH,PUT,DELETE,OPTIONS`).
   - `allowedHeaders`: explicit list including `Authorization`, `Content-Type`.
3. Confirm the public, unauthenticated endpoints (Offer browsing, partnership application submission) still work correctly for the marketplace frontend's origin specifically — CORS is about *which origins* can call the API, not about authentication, so tightening this must not be confused with adding auth to public routes.

**Configuration example:**
```ts
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim());
app.enableCors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
});
```

**Testing checklist:**
- [ ] Request from an allowed origin succeeds with correct `Access-Control-Allow-Origin` header.
- [ ] Request from a non-allow-listed origin is rejected.
- [ ] Preflight (`OPTIONS`) requests succeed for all methods actually used by the frontend.
- [ ] Existing frontend (web app + marketplace) continues to function unmodified after enabling the allow-list.

---

## 5. Helmet Security Headers

**Why it's needed:** Helmet sets a collection of HTTP response headers that mitigate common attacks (clickjacking, MIME-sniffing, cross-site scripting via missing CSP, etc.) with minimal configuration — a standard, low-risk baseline for any production API.

**Protections to enable:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (the API is not meant to be framed)
- `Strict-Transport-Security` (HSTS) — safe once HTTPS is enforced at the proxy (Section 17)
- `X-DNS-Prefetch-Control: off`
- Referrer-Policy set to a conservative value (`no-referrer` or `same-origin`)

**Protections to tune or disable:**
- Content-Security-Policy: **do not enable Helmet's default CSP as-is** if Swagger UI is served from this same app — the default CSP will block Swagger's inline scripts/styles. Either scope a custom CSP that allowlists the Swagger path, or disable CSP specifically for the `SWAGGER_PATH` route while keeping it (or leaving it off, since this is a pure JSON API with no rendered HTML for end users) on every other route.

**Implementation steps:**
1. Install and apply Helmet as global middleware in `main.ts`, gated by `ENABLE_HELMET`.
2. Explicitly configure or disable CSP as described above, rather than accepting Helmet's default for a mixed API+Swagger app.
3. Confirm the Swagger UI (Section 14) still renders correctly after Helmet is applied.

**Testing checklist:**
- [ ] Response headers include the protections listed above on a normal API route.
- [ ] Swagger UI still loads and functions correctly.
- [ ] No existing frontend behavior (e.g. iframe embedding, if ever used) is broken by `X-Frame-Options`.

---

## 6. Rate Limiting

Three tiers, not one blanket limiter:

**Global Rate Limiter:** applied to every route by default, protecting against generic abuse/scraping. Driven by `RATE_LIMIT_TTL`/`RATE_LIMIT_LIMIT`.

**Authentication Rate Limiter:** a stricter limit specifically on `POST /auth/login`, `POST /auth/signUp`, `POST /auth/forgot-password`, `POST /auth/send-otp`, and the public partnership-application submission endpoint — these are exactly the routes where brute-force or enumeration attacks matter most, and where the earlier project review already explicitly recommended rate limiting. Driven by `LOGIN_RATE_LIMIT`.

**AI Endpoint Limiter:** a separate, moderate limit on any endpoint that triggers a call to the external AI microservice (`/predictions/recalculate`, `/recommendations/scan-surplus`, manual import-triggered ingest, etc.) — this protects the AI service itself from being overwhelmed by rapid repeated manual triggers, which matters specifically because the AI integration design already includes retry-with-backoff logic that could compound into a retry storm under abuse. Driven by `AI_ENDPOINT_RATE_LIMIT`.

**Implementation steps:**
1. Add `@nestjs/throttler` (or equivalent) as a global guard for the default tier.
2. Override the throttler's limit via a route-level decorator (e.g. `@Throttle()`) on the auth and AI-triggering routes specifically, using the stricter env-driven values.
3. Ensure `TRUST_PROXY` (Section 3) is correctly configured so the limiter keys on the real client IP, not the reverse proxy's IP — otherwise every request appears to come from one IP and either everyone gets rate-limited together or no one does.

**Recommended limits:**
| Tier | Suggested Limit |
|---|---|
| Global | 100 requests / 60s per IP |
| Auth endpoints | 5 requests / 60s per IP |
| AI-triggering endpoints | 20 requests / 60s per IP (or per authenticated manager, if the throttler supports keying by user) |

**Testing checklist:**
- [ ] Exceeding the global limit returns `429` on a normal route.
- [ ] Exceeding the login limit returns `429` well before a meaningful brute-force attempt could succeed.
- [ ] AI-triggering routes are limited independently of the global tier.
- [ ] Legitimate, normal usage patterns (a manager refreshing a dashboard, a customer browsing offers) are never incidentally rate-limited.

---

## 7. Validation

**Current status:** ✅ largely already in place — a global `ValidationPipe` with `whitelist`/`forbidNonWhitelisted`/`transform` has been consistently relied upon throughout this project's design (e.g., removing a field from a DTO is sufficient to block clients from sending it).

**What to verify/formalize:**
- `whitelist: true` — strips any property not declared in the DTO.
- `forbidNonWhitelisted: true` — rejects the request outright (400) if an undeclared property is present, rather than silently stripping it — this is the stricter, more secure option and should be confirmed as the actual configuration, not just "whitelist" alone.
- `transform: true` — so path/query params are coerced to their declared types (e.g. numeric pagination params), preventing type-confusion bugs downstream.
- Every DTO across every module uses `class-validator` decorators matching its schema's actual constraints (required/optional, enums, `@IsMongoId()` on every reference field) — this has been the consistent convention throughout the project; this document's job is to confirm no module was missed, not to introduce the pattern.

**Implementation steps:**
1. Confirm `main.ts` registers exactly one global `ValidationPipe` with all three options above.
2. Spot-check a sample of DTOs across at least Auth, Users, Products, Offers, Orders, and Inventory modules for decorator completeness.

**Checklist:**
- [ ] Global `ValidationPipe` confirmed with `whitelist`, `forbidNonWhitelisted`, and `transform` all `true`.
- [ ] A request with an extra, undeclared field is rejected with `400`, not silently accepted.
- [ ] A request with a wrong-typed field (e.g. string where a number is expected) is rejected with a clear validation message.

---

## 8. Request Size Protection

**JSON limits:** cap the JSON body parser at `MAX_JSON_BODY_SIZE` (default `1mb`) — no legitimate request in this API (auth, orders, offers, etc.) needs a larger JSON payload; oversized payloads are either abuse or a client bug.

**Multipart limits:** cap file uploads at `MAX_UPLOAD_SIZE` (default `5mb`), enforced at the `multer`/upload-interceptor level, in addition to (not instead of) the existing shared MIME-type validation service (Section 15) — MIME validation checks *what* is uploaded, size limits protect against *how much*.

**URL-encoded limits:** cap at `MAX_URLENCODED_BODY_SIZE`, matching the JSON limit unless a specific form-encoded endpoint needs more.

**Implementation:**
```ts
app.use(json({ limit: process.env.MAX_JSON_BODY_SIZE ?? '1mb' }));
app.use(urlencoded({ extended: true, limit: process.env.MAX_URLENCODED_BODY_SIZE ?? '1mb' }));
// multer/FileInterceptor configured per-route with limits: { fileSize: <MAX_UPLOAD_SIZE in bytes> }
```

**Checklist:**
- [ ] A JSON payload above the limit is rejected with `413 Payload Too Large`, not a crash or timeout.
- [ ] A file upload above `MAX_UPLOAD_SIZE` is rejected cleanly.
- [ ] Existing legitimate uploads (product images, category images, partnership documents if applicable) still succeed comfortably under the new limit.

---

## 9. Authentication Hardening

**JWT:** confirm (or introduce) **distinct signing secrets per token type** (`access`, `refresh`, `reset`, `setup`) rather than one shared secret reused across all four — this limits the blast radius if any single secret is ever compromised, and matches the project's existing multi-token-type architectural pattern (the guard already discriminates by `tokenType`; giving each type its own secret is a natural, low-effort extension of a pattern already in place, not a new concept).

**Password hashing:** confirm bcrypt (cost factor ≥ 10–12) or argon2id is in use — both are acceptable; whichever is already implemented should simply be confirmed rather than switched, to avoid invalidating every existing stored hash.

**Secrets:** all four JWT secrets, the MongoDB URI, and the AI service API key must live only in environment variables, never committed, never logged (Section 12).

**Token expiration (recommended concrete values):**
| Token Type | Recommended Expiry | Reasoning |
|---|---|---|
| Access | 15 minutes | Short-lived by design; the refresh token exists specifically so this can stay short. |
| Refresh | 7 days | Long enough to avoid re-login friction, short enough to bound the damage of a leaked refresh token. |
| Reset (password) | 15 minutes | Matches the existing project convention of short-lived, single-use security-sensitive tokens. |
| Setup (account activation) | 24 hours | Longer than reset, since a new manager or staff member may not check their email immediately, but still bounded. |

**Cookies:** if refresh tokens are ever moved to httpOnly cookies (currently this project's documented flows are bearer-token based throughout), they must be `httpOnly`, `secure`, and `sameSite: strict` — not required today, noted for completeness only.

**Generic login errors:** `POST /auth/login` must return the same generic message ("Invalid email or password") whether the email doesn't exist or the password is wrong — never two different messages that let an attacker enumerate valid accounts. This directly mirrors the "404, not 403" principle already established elsewhere in this project's ownership-checking convention (never confirm the existence of something the caller shouldn't be able to distinguish) — the same reasoning, applied to login instead of cross-tenant resource access.

**Checklist:**
- [ ] Four distinct JWT secrets confirmed or introduced.
- [ ] Token expiry values match (or are deliberately adjusted from) the table above.
- [ ] Login failure messages confirmed generic (no account-existence leakage).
- [ ] No secret appears in source control, `.env` files are `.gitignore`d, only `.env.example` is committed.

---

## 10. Authorization Review

**Guards in place:** the unified `AuthGuard` (multi-token-type aware) and `RolesGuard` (reading `@Roles()` metadata) — this structure is sound and should not be rearchitected, only verified for completeness.

**The one confirmed, specific gap to close:** as noted in Section 2, `GET /users` (and any other endpoint accepting a `restaurantId` filter from a `manager`- or `staff`-role caller) must have that value **forced server-side from the caller's own token**, never trusted from the query string or body. This is not generic advice — it was explicitly identified during this project's own Staff Flow design review as a live risk requiring verification, and closing it is the single highest-priority item in this entire document.

**Implementation steps:**
1. Audit every controller method decorated for `manager` or `staff` access that also accepts any restaurant-identifying parameter from the client.
2. For each one, replace "trust the client-supplied value" with "read the caller's own `restaurantId` from the authenticated request, ignore or reject any client-supplied value that disagrees with it."
3. Re-run this exact check as a named item in the Section 18 pre-deployment checklist, not just once during this document's initial pass — this class of bug is easy to reintroduce when a new endpoint is added later.

**Checklist:**
- [ ] Every `manager`/`staff` endpoint's tenant-scoping verified to be server-derived, not client-supplied.
- [ ] A manager attempting to pass another restaurant's ID anywhere receives `404`, consistent with the project's established convention.
- [ ] No endpoint exists that is reachable without *some* guard, unless deliberately and explicitly public (Offer browsing, partnership submission, auth endpoints).

---

## 11. AI Service Security

**Current status:** ❌ Not addressed anywhere in the AI integration design. The retry, timeout, and fallback behavior for every AI microservice call has been specified in detail, but **no authentication mechanism between the backend and the AI service has ever been defined** — this is a genuine, concrete gap, not boilerplate advice.

**Required:**
- **Shared secret / header**: every outbound call from NestJS to the AI microservice must include a header (e.g. `X-Internal-Api-Key: <AI_SERVICE_API_KEY>`), and the AI microservice must reject any request missing or mismatching it. This prevents any other caller from reaching the AI service directly and prevents the AI service from being treated as a public endpoint.
- **Timeouts**: already established in the AI integration design (e.g. `AI_SERVICE_TIMEOUT_MS`) — confirm this is actually wired into the HTTP client used for these calls, not just documented intent.
- **Retries**: already established (exponential backoff, capped attempts) — confirm the retry logic never retries on a `4xx` (client-error, e.g. malformed payload) response, only on timeouts/`5xx`/network failures, since retrying a request the AI service is correctly rejecting just wastes the retry budget.

**Implementation steps:**
1. Add `AI_SERVICE_API_KEY` to the shared HTTP client configuration used for every AI-calling service (`AiIngestService` and any prediction/recommendation service built on top of it).
2. Add the corresponding header-check on the AI microservice side (outside this backend's codebase, but must be coordinated with whoever owns that service).
3. Confirm the existing retry logic distinguishes retryable (timeout, `5xx`) from non-retryable (`4xx`) failures.

**Checklist:**
- [ ] Every AI-calling service sends the shared-secret header.
- [ ] A request to the AI service with a missing/wrong key is rejected (verify against the AI service, not just the backend).
- [ ] Retry logic confirmed to skip retries on `4xx` responses.
- [ ] Timeout value confirmed actually applied to the HTTP client, not just present in `.env.example`.

---

## 12. Logging Security

**Never log:**
- Passwords (plaintext or hashed), JWTs, OTP codes, reset/setup tokens.
- Full request bodies for authentication endpoints (login, signup, reset, setup) — these routes' bodies contain exactly the values that must never be logged.
- The `Authorization` header, in full or in part.

**Masking approach:**
- For any general request/response logging middleware, explicitly redact the `Authorization` header and any field named `password`, `token`, `otp`, `secret`, or matching a small denylist, replacing the value with `"[REDACTED]"` rather than omitting the field entirely (so the log shape stays consistent for debugging).
- Mask emails and phone numbers in non-essential logs (e.g. `j***@example.com`) where full precision isn't needed for the log's purpose — full values remain necessary in structured audit-trail-style logs (e.g. `audit_logs`-equivalent records already used elsewhere in the project for `reviewedBy`/`approvedBy`/`createdBy` tracking), which is a different, deliberate kind of record from incidental application logs.

**Implementation:**
- A logging interceptor/middleware with a redaction function applied before any request/response is written to logs.
- `LOG_LEVEL=debug` should never be the production default (Section 3), since debug-level logging is the most likely place for an accidental sensitive-value leak.

**Checklist:**
- [ ] Auth-endpoint request bodies confirmed absent from logs (or fully redacted).
- [ ] `Authorization` header confirmed redacted in any access/request logging.
- [ ] Production `LOG_LEVEL` confirmed not `debug`.

---

## 13. Exception Handling

**Current status:** ✅ a global exception filter and standardized exception classes are already established and consistently used throughout the project.

**What to add for production specifically:**
- In `production` mode, unexpected (non-`HttpException`) errors must be caught by the global filter and returned as a generic `500` with no stack trace, no internal error message, and no file paths — only a generic `"Internal server error"` message and a correlation/request ID if one is implemented.
- In `development`/`staging`, the fuller error detail can remain visible to speed up debugging — gate this behavior on `NODE_ENV`.

**Implementation steps:**
1. Confirm the global exception filter branches on `NODE_ENV` for the level of detail returned to the client.
2. Confirm every unexpected error is still fully logged server-side (with full detail) even when the client-facing response is generic — visibility for developers should never be reduced, only what's exposed externally.

**Checklist:**
- [ ] A forced unexpected error (e.g. a deliberately broken DB call in a test environment) returns a generic message in `production` mode.
- [ ] The same error is fully detailed in server-side logs regardless of environment.
- [ ] No existing client-facing error response shape (for the standardized exceptions already in use) changes — this section only affects the *unexpected*, unhandled error path.

---

## 14. Swagger Security

**Development:** fully enabled at `SWAGGER_PATH`, no restrictions — this is a developer tool during active work.

**Production:** should default to **disabled** (`ENABLE_SWAGGER=false`). If API documentation must remain reachable in production for a specific reason, gate it behind either basic-auth middleware on the Swagger route specifically, or an IP allow-list — never leave it publicly reachable and unauthenticated in production, since it documents the entire API surface including admin-only endpoints.

**Configuration:**
```ts
if (process.env.ENABLE_SWAGGER === 'true') {
  const config = new DocumentBuilder().setTitle('RestoMind API').build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(process.env.SWAGGER_PATH ?? '/api/docs', app, document);
}
```

**Checklist:**
- [ ] `ENABLE_SWAGGER=false` confirmed as the production default.
- [ ] If Swagger must stay reachable in production, an additional access control is confirmed in place on that specific route.

---

## 15. File Upload Security

**Current status:** ✅ shared MIME-type validation service already exists and is used consistently across upload endpoints.

**Additions needed:**
- **File size limits**: enforce `MAX_UPLOAD_SIZE` at the multer/interceptor level (Section 8) — MIME validation alone doesn't bound file size.
- **Extension validation as a second check, not a replacement**: MIME type can be spoofed by a malicious client; cross-check the file extension against the same allow-list the MIME check uses, and reject if they disagree (e.g. a `.exe` renamed with an `image/png` content-type header).
- **Explicit denial of executable/script extensions** regardless of any claimed MIME type (`.exe`, `.sh`, `.php`, `.js`, etc.) — a defense-in-depth measure on top of the allow-list approach already in place.

**Implementation steps:**
1. Extend the existing shared upload-validation service with a size check and an extension cross-check, rather than building a second, parallel validation path.
2. Confirm the allow-list (currently presumably image MIME types for product/category/document images) is still accurate and hasn't silently grown to include unintended types.

**Checklist:**
- [ ] Oversized file rejected.
- [ ] Mismatched extension/MIME-type combination rejected.
- [ ] Executable/script extensions rejected outright, independent of claimed MIME type.

---

## 16. Environment Validation

**Why:** deploying with a missing or default secret (e.g. an empty `JWT_ACCESS_SECRET`) is a common, entirely preventable way for a production deployment to be silently insecure from day one.

**Implementation:**
- Validate all required environment variables (Section 3) at application startup, using a schema validator (e.g. `Joi`, or a `class-validator`-decorated config class, consistent with the validation pattern already used throughout this project) — **fail fast and refuse to start** if any required secret is missing, empty, or below a minimum length (e.g. JWT secrets under 32 characters).
- Distinguish required-in-all-environments variables (e.g. `MONGODB_URI`) from required-in-production-only variables (e.g. `ALLOWED_ORIGINS` might reasonably be unset in local development).

**Checklist:**
- [ ] Application refuses to start if a required secret is missing.
- [ ] Application refuses to start if a JWT secret is suspiciously short/default (e.g. the literal example value from `.env.example`).
- [ ] Startup validation errors are clear about exactly which variable is missing/invalid, to avoid a confusing debugging experience for whoever deploys this.

---

## 17. Production Readiness

**HTTPS:** terminated at the reverse proxy/load balancer (not inside the Node process) — the application itself should assume it's always reached over HTTPS in production and rely on `TRUST_PROXY` (Section 3) to correctly interpret forwarded headers.

**Proxy:** `app.set('trust proxy', 1)` (or the NestJS equivalent) enabled whenever `TRUST_PROXY=true`, so rate limiting and any IP-based logic see the real client IP rather than the proxy's.

**Compression:** enable gzip/br compression middleware (`compression` package), gated by `ENABLE_COMPRESSION`, for reduced response payload size — safe, standard, no business-logic impact.

**Docker:** run as a non-root user inside the container, use a multi-stage build so build-time dependencies and source don't end up in the final image, and never bake any `.env` values or secrets into the image layer — secrets should be injected at runtime (container orchestrator's secret management, or the platform's environment variable injection).

**Reverse Proxy:** Nginx, Caddy, or the cloud provider's managed load balancer in front of the NestJS app, handling TLS termination, and ideally also a first layer of rate limiting/WAF-style filtering before traffic even reaches the application.

**Checklist:**
- [ ] HTTPS enforced end-to-end (proxy terminates TLS, app trusts the proxy correctly).
- [ ] Compression enabled.
- [ ] Docker image confirmed to run as non-root.
- [ ] No secrets present in the built Docker image (`docker history`/layer inspection check).

---

## 18. Security Testing Checklist

Full pre-deployment checklist, compiled from every section above:

- [ ] CORS tested against both an allowed and a disallowed origin.
- [ ] Helmet enabled; headers verified present on a sample response.
- [ ] Global, auth, and AI-endpoint rate limiters all independently verified.
- [ ] Global `ValidationPipe` confirmed with `whitelist` + `forbidNonWhitelisted` + `transform`.
- [ ] JSON/multipart/URL-encoded size limits verified.
- [ ] Four distinct JWT secrets in place, expiry values confirmed.
- [ ] Login error messages confirmed generic.
- [ ] **Manager/staff `restaurantId` scoping confirmed server-derived, not client-suppliable** (Section 10 — highest priority item in this document).
- [ ] AI microservice calls confirmed to send the shared-secret header; AI service confirmed to reject requests without it.
- [ ] Sensitive values confirmed absent/redacted from logs.
- [ ] Production error responses confirmed generic (no stack traces).
- [ ] Swagger disabled (or access-controlled) in production.
- [ ] File upload size + extension cross-check verified, alongside the existing MIME check.
- [ ] Application confirmed to refuse startup with missing/invalid required environment variables.
- [ ] HTTPS, `trust proxy`, and Docker non-root/no-baked-secrets confirmed.

---

## 19. Future Security Enhancements

- **Redis-backed rate limiting**: the in-memory throttler recommended in Section 6 only tracks state within a single process — once this backend runs as more than one instance behind a load balancer, rate-limit state must be shared via Redis (or equivalent) so a limit isn't trivially bypassed by hitting a different instance.
- **Audit Logs**: this project already has the foundation for this — `reviewedBy`, `approvedBy`, and `createdBy` fields are used consistently across sensitive actions (recommendation approval, partnership application review, order status changes). A future dedicated audit-log collection would formalize this existing pattern into a single, queryable trail of every sensitive action platform-wide, rather than fields scattered per-collection.
- **WAF (Web Application Firewall)**: an additional network-layer filtering tier (e.g. Cloudflare, AWS WAF) in front of the reverse proxy, catching common attack patterns before they reach the application at all.
- **CSRF protection**: not currently relevant given the bearer-token (not cookie-based) authentication model throughout this project — revisit only if refresh tokens are ever moved to cookies (Section 9).
- **SIEM integration**: centralized security event monitoring/alerting once the redacted logging (Section 12) pipeline exists to feed it.
- **Secrets Manager**: move from `.env`-file-based secrets to a managed secret store (AWS Secrets Manager, HashiCorp Vault, or the cloud provider's equivalent) for production, enabling rotation without a redeploy.
- **MFA (Multi-Factor Authentication)**: particularly valuable for `admin` accounts specifically, given their platform-wide reach, before extending it to `manager`/`staff`.
- **Key Rotation**: a defined process/schedule for rotating JWT secrets and the AI service shared secret without invalidating every currently-active session at once.
- **DDoS Protection**: typically handled at the network/CDN layer (the same provider as the WAF above), complementing but not replacing the application-level rate limiting in Section 6.

---

## 20. Final Summary

| Area | Status | Priority |
|---|---|---|
| JWT multi-token-type auth | ✅ Implemented | — |
| Password hashing | ✅ Implemented | — |
| RBAC / Guards | ✅ Implemented | — |
| Tenant isolation (general) | ✅ Implemented | — |
| **Manager `restaurantId` scoping on list endpoints** | ❌ Needs fix | **Critical** |
| Standardized exceptions | ✅ Implemented | — |
| DTO validation (ValidationPipe) | ✅ Implemented (verify config) | Low |
| Soft-delete convention | ✅ Implemented | — |
| Revoked-token blacklist | ✅ Implemented | — |
| Shared upload MIME validation | ✅ Implemented | — |
| CORS allow-list | ⚠️ Missing | High |
| Helmet headers | ⚠️ Missing | High |
| Rate limiting (all 3 tiers) | ⚠️ Missing | High |
| Request size limits | ⚠️ Missing | Medium |
| **AI service authentication (shared secret)** | ❌ Missing entirely | **Critical** |
| Logging redaction | ⚠️ Missing | High |
| Production exception detail suppression | ⚠️ Verify only | Medium |
| Swagger production lockdown | ⚠️ Missing | Medium |
| File upload size/extension checks | ⚠️ Missing (MIME check exists) | Medium |
| Environment startup validation | ⚠️ Missing | Medium |
| HTTPS / proxy / Docker hardening | ⚠️ Missing | High (pre-launch) |
| Distinct JWT secrets per token type | ⚠️ Verify | Medium |
| Generic login error messages | ⚠️ Verify | Medium |

**Two items are marked Critical and should be resolved before any other item in this document:** the manager/staff tenant-scoping verification (Section 10) is a potential live data leak, and AI service authentication (Section 11) currently has no protection at all against unauthorized callers reaching the prediction engine directly. Everything else in this guide meaningfully raises the security baseline but does not carry the same immediate risk if addressed slightly later in the rollout.
