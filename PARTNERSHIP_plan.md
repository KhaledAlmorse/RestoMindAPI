# RestoMind — Partnership & Restaurant Onboarding Implementation Plan

## Status & Relationship to Other Roadmaps

This is a standalone feature plan, independent of the AI Integration Roadmap (Phases 4–8) — it doesn't touch prediction, inventory, or offers logic, and can be built in parallel with that track. It has exactly one hard dependency: **Phase 0 (Restaurant onboarding, already complete)** — the owner↔restaurant auto-linking, ownership validation (owner must exist, must be `manager` role, 1:1 ownership enforced), and soft-delete cleanup already built there. This plan does not reimplement any of that; it explicitly reuses it. See the callout in Phase P2 for why this matters.

## Architecture Analysis Before Planning — conflicts and gaps found in the source spec

1. **The approval flow must not reimplement Phase 0's owner-linking mechanism.** The source spec describes "Create User → Create Restaurant → Link" as if it's new logic. It isn't — this is exactly what `POST /restaurants`'s existing, already-hardened transactional flow does (atomic creation + linking, existence/role validation, duplicate-ownership rejection, race-condition-safe). Approval must call that same internal service method, not hand-roll a second, unhardened version of the same three steps.
2. **The setup-token mechanism should reuse existing auth infrastructure, not invent a third one.** The project already has a multi-token-type pattern in `AuthGuard`/`TokenService` (access, refresh, password-reset). A setup token is a fourth `tokenType`, not a new bespoke mechanism with its own URL-parsing logic.
3. **`district` has no home in the current `Restaurant.address` schema.** The form collects it; `Restaurant.address` (per the existing schema) only has `{ street, city, country }`. This needs an additive field, not silent data loss.
4. **No spam/duplicate protection on the public submission endpoint.** Anyone can `POST /partnership-applications` repeatedly with no rate limit, and nothing stops the same email submitting multiple simultaneously-pending applications.
5. **`APPROVED` vs `ONBOARDED` is ambiguous in the source doc.** The lifecycle diagram shows them as separate states, but the approval steps describe everything (user/restaurant creation, email) happening under "Approve," then just "Mark status = APPROVED." Resolved below: `APPROVED` = admin approved and the account/restaurant now exist; `ONBOARDED` = the owner has actually completed setup (set their password) and can log in. This makes the two states independently useful on the admin dashboard ("approved but hasn't logged in yet" is a real, actionable state).
6. **No terminal-state lock defined.** `REJECTED`/`ONBOARDED` should behave like `Order.status`'s existing terminal-state lock — once reached, no further transitions.
7. **Public status-check endpoint (`GET /partnership-applications/status/:id`) as specified leaks data to anyone with the ID.** Needs a second identifying factor (the submitted email) so application IDs can't be enumerated to view other businesses' submissions.
8. **`commercialRegistration` is a plain string, but "Business Verification Flow" is a stated goal.** Worth an explicit decision: is this a registration *number* (string, fine as-is) or should it support a document *upload* (reusing the existing shared upload/MIME-validation service already used by Categories/Products)? Flagged as an open question, not decided silently either way.

---

# Phase P1 — Partnership Application Submission & Admin Review

## Goal

Let a business submit a partnership application publicly, and let admins list, review, approve, or reject it — without creating any `User` or `Restaurant` record yet. This phase is deliberately scoped to stop *before* the approval side-effect chain (Phase P2), since submission/review carries none of the cross-collection risk approval does.

## Database Changes / Schemas

```typescript
// partnership-application.model.ts
_id                     ObjectId
businessName            String    required
businessType            'restaurant' | 'bakery' | 'cafe' | 'catering' | 'supermarket'   required
description             String    optional
estimatedOrdersPerDay   Number    optional   // flagged by source doc as useful for future AI cold-start — kept
estimatedWasteKgPerDay  Number    optional   // same
ownerFirstName          String    required   // split from the form's single "Owner Name" field at submission time, not later — see DTO note
ownerLastName           String    required
email                   String    required (index)
phone                   String    required
city                    String    required
district                String    optional
street                  String    optional
website                 String    optional
facebookPage            String    optional
instagramPage           String    optional
operatingHours          Object    optional
commercialRegistration  String    optional   // see open question above — plain text for this phase
taxId                   String    optional
notes                   String    optional
status                  'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'ONBOARDED'   default 'PENDING'
rejectionReason         String    optional
reviewedBy              ObjectId → User   optional
approvedBy              ObjectId → User   optional
approvedAt              Date      optional
userId                  ObjectId → User         optional — set in Phase P2
restaurantId            ObjectId → Restaurant   optional — set in Phase P2
createdAt / updatedAt   Date
```

**Note on name splitting:** the source spec splits "Mohamed Ahmed Reda" into `firstName`/`lastName` at *approval* time. Do it at **submission** time instead — store `ownerFirstName`/`ownerLastName` directly on the application (the form can just present two fields, "First Name" / "Last Name," instead of one combined field that needs fragile server-side splitting later). This avoids ever having to guess where a multi-word name splits.

**Indexes:** `{ email: 1, status: 1 }` — supports the duplicate-pending check below and the status-check endpoint. `{ status: 1, createdAt: -1 }` — supports the admin list view's default sort/filter.

## DTOs

- `CreatePartnershipApplicationDto` — all public-facing fields above, `class-validator` decorators matching required/optional per the schema (`@IsEmail()`, `@IsEnum()` on `businessType`, etc.).
- `CheckApplicationStatusDto` — `{ email }`, used alongside the `:id` param (see Security below).
- `ReviewApplicationDto` — `{}` (no body needed, just transitions status — or optionally `{ note }` if internal reviewer notes are wanted; not in the source spec, skip unless requested).
- `RejectApplicationDto` — `{ reason: string, required }`.

## Controllers / Services

- **`PartnershipApplicationsModule`**: standard structure (`dto/`, controller, service, module; repository extending `base.service.ts`).
- **Public routes**: no `@Auth()` guard, but rate-limited (see Security).
- **Admin routes**: `@Auth('admin')` — this is system administration, not restaurant-operational data, matching the Admin Flow boundary already established elsewhere in this project (admin manages platform-level concerns, not day-to-day restaurant operations) — correctly admin-only, not manager-accessible.

## API Endpoints

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/partnership-applications` | Public, rate-limited | Submit a new application |
| GET | `/partnership-applications/status/:id` | Public, requires `?email=` match | Check status of your own application |
| GET | `/admin/partnership-applications` | `admin` | List all, filterable by `status` |
| GET | `/admin/partnership-applications/:id` | `admin` | Full detail |
| PATCH | `/admin/partnership-applications/:id/review` | `admin` | `PENDING → UNDER_REVIEW` |
| POST | `/admin/partnership-applications/:id/reject` | `admin` | Body: `{ reason }` — `PENDING/UNDER_REVIEW → REJECTED` |

(`approve` is deliberately not in this phase's table — it belongs to Phase P2, since it's the endpoint that triggers the User/Restaurant creation chain.)

## Status Lifecycle — explicit, terminal-state-locked

```
PENDING ──→ UNDER_REVIEW ──→ APPROVED (Phase P2) ──→ ONBOARDED (Phase P2, owner-triggered)
   │             │
   └─────────────┴──→ REJECTED
```
Valid transitions: `PENDING→UNDER_REVIEW`, `PENDING→REJECTED`, `UNDER_REVIEW→REJECTED`, and (Phase P2) `PENDING→APPROVED`/`UNDER_REVIEW→APPROVED`, `APPROVED→ONBOARDED`. **`REJECTED` and `ONBOARDED` are terminal** — reject any further transition attempt on an application already in one of these states with `ConflictException`, mirroring the exact lock already used on `Order.status`.

## Security Considerations

- **Rate limiting on `POST /partnership-applications`**: by IP and/or email (e.g. `@nestjs/throttler` if already used elsewhere in the project, or the equivalent existing pattern) — this is the one fully public, unauthenticated write endpoint in the whole system.
- **Duplicate-pending check**: before creating a new application, query for an existing `{ email, status: { $in: ['PENDING','UNDER_REVIEW'] } }` — if found, reject with `ConflictException` ("You already have a pending application") rather than creating a second one silently.
- **Status-check endpoint requires the email as a second factor**, not just the Mongo ID — `GET /partnership-applications/status/:id?email=...`, reject with `NotFoundException` if the email doesn't match that application's stored email (don't reveal *why* it didn't match — same "404, not 403" reasoning already established elsewhere in this project for cross-tenant lookups, applied here to prevent ID enumeration).

## Migration Strategy

None required — this is a wholly new collection with no relationship to existing data until Phase P2's approval step writes into `User`/`Restaurant`.

## Testing Plan

- Submit a valid application → confirm `status: PENDING`.
- Submit a second application with the same email while the first is still `PENDING` → confirm `ConflictException`.
- `PATCH .../review` → confirm `UNDER_REVIEW`. Attempt `review` again → confirm rejection (already reviewed) or idempotent no-op — decide and document which.
- `POST .../reject` with a reason → confirm `REJECTED`, `rejectionReason` stored. Attempt any further transition on it → confirm `ConflictException` (terminal state).
- `GET .../status/:id` with the correct email → succeeds. With a wrong/missing email → `NotFoundException`.
- Exceed the rate limit on submission → confirm `429`.

## Admin Dashboard Requirements

- List view with status filter (`All`/`Pending`/`Under Review`/`Approved`/`Rejected`/`Onboarded`), sorted newest-first.
- Detail view showing every field from the schema (business info, owner info, location, notes).
- Reject action with a required reason field.
- Clear visual distinction between `APPROVED` (account created, owner hasn't logged in) and `ONBOARDED` (owner is active) — this is exactly why Phase P2 keeps them as two separate states.

## Completion Checklist

- [ ] `PartnershipApplication` model implemented with indexes.
- [ ] All P1 endpoints implemented with correct public/admin access split.
- [ ] Terminal-state lock enforced (`REJECTED` cannot transition further).
- [ ] Duplicate-pending-application check enforced.
- [ ] Rate limiting verified on the public submission endpoint.
- [ ] Status-check endpoint verified to require email match.

**⏸ STOP — confirm Phase P1 before continuing to Phase P2.**

---

# Phase P2 — Approval Automation & Owner Account Setup

## Goal

Turn an `APPROVED` application into a real, working manager account and restaurant — reusing Phase 0's already-hardened owner-linking mechanism rather than duplicating it — and let the owner securely set their own password via a setup token before the application is considered `ONBOARDED`.

## Database Changes / Schemas

**Modification to `Restaurant.address`** (additive, non-breaking):
```typescript
district   String   optional   // NEW
```

**Reuse, not new:** the setup-token mechanism extends the existing token-type pattern already used by `TokenService`/`AuthGuard` for access/refresh/reset tokens:
```
tokenType: 'setup'   // NEW value alongside the existing access/refresh/reset types
```
No new token collection needed — this rides the same infrastructure already established for the password-reset flow.

## Backend Implementation

- **`PartnershipApplicationsService.approve()`**: does **not** independently write `User` and `Restaurant` documents. It calls the **same internal service method Phase 0's `POST /restaurants` already uses** for atomic owner-linked creation (existence/role validation, duplicate-ownership rejection, transaction-wrapped). If that shared method doesn't currently accept "create the user too, not just link an existing one," extend it to accept an optional "create owner inline" mode — do not fork a second, parallel implementation.
- **Approval transaction** (one Mongo transaction): create `User` (`role: 'manager'`, `firstName`/`lastName` from the application's already-split fields, `email`/`phone` from the application, no password set yet — or a random unusable placeholder, since real password entry happens via the setup token) → create `Restaurant` via the shared Phase 0 method (owner-linking, validation, and all its existing hardening included for free) → set `PartnershipApplication.userId`/`restaurantId`/`approvedBy`/`approvedAt` → set `status: 'APPROVED'`.
- **Duplicate-email collision check before the transaction starts**: if a `User` with this email already exists (self-registered as a customer, or from an unrelated prior approval), reject `POST .../approve` with `ConflictException` — surface this to the admin as a manual-resolution case, don't let a duplicate-key error crash the transaction mid-way.
- **Email sending is a separate, non-blocking step *after* the transaction commits** — wrapped in the same retry pattern already established for external calls elsewhere in this project (a few attempts, exponential backoff, log at `error` level on exhausted retries) — **a failed email must never roll back a successful approval**; the admin dashboard should surface "approved, email delivery failed" as a state an admin can manually resend from.
- **Setup token issuance**: generated via `TokenService` with `tokenType: 'setup'`, embedded in the approval email's link (`https://.../setup-account?token=...`).
- **`POST /auth/setup-account`**: public, guarded by `@Auth({ tokenType: 'setup' })` (the same composed-decorator pattern already used for the reset-password token) — body `{ password }`, sets the user's real password, and — this is the step that finally sets `PartnershipApplication.status: 'ONBOARDED'`.

## API Endpoints

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/admin/partnership-applications/:id/approve` | `admin` | Triggers the full approval transaction + email |
| POST | `/admin/partnership-applications/:id/resend-approval-email` | `admin` | Manual retry if the automated send failed |
| POST | `/auth/setup-account` | Public, `tokenType: 'setup'` | Owner sets their password, application becomes `ONBOARDED` |

## Email Flow

- **Approval email**: subject/content per the source spec, link carries the `setup` token, not a plaintext password (per the source doc's own "Better Security Approach" — adopted as specified).
- **Rejection email**: subject/content per the source spec, includes `rejectionReason`.
- Both emails sent via whatever email-sending infrastructure the project already uses for OTP emails (Auth module) — reuse the transport/template pattern, don't stand up a second one.

## Business Workflow — Corrected Approval Chain

```
[Admin] ──> POST /admin/partnership-applications/:id/approve
                │
                ├── 1. Reject if application isn't in PENDING/UNDER_REVIEW (terminal-state guard)
                ├── 2. Reject if a User with this email already exists (duplicate-email guard)
                ├── 3. TRANSACTION:
                │        a. Create User (role: manager, no usable password yet)
                │        b. Create Restaurant via Phase 0's EXISTING shared owner-linking method
                │           (this is where existence/role/duplicate-ownership validation already lives — reused, not rebuilt)
                │        c. Set application.userId, restaurantId, approvedBy, approvedAt, status: 'APPROVED'
                ├── 4. Commit
                └── 5. Send approval email (async, retried, non-blocking — failure doesn't undo step 3)

[Owner] ──> clicks setup link ──> POST /auth/setup-account { password }
                │
                ├── Validate the 'setup' token
                ├── Set User.password
                └── Set application.status = 'ONBOARDED'

[Owner] ──> logs in normally via existing POST /auth/login
```

## Security Considerations

- Setup tokens should be short-lived and single-use (same expiry/consumption pattern as the existing reset-password token) — reuse that exact mechanism rather than inventing new expiry logic.
- The duplicate-email guard (step 2 above) prevents an approval from silently overwriting or colliding with an existing account.
- `resend-approval-email` should regenerate a fresh setup token (invalidating the old one) rather than resending a token that may have already expired.

## Migration Strategy

None — `Restaurant.address.district` is additive and optional; existing restaurants without it are unaffected.

## Testing Plan

- Approve a valid `PENDING` application → confirm `User` + `Restaurant` created, correctly linked (verify against the exact same checks Phase 0's own test suite already covers — owner role, ownership uniqueness), application → `APPROVED`.
- Attempt to approve the same application twice → confirm rejection (terminal-ish guard — `APPROVED` should also block re-approval, not just `REJECTED`/`ONBOARDED`).
- Approve an application whose email already belongs to an existing `User` → confirm `ConflictException`, no partial `User`/`Restaurant` created.
- Force the approval email send to fail → confirm the application is still `APPROVED` (transaction unaffected), and `resend-approval-email` succeeds afterward.
- Complete setup via `POST /auth/setup-account` with a valid token → confirm password set, `status: 'ONBOARDED'`, and normal login now works.
- Attempt setup with an expired or already-used token → confirm rejection.
- Attempt setup with a token of the wrong `tokenType` (e.g. a reset-password token) → confirm rejection, proving the multi-type guard correctly discriminates.

## Admin Dashboard Requirements

- Approve action, visible only on `PENDING`/`UNDER_REVIEW` applications.
- Clear indicator for `APPROVED`-but-not-yet-`ONBOARDED` applications, with a "resend setup email" action.
- Surfacing of email-delivery failures distinctly from approval failures.

## Completion Checklist

- [ ] Approval transaction reuses Phase 0's existing owner-linking method — verified by code review, not just behavioral testing.
- [ ] Duplicate-email guard verified.
- [ ] Email failure does not roll back approval — verified by forced-failure test.
- [ ] Setup token reuses the existing multi-token-type `TokenService`/`AuthGuard` pattern — no new token collection or bespoke URL-parsing logic introduced.
- [ ] `ONBOARDED` only reachable via actual owner setup completion, never set automatically at approval time.
- [ ] No existing endpoint (`POST /restaurants`, `POST /auth/login`, etc.) modified or broken.

**⏸ STOP — this is the final phase of the Partnership feature.**

---

## Open Questions to Resolve Before Implementation Begins

1. **`commercialRegistration`**: plain text registration number (as currently scoped), or a real document upload (would reuse the existing shared upload/MIME-validation service and add meaningful scope to Phase P1)? Decide before P1 starts, not mid-build.
2. **Can a `PENDING` application skip `UNDER_REVIEW` and go straight to `APPROVED`**, or must every application pass through `UNDER_REVIEW` first? The endpoint table above allows both `PENDING→APPROVED` and `UNDER_REVIEW→APPROVED` — confirm that's actually the intended admin workflow, not just a technical convenience.
3. **Should `PATCH .../review` be idempotent** (calling it twice on an already-`UNDER_REVIEW` application is a harmless no-op) or should the second call be rejected? Either is defensible; pick one and document it in the DTO/service, don't leave it undefined.
