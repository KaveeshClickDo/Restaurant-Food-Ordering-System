# Audit 06 — Auth & Authorization

**Phase:** 3 — Security
**Date:** 2026-05-04
**Scope:** Every route under [app/src/app/api/](../app/src/app/api/) (67 `route.ts` files), the auth helpers in [lib/auth.ts](../app/src/lib/auth.ts), [lib/adminAuth.ts](../app/src/lib/adminAuth.ts), [lib/waiterAuth.ts](../app/src/lib/waiterAuth.ts), and the edge [middleware.ts](../app/src/middleware.ts).
**Mode:** Read-only

---

## ⚠️ Heads-up

This audit found multiple **critical**, internet-exposable security issues. They are described below for the purpose of fixing. Treat this file as sensitive — don't commit screenshots of it to public channels until the issues are remediated. Most issues are simple to fix (apply existing helpers); the print/email endpoints need more thought.

## 1. Methodology

I built an auth-coverage matrix by grepping every `route.ts` file for known auth markers (`isAdminAuthenticated`, `requireWaiterAuth`, `getCustomerSession`, `getDriverSession`, `getKitchenSession`, `getPosSession`, presence of a 401 response). For every route that came back blank, I read the file to confirm whether (a) it should be public, (b) it has alternative auth (e.g. a token in the URL), or (c) it's actually unauthenticated when it shouldn't be.

I also read `lib/auth.ts`, `lib/adminAuth.ts`, `lib/waiterAuth.ts`, and `middleware.ts` to confirm the auth model.

## 2. The auth model — what's in place

The codebase has a **good cryptographic foundation** that just isn't being used everywhere:

- **HMAC-signed tokens** in httpOnly cookies, signed with `AUTH_JWT_SECRET` / `ADMIN_JWT_SECRET` ([lib/auth.ts:38–64](../app/src/lib/auth.ts#L38), [lib/adminAuth.ts:28–49](../app/src/lib/adminAuth.ts#L28)).
- **Timing-safe comparisons** for password verification (`timingSafeEqual`, [lib/auth.ts:58](../app/src/lib/auth.ts#L58), [lib/adminAuth.ts:44](../app/src/lib/adminAuth.ts#L44)).
- **`secure` cookies** in production, `httpOnly`, `sameSite: lax`, `path: /` ([lib/auth.ts:67–73](../app/src/lib/auth.ts#L67)).
- **Session readers** for each role: `getCustomerSession`, `getDriverSession`, `getWaiterSession`, `getKitchenSession`, `getPosSession` ([lib/auth.ts:95–99](../app/src/lib/auth.ts#L95)).
- **Edge middleware** redirects unauthenticated users away from `/driver/*` and `/kitchen/*` pages ([middleware.ts:108–139](../app/src/middleware.ts#L108)).
- **`requireWaiterAuth`** helper ([lib/waiterAuth.ts:14–18](../app/src/lib/waiterAuth.ts#L14)).
- **Rate limiting** via [lib/rateLimit.ts](../app/src/lib/rateLimit.ts) — applied on all 5 login endpoints (auth/login, auth/register, kitchen/auth, pos/auth, waiter/auth).
- **bcrypt** for password hashing on the customer + driver paths ([auth/register/route.ts:90](../app/src/app/api/auth/register/route.ts#L90), [admin/drivers/route.ts:72](../app/src/app/api/admin/drivers/route.ts#L72) — cost factor 10–12).
- **Server-authoritative price/coupon recalculation** in `/api/orders` ([orders/route.ts:80–214](../app/src/app/api/orders/route.ts#L80)).

The auth toolkit is well-built. The problem is **inconsistent application**.

## 3. Auth-coverage matrix (67 routes)

Legend: A = admin, W = waiter, P = POS staff, C = customer, D = driver, K = kitchen, T = URL token, ⛔ = no auth check, ✓ = correctly gated.

| Route | Method | Required | Implemented | Verdict |
|---|---|---|---|---|
| `admin/auth` | POST/GET/DELETE | password / A | A (login uses ADMIN_PASSWORD; GET/DELETE check cookie) | ✓ |
| `admin/categories` | GET/POST | A | A | ✓ |
| `admin/categories/[id]` | PUT/DELETE | A | A | ✓ |
| `admin/customers` | GET/POST | A | A | ✓ |
| `admin/customers/[id]` | * | A | A | ✓ |
| **`admin/drivers`** | **GET/POST** | **A** | **none** | ⛔ **06-F1** |
| **`admin/drivers/[id]`** | **PUT/DELETE** | **A** | **none** | ⛔ **06-F1** |
| `admin/menu` | GET/POST | A | A | ✓ |
| `admin/menu/[id]` | PUT/DELETE | A | A | ✓ |
| `admin/orders/[id]/driver` | PUT | A | A | ✓ |
| `admin/orders/[id]/refund` | POST | A | A | ✓ |
| `admin/orders/[id]/status` | PUT | A | A | ✓ |
| `admin/reservations` | * | A | A | ✓ |
| `admin/reservations/[id]` | PUT/DELETE | A | A | ✓ |
| `admin/reservation-customers` | * | A | A | ✓ |
| `admin/reservation-customers/[id]` | * | A | A | ✓ |
| `admin/reservation-customers/[id]/reservations` | GET | A | A | ✓ |
| **`admin/seed`** | **POST** | **A** | **none (explicit comment "no admin auth required")** | ⛔ **06-F2** |
| `admin/settings` | GET/PUT | A | A | ✓ |
| `admin/users` | GET/POST | A | A | ✓ |
| `admin/users/[id]` | * | A | A | ✓ |
| `admin/users/[id]/send-reset` | POST | A | A | ✓ |
| `admin/users/[id]/set-password` | POST | A | A | ✓ |
| `auth/change-password` | POST | C | C | ✓ |
| `auth/driver` | POST/GET | public POST / D for GET | D on GET | ✓ |
| `auth/driver/me` | GET | D | D | ✓ |
| `auth/driver/logout` | POST | none (clear cookie) | none | ✓ |
| `auth/driver/reset-password` | POST | public | rate limit | ✓ (verify rate limit in code) |
| `auth/driver/reset-password/confirm` | POST | token-gated | T | ✓ |
| `auth/google` | GET | public (OAuth init) | none | ✓ |
| `auth/google/callback` | GET | public (OAuth callback) | none | ✓ |
| `auth/login` | POST | public | rate-limited | ✓ |
| `auth/logout` | POST | none (clear cookie) | none | ✓ |
| `auth/me` | GET | C | C | ✓ |
| `auth/register` | POST | public | rate-limited | ✓ |
| `auth/resend-verification` | POST | C | C | ✓ |
| `auth/reset-password` | POST | public | rate limit | ✓ (verify) |
| `auth/reset-password/confirm` | POST | token-gated | T | ✓ |
| `auth/verify-email` | POST | token-gated | T | ✓ |
| **`customers/[id]`** | **PATCH** | **C (the same customer)** | **none — strips disallowed fields, but no session check** | ⛔ **06-F3** |
| **`customers/[id]/spend-credit`** | **POST** | **C (the same customer)** | **none** | ⛔ **06-F4** |
| **`email`** | **POST** | **A or none** | **none — wide-open SMTP relay** | ⛔ **06-F5** |
| **`guest-profile`** | **POST** | none (anon flow) but should be rate-limited | none | 🟡 **06-F11** |
| `kds/orders/[id]/status` | PUT | K or A | K or A | ✓ |
| `kitchen/auth` | POST | rate-limited public PIN auth | rate-limited | ✓ |
| `kitchen/config` | GET | none (PINs stripped) | strips PINs | ✓ |
| `kitchen/logout` | POST | K | K (clears cookie) | ✓ |
| **`orders`** | **POST** | **C (the customer placing it)** | **none — accepts arbitrary `customer_id` from body** | ⛔ **06-F6** |
| `ping` | GET | public | none | ✓ |
| `pos/auth` | POST | rate-limited public PIN auth | rate-limited | ✓ |
| `pos/menu` | GET/POST | P | P | ✓ |
| **`pos/orders/[id]/collected`** | **PUT** | **P or A** | **none — explicit "trusted in-restaurant screen" comment** | ⛔ **06-F7** |
| `pos/orders` | * | P | P | ✓ |
| **`pos/reservations`** | **POST** | **P** | **none — explicit "POS is an internal staff terminal" comment** | ⛔ **06-F8** |
| **`pos/reservations/[id]`** | **PUT** | **P** | **none — same comment** | ⛔ **06-F8** |
| **`print`** | **POST** | **A or P** | **none — accepts ip/port/bytes from anyone** | ⛔ **06-F9** |
| `reservation/[token]` | GET/POST | T | T (cancel_token in URL) | ✓ |
| **`reservations`** | **POST** | **none (public booking)** | **none, but no rate limit** | 🟡 **06-F10** |
| `reservations/availability` | GET | none | none | ✓ |
| `settings/public` | GET | none (whitelisted) | strips sensitive | ✓ |
| `waiter/auth` | POST | rate-limited public PIN auth | rate-limited | ✓ |
| `waiter/config` | GET | none (PINs stripped) | strips PINs | ✓ |
| `waiter/logout` | POST | none (clear cookie) | none | ✓ |
| `waiter/orders` | POST | W | W (`requireWaiterAuth`) | ✓ |
| **`waiter/refund`** | **POST** | **W (senior?) or A** | **none** | ⛔ **06-F12** |
| **`waiter/settle`** | **POST** | **W or A** | **none** | ⛔ **06-F13** |
| **`waiter/void`** | **POST** | **W (senior?) or A** | **none** | ⛔ **06-F14** |

**Of 67 routes, 12 are missing required auth** — 18%. None of these gaps are subtle: in every case the helper exists in `lib/auth.ts` or `lib/waiterAuth.ts` and just isn't called.

## 4. Findings — critical gaps (⛔)

### 06-F1 — `admin/drivers` and `admin/drivers/[id]` have no admin auth check
**Severity:** 🔴 Critical
**Evidence:** [admin/drivers/route.ts](../app/src/app/api/admin/drivers/route.ts) has `GET` (line 34) and `POST` (line 47); [admin/drivers/[id]/route.ts](../app/src/app/api/admin/drivers/[id]/route.ts) has `PUT` (line 29) and `DELETE` (line 88). None call `isAdminAuthenticated()`.
**Impact:**
- Anyone can `POST /api/admin/drivers` to create a driver account with a known password and immediately `POST /api/auth/driver` to authenticate as that driver.
- Anyone can `DELETE /api/admin/drivers/<id>` to remove all drivers.
- `GET` does correctly exclude `password_hash` from the response, so credential exfiltration is bounded — but PII (driver names, emails, phones, vehicle info) leaks.
**Fix:** Add `if (!await isAdminAuthenticated()) return unauthorizedResponse();` at the top of every handler.

### 06-F2 — `admin/seed` has no admin auth (explicit by-design comment)
**Severity:** 🔴 High
**Evidence:** [admin/seed/route.ts:5](../app/src/app/api/admin/seed/route.ts#L5): "No admin auth required (seeding is only additive and idempotent)." Handler at [line 61](../app/src/app/api/admin/seed/route.ts#L61).
**Impact:** It IS idempotent today (no-op when tables are populated). But:
- Anyone on the internet can poll the endpoint to detect first-run state.
- Mock customers from [data/customers.ts](../app/src/data/customers.ts) get inserted on a fresh install — those customers have known IDs and (per the seed code) a `password` field set to whatever's in the seed file. That's a known-credential foothold.
- "Idempotent" today; one new line of code that *isn't* idempotent (e.g. resetting a counter, "ensure pos-walk-in" already does an upsert) and the assumption breaks.
**Fix:** Gate on `isAdminAuthenticated()`. Idempotency is not a substitute for authorization.

### 06-F3 — `customers/[id]` PATCH lets anyone update any customer's profile
**Severity:** 🔴 Critical
**Evidence:** [customers/[id]/route.ts](../app/src/app/customers/[id]/route.ts). The `ALLOWED_FIELDS` allowlist (`favourites`, `saved_addresses`, `name`, `phone`) is good — but there's no `getCustomerSession()` call. The route trusts whoever calls it with a customer ID.
**Impact:** A customer ID is just a UUID. With a known UUID (e.g. obtained from any leaked link, page source on shared device, or guessed across enumeration), an attacker can:
- Change another customer's `name` and `phone` — repurposing the account for fraud (e.g. delivery to attacker's number).
- Add a `saved_address` belonging to the attacker, then place an order on that customer (combined with 06-F6).
- Replace the favourites list (low impact, but unwanted).
**Fix:**
```ts
const session = await getCustomerSession();
if (!session || session.id !== id) return unauthorizedJson();
```

### 06-F4 — `customers/[id]/spend-credit` lets anyone burn any customer's store credit
**Severity:** 🔴 Critical
**Evidence:** [customers/[id]/spend-credit/route.ts:5](../app/src/app/api/customers/[id]/spend-credit/route.ts#L5): explicit comment "No admin auth required — this is called during customer checkout." But there is no customer session check either.
**Impact:** With a known customer UUID, attacker can `POST { amount: 9999 }` to clear that customer's store-credit balance to zero. Pure griefing today; in combination with 06-F6, an attacker can use the credit on a fraudulent order to themselves.
**Fix:** Same as 06-F3 — verify `session.id === id`.

### 06-F5 — `/api/email` is an open SMTP relay
**Severity:** 🔴 Critical (highest blast radius)
**Evidence:** [email/route.ts:38](../app/src/app/api/email/route.ts#L38). Validates that body doesn't carry SMTP creds, but anyone on the internet can `POST {to, subject, html}` and the server sends the email through your configured SMTP provider.
**Impact:**
- **Spam relay**: a single hour of abuse will trigger blacklisting on Resend / SendGrid / your domain. Once your sending IP/domain is blacklisted, your real transactional emails (order confirmations, password resets) silently fail to deliver.
- **Phishing carrier**: emails go *from your verified domain*, lending phishing credibility.
- **Cost**: SMTP providers charge per email; an attacker can run up your bill.
- **Reputation**: a domain that gets used as a spam vector takes weeks-to-months to recover sender reputation, even after the leak is fixed.
**Fix priority:** **Block this immediately.** Options:
1. Best: gate on a server session (admin / staff / customer-with-verified-email) and rate-limit per session.
2. Minimum acceptable stop-gap: deny anonymous calls and only allow internal use via a secret header. The secret should be a per-deployment env var (`INTERNAL_EMAIL_API_KEY`).
3. Do NOT release this endpoint as-is in any environment that has SMTP creds set.

### 06-F6 — `POST /api/orders` accepts arbitrary `customer_id` from the body
**Severity:** 🔴 Critical
**Evidence:** [orders/route.ts:40,45–47](../app/src/app/api/orders/route.ts#L40). The price/coupon verification is excellent, but the route takes `customer_id` from the request body and inserts whatever is given. There's no `getCustomerSession()` and no check that the caller is the customer they claim to be.
**Impact:**
- Attacker places an order on victim's account. Victim is billed (via stored payment method tied to their account, if any), and the attacker controls the delivery `address`.
- Combined with 06-F3 (set victim's address to attacker's location) and 06-F4 (drain victim's store credit toward the order), attacker can run up store-credit-funded fraud.
- Even without payment fraud, this generates spam orders on legitimate customers.
**Fix:**
```ts
const session = await getCustomerSession();
// POS / waiter / kitchen flows enter via different routes;
// /api/orders should only serve customer-placed orders.
if (!session || session.id !== body.customer_id) return unauthorizedJson();
```
Note: `customer_id === "pos-walk-in"` is the seeded sentinel for non-customer paths. Either reject that here (POS uses `/api/pos/orders`) or allow it only when caller is a POS session.

### 06-F7 — `pos/orders/[id]/collected` PUT has no auth
**Severity:** 🔴 Medium-High
**Evidence:** [pos/orders/[id]/collected/route.ts:5–6](../app/src/app/api/pos/orders/[id]/collected/route.ts#L5): "No admin cookie needed because this endpoint is called from a trusted in-restaurant screen." The status guard (only advances from "ready") limits damage.
**Impact:** Attacker who learns an in-flight order ID can prematurely mark it as `delivered`. Customer's notification flow may interpret as "your order is ready / collected". Doesn't deliver real harm because the food doesn't move, but skews reports and confuses reconciliation.
**Fix:** Add `getPosSession()` check or, if the customer-display device runs on its own auth, gate on a kitchen/POS cookie.

### 06-F8 — POS reservation create/update have no POS auth
**Severity:** 🔴 High
**Evidence:** [pos/reservations/route.ts:5–6](../app/src/app/api/pos/reservations/route.ts#L5), [pos/reservations/[id]/route.ts:5–6](../app/src/app/api/pos/reservations/[id]/route.ts#L5): both say "No admin cookie required — POS is an internal staff terminal."
**Impact:**
- Anyone can create walk-in reservations attributed to staff at any table — denial-of-service against booking system.
- Anyone can flip reservation statuses (`checked_in`, `checked_out`, `confirmed`, `cancelled`, `no_show`) — disrupts service, falsifies records.
- Side-effect: triggers customer emails ("review your visit", cancellation emails) — abuse vector for spamming customers.
**Fix:** `if (!await getPosSession()) return unauthorizedJson();` in both files.

### 06-F9 — `/api/print` is an unauthenticated SSRF / port-scanner
**Severity:** 🔴 Critical (deployment-dependent)
**Evidence:** [print/route.ts:38–60](../app/src/app/api/print/route.ts#L38). Accepts `ip`, `port`, and `bytes` from request body and opens a TCP socket to it.
**Impact:**
- **SSRF**: attacker can use the server as a TCP probe into your internal network (private IP ranges 10/8, 192.168/16, 172.16/12). They learn what's running on which ports based on the error code returned (`ECONNREFUSED` vs `ETIMEDOUT` vs `EHOSTUNREACH`).
- **Arbitrary internal traffic**: the body payload is raw bytes — any byte-oriented internal service (Redis, memcached without auth, internal admin panels) can be poked.
- **Cloud metadata access** (if deployed on cloud): `169.254.169.254` is the AWS/GCP/Azure metadata endpoint. ESC/POS bytes don't speak HTTP, so direct exfiltration is bounded — but presence/absence of the endpoint is detectable.
**Fix:**
1. Require auth: admin or POS session.
2. Validate `ip` against an allowlist or block private/loopback/metadata ranges.
3. Validate `port` against an allowlist (default 9100).
4. Cap `bytes.length`.
5. Consider running this only via a dedicated internal-network worker, not the public Next.js server.

### 06-F10 — Public `/api/reservations` POST has no rate limit
**Severity:** 🟡 Medium
**Evidence:** [reservations/route.ts:17](../app/src/app/api/reservations/route.ts#L17). Has good server-side validation (slot conflict re-check, party size cap, future-time only) but no rate limit.
**Impact:** Bot can flood the system with fake bookings. Each booking fires a confirmation email (cost + reputation). The slot-conflict check makes the bookings *real* (legitimate customers are blocked). This is a denial-of-service against the booking flow.
**Fix:** Apply `rateLimit("reservation:" + ip, 5, 60_000)` similar to register/login.

### 06-F11 — `/api/guest-profile` POST has no rate limit and accepts arbitrary email
**Severity:** 🟡 Medium
**Evidence:** [guest-profile/route.ts](../app/src/app/api/guest-profile/route.ts).
**Impact:** Attacker can pollute the `reservation_customers` table with arbitrary emails and increment counts. Not a direct security breach but corrupts CRM data.
**Fix:** Rate limit per IP. Consider tying to a recent order/reservation as proof of legitimate use.

### 06-F12 — `waiter/refund` has no auth
**Severity:** 🔴 Critical
**Evidence:** [waiter/refund/route.ts](../app/src/app/api/waiter/refund/route.ts). Uses `supabaseAdmin` to fetch dine-in orders and write refund records — directly impacts cash position.
**Impact:**
- Attacker issues unauthorized refunds against arbitrary order IDs (in `delivered` status). Money flows where the attacker says.
- Attacker spams the refunds JSON with fake records, masking real refunds in audit trails.
- This is the highest financial-impact missing check in the audit.
**Fix:** `requireWaiterAuth()` at minimum. Better: also check the waiter is "senior" via DB lookup before allowing refunds (the system already distinguishes "senior" from "waiter" — see [waiter/config/route.ts:11](../app/src/app/api/waiter/config/route.ts#L11)).

### 06-F13 — `waiter/settle` has no auth
**Severity:** 🔴 High
**Evidence:** [waiter/settle/route.ts](../app/src/app/api/waiter/settle/route.ts).
**Impact:** Anyone can mark dine-in orders as `delivered`/paid with whatever payment method. Skews end-of-day cash reconciliation. Doesn't directly extract money, but breaks accounting.
**Fix:** `requireWaiterAuth()`.

### 06-F14 — `waiter/void` has no auth
**Severity:** 🔴 High
**Evidence:** [waiter/void/route.ts](../app/src/app/api/waiter/void/route.ts).
**Impact:** Attacker voids active dine-in orders en masse → kitchen stops cooking, customers' orders disappear. Possible operational sabotage. The status guard (won't void already-completed orders) limits the blast radius to active orders only.
**Fix:** `requireWaiterAuth()` plus role-elevation check (voids should be senior-only, like refunds).

## 5. Findings — auth-model issues

### 06-F15 — Two HMAC token formats (admin uses `<exp>.<sig>`, others use `<exp>|<id>|<role>|<sig>`)
**Severity:** 🟡 Low (not exploitable, but inconsistent)
**Evidence:** [adminAuth.ts:28–32](../app/src/lib/adminAuth.ts#L28) uses `<exp>.<sig>`; [auth.ts:38–47](../app/src/lib/auth.ts#L38) uses pipe-delimited. The middleware ([middleware.ts:74–103](../app/src/middleware.ts#L74)) implements the admin format separately because it's different.
**Why it matters:** Two formats = two implementations of token verification, with the same security-critical primitives implemented twice. Minor maintenance burden.
**Fix:** Migrate admin sessions to the same `<exp>|<id>|<role>|<sig>` format with `role: "admin"`. Existing tokens become invalid — force re-login.

### 06-F16 — `ADMIN_PASSWORD` is a single shared password (no per-user admin accounts)
**Severity:** 🟡 Medium (tradeoff, intentional)
**Evidence:** [admin/auth/route.ts:22–46](../app/src/app/api/admin/auth/route.ts#L22). Comparison is timing-safe (good), but there's no user identity behind admin sessions — the cookie just says "admin", no `id`, no audit trail.
**Why it matters:**
- No way to tell *which* admin made a change.
- Rotation requires telling every admin user the new password simultaneously.
- A leaked password compromises every admin.
**Fix:** Move admin login to the same `users` table that already exists ([UserManagementPanel.tsx](../app/src/components/admin/UserManagementPanel.tsx)) with per-user accounts and bcrypt-hashed passwords. Issue a `role: "admin"` session token. Then 06-F15 falls out naturally.

### 06-F17 — Login length-leak in admin password compare
**Severity:** 🟡 Low
**Evidence:** [admin/auth/route.ts:46](../app/src/app/api/admin/auth/route.ts#L46): `valid = a.length === b.length && timingSafeEqual(...)`. Comment acknowledges it ("length mismatch is itself detectable").
**Why it matters:** An attacker can determine the admin password length by timing or by behavior. Not a direct break — but combined with weak passwords it reduces brute-force search space.
**Fix:** Always run `timingSafeEqual` against a fixed-length buffer (hash both sides first, e.g. `sha256(candidate)` vs `sha256(stored)`).

### 06-F18 — `auth/driver/me` exists, but no equivalent `auth/waiter/me` or `auth/pos/me`
**Severity:** 🟡 Low (UX symptom of 04-F9)
**Evidence:** Driver app does session validation on mount via `/api/auth/driver/me`. Waiter and POS don't have an equivalent endpoint.
**Why it matters:** When the cookie expires while the tab is open, waiter/POS UIs continue acting authenticated until a request fails. Inconsistent UX.
**Fix:** Add `GET /api/auth/waiter/me` and `GET /api/auth/pos/me` returning `{ ok, staff/waiter }`. Update [waiter/page.tsx](../app/src/app/waiter/page.tsx) restore flow to validate (cross-ref 04-F9).

### 06-F19 — Edge middleware protects `/driver/*` and `/kitchen/*` pages but **not** `/pos/*`, `/waiter/*`, `/admin/*`
**Severity:** 🟡 Medium
**Evidence:** [middleware.ts:144–146](../app/src/middleware.ts#L144): matcher only includes `/driver` and `/kitchen` paths.
**Why it matters:**
- `/pos`, `/waiter`, `/admin` rely on client-side redirect logic (e.g. POS login screen rendered when no `currentStaff` in localStorage). That works for the happy path, but:
- A user with JS disabled or a slow first paint sees the protected page briefly.
- Search engine bots can index protected URLs (and may surface them).
- Direct deep-link to `/admin/?someState` shows the admin shell before the auth modal renders.
**Fix:** Extend the matcher and add HMAC verification for the other admin/staff cookies. Edge runtime constraint: must use Web Crypto (already used for the existing roles).

### 06-F20 — `customer_id === "pos-walk-in"` is a back-door for real customers' privilege
**Severity:** 🟡 Medium
**Evidence:** [admin/seed/route.ts:113–126](../app/src/app/api/admin/seed/route.ts#L113), [waiter/orders/route.ts:12–20](../app/src/app/api/waiter/orders/route.ts#L12). The seeded sentinel customer has `email: "pos-walkin@internal"` and `password: ""`.
**Why it matters:** Combined with 06-F6: attacker passes `customer_id: "pos-walk-in"` to `/api/orders` and the order is attributed to the sentinel rather than the attacker. Once 06-F6 is fixed, this back-door closes — but if the customer login flow ever allows logging in as the sentinel (empty password), that's an auth bypass.
**Fix:** Once 06-F6 is fixed, also reject `customer_id === "pos-walk-in"` in the customer-side endpoint.

## 6. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🔴 **Critical** | 06-F5 (open email relay), 06-F12 (waiter refund unprotected), 06-F6 (orders accept arbitrary customer_id), 06-F9 (print SSRF), 06-F1 (admin/drivers no auth), 06-F3 (customer profile mass-update), 06-F4 (spend any customer's credit) | Direct internet-exposable |
| 🔴 **High** | 06-F2 (seed unprotected), 06-F8 (POS reservations unprotected), 06-F13 (waiter/settle), 06-F14 (waiter/void) | Auth missing on operational endpoints |
| 🔴 **Medium-High** | 06-F7 (pos/collected) | |
| 🟡 **Medium** | 06-F10 (no rate limit on reservations), 06-F11 (guest-profile spam), 06-F16 (single admin password), 06-F19 (middleware coverage) | |
| 🟡 **Low** | 06-F15 (token format inconsistency), 06-F17 (length leak), 06-F18 (no waiter/me, pos/me), 06-F20 (sentinel customer back-door) | |

## 7. Highest-ROI fixes — recommended order

When refactor phase begins, this is the sequence that closes the most blast radius for the least effort:

1. **`/api/email`** — block immediately (06-F5). One line + redeploy. Stops potential domain reputation destruction.
2. **`/api/print`** — gate on auth + IP allowlist (06-F9). One file edit.
3. **Waiter mutations** — `requireWaiterAuth()` on refund/settle/void (06-F12, 06-F13, 06-F14). Three one-line additions.
4. **`/api/orders`** — verify `session.id === customer_id` (06-F6). Closes order-spoofing entirely.
5. **`customers/[id]` PATCH + spend-credit** — verify session ownership (06-F3, 06-F4).
6. **`/api/admin/drivers*`** — `isAdminAuthenticated()` (06-F1).
7. **`/api/admin/seed`** — `isAdminAuthenticated()` (06-F2). 
8. **POS endpoints** — `getPosSession()` on collected/reservations (06-F7, 06-F8).
9. **Rate limits** — reservations + guest-profile (06-F10, 06-F11).
10. **Middleware extension** — cover /admin, /pos, /waiter (06-F19).
11. **Token-format unification + per-admin accounts** (06-F15, 06-F16, 06-F17). Bigger refactor; do last.

Steps 1–8 are individually 1-line or 1-block patches, mostly identical (`if (!session) return unauthorizedJson();`).

## 8. Open questions for the user

1. **Authorization granularity for waiter mutations** (06-F12, 06-F14): the system already distinguishes `senior` vs `waiter` roles. Should refunds and voids be senior-only, or any-waiter? UK pub/restaurant convention is senior-only.
2. **Print endpoint deployment** (06-F9): is this server expected to reach the printer over LAN, or via a tunnel/VPN? Affects allowlist shape.
3. **Admin user model** (06-F16): how many people log into `/admin` today? If >1, we should plan a migration to per-user admin accounts now rather than later.
4. **POS / waiter `me` endpoints** (06-F18): worth adding now while we're touching auth, or defer? They unblock client-side session validation (04-F9, 06-F18).

## 9. What's next

- **Audit 07 — Service-role key exposure** ([07-service-role-key.md](./07-service-role-key.md), pending). Will verify `supabaseAdmin` is never imported into client code, that `NEXT_PUBLIC_*` vars don't accidentally include the service role key, and that RLS is enabled on every table the anon key can reach.
