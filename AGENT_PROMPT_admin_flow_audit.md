# Task — Audit the Admin Flow Against Requirements (Code Review, Not Implementation)

You are acting as a Senior NestJS Backend Architect and Code Reviewer for the **RestoMindApi** project. This is a **read-and-report task** — do not write, edit, or generate any code. Your only output is the audit report specified at the end.

## Ground rule: verify against the actual files, not assumptions

Everything stated as "required" below reflects the intended design. It is not a claim about what currently exists in the code. **Open and read the actual controller, service, DTO, guard, and schema files for every module in scope before writing anything** — do not infer status from file names, module structure, or prior documentation alone. If a requirement below turns out to already be satisfied by code that looks different from how it's described here (different file name, slightly different validation approach, etc.), that's a ✅, not a ❌ — judge by behavior, not by whether the code matches this document's phrasing.

If any other project documentation exists in this repo (a `plan.md`, architecture docs, prior agent-implementation prompts), read those too before starting — they may describe decisions already made (e.g. exact restaurant-ownership validation rules) that this audit should check the code against, not re-litigate from scratch.

## Scope

Audit only the **Admin Flow** — system administration, not restaurant daily operations. The Admin manages users, restaurants (creation/deletion only), categories, and has system-wide visibility. The Admin does **not** manage menus, orders fulfillment, inventory, or anything restaurant-operational — if you find Admin-role access to those areas, flag it as an authorization issue (over-privileged), not a missing feature.

---

## 1. Authentication

Verify the Admin can log in and reach protected admin endpoints. Check:

- JWT issuance and verification for admin-role accounts specifically (not just "auth works in general" — confirm the admin role flows through correctly end to end).
- Role guard / permission decorator actually gates admin-only routes (not just present, but functioning — trace one admin route through its guard chain).

## 2. User Management

Required APIs — confirm each exists and check its exact behavior, not just its presence:

- `POST /users` (Create)
- `GET /users` (list — confirm pagination and filtering, not just an unfiltered dump)
- `GET /users/:id`
- `PATCH /users/:id` (Update)
- `DELETE /users/:id` (Delete)

Requirements to verify against the actual guard/service logic:

- Only `admin` reaches these endpoints — **except** where a `manager` legitimately needs scoped access (e.g. a manager creating their own staff, if that exists) — confirm the role check is precise, not a blanket "admin or manager" that accidentally lets a manager create another admin.
- `manager` cannot create or delete users outside their own scope.
- `customer` cannot reach these endpoints at all.
- DTO validation is real (test what happens with a malformed body, not just check a decorator exists).

## 3. Restaurant Management

Required APIs:

- `POST /restaurants`
- `GET /restaurants`
- `GET /restaurants/:id`
- `DELETE /restaurants/:id`

**Also check for any additional restaurant endpoints that exist beyond this list** (e.g. a `GET /restaurants/me` for managers, or an update endpoint) — audit those too under the same rules, don't skip them just because they weren't named above.

Requirements — verify these against the actual `restaurant.service.ts` logic, not just that validation decorators exist:

- Only `admin` creates and deletes restaurants; `manager` cannot do either.
- `ownerUserId` must reference an existing user whose role is `manager` — check both the existence check and the role check are real, separate validations (a missing user and a wrong-role user should fail differently, or at least both fail).
- A manager cannot own multiple restaurants — confirm this is enforced with a real uniqueness check (ideally a DB-level unique index, not just an application `if` check that a race condition could slip past), and confirm what happens when a manager's restaurant is soft-deleted: can they then create/own a new one? (This should work — deleting a restaurant should clear the former owner's link.)
- Restaurant owner (`restaurantId` on the `User` document) is set automatically during restaurant creation — confirm this happens atomically with restaurant creation (same transaction), not as a separate, skippable step.

## 4. Category Management

Requirements:

- Only `admin` can create/update/delete categories.
- Everyone (any authenticated role, or public — check which) can read categories.
- Duplicate category name validation exists and actually rejects duplicates (test the boundary, not just check for a unique index in the schema).
- Deleting a category reassigns its products to a Default Category, rather than leaving them orphaned or cascading the delete — verify the Default Category itself cannot be deleted (a hard business rule, not just a convention).

## 5. System Monitoring

Verify Admin can view: all restaurants, all users, all orders. Confirm each is actually restricted to `admin` (not accidentally also open to `manager` or `customer`). System-wide statistics is explicitly optional — if missing, note it as ❌ **but flag it Low priority** in the final checklist, not High; don't let a missing nice-to-have inflate the perceived severity of real gaps elsewhere.

## 6. Authorization Review — go controller by controller

For every controller in the project (not just the ones named above), confirm role scoping matches intent:

- Admin-only endpoints: reachable only by `admin`.
- Restaurant-operational endpoints (menu, inventory, orders fulfillment, etc.): reachable by `manager` (scoped to their own restaurant), not by `admin` unless there's a deliberate reason for admin override — flag any accidental admin access to operational data as an issue, since the requirements explicitly state the Admin does not manage daily operations.
- Customer-facing endpoints: reachable only by `customer` where the business logic says so.

List every endpoint you find with incorrect authorization, not just the ones in this document's named scope — if you notice a restaurant-operational endpoint that's wrongly open to `admin` while auditing Section 3 or 5, report it here too.

## 7. Validation Review

Test/verify, don't just visually scan for decorators:

- Invalid `ObjectId` inputs are rejected with a clear error, not a 500 or a silent empty result.
- Invalid `ownerUserId` (non-existent, or wrong role) is rejected per Section 3.
- Duplicate category name is rejected per Section 4.
- Duplicate/invalid restaurant ownership is rejected per Section 3.
- Invalid role assignment (e.g. someone attempting to set `role: 'admin'` through an endpoint that shouldn't allow it) is rejected.

## 8. Security Review

Verify:

- Every protected route actually has a guard attached (check for any route missing `@Auth()`/`@Roles()` entirely, which is a more severe finding than a wrong role check — flag these as High priority regardless of how minor they seem).
- Role decorators match their guard's actual enforcement (a `@Roles('admin')` decorator that the guard doesn't correctly read is worse than having no decorator, since it looks secured but isn't).
- Ownership validation: a `manager` cannot read/modify another manager's restaurant-scoped data by guessing/passing a different ID — actually test this, don't just check that a `restaurantId` field exists on the query.
- No endpoint returns more data than the caller's role should see (e.g. a customer-facing endpoint accidentally leaking another customer's data).

---

## Expected Output

Produce exactly this structure — do not add extra top-level sections, and do not omit any of these even if a section has nothing to report (write "No issues found" rather than skipping it):

```
## Authentication
✅ ...
⚠️ ...
❌ ...

-----------------------------------

## User Management
Implemented:
...
Missing:
...
Recommended Fix:
...

-----------------------------------

## Restaurant Management
...

-----------------------------------

## Category Management
...

-----------------------------------

## Authorization Issues
...

-----------------------------------

## Validation Issues
...

-----------------------------------

## Security Issues
...

-----------------------------------

## Final Score
Authentication: XX%
User Management: XX%
Restaurant Management: XX%
Category Management: XX%
Authorization: XX%
Overall Completion: XX%
```

For every ❌ or ⚠️ finding, include:

- Which file(s) should be modified (exact path).
- Why the current implementation is incorrect (specific, not "doesn't match spec").
- The recommended implementation (concrete enough to act on, not just "add validation").
- Whether fixing it is a breaking change (does it change an existing endpoint's request/response shape or behavior for a client already calling it today).

Verify that the Admin Flow follows Clean Architecture.

Review:

- Controller responsibilities
- Service responsibilities
- Repository responsibilities
- Dependency Injection
- SOLID principles
- Separation of concerns

Report any architectural issues or code smells.

Finish with a **prioritized checklist (High → Medium → Low)** of everything that needs implementing or fixing, ordered by actual risk — a missing role guard on a real endpoint is High; a missing optional stats endpoint is Low, regardless of how many findings land in each section.
