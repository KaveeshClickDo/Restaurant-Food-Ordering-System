# Audit 11 — API Consistency

**Phase:** 4 — API layer
**Date:** 2026-05-05
**Scope:** All 67 `route.ts` files. Response shape, status-code conventions, error-message format, HTTP method semantics, URL naming, idempotency contracts, runtime/cache directives, CORS, pagination.
**Mode:** Read-only

---

## 1. Methodology

1. Counted error-response occurrences (`ok: false`) and success responses (`ok: true`) across the API surface.
2. Inventoried HTTP status codes with grep, sorted by frequency.
3. Sampled error-message strings to spot duplication / wording drift.
4. Cross-referenced URL-naming with method-semantic conventions for resource-vs-action endpoints.
5. Checked which routes use `apiHandler.ts` / `withError`, which set `runtime`, and which configure caching.

## 2. Statistics

- **`{ ok, ... }` envelope** — universal. **101** routes return success with this shape; **282** error responses use the same shape. Good.
- **Status-code distribution:**

| Status | Count | Use |
|---:|---:|---|
| 400 | 150 | Bad input / missing field / Invalid JSON |
| 500 | 86 | Server / DB error (often echoes Supabase `error.message`) |
| 401 | 15 | Unauthorized |
| 404 | 12 | Not found |
| 409 | 9 | Conflict (duplicate, slot taken) |
| 503 | 5 | Service unavailable / misconfig |
| 429 | 5 | Rate-limited |
| 201 | 4 | Created |
| 204 | 2 | No content (delete) |
| 403 | 1 | Forbidden |

- **`apiHandler.ts` / `withError`** — defined in [lib/apiHandler.ts:9](../app/src/lib/apiHandler.ts#L9) and a duplicate in [lib/supabaseAdmin.ts:55](../app/src/lib/supabaseAdmin.ts#L55). **Never used by any route.** Cross-ref 07-F7.
- **Runtime export** — only [email/route.ts:25](../app/src/app/api/email/route.ts#L25) declares `runtime = "nodejs"`. [print/route.ts](../app/src/app/api/print/route.ts) documents in comments that it requires Node.js (uses `net.Socket`) but doesn't declare it.
- **Cache directives** — none. No `revalidate`, no `dynamic`, no `Cache-Control` headers anywhere. Routes are dynamic by default.
- **CORS** — no `Access-Control-*` headers anywhere. Same-origin only.

## 3. Findings — response shape & error format

### 11-F1 — `withError` exists in two places, used by zero routes
**Severity:** 🟡 Low (already in 07-F7; restated here in API context)
**Evidence:** Two definitions:
- [lib/apiHandler.ts:9–19](../app/src/lib/apiHandler.ts#L9): `withError<T>(fn)` typed-tuple variant.
- [lib/supabaseAdmin.ts:55–65](../app/src/lib/supabaseAdmin.ts#L55): `withError(fn: Handler)` looser variant.

Grep across [app/src/](../app/src/) shows zero callers — every route hand-rolls its own `try { ... } catch { return NextResponse.json({...}, {status: 500}) }`.
**Why it matters:**
- Two implementations of the same idea + zero adoption = pure dead weight.
- Each route reimplements the catch block, leading to message drift and inconsistent log statements.
**Possible action:** Pick one (`apiHandler.ts` is the better-typed one), delete the other, and adopt it as the standard wrapper for new routes. Migrate existing routes opportunistically.

### 11-F2 — `"Invalid JSON."` is duplicated 47+ times
**Severity:** 🟡 Low
**Evidence:** Grep shows 47+ occurrences of `"Invalid JSON."` (with period) and a few of `"Invalid JSON"` (no period — [admin/drivers/route.ts:53](../app/src/app/api/admin/drivers/route.ts#L53), [admin/drivers/[id]/route.ts:42](../app/src/app/api/admin/drivers/[id]/route.ts#L42), [email/route.ts:43](../app/src/app/api/email/route.ts#L43)).
**Why it matters:** Every `try { body = await req.json(); } catch { ... }` is the same 1 line of code. With a wrapper helper, this disappears.
**Possible action:**
```ts
// lib/apiHandler.ts
export async function parseJsonBody<T>(req: Request): Promise<T | NextResponse> {
  try { return await req.json() as T; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }
}
```
Routes call: `const body = await parseJsonBody<MyShape>(req); if (body instanceof NextResponse) return body;`
With zod (08-F16 recommendation) this becomes `const body = MySchema.safeParse(await req.json())`.

### 11-F3 — Supabase `error.message` is returned to the client in ~30 routes
**Severity:** 🟡 Medium (already in 08-F15 / 09-F17; restated for API completeness)
**Evidence:** Pattern `return NextResponse.json({ ok: false, error: error.message }, { status: 500 })` appears across most admin and write endpoints (counted via grep; >30 sites).
**Why it matters:** PostgREST error messages can include constraint names, column names, and the user-supplied value that triggered the constraint:
```
duplicate key value violates unique constraint "customers_email_key"
Detail: Key (email)=(victim@x.com) already exists.
```
That detail leak is worse for public/customer-facing endpoints than for admin endpoints, but neither audience benefits from raw DB errors.
**Possible action:** Centralize via a `respondInternalError(err, route)` helper:
- For known error codes (23505 → "already exists"; PGRST116 → "not found"), map to canonical user-facing messages.
- For unknown errors: log details server-side (also strip `Detail:` per 09-F17), respond with generic "Internal server error".

### 11-F4 — Inconsistent created-resource status: 200 vs 201
**Severity:** 🟡 Low
**Evidence:**
- 201 used by: [admin/drivers POST](../app/src/app/api/admin/drivers/route.ts#L99), [admin/users POST customer](../app/src/app/api/admin/users/route.ts#L249), [admin/users POST driver](../app/src/app/api/admin/users/route.ts#L300), [admin/users POST waiter](../app/src/app/api/admin/users/route.ts#L356).
- 200 used by: [auth/register](../app/src/app/api/auth/register/route.ts#L143), [admin/customers POST](../app/src/app/api/admin/customers/route.ts#L29), [admin/categories POST](../app/src/app/api/admin/categories/route.ts), [admin/menu POST](../app/src/app/api/admin/menu/route.ts#L29), [admin/reservations POST](../app/src/app/api/admin/reservations/route.ts#L158), [orders POST](../app/src/app/api/orders/route.ts#L267), [reservations POST](../app/src/app/api/reservations/route.ts#L152), [pos/reservations POST](../app/src/app/api/pos/reservations/route.ts#L106), [waiter/orders POST](../app/src/app/api/waiter/orders/route.ts#L71), [pos/orders POST](../app/src/app/api/pos/orders/route.ts#L109).

**Why it matters:**
- HTTP semantics: `201 Created` should be returned with `Location` header pointing at the new resource.
- API consumers can't tell if a successful POST is "created", "updated", or "accepted for processing".
- Mostly cosmetic, but a public-API contract should be consistent.
**Possible action:** Pick a convention (RESTish: 201 + `Location` header for resource creation, 200 for action endpoints) and apply it. Or accept "always 200" for simplicity, but document.

### 11-F5 — No DELETE returns 204 No Content (most return 200 + `{ ok: true }`)
**Severity:** 🟡 Low
**Evidence:** [admin/drivers DELETE](../app/src/app/api/admin/drivers/[id]/route.ts#L88), [admin/menu DELETE](../app/src/app/api/admin/menu/[id]/route.ts#L30), etc., return `{ ok: true }` with default 200. Only 2 routes use 204 across the codebase.
**Why it matters:**
- 204 is the spec-correct response for a DELETE that has nothing to return. It's also slightly cheaper (no body to serialize).
- 200 + `{ ok: true }` is fine and consistent with the rest of the codebase. Mixed = bad.
**Possible action:** Pick one. Recommend: keep 200 + `{ ok: true }` since the rest of the API uses the envelope.

### 11-F6 — 403 is used exactly once
**Severity:** 🟡 Low
**Evidence:** Only one 403 across the API. Most "forbidden" cases (e.g. session valid but role mismatch) return 401 — semantically wrong: 401 = "not authenticated", 403 = "authenticated but not allowed".
**Why it matters:** Clients can't distinguish "log in" from "your role doesn't permit this." For session/role mismatch cases (e.g. waiter trying to use POS endpoint) 403 is correct.
**Possible action:** Audit each `unauthorizedJson()` call site — if the cookie is valid for *some* role but not the right one, change to 403.

### 11-F7 — Error message format drift
**Severity:** 🟡 Low
**Evidence:** Required-field errors take wildly different shapes across routes:
- `"id, name, and email are required."` ([admin/customers POST](../app/src/app/api/admin/customers/route.ts#L21))
- `"tableId, tableLabel, date, time, partySize and customerName are required."` ([pos/reservations POST](../app/src/app/api/pos/reservations/route.ts#L29) — note: no Oxford comma, slightly different phrasing)
- `"Required fields: to, subject, html"` ([email POST](../app/src/app/api/email/route.ts#L57))
- `"Email and password are required."` ([auth/login POST](../app/src/app/api/auth/login/route.ts#L40))
- `"name is required."` ([admin/users POST](../app/src/app/api/admin/users/route.ts#L173))
- `"'amount' must be a positive number."` ([customers/[id]/spend-credit](../app/src/app/api/customers/[id]/spend-credit/route.ts#L23))
- `"'fulfillment' must be 'delivery', 'collection', or 'dine-in'."` ([orders POST](../app/src/app/api/orders/route.ts#L49))

**Why it matters:** Inconsistent UX (some errors highlight a single field for the form, some don't). Inconsistent for log analysis.
**Possible action:** Standardize error response shape:
```ts
{ ok: false, error: "Invalid input.", fieldErrors: { email: "Required.", password: "Must be at least 6 characters." } }
```
This pairs naturally with zod (08-F16) — `error.flatten()` produces this shape.

## 4. Findings — URL naming & method semantics

### 11-F8 — Singular vs plural inconsistency: `reservation` vs `reservations`
**Severity:** 🟡 Medium (already in 01-F6 / 03-F17; restated)
**Evidence:**
- [api/reservation/[token]](../app/src/app/api/reservation/[token]/route.ts) — singular, token-keyed.
- [api/reservations/...](../app/src/app/api/reservations/route.ts) — plural; covers create + availability.

**Why it matters:** Two parallel resource hierarchies (`/reservation` and `/reservations`) for the same entity is a textbook source of confusion. Clients have to remember which one is for what.
**Possible action:** Settle on plural REST: `GET /api/reservations/by-token/[token]` or `GET /api/reservations/[id]?token=...`. Migrate during the cleanup.

### 11-F9 — Customer resource has two parallel surfaces
**Severity:** 🟡 Medium (already in 01-F6 / 03-F16; restated)
**Evidence:**
- [api/customers/[id] PATCH](../app/src/app/api/customers/[id]/route.ts) — customer-self-service (allowlist of safe fields).
- [api/customers/[id]/spend-credit POST](../app/src/app/api/customers/[id]/spend-credit/route.ts) — checkout-time deduction.
- [api/admin/customers/[id] PUT](../app/src/app/api/admin/customers/[id]/route.ts) — admin full update (mass-assignment per 08-F1).
- [api/admin/customers/[id]/route.ts] also has DELETE? — verify.

**Why it matters:**
- Two endpoints touching the same row with different rules. Auth and validation contracts diverge per endpoint.
- Cross-ref security audits: 06-F3 found `/api/customers/[id]` lacks auth; 08-F1 found `/api/admin/customers/[id]` is mass-assignment.
**Possible action:** A single resource at `/api/customers/[id]` that branches on caller role internally — admin role unlocks more fields. Reduces auth+validation surface to one file. Or keep separated but make admin endpoints thin wrappers around a service-layer function.

### 11-F10 — `/api/orders` (top-level) coexists with role-prefixed variants
**Severity:** 🟡 Low (organizational)
**Evidence:**
- [api/orders POST](../app/src/app/api/orders/route.ts) — customer-facing order placement.
- [api/admin/orders/[id]/...](../app/src/app/api/admin/orders/[id]/) — admin order mutations.
- [api/pos/orders ...](../app/src/app/api/pos/orders/) — POS order push.
- [api/waiter/orders POST](../app/src/app/api/waiter/orders/route.ts) — waiter order push.
- [api/kds/orders/[id]/status PUT](../app/src/app/api/kds/orders/[id]/status/route.ts) — kitchen status update.

**Why it matters:** Five different namespaces for "orders" — each is auth'd differently, has different validation, and shares a target table. The intent ("which user can do what to orders") is encoded in the URL prefix, but means there's no single place to look at "all order-mutating logic." Cross-ref 03-F16 (admin/customer dual surface).
**Possible action:** Either:
- Keep the role-prefix convention but document that it's the deliberate design.
- Or unify under `/api/orders/...` with role-based branching (more centralization, more complex auth).
The current design is *consistent* with the role-prefix pattern — just complicated. Lower priority than fixing semantics.

### 11-F11 — State-transition endpoints vary between PUT and POST
**Severity:** 🟡 Low
**Evidence:**
- [admin/orders/[id]/status PUT](../app/src/app/api/admin/orders/[id]/status/route.ts) — PUT for status change.
- [admin/orders/[id]/refund POST](../app/src/app/api/admin/orders/[id]/refund/route.ts) — POST for refund.
- [pos/orders/[id]/collected PUT](../app/src/app/api/pos/orders/[id]/collected/route.ts) — PUT for collection.
- [waiter/refund POST](../app/src/app/api/waiter/refund/route.ts) — POST.
- [waiter/settle POST](../app/src/app/api/waiter/settle/route.ts) — POST.
- [waiter/void POST](../app/src/app/api/waiter/void/route.ts) — POST.

**Why it matters:**
- HTTP semantics: PUT should be idempotent (same request → same state). Status transitions like "collected" *are* idempotent (calling twice doesn't double-collect). Refunds aren't (calling twice double-refunds — and the route doesn't dedupe).
- Mixed picture; mostly correct (collected = PUT, refund = POST), but the convention isn't documented.
**Possible action:** Document the convention in [docs/](../docs/): "use PUT for terminal state transitions; POST for actions that mutate or create rows." Audit the existing routes against it.

### 11-F12 — Some routes accept POST when GET would suffice
**Severity:** 🟡 Low
**Evidence:** Couldn't spot any in the read set, but worth a sweep. [reservations/availability GET](../app/src/app/api/reservations/availability/route.ts) is correct. [auth/me GET](../app/src/app/api/auth/me/route.ts) correct. **Update if you find any read-only POSTs**.
**Why it matters:** GET enables intermediate caching (CDN, browser); POST doesn't.

## 5. Findings — operational consistency

### 11-F13 — `runtime = "nodejs"` declared on email but not on print (which also requires Node.js)
**Severity:** 🟡 Low
**Evidence:**
- [email/route.ts:25](../app/src/app/api/email/route.ts#L25): `export const runtime = "nodejs";` — required because `nodemailer` uses Node APIs.
- [print/route.ts](../app/src/app/api/print/route.ts) — uses `net.Socket` (Node.js only) but doesn't declare runtime. The comment ([line 9–11](../app/src/app/api/print/route.ts#L9)) says "Next.js App Router defaults to Node.js for API routes, so no explicit `export const runtime` is required."

**Why it matters:**
- The comment is correct *today*. But Edge runtime adoption inside the app (or a future Next.js default change) would silently break print. Defensive `runtime = "nodejs"` declaration costs one line.
- Consistency: declare it everywhere it matters, or nowhere.
**Possible action:** Add `export const runtime = "nodejs";` to [print/route.ts](../app/src/app/api/print/route.ts) and any other Node-API consumer.

### 11-F14 — No cache headers on static-ish endpoints
**Severity:** 🟡 Low
**Evidence:** [settings/public GET](../app/src/app/api/settings/public/route.ts) returns whitelist-safe restaurant info + reservation system config. [waiter/config](../app/src/app/api/waiter/config/route.ts) and [kitchen/config](../app/src/app/api/kitchen/config/route.ts) return staff lists. None set `Cache-Control`.
**Why it matters:**
- Public booking widget hits `/api/settings/public` on every page load — could cache for 30–60 s without harm.
- Static config endpoints are common DDoS targets; short-cache mitigates.
**Possible action:** Set `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=120` on truly public endpoints. Be careful: anything that includes per-user data must NOT cache.

### 11-F15 — No pagination on any list endpoint
**Severity:** 🟡 Medium
**Evidence:** Sample list endpoints:
- [admin/customers GET](../app/src/app/api/admin/customers/route.ts) — selects all customers.
- [admin/users GET](../app/src/app/api/admin/users/route.ts) — fetches all customers + drivers + waiters.
- [admin/reservations GET](../app/src/app/api/admin/reservations/route.ts#L36) — `from`/`to`/`status` query filters but no `limit`/`offset`.
- [admin/orders/[id]/...](../app/src/app/api/admin/orders/[id]/) — no list endpoint at the top admin/orders level (orders go through Realtime / per-customer).
- [admin/drivers GET](../app/src/app/api/admin/drivers/route.ts#L34) — all drivers.

**Why it matters:**
- A growing customer base will eventually break the admin customer list. 10K customers × ~500 bytes = 5 MB JSON response. Memory + latency cost grows linearly.
- Same for orders, reservations.
- Cross-ref Audit 12 (next) — query efficiency.
**Possible action:** Add `?limit=50&cursor=...` cursor-based pagination. Postgres `id > cursor LIMIT 50` is straightforward. Update consumers.

### 11-F16 — Realtime subscriptions reach into anon-readable tables (cross-ref 07-F3/F4)
**Severity:** 🔴 see Audit 07
**Evidence:** [AppContext.tsx:633–784](../app/src/context/AppContext.tsx#L633) subscribes via `supabase.from("...").on(...)` to categories, menu_items, orders, customers, drivers. Anon-readable subscriptions inherit the anon-SELECT policy (07-F3: orders are all-anon-readable). Once 07-F3/F4 are tightened, Realtime subscriptions break unless migrated to authenticated channels.
**Why it matters:** Coupling between data-source security (Audit 07) and API design. Worth flagging here so 07-F3/F4 fix scope includes the Realtime migration.
**Possible action:** Plan that the security-tightening PR moves Realtime channels server-side (proxy via Next.js + Server-Sent Events, or use Supabase row-level auth) before locking down anon SELECT.

### 11-F17 — No CORS configuration anywhere
**Severity:** ⚠️ Positive (correct for current setup)
**Evidence:** Grep shows zero `Access-Control-*` headers and zero CORS middleware.
**Why it matters:**
- Current consumers are: same-origin Next.js client + Capacitor Android wrapper (which serves the Next.js app from same-origin). No third-party JavaScript clients.
- Therefore restricting to same-origin is correct.
**Possible action:** Document this in deployment docs. If a third-party integration is added later (e.g. partner widget), revisit then.

### 11-F18 — Empty / partial `route.ts` discoverability
**Severity:** 🟡 Low (organizational)
**Evidence:** From [Audit 03 §3](./03-dead-code-duplicates.md), [admin/drivers/[id]/route.ts](../app/src/app/api/admin/drivers/[id]/route.ts) has only PUT and DELETE — no GET. To check whether GET is needed, a reader has to search for callers. Same for many routes.
**Why it matters:** Discoverability. A consumer wondering "can I GET /api/admin/drivers/<id>?" can't tell from the route file alone.
**Possible action:** Each `route.ts` exports the methods it supports; everything else returns 405 by default (Next.js handles this). No code change required, but a brief docstring at the top of each route listing supported methods would help.

## 6. Findings — idempotency

### 11-F19 — `POST /api/orders` doesn't explicitly handle duplicate-id (returns 500)
**Severity:** 🟡 Medium
**Evidence:** [orders/route.ts:241–245](../app/src/app/api/orders/route.ts#L241):
```ts
const { error } = await supabaseAdmin.from("orders").insert(row);
if (error) {
  console.error("orders POST:", error.message);
  return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
}
```
If the client POSTs the same `id` twice (offline retry, double-click, network blip), the second insert fails with PG `23505 (unique_violation)` and the route returns 500 + the raw message.
**Why it matters:**
- Compare [pos/orders POST](../app/src/app/api/pos/orders/route.ts) (does similar but cleaner) and the [posOutbox.ts:128–131](../app/src/lib/posOutbox.ts#L128) which treats 409 as "already exists, success."
- The customer site has no offline outbox today, but a network-flap retry can still trigger this.
**Possible action:** Detect 23505 and return 409 with `{ ok: true, orderId: id, duplicate: true }` (or just 200 idempotent-success). Cross-ref Audit 12 for similar issues across routes.

### 11-F20 — `auth/register` doesn't handle duplicate email gracefully on the fallback path
**Severity:** 🟡 Low
**Evidence:** [auth/register/route.ts:83–87](../app/src/app/api/auth/register/route.ts#L83) checks for an existing email *before* insert, returns 409. ✓ Good. But the fallback insert at [line 122](../app/src/app/api/auth/register/route.ts#L122) (when migration not run) doesn't check; race condition possible.
**Why it matters:** Tiny window. Real fix is "always-on migration" rather than a fallback path; cross-ref 03-F11/03-F14 (migration ad-hoc).
**Possible action:** Drop the fallback path once the migration is required (set a release boundary).

## 7. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🔴 **Cross-ref** | 11-F3 (Supabase error echo — see 08-F15/09-F17), 11-F16 (Realtime + RLS — see 07-F3/F4) | |
| 🟡 **Medium** | 11-F8 (singular/plural reservation), 11-F9 (customer dual surface), 11-F15 (no pagination) | |
| 🟡 **Low** | 11-F1 (withError unused), 11-F2 ("Invalid JSON." duplication), 11-F4 (200 vs 201 inconsistency), 11-F5 (DELETE 200 vs 204), 11-F6 (403 underused), 11-F7 (error message drift), 11-F10 (orders namespace fan-out), 11-F11 (PUT vs POST drift), 11-F13 (runtime=nodejs not declared on print), 11-F14 (no cache on static endpoints), 11-F18 (route discoverability), 11-F19 (orders duplicate-id 500), 11-F20 (register fallback race) | |
| ⚠️ **Positive** | 11-F17 (no CORS — correct for current setup) | |

## 8. Highest-ROI consistency fixes

1. **Adopt the `withError` wrapper** (11-F1). Migrate routes opportunistically. Disappears the duplicate try/catch and centralises 11-F3.
2. **Centralise body-parsing + JSON-error helper** (11-F2). One line per route → removes 47+ duplications. Pairs with zod (08-F16).
3. **Centralise the "respond with internal error" helper** (11-F3) — strip `Detail:`, log structured, return generic message to caller.
4. **Pick a created-resource convention** (11-F4) — 201 + `Location` for clear creates, or document "always 200".
5. **Pagination on list endpoints** (11-F15) — `?limit=&cursor=`. Pair with consumers' UI changes.
6. **Singular/plural reservations** (11-F8) — pick plural; provide a redirect from old singular path during rollout.
7. **Document method-semantics convention** (11-F11) — PUT for idempotent state transitions; POST for actions.
8. **Set `runtime = "nodejs"` explicitly** on print + any other Node-only route (11-F13).

## 9. Open questions for the user

1. **Public API contract:** is the API treated as a public contract (third-party clients, mobile app) or private to this app's frontend? Affects rigor on 11-F4 (status codes) and 11-F11 (HTTP semantics).
2. **Pagination defaults:** when adopting pagination (11-F15), what default page size feels right? 50 is a common default; 25 if list rows are heavy.
3. **`apiHandler.ts` adoption:** are you happy migrating all routes to the wrapper over time, or do you prefer to keep it for new routes only and let existing ones drift?
4. **Realtime subscription strategy** (11-F16): once 07-F3/F4 RLS is tightened, do you prefer to (a) keep client-side Realtime via authenticated Supabase channels, or (b) move to server-driven push (SSE / fetch-poll)? Affects refactor scope.

## 10. What's next

- **Audit 12 — Query efficiency** ([12-query-efficiency.md](./12-query-efficiency.md), pending). Will scan for: unbounded SELECTs (no `.limit()`), N+1 patterns (per-row queries inside loops), missing indexes implied by frequent filters, `.select("*")` vs explicit columns, transaction boundaries / atomicity gaps.
