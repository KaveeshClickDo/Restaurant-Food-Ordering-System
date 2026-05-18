# Role-Based Access & Insider-Threat Audit

**Date:** 2026-05-18
**Branch:** kaveesh
**Scope:** every UI route under [app/src/app/](../app/src/app/), every API route under [app/src/app/api/](../app/src/app/api/) (84 `route.ts` files), the auth helpers in [lib/auth.ts](../app/src/lib/auth.ts) / [lib/adminAuth.ts](../app/src/lib/adminAuth.ts) / [lib/waiterAuth.ts](../app/src/lib/waiterAuth.ts), the edge [middleware.ts](../app/src/middleware.ts), the [supabase/schema.sql](../supabase/schema.sql) RLS posture, and the client-side data access in [AppContext.tsx](../app/src/context/AppContext.tsx).
**Mode:** Read-only audit. No code changed.
**Methodology:** Findings re-derived from source — `AUTH_AUDIT.md`, prior `clean-up/06-*.md`, and `docs/security.md` were *not* used as inputs. Three parallel sub-agents read every API `route.ts` file end-to-end; UI pages, middleware, auth libs, schema, and client data-access were inspected directly.

This audit is the authorization companion to the older authentication audit. The older audit answered *"is this endpoint authenticated at all?"* This audit answers:

> Once a user is authenticated, **what can they do that they shouldn't be able to do** — including across roles (cashier hitting an admin endpoint) and across users within a role (cashier reading another cashier's tips, customer reading another customer's orders)?

---

## 0. TL;DR

The system has 6 cookie-bound roles (`admin`, `customer`, `driver`, `waiter`, `kitchen`, `pos`) plus a POS sub-role (`admin | manager | cashier`) and a permissions blob on `pos_staff`. Authentication is in good shape — every protected route checks *some* session helper.

**Authorization is not.** The big patterns:

1. **Insider-threat surface in POS and Waiter is wide open.** Within `pos_staff` and `waiters`, any logged-in user (incl. lowest sub-role) can:
   - Void or refund any sale, regardless of who rang it up — [F-INS-1](#f-ins-1)
   - Clock another staff member in or out — [F-INS-2](#f-ins-2)
   - Rewrite the entire menu and pricing — [F-INS-4](#f-ins-4)
   - Refund/void another waiter's orders, forging `refundedBy`/`voidedBy` audit fields — [F-INS-5](#f-ins-5)
   - Read every other staff member's full sales/tip history — [F-INS-7](#f-ins-7)
   - Escalate their own permissions if they have `canManageStaff` — [F-INS-6](#f-ins-6)

   Sub-role and the `pos_staff.permissions` flags exist in the schema but are **never consulted** by the routes that exercise them. `getPosSession()` returns truthy → handler proceeds.

2. **A single foundational data-exposure bug dwarfs everything else.** [`AppContext.tsx:560-561`](../app/src/context/AppContext.tsx#L560) runs `supabase.from("customers").select(..., orders(*))` from the **browser**, with the **anon key**, on **every page load** including the public storefront. The RLS policies `anon_select_customers` and `anon_select_orders` permit this with `using (true)`. Net effect: every visitor to the website automatically downloads every customer's name/email/phone/address/store-credit and their entire order history — [F-DATA-1](#f-data-1).

3. **Driver login is the only staff login with no rate-limit.** All POS / waiter / kitchen logins call `rateLimit(...)`; driver email+password login does not — [F-ST-8](#f-st-8). Same for admin login — [F-AD-1](#f-ad-1).

4. **Two routes are SSRF / abuse primitives for any logged-in staff:** `/api/print` (write arbitrary bytes to almost any IP on port 9100) — [F-PU-4](#f-pu-4); `/api/email` (send arbitrary mail to arbitrary recipients on the restaurant's domain) — [F-PU-5](#f-pu-5).

5. **Several "public" GETs leak payroll PII** — `/api/pos/staff` and `/api/waiter/config` return `hourly_rate` + `email` for every active staff member, unauthenticated, because the login tile-picker UI consumes them — [F-INS-10](#f-ins-10).

6. **Mass-assignment risk on admin customer write endpoints** — admin POST/PUT against `/api/admin/customers` accepts the raw JSON body and forwards it into `supabaseAdmin.from("customers").update(body)`. An admin (or a stolen admin cookie) can set `password_hash`, `email_verified`, `store_credit`, etc. — [F-AD-2](#f-ad-2).

**Total findings: 32** (1 critical, 7 high, 13 medium, 8 low, 3 info).

---

## 1. Authentication architecture (re-derived from code)

| Subsystem | Cookie | Role string | Helper (boolean / session) | Verifier |
|---|---|---|---|---|
| Admin    | `admin_session`       | `admin`    | `isAdminAuthenticated()` / `getAdminSession()` | [adminAuth.ts:48](../app/src/lib/adminAuth.ts#L48) + [middleware.ts:118](../app/src/middleware.ts#L118) |
| Customer | `customer_session`    | `customer` | `getCustomerSession()`                        | [auth.ts:52](../app/src/lib/auth.ts#L52) |
| Driver   | `driver_session`      | `driver`   | `getDriverSession()`                          | [auth.ts:52](../app/src/lib/auth.ts#L52) + [middleware.ts:23](../app/src/middleware.ts#L23) |
| Waiter   | `waiter_session`      | `waiter`   | `getWaiterSession()` / `requireWaiterAuth()`  | [auth.ts:52](../app/src/lib/auth.ts#L52) |
| Kitchen  | `kitchen_session`     | `kitchen`  | `getKitchenSession()`                         | [auth.ts:52](../app/src/lib/auth.ts#L52) + [middleware.ts:85](../app/src/middleware.ts#L85) |
| POS      | `pos_staff_session`   | `pos`      | `getPosSession()`                             | [auth.ts:52](../app/src/lib/auth.ts#L52) + [middleware.ts:54](../app/src/middleware.ts#L54) |

Token format is unified: `<exp>|<id>|<role>|<hmac>` signed with HMAC-SHA256, `AUTH_JWT_SECRET` (falls back to `ADMIN_JWT_SECRET`). Cookies are `httpOnly`, `sameSite=lax`, `secure` in production.

**Crypto primitives are sound** — HMAC-signed cookies, `timingSafeEqual` on signature compares, bcrypt for password and PIN hashes (drivers/customers use password+bcrypt; POS/waiter/kitchen use PIN+bcrypt).

**POS has a *sub-role* inside the role.** [`pos_staff.role`](../supabase/schema.sql#L179) is one of `admin | manager | cashier`. [`pos_staff.permissions`](../supabase/schema.sql#L183) is a JSONB capability map. **Neither is consulted by any of the high-impact `/api/pos/*` mutation routes.** Once `getPosSession()` returns a session, every POS endpoint treats the caller as equally privileged.

---

## 2. Middleware coverage

[middleware.ts](../app/src/middleware.ts) — matcher: `/driver`, `/kitchen`, `/pos` (and subpaths).

| Path | Protected by middleware | Login bypass | Verifier cookies accepted |
|---|---|---|---|
| `/driver/*`   | yes | `/driver/login`  | `driver_session` |
| `/kitchen/*`  | yes | `/kitchen/login` | `kitchen_session` OR `admin_session` |
| `/pos/*`      | yes | `/pos/login`     | `pos_staff_session` OR `admin_session` |
| `/admin/*`    | **no — client-side gate only** | n/a (inline login form) | n/a |
| `/waiter/*`   | **no — client-side gate only** | n/a (inline PIN picker) | n/a |
| `/(site)/*`   | **no — public** | n/a | n/a |
| `/customer-display` | **no — public** | n/a | n/a |

Implications:

- `/admin` and `/waiter` page bundles are served unauthenticated and the page renders its own login UI. Auth state arrives via a client-side `fetch("/api/admin/auth")` / `fetch("/api/waiter/auth")` after mount. **No UI flash** for `/admin` (it blocks render on `adminAuthed === null` with a spinner — verified at [admin/page.tsx:252-258](../app/src/app/admin/page.tsx#L252)). Waiter exhibits a similar gate.
- The JS bundle is still public — anyone can statically analyse `/admin/page.tsx`'s code, panel definitions, and API surface even without a session. This is unavoidable for an SPA and is not a finding.
- The `/customer-display` page calls `supabase.from("orders")...` directly with the anon key ([customer-display/page.tsx:386-387](../app/src/app/customer-display/page.tsx#L386)). It is intentionally unauthenticated (it's a screen at the counter). The data exposure that follows is governed by RLS (see §6).

---

## 3. UI route × role matrix

| Route | Auth gate | Authorised roles | Notes |
|---|---|---|---|
| [`/`](../app/src/app/page.tsx) | none | public | landing / storefront |
| [`/(site)/[footerPage]`](../app/src/app/(site)/[footerPage]/page.tsx) | none | public | CMS-ish footer pages |
| [`/(site)/login`](../app/src/app/(site)/login/page.tsx) | none | public | customer auth entry |
| [`/(site)/book`](../app/src/app/(site)/book/page.tsx) | none | public | reservation booking |
| [`/(site)/verify-email`](../app/src/app/(site)/verify-email/page.tsx) | none | public | token-based, consumes verify-email token |
| [`/(site)/reservation/[token]`](../app/src/app/(site)/reservation/[token]/page.tsx) | token | token holder | guest cancel link |
| [`/(site)/account`](../app/src/app/(site)/account/page.tsx) | **client-side only** (`currentUser` from `useApp()`) | `customer` (or shows auth modal) | also reads `customers`/`orders` from `AppContext` — see §6 |
| [`/(site)/favourites`](../app/src/app/(site)/favourites/page.tsx) | client-side `currentUser` | `customer` | same |
| [`/(site)/my-orders`](../app/src/app/(site)/my-orders/page.tsx) | client-side `currentUser` | `customer` | same |
| [`/admin`](../app/src/app/admin/page.tsx) | client-side fetch `/api/admin/auth` | `admin` | blocks render on `null`, shows login form on `false` |
| [`/waiter`](../app/src/app/waiter/page.tsx) | client-side fetch `/api/waiter/auth` | `waiter` | inline PIN picker |
| [`/kitchen`](../app/src/app/kitchen/page.tsx) | middleware + client `/api/kitchen/auth` | `kitchen` or `admin` | |
| [`/kitchen/login`](../app/src/app/kitchen/login/page.tsx) | none | public | login entry |
| [`/pos`](../app/src/app/pos/page.tsx) | middleware + client `currentStaff` | `pos` or `admin` | |
| [`/pos/login`](../app/src/app/pos/login/page.tsx) | none | public | login entry |
| [`/driver`](../app/src/app/driver/page.tsx) | middleware | `driver` | |
| [`/driver/login`](../app/src/app/driver/login/page.tsx) | none | public | login entry |
| [`/customer-display`](../app/src/app/customer-display/page.tsx) | **none** | public | reads orders directly via anon Supabase |

**Concerns on this matrix:**

- `/admin` and `/waiter` are not behind the edge middleware, by design — their inline-login pattern would create a redirect loop. The page-level loading state currently blocks the protected UI from rendering until the auth fetch resolves. The pages themselves are still in the public JS bundle.
- `/customer-display` has no auth — fine as design (in-store screen) but it relies on the anon Supabase client to read every order. Anyone who knows the anon key gets the same view; see [F-DATA-1](#f-data-1).
- Customer pages (`account` / `favourites` / `my-orders`) use only `currentUser` from `AppContext` as a gate. Render is gated, but the underlying `AppContext` fetches **every customer's PII** on mount regardless of who's logged in — see [F-DATA-1](#f-data-1).

---

## 4. API route × method × role matrix

84 `route.ts` files were inspected end-to-end. The matrix is too large to inline; the abbreviated structure is below. Per-route, per-method evidence with file:line citations lives in §5 (Findings).

### 4a. Admin tree (`/api/admin/*`)

34 routes. **Every handler calls `isAdminAuthenticated()` correctly.** No method-asymmetry gaps. Issues are mostly *what they do after* the auth check:

- No rate-limit anywhere in the admin tree (login, send-reset, bulk operations) — [F-AD-1](#f-ad-1), [F-AD-4](#f-ad-4)
- `/api/admin/customers` and `/api/admin/customers/[id]` skip the zod validation that every sibling route uses; the raw body is spread into the supabase write — [F-AD-2](#f-ad-2)
- `/api/admin/orders/[id]/refund` trusts client-supplied `refundedAmount`, `refunds`, `newStatus`, `newStoreCredit`, `customerId` — no server-side recomputation, no `customerId === order.customer_id` cross-check — [F-AD-3](#f-ad-3)
- No admin sub-roles — every admin operation requires the all-powerful single shared `ADMIN_PASSWORD` credential — [F-AD-6](#f-ad-6)
- `admin/seed` route from prior audit no longer exists on the tree — confirmed by file listing — [F-AD-7](#f-ad-7)

### 4b. Staff tree (`/api/pos/*`, `/api/waiter/*`, `/api/kitchen/*`, `/api/kds/*`, `/api/auth/driver/*`)

The **insider-threat surface**. All findings in this group are about *what the role can do once authenticated*, not whether they're authenticated:

| Concern | Routes | Severity |
|---|---|---|
| POS cashier can void/refund any sale | [`pos/sales/[id]`](../app/src/app/api/pos/sales/[id]/route.ts#L20) | high |
| POS cashier can clock another staff in/out (and read their clock entries) | [`pos/clock`](../app/src/app/api/pos/clock/route.ts#L46,L78) | high |
| POS sale `staff_id`/`staff_name` taken from request body | [`pos/sales`](../app/src/app/api/pos/sales/route.ts#L82) | medium |
| POS menu writes have no permission check + bootstrap bypass | [`pos/menu`](../app/src/app/api/pos/menu/route.ts#L37) | high |
| POS staff PATCH allows manager to edit anyone's permissions | [`pos/staff/[id]`](../app/src/app/api/pos/staff/[id]/route.ts#L29) | medium |
| POS sales GET returns every staff's sales | [`pos/sales`](../app/src/app/api/pos/sales/route.ts#L43) | medium |
| Waiter refund/void any order; `refundedBy`/`voidedBy` body-supplied | [`waiter/refund`](../app/src/app/api/waiter/refund/route.ts#L27), [`waiter/void`](../app/src/app/api/waiter/void/route.ts#L16) | high |
| Driver login has no rate-limit | [`auth/driver`](../app/src/app/api/auth/driver/route.ts#L24) | high |
| Driver reset-password has no rate-limit | [`auth/driver/reset-password`](../app/src/app/api/auth/driver/reset-password/route.ts#L19) | medium |
| `/api/pos/staff` GET and `/api/waiter/config` GET leak payroll PII unauthenticated | [`pos/staff`](../app/src/app/api/pos/staff/route.ts#L56), [`waiter/config`](../app/src/app/api/waiter/config/route.ts#L10) | medium |
| Kitchen rate-limit key is IP-only (inconsistent) | [`kitchen/auth`](../app/src/app/api/kitchen/auth/route.ts#L25) | low |
| Waiter order POST records `staffName` from body | [`waiter/orders`](../app/src/app/api/waiter/orders/route.ts#L30) | low |
| POS staff DELETE has no last-admin / self-deletion guard | [`pos/staff/[id]`](../app/src/app/api/pos/staff/[id]/route.ts#L66) | low |

### 4c. Public / customer / payment tree

Customer-self-service routes (`/api/customers/[id]`, `/api/customers/[id]/spend-credit`, `/api/auth/me`, `/api/auth/change-password`) **correctly enforce `session.id === id` ownership.** Verified in §5 evidence.

Order placement (`/api/orders`) and payment intent (`/api/payments/intent`) **correctly recompute prices server-side** ([orderValidation.ts](../app/src/lib/orderValidation.ts)) and reject the `pos-walk-in` sentinel.

Stripe webhook (`/api/webhooks/stripe`) **correctly verifies signature** via `getStripe().webhooks.constructEvent(rawBody, sig, secret)`.

Open issues in this tree:

| Concern | Route | Severity |
|---|---|---|
| `/api/customers/[id]/spend-credit` can be invoked without an order, draining own credit | [`spend-credit`](../app/src/app/api/customers/[id]/spend-credit/route.ts#L42) | medium |
| `/api/auth/reset-password` has no rate-limit (email-bomb vector) | [`reset-password`](../app/src/app/api/auth/reset-password/route.ts#L22) | medium |
| `/api/orders` POST has no rate-limit + guest path | [`orders`](../app/src/app/api/orders/route.ts#L30) | medium |
| `/api/print` accepts almost any non-loopback IP — SSRF primitive for any staff | [`print`](../app/src/app/api/print/route.ts#L56) | medium |
| `/api/email` accepts any staff role (waiter/kitchen/pos/admin) to send arbitrary mail | [`email`](../app/src/app/api/email/route.ts#L37) | medium |
| `/api/auth/register` accepts client-supplied `id` (PK) | [`register`](../app/src/app/api/auth/register/route.ts#L73) | low |
| Reservation `cancel_token` is reusable after cancellation | [`reservation/[token]`](../app/src/app/api/reservation/[token]/route.ts#L55) | low |
| `/api/geocode` is an open outbound proxy with no auth/rate-limit | [`geocode`](../app/src/app/api/geocode/route.ts#L48) | low |
| `/api/auth/change-password` has no rate-limit | [`change-password`](../app/src/app/api/auth/change-password/route.ts#L35) | low |
| `/api/auth/resend-verification` logged-in path skips rate-limit | [`resend-verification`](../app/src/app/api/auth/resend-verification/route.ts#L32) | low |

---

## 5. Findings — detailed

Severity legend: 🔴 critical · 🟠 high · 🟡 medium · 🟢 low · ⚪ informational

### Foundational data exposure

#### <a name="f-data-1"></a> F-DATA-1: AppContext fetches every customer's PII + order history on every page load — 🔴 critical

**Location:** [`app/src/context/AppContext.tsx:560-561`](../app/src/context/AppContext.tsx#L560-L561) and [the surrounding init() in `:482-570`](../app/src/context/AppContext.tsx#L482-L570). Re-confirmed at lines [671-672](../app/src/context/AppContext.tsx#L671-L672) and [698-699](../app/src/context/AppContext.tsx#L698-L699) (realtime handlers).

**Evidence:**
```ts
// AppContext.tsx:560-561 — runs in the browser, with the anon key, on every page mount
const { data: custsData, error: custsErr } = await supabase
  .from("customers").select("id, name, email, phone, created_at, tags, favourites, saved_addresses, store_credit, email_verified, orders(*)");
```

And the RLS policies that permit it ([schema.sql:565-571](../supabase/schema.sql#L565-L571)):
```sql
create policy "anon_select_customers"
  on customers for select to anon using (true);
create policy "anon_select_orders"
  on orders for select to anon using (true);
```

**Why it's critical:**
- `AppProvider` wraps the **entire app** (root layout — [`layout.tsx:143`](../app/src/app/layout.tsx#L143)) including the public storefront `/`. Every visitor — not logged in, not even past a robots gate — triggers this query.
- The column-level grant on `customers` ([schema.sql:665-669](../supabase/schema.sql#L665-L669)) **does** correctly strip `password_hash`, `reset_token`, and `email_verification_token`. But the columns that ARE permitted — `name, email, phone, saved_addresses, store_credit, orders(*)` — are themselves the GDPR-relevant PII. Stripping the password hash doesn't help when the email and home address are still in the response.
- The realtime subscription on `customers` and `orders` ([schema.sql:710-715](../supabase/schema.sql#L710-L715)) broadcasts every change to every subscribed browser. A customer placing an order publishes that order to every other open browser.
- The anon key is shipped in the JS bundle (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Anyone can curl Supabase directly from any IP. The "single-restaurant" deployment shape means this is the entire restaurant's customer database — not partitioned, not multi-tenant — being broadcast.

**Fix idea (one of these, not all):**
- Tighten the RLS policy: `using (id = current_setting('request.jwt.claims', true)::jsonb->>'sub')` if customers log in via Supabase Auth. Then `AppContext`'s un-filtered select becomes a per-user select automatically.
- Or replace the direct `supabase.from("customers").select(...)` with a server route `/api/customers/me` that returns only the current session's row + their orders, and remove the realtime customer/orders subscription from the customer-area code path.
- Either way, audit every `supabase.from(...)` call in the client code (grep returns 30+ hits) and confirm that **none** of them read tables that hold other customers' PII.

This is the highest-leverage fix in the whole report.

---

### Cross-role and within-role escalation (insider threat)

#### <a name="f-ins-1"></a> F-INS-1: POS cashier can void or refund any sale — 🟠 high

**Route:** [`/api/pos/sales/[id]` PATCH at :20`](../app/src/app/api/pos/sales/[id]/route.ts#L20)

**Evidence:**
```ts
const session = await getPosSession();
if (!session) { return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }); }
// ... straight into UPDATE pos_sales SET voided=true, refund_method=…, refund_amount=…
```

**Why it's a problem:** Any POS session with any sub-role can void or refund any sale ever recorded, including those rung up by managers/admins. Sub-role and `pos_staff.permissions.canVoidSales` / `canRefund` are never consulted, and `session.id` is not matched against `pos_sales.staff_id`. This is where money leaves the till.

**Fix idea:** After `getPosSession`, load the caller's `pos_staff.permissions` row and require `canVoidSales` / `canRefund`. Optionally enforce `session.id === sale.staff_id` for cashier-role; allow managers/admins to override.

#### <a name="f-ins-2"></a> F-INS-2: POS clock endpoint accepts `staffId` from body — anyone can clock anyone in/out — 🟠 high

**Route:** [`/api/pos/clock` POST at :78`](../app/src/app/api/pos/clock/route.ts#L78); GET at [:46](../app/src/app/api/pos/clock/route.ts#L46).

**Evidence:**
```ts
const session = await getPosSession();
if (!session) return ...401...;
const parsed = await parseBody(req, PosClockSchema); // body has { action, staffId, staffName }
.insert({ staff_id: body.staffId, staff_name: body.staffName, ... });
```

**Why it's a problem:** Session identity is established and then discarded. A cashier can clock a co-worker in/out, falsifying payroll. The GET handler with `?staffId=` likewise reads anyone's clock history.

**Fix idea:** Always insert/query with `staff_id: session.id`. Provide a separate admin route for managers to edit other staff's entries.

#### <a name="f-ins-3"></a> F-INS-3: POS sale POST attributes `staff_id` / `staff_name` from request body — 🟡 medium

**Route:** [`/api/pos/sales` POST at :82`](../app/src/app/api/pos/sales/route.ts#L82).

**Evidence:**
```ts
const row = { ..., staff_id: body.staffId || null, staff_name: body.staffName ?? "", ... };
```

**Why it's a problem:** A cashier can post a sale attributed to another cashier, forging tip attribution and shift totals. Combined with F-INS-1 the entire audit trail is forgeable.

**Fix idea:** Set `staff_id = session.id` and look up `staff_name` server-side.

#### <a name="f-ins-3b"></a> F-INS-3b: POS sale POST trusts client-supplied totals — 🟠 high

**Route:** [`/api/pos/sales` POST at :82-104`](../app/src/app/api/pos/sales/route.ts#L82-L104) + [`PosSaleCreateSchema` at lib/schemas/pos.ts:17-38](../app/src/lib/schemas/pos.ts#L17-L38).

**Evidence:**
```ts
// route.ts:82-104
const row = {
  id:              body.id,
  // ...
  items:           body.items,
  subtotal:        body.subtotal       ?? 0,
  discount_amount: body.discountAmount ?? 0,
  tax_amount:      body.taxAmount      ?? 0,
  tax_rate:        body.taxRate        ?? 0,
  tax_inclusive:   body.taxInclusive   ?? false,
  tip_amount:      body.tipAmount      ?? 0,
  total:           body.total          ?? 0,
  // ...
};
await supabaseAdmin.from("pos_sales").insert(row);
```

```ts
// schemas/pos.ts:17-38 — every total field is .optional() and not cross-checked
subtotal:       Money.optional(),
discountAmount: Money.optional(),
taxAmount:      Money.optional(),
total:          Money.optional(),
cashTendered:   Money.optional(),
changeGiven:    Money.optional(),
```

**Why it's a problem:** The server stores `subtotal`, `tax_amount`, `total` etc. straight from the client body. It does not recompute them from `items` (which it has) or compare against the menu. A cashier can ring up a £50 cart but submit `total: 0.01`, pocket the cash, and the pos_sales row will say £0.01. The orders KDS row picks up `total: sale.total` so the kitchen receipt also lies. This is the *create* analogue of F-AD-3 — but cashiers are far more numerous than admins. This is money-leak surface, not just an audit-trail issue. Compare with [`/api/orders` :56](../app/src/app/api/orders/route.ts#L56), which deliberately re-derives prices via `validateAndNormaliseOrder`; POS does the equivalent work in the browser only.

**Fix idea:** Add a server-side `recomputePosSaleTotals(items, taxSettings, discount)` helper mirroring `validateAndNormaliseOrder`. Treat the body's `subtotal/total/tax_amount/tip_amount` as hints to *compare against* and reject if they diverge by more than rounding tolerance; insert the server-computed values, not the body's.

#### <a name="f-ins-4"></a> F-INS-4: POS menu POST — any cashier can rewrite menu + bootstrap-bypass for unauthenticated writes — 🟠 high

**Route:** [`/api/pos/menu` POST at :37`](../app/src/app/api/pos/menu/route.ts#L37).

**Evidence:**
```ts
const session = await getPosSession();
if (!session) {
  const { count } = await supabaseAdmin.from("pos_staff")
    .select("id", { count: "exact", head: true }).eq("active", true);
  if ((count ?? 0) > 0) return ...401...;     // bootstrap bypass
}
let body: { categories?: Record<string, unknown>[]; products?: Record<string, unknown>[] };
try { body = await req.json(); } ...
await supabaseAdmin.from("categories").upsert(categories, { onConflict: "id" });
await supabaseAdmin.from("menu_items").upsert(products, { onConflict: "id" });
```

**Why it's a problem:**
1. Any logged-in POS cashier can rewrite the entire menu and pricing — no `canManageMenu` flag check.
2. The "fresh install" bootstrap bypass lets anyone unauthenticated rewrite the menu while zero active POS staff exist.
3. No zod schema; arbitrary columns (`active`, hidden flags) can be persisted via the raw upsert.

**Fix idea:** Require `isAdminAuthenticated()` or POS session with `canManageMenu`. Drop the bootstrap bypass for writes (read-only bootstrap is enough). Add a column-whitelisting zod schema.

#### <a name="f-ins-5"></a> F-INS-5: Waiter refund / void can target any order; `refundedBy`/`voidedBy` are body-supplied — 🟠 high

**Routes:** [`/api/waiter/refund` POST at :32](../app/src/app/api/waiter/refund/route.ts#L32); [`/api/waiter/void` POST at :20](../app/src/app/api/waiter/void/route.ts#L20).

**Evidence:**
```ts
// refund
const { orderIds, refundAmount, refundMethod, reason, refundedBy } = parsed.data;
const processedBy = refundedBy?.trim() ?? "Staff";
// void
const { orderIds, reason, voidedBy } = parsed.data;
voided_by: voidedBy?.trim() ?? null,
```

**Why it's a problem:** Any authenticated waiter can refund or void any active dine-in order — there is no link from `orders` to a specific waiter. Worse, the audit fields `refundedBy`/`voidedBy` are free-form strings from the body, not `session.id`, so a malicious waiter can post a refund stamped with another waiter's name.

**Fix idea:** Look up the waiter's name from `waiters` keyed by `session.id` and use that for the audit field. If per-waiter order ownership gets added later, additionally enforce that. Consider a "senior waiter" role for refunds.

#### <a name="f-ins-6"></a> F-INS-6: POS staff PATCH allows any `canManageStaff` holder to edit anyone's permissions — 🟡 medium

**Route:** [`/api/pos/staff/[id]` PATCH at :29`](../app/src/app/api/pos/staff/[id]/route.ts#L29).

**Evidence:**
```ts
if (!await canManageStaff()) return ...401...;
...
if (body.permissions !== undefined) patch.permissions = body.permissions;
if (body.role        !== undefined) patch.role        = body.role;
```

**Why it's a problem:** A `manager` with `canManageStaff` can mint a cashier into having `canVoidSales`/`canRefund`/`canManageStaff`, edit their own permissions, or strip flags from the seeded admin row. No role-hierarchy check, no self-edit guard.

**Fix idea:** Require `isAdminAuthenticated()` for `permissions` and `role` mutations. Non-admin managers should only be able to edit non-privileged fields (name, hourly_rate, avatar_color) and only on rows whose `role !== "admin"`.

#### <a name="f-ins-7"></a> F-INS-7: `GET /api/pos/sales` returns every staff's sales — 🟡 medium

**Route:** [`/api/pos/sales` GET at :43`](../app/src/app/api/pos/sales/route.ts#L43).

**Evidence:**
```ts
let q = supabaseAdmin.from("pos_sales").select("*").order("date", { ascending: false }).limit(limit);
```

**Why it's a problem:** A cashier hitting this endpoint reads every other staff member's full sales history including `tip_amount`, `staff_id`, `customer_name`. No `staffId`-scoping for non-managers.

**Fix idea:** For sessions whose `pos_staff.permissions.canViewReports !== true`, force `q.eq("staff_id", session.id)`.

#### <a name="f-st-8"></a> F-INS-8: Driver login has no rate-limit — 🟠 high

**Route:** [`/api/auth/driver` POST at :24`](../app/src/app/api/auth/driver/route.ts#L24).

**Evidence:** No `rateLimit(...)` call in the handler. POS/waiter/kitchen logins all call `rateLimit(...)` with an `${ip}:${staffId}` key.

**Why it's a problem:** Driver credentials are email+password (not a 4-digit PIN). Bcrypt cost helps but unthrottled credential-stuffing against driver accounts is still feasible. This is the one staff login that's a real password.

**Fix idea:** Add `rateLimit(`driver-auth:${ip}:${email}`, 10, 60_000)`, mirroring the POS/waiter pattern. Same on `/reset-password` and `/reset-password/confirm`.

#### <a name="f-ins-9"></a> F-INS-9: Driver password-reset endpoints have no rate-limit, no zod schema — 🟡 medium

**Routes:** [`/api/auth/driver/reset-password` POST at :19`](../app/src/app/api/auth/driver/reset-password/route.ts#L19); [`/api/auth/driver/reset-password/confirm` POST at :18`](../app/src/app/api/auth/driver/reset-password/confirm/route.ts#L18).

**Why it's a problem:** Email send is an expensive side-effect with no per-IP cap, so an attacker can pump email volume against legitimate driver addresses. The request schema also isn't zod-validated.

**Fix idea:** Add IP-scoped rate-limit on both endpoints; validate with `ResetPasswordRequestSchema` (already used by the customer flow).

#### <a name="f-ins-10"></a> F-INS-10: `/api/pos/staff` and `/api/waiter/config` are public and leak payroll PII — 🟡 medium

**Routes:** [`/api/pos/staff` GET at :56`](../app/src/app/api/pos/staff/route.ts#L56); [`/api/waiter/config` GET at :10`](../app/src/app/api/waiter/config/route.ts#L10).

**Evidence:**
```ts
// pos/staff (no auth check)
.select("id, name, email, role, active, permissions, hourly_rate, avatar_color, created_at")
// waiter/config (no auth check)
.select("id, name, email, active, hourly_rate, avatar_color, created_at")
```

**Why it's a problem:** Both endpoints serve the login "tile picker," which is the justification for them being public. But `hourly_rate` + `email` of every active staff member are returned to anyone with the URL. `pos_staff` also returns `permissions` — a roadmap for an attacker.

**Fix idea:** Return only `{ id, name, role, avatar_color, active }` to unauthenticated callers. Expose the full row only to an admin or `canManageStaff` POS session.

#### <a name="f-ins-11"></a> F-INS-11: Kitchen auth rate-limit is IP-only, inconsistent with POS/waiter — 🟢 low

**Route:** [`/api/kitchen/auth` POST at :25`](../app/src/app/api/kitchen/auth/route.ts#L25). POS / waiter use `${ip}:${staffId}`; kitchen uses `kitchen-auth:${ip}` only.

**Fix idea:** Change the key to `kitchen-auth:${ip}:${staffId}`. Also move the `rateLimit` call after `parseBody` so malformed payloads don't consume a slot.

#### <a name="f-ins-12"></a> F-INS-12: Waiter order POST records `staffName` from body — 🟢 low

**Route:** [`/api/waiter/orders` POST at :30`](../app/src/app/api/waiter/orders/route.ts#L30). The KDS "Staff: …" attribution is forgeable.

**Fix idea:** Resolve `staffName` from `waiters` keyed by `session.id`.

#### <a name="f-ins-13"></a> F-INS-13: POS staff DELETE has no self-deletion / last-admin guard — 🟢 low

**Route:** [`/api/pos/staff/[id]` DELETE at :66`](../app/src/app/api/pos/staff/[id]/route.ts#L66). A staff-manager could delete themselves or the last `canManageStaff` row and lock the org out.

**Fix idea:** Refuse delete when `id === session.id` or when it would leave zero active `canManageStaff` rows.

---

### Admin tree

#### <a name="f-ad-1"></a> F-AD-1: Admin login has no rate-limit — 🟠 high

**Route:** [`/api/admin/auth` POST at :24`](../app/src/app/api/admin/auth/route.ts#L24). The single shared `ADMIN_PASSWORD` is the only gate protecting every admin route, and there is no IP throttle, lockout, captcha, or backoff anywhere in the admin tree.

**Fix idea:** `rateLimit("admin-login:" + ip, 5, 60_000)` and log failed attempts.

#### <a name="f-ad-2"></a> F-AD-2: Admin customer create/update endpoints mass-assign untrusted JSON — 🟡 medium

**Routes:** [`/api/admin/customers` POST at :24`](../app/src/app/api/admin/customers/route.ts#L24); [`/api/admin/customers/[id]` PUT at :21`](../app/src/app/api/admin/customers/[id]/route.ts#L21).

**Evidence:**
```ts
const { error } = await supabaseAdmin.from("customers").insert(body);
const { error } = await supabaseAdmin.from("customers").update(body).eq("id", id);
```

**Why it's a problem:** No zod schema. Every other admin route uses `parseBody` with a typed schema. While these are admin-only, an admin (or compromised admin session) can silently set `password_hash`, `email_verified`, `store_credit`, `reset_token`, etc. on any customer row.

**Fix idea:** Add `CustomerCreateSchema` / `CustomerUpdateSchema` and pipe both routes through `parseBody`.

#### <a name="f-ad-3"></a> F-AD-3: `/api/admin/orders/[id]/refund` trusts client-supplied refund state — 🟡 medium

**Route:** [`/api/admin/orders/[id]/refund` at :98`](../app/src/app/api/admin/orders/[id]/refund/route.ts#L98).

**Evidence:**
```ts
.update({
  status: body.newStatus, refunds: body.refunds,
  refunded_amount: body.refundedAmount, ...
})
if (body.customerId !== undefined && body.newStoreCredit !== undefined) {
  await supabaseAdmin.from("customers")
    .update({ store_credit: body.newStoreCredit }).eq("id", body.customerId);
}
```

**Why it's a problem:** Server doesn't recompute `refunded_amount` from prior refunds, doesn't cap at `order.total`, and doesn't verify `body.customerId === order.customer_id`. An admin-level attacker can issue a larger Stripe refund than charged (currency-rounding) or apply store credit to the wrong customer.

**Fix idea:** Server-derive `refunded_amount = sum(refunds.map(r=>r.amount))`, cap each refund at `order.total - priorRefunded`, and assert `body.customerId === order.customer_id` before mutating store_credit.

#### <a name="f-ad-4"></a> F-AD-4: No rate-limit on any admin route — 🟢 low

Grep for `rateLimit` under `app/src/app/api/admin` returns no matches. An admin-session attacker can bulk-create/delete users, refund-storm, password-reset-bomb (`/api/admin/users/[id]/send-reset`) without any throttle.

**Fix idea:** Apply per-route limits, especially on `send-reset`, `set-password`, `refund`, and CRUD endpoints.

#### <a name="f-ad-5"></a> F-AD-5: `send-reset` ignores the route `id` param — 🟢 low (cosmetic)

**Route:** [`/api/admin/users/[id]/send-reset` at :51`](../app/src/app/api/admin/users/[id]/send-reset/route.ts#L51). The URL says it's resetting user `[id]` but the lookup uses `body.email` — the two can refer to different rows. Not exploitable (admin only) but error-prone in audit logs.

**Fix idea:** Look up by `id` and assert `data.email === normalizedEmail`, or drop the unused `id` URL segment.

#### <a name="f-ad-6"></a> F-AD-6: No role granularity inside admin tree — ⚪ informational

Every admin handler gates on `isAdminAuthenticated()` (boolean) — never on a sub-role. The shared `ADMIN_PASSWORD` model means there is exactly one role with full power. No read-only admin tier, no audit trail per-actor.

**Fix idea:** Plan migration to per-user admin/manager accounts (already foreshadowed in [`adminAuth.ts:12`](../app/src/lib/adminAuth.ts#L12) as "06-F16"). Critical for refund/delete operations and for proper audit-log `actor` stamping.

#### <a name="f-ad-7"></a> F-AD-7: `/api/admin/seed` route is absent on current tree — ⚪ informational

The directory does not exist. Prior audits referenced it. No action needed; flagged for the parent report.

---

### Public / customer / abuse vectors

#### <a name="f-pu-1"></a> F-PU-1: `/api/customers/[id]/spend-credit` can be invoked without an order — 🟡 medium

**Route:** [`/api/customers/[id]/spend-credit` at :42`](../app/src/app/api/customers/[id]/spend-credit/route.ts#L42).

**Why it's a problem:** A logged-in customer (or anything holding their cookie) can POST `{ amount }` repeatedly and decrement balance to 0. No link to an order, no idempotency key. A buggy client or XSS payload empties the balance silently; there is no way to refund the deduction if the checkout later fails.

**Fix idea:** Require an `order_id` (verify it belongs to the customer and was just created), or move credit deduction inside the order/payment server flow rather than expose it as a separate endpoint.

#### <a name="f-pu-2"></a> F-PU-2: `/api/auth/reset-password` is not rate-limited — 🟡 medium

**Route:** [`/api/auth/reset-password` at :22`](../app/src/app/api/auth/reset-password/route.ts#L22). All other side-effect-producing endpoints (`login`, `register`, `resend-verification`, `guest-profile`, `reservation`) are rate-limited; this one isn't. Email-bomb / mail-relay abuse vector.

**Fix idea:** `rateLimit("reset-password:" + ip, 3, 60_000)` + per-email cap (1 per 5 min).

#### <a name="f-pu-3"></a> F-PU-3: `/api/orders` POST has no rate-limit; guest path is unauthenticated — 🟡 medium

**Route:** [`/api/orders` POST at :30`](../app/src/app/api/orders/route.ts#L30). No `rateLimit` import. Bot flooding fills the orders table, the KDS, and the mail relay. `payments/intent` has the same shape — `customer_email` from the body becomes the Stripe `receipt_email`.

**Fix idea:** `rateLimit("orders:" + ip, 10, 60_000)`. Consider a Turnstile/hCaptcha gate on the guest path. For `payments/intent`, only honour `customer_email` from a verified session.

#### <a name="f-pu-4"></a> F-PU-4: `/api/print` is an SSRF primitive for any authenticated staff — 🟡 medium

**Route:** [`/api/print` POST at :49`](../app/src/app/api/print/route.ts#L49).

**Evidence:**
```ts
const BLOCKED_IP_PREFIXES = [/^127\./, /^169\.254\./, /^0\.0\.0\.0$/, /^::1$/];
```

**Why it's a problem:** Only loopback and metadata addresses are blocked. RFC1918 ranges (e.g. `192.168.x.x` admin panels, `10.x.x.x` NAS shares) **and public IPs** remain reachable. Any authenticated kitchen/waiter/POS session (PINs often shared on-site) can send arbitrary bytes to any TCP host on any port. ESC/POS bytes are effectively arbitrary binary data.

**Fix idea:** Restrict `ip` to a configured allowlist of printer IPs maintained in admin settings, or to a single configurable CIDR. Reject anything outside.

#### <a name="f-pu-5"></a> F-PU-5: `/api/email` allows broad staff roles to send arbitrary mail to arbitrary recipients — 🟡 medium

**Route:** [`/api/email` POST at :47`](../app/src/app/api/email/route.ts#L47).

**Evidence:**
```ts
async function isStaffAuthenticated(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const [waiter, pos, kitchen] = await Promise.all([
    getWaiterSession(), getPosSession(), getKitchenSession(),
  ]);
  return Boolean(waiter || pos || kitchen);
}
```

**Why it's a problem:** Waiter / POS / kitchen accounts (often shared PIN logins) can send arbitrary `to / subject / html` — including phishing branded with the restaurant's domain. No recipient allowlist, no daily cap, no rate-limit. The doc-comment says "for admin Send-test" but the auth check is far broader.

**Fix idea:** Restrict to `isAdminAuthenticated()` only (matches stated use case), or per-session rate-limit + recipient-domain allowlist.

#### <a name="f-pu-6"></a> F-PU-6: `/api/auth/register` accepts a client-supplied `id` — 🟢 low

**Route:** [`/api/auth/register` POST at :73`](../app/src/app/api/auth/register/route.ts#L73). Customer row PK is whatever the client posts (validated only as `NonEmptyString`). Inconsistent with the Google callback path which uses `randomUUID()` server-side.

**Fix idea:** Always generate `id = randomUUID()` server-side; drop `id` from `RegisterSchema`.

#### <a name="f-pu-7"></a> F-PU-7: Reservation `cancel_token` is reusable after cancellation — 🟢 low

**Route:** [`/api/reservation/[token]` POST at :55`](../app/src/app/api/reservation/[token]/route.ts#L55). After status flips to `cancelled`, the token column is not cleared — anyone with the original cancellation link can keep reading the row indefinitely (name, time, table, note). External guessing is infeasible due to 122-bit entropy; the risk is forwarded-email leak.

**Fix idea:** `UPDATE ... SET cancel_token = NULL` (or rotate) when status moves to `cancelled`.

#### <a name="f-pu-8"></a> F-PU-8: `/api/geocode` is an open outbound proxy with no auth or rate-limit — 🟢 low

**Route:** [`/api/geocode` GET at :48`](../app/src/app/api/geocode/route.ts#L48). The 1-second `MIN_GAP_MS` throttles **outbound** to Nominatim, not **inbound**. Anyone can make the server hit Nominatim with arbitrary strings, potentially getting the server IP banned by Nominatim's free-tier ToS.

**Fix idea:** Gate behind `isAdminAuthenticated()` (the doc-comment suggests admin-only intent), or `rateLimit("geocode:" + ip, 20, 60_000)`.

#### <a name="f-pu-9"></a> F-PU-9: `/api/auth/change-password` has no rate-limit on `currentPassword` — 🟢 low

**Route:** [`/api/auth/change-password` POST at :35`](../app/src/app/api/auth/change-password/route.ts#L35). Stolen-session brute-forcing of `currentPassword` is unthrottled.

**Fix idea:** `rateLimit("change-pw:" + session.id, 5, 60_000)`.

#### <a name="f-pu-10"></a> F-PU-10: `/api/auth/resend-verification` logged-in path skips rate-limit — 🟢 low

**Route:** [`/api/auth/resend-verification` at :32`](../app/src/app/api/auth/resend-verification/route.ts#L32). Rate-limit applies only to the logged-out branch.

**Fix idea:** Apply `rateLimit("resend-verify:" + (session?.id ?? ip), 3, 60_000)` unconditionally; use `ResendVerificationSchema` (already exported).

---

## 6. Defense-in-depth: Postgres RLS posture

The schema is *largely* well-thought-out — RLS is enabled on every table ([schema.sql:531-550](../supabase/schema.sql#L531-L550)), staff/auth/audit tables explicitly `deny_anon_all` ([schema.sql:606-640](../supabase/schema.sql#L606-L640)), column-level grants strip `password_hash`/`reset_token`/`email_verification_token` from anon reads on `customers` ([schema.sql:665-669](../supabase/schema.sql#L665-L669)), and the realtime publication explicitly excludes staff tables and re-publishes `customers` with a safe column list ([schema.sql:705-740](../supabase/schema.sql#L705-L740)).

**The remaining gap is the read policies on `customers`, `orders`, and `reservations`:**

```sql
-- schema.sql:566-575
create policy "anon_select_customers" on customers      for select to anon using (true);
create policy "anon_select_orders"    on orders         for select to anon using (true);
create policy "anon_select_reservations" on reservations for select to anon using (true);
```

`using (true)` permits any anon caller to read every row. The column-level grants on `customers` correctly mask password material — but they do not mask `email`, `phone`, `saved_addresses`, `store_credit`, `tags`, `favourites`. For `orders` and `reservations`, no column-level filter is applied — every column is readable.

This is what makes [F-DATA-1](#f-data-1) possible. RLS is doing its job of enforcing the rules — the rules themselves are too permissive.

**Reasonable target policies (one approach):**

```sql
-- customers: a row is readable iff its id matches the JWT subject
drop policy "anon_select_customers" on customers;
create policy "self_select_customers"
  on customers for select to anon
  using (
    id = current_setting('request.jwt.claims', true)::jsonb->>'sub'
    OR id = 'pos-walk-in'   -- public sentinel
  );

-- orders: same — owned by the customer or driver assigned to it
drop policy "anon_select_orders" on orders;
create policy "self_select_orders"
  on orders for select to anon
  using (customer_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');
```

The realtime subscriptions for `orders` and `customers` in [`AppContext.tsx:644, :692`](../app/src/context/AppContext.tsx#L644) would then automatically only broadcast events the subscribing client is entitled to see. The fan-out reduces dramatically.

The cost is: the kitchen, waiter, and customer-display surfaces currently lean on the anon client to read orders without going through an API route. Tightening the policy will require those surfaces to either (a) get a Supabase-level JWT minted at staff-login time, or (b) move their reads to authenticated API routes that use the service-role key server-side. (b) is the cleaner story and aligns with the rest of the codebase.

---

## 7. Phase 0: verification of "closed" findings from prior audits

A spot-check of the four highest-severity items that the prior audit (`AUTH_AUDIT.md` 2026-05-12 remediation) reported as closed. Verified against current source on `kaveesh`:

| Prior ID | Claim | Verified state on 2026-05-18 |
|---|---|---|
| 06-F1 | `admin/drivers` route requires `isAdminAuthenticated()` | **Confirmed.** `isAdminAuthenticated` called at [route.ts:38, :53](../app/src/app/api/admin/drivers/route.ts#L38) and [`[id]/route.ts:36, :84`](../app/src/app/api/admin/drivers/[id]/route.ts#L36) |
| 06-F6 | `/api/orders` rejects `customer_id === "pos-walk-in"` and enforces `session.id === customer_id` | **Confirmed.** [route.ts:48-54](../app/src/app/api/orders/route.ts#L48-L54) |
| 06-F9 | `/api/print` requires a staff session + private-IP allowlist | **Partially confirmed.** Staff auth IS required ([route.ts:50](../app/src/app/api/print/route.ts#L50)), but the IP filter only blocks loopback / 169.254 / 0.0.0.0 — public and private LAN IPs both still pass. See [F-PU-4](#f-pu-4) — this remediation was incomplete. |
| NEW-F2 | POS PIN validated server-side only; `pos_session` localStorage wiped | **Confirmed.** POST `/api/pos/auth` does bcrypt compare server-side ([route.ts:50-80](../app/src/app/api/pos/auth/route.ts#L50)); no client-side PIN store. |
| 06-F3 | Customer PATCH enforces session ownership | **Confirmed.** `session.id !== id → 401` at [route.ts:23](../app/src/app/api/customers/[id]/route.ts#L23) |
| 06-F4 | spend-credit enforces session ownership | **Confirmed.** [route.ts:22](../app/src/app/api/customers/[id]/spend-credit/route.ts#L22) — but separately introduces F-PU-1 (no order link). |

**Net Phase 0 result:** prior remediation largely holds, with one partial regression flagged ([F-PU-4](#f-pu-4) — the print-route IP allowlist is narrower than the comment suggests).

---

## 8. Findings summary by severity

| ID | Title | Severity |
|---|---|---|
| [F-DATA-1](#f-data-1) | AppContext fetches every customer's PII + orders on every page load | 🔴 critical |
| [F-INS-1](#f-ins-1)  | POS cashier can void/refund any sale | 🟠 high |
| [F-INS-2](#f-ins-2)  | POS clock — anyone can clock anyone in/out | 🟠 high |
| [F-INS-4](#f-ins-4)  | POS menu writes have no permission check + bootstrap bypass | 🟠 high |
| [F-INS-5](#f-ins-5)  | Waiter refund/void any order, audit fields forgeable | 🟠 high |
| [F-INS-8](#f-st-8)   | Driver login has no rate-limit | 🟠 high |
| [F-AD-1](#f-ad-1)    | Admin login has no rate-limit | 🟠 high |
| [F-INS-3](#f-ins-3)  | POS sale POST attributes staff from body | 🟡 medium |
| [F-INS-3b](#f-ins-3b) | POS sale POST trusts client-supplied totals (money-leak) | 🟠 high |
| [F-INS-6](#f-ins-6)  | POS staff PATCH allows manager to edit anyone's permissions | 🟡 medium |
| [F-INS-7](#f-ins-7)  | GET /api/pos/sales returns every staff's sales | 🟡 medium |
| [F-INS-9](#f-ins-9)  | Driver reset-password endpoints have no rate-limit | 🟡 medium |
| [F-INS-10](#f-ins-10)| /api/pos/staff and /api/waiter/config leak payroll PII | 🟡 medium |
| [F-AD-2](#f-ad-2)    | Admin customer endpoints mass-assign untrusted JSON | 🟡 medium |
| [F-AD-3](#f-ad-3)    | Admin refund route trusts client-supplied refund state | 🟡 medium |
| [F-PU-1](#f-pu-1)    | spend-credit can be invoked without an order | 🟡 medium |
| [F-PU-2](#f-pu-2)    | /api/auth/reset-password not rate-limited | 🟡 medium |
| [F-PU-3](#f-pu-3)    | /api/orders POST not rate-limited | 🟡 medium |
| [F-PU-4](#f-pu-4)    | /api/print is an SSRF primitive for any staff | 🟡 medium |
| [F-PU-5](#f-pu-5)    | /api/email allows broad staff roles to send arbitrary mail | 🟡 medium |
| [F-INS-11](#f-ins-11)| Kitchen-auth rate-limit is IP-only | 🟢 low |
| [F-INS-12](#f-ins-12)| Waiter order POST records staffName from body | 🟢 low |
| [F-INS-13](#f-ins-13)| POS staff DELETE has no last-admin / self-deletion guard | 🟢 low |
| [F-AD-4](#f-ad-4)    | No rate-limit on any admin route | 🟢 low |
| [F-AD-5](#f-ad-5)    | send-reset ignores the route id param | 🟢 low |
| [F-PU-6](#f-pu-6)    | /api/auth/register accepts client-supplied id | 🟢 low |
| [F-PU-7](#f-pu-7)    | Reservation cancel_token reusable after cancellation | 🟢 low |
| [F-PU-8](#f-pu-8)    | /api/geocode is an open outbound proxy | 🟢 low |
| [F-PU-9](#f-pu-9)    | /api/auth/change-password not rate-limited | 🟢 low |
| [F-PU-10](#f-pu-10)  | /api/auth/resend-verification logged-in path skips rate-limit | 🟢 low |
| [F-AD-6](#f-ad-6)    | No role granularity inside admin tree | ⚪ informational |
| [F-AD-7](#f-ad-7)    | /api/admin/seed route is absent on current tree | ⚪ informational |

---

## 9. Recommended remediation order

Each step is scoped to be self-contained — finish, ship, move on.

**Step 1 — Stop the customer-data exposure (closes F-DATA-1).** Replace the `supabase.from("customers").select(..., orders(*))` call in `AppContext.tsx` with a per-user `/api/customers/me/with-orders` route, drop the realtime `customers` and `orders` subscriptions for non-staff surfaces, and tighten the `anon_select_customers` / `anon_select_orders` RLS policies to row-owner only. Highest impact for least scope.

**Step 2 — Fix the insider-threat surface in POS.** Closes F-INS-1, F-INS-2, F-INS-3, F-INS-3b, F-INS-6, F-INS-7. Specifically:
- `/api/pos/sales/[id]` PATCH: require `canVoidSales` / `canRefund` from `pos_staff.permissions`.
- `/api/pos/clock` GET + POST: ignore body `staffId`; always use `session.id`.
- `/api/pos/sales` POST: set `staff_id = session.id`, look up `staff_name` server-side, **and recompute `subtotal/tax/total` server-side from `items` instead of trusting the body**.
- `/api/pos/staff/[id]` PATCH: require admin for `permissions` and `role` edits.
- `/api/pos/sales` GET: scope to `session.id` unless `canViewReports`.

**Step 3 — Fix the waiter insider-threat surface.** Closes F-INS-5, F-INS-12. Resolve `refundedBy` / `voidedBy` / `staffName` from `waiters` keyed by `session.id`. If business needs per-waiter order ownership, add `orders.waiter_id`; otherwise leave the cross-table refund/void capability but make the audit trail honest.

**Step 4 — Lock down POS menu writes.** Closes F-INS-4. Require admin auth or POS+`canManageMenu`. Drop the bootstrap bypass on writes. Add a zod schema.

**Step 5 — Add the missing rate limits.** Closes F-INS-8, F-INS-9, F-AD-1, F-AD-4, F-PU-2, F-PU-3, F-PU-9, F-PU-10. Adopt one `withRateLimit({ bucket, limit, windowMs })` wrapper and apply across login endpoints, password-reset endpoints, and bulk-side-effect endpoints.

**Step 6 — Constrain the abuse-vector endpoints.** Closes F-PU-4, F-PU-5. `/api/print` gets a configured printer-IP allowlist in admin settings. `/api/email` gets restricted to admin or per-session rate-limit + recipient-domain allowlist.

**Step 7 — Hide payroll PII on the login pickers.** Closes F-INS-10. Public `/api/pos/staff` and `/api/waiter/config` return `{id, name, role, avatar_color, active}` only; the full row needs admin or `canManageStaff`.

**Step 8 — Admin write hardening.** Closes F-AD-2, F-AD-3. Add zod schemas to `/api/admin/customers` routes. Make `/api/admin/orders/[id]/refund` server-derive `refunded_amount` and assert `customerId === order.customer_id`.

**Step 9 — Low-severity cleanup.** Closes F-INS-11, F-INS-13, F-AD-5, F-PU-6, F-PU-7, F-PU-8. Mostly small route-by-route fixes.

**Step 10 — Long term: per-user admin/manager accounts.** Closes F-AD-6 (and the prior audit's 06-F16). Required for proper audit-log `actor` stamping and for separation of duties on refunds.
