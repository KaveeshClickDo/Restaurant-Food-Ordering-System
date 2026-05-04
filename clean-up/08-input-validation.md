# Audit 08 — Input Validation

**Phase:** 3 — Security
**Date:** 2026-05-04
**Scope:** All 67 API routes — schema validation, type narrowing of request bodies, mass-assignment, path/query/header injection, password & email validation, SQL/PostgREST query parameterization.
**Mode:** Read-only

---

## 1. Methodology

For each route I measured: presence of a schema validation library, count of `typeof` runtime guards, count of unsafe casts (`as any` / `as unknown`), and whether body fields flow into Supabase queries unchecked. I read the largest / most sensitive routes in full to confirm the shape of validation.

**Project-wide tooling check:**
- No `zod`, `valibot`, or `yup` in [package.json](../app/package.json). All validation is hand-rolled.
- Total `as any` / `as unknown` in API routes: **3** (low — good). Locations: [orders/route.ts](../app/src/app/api/orders/route.ts), [admin/users/route.ts](../app/src/app/api/admin/users/route.ts), [auth/google/callback/route.ts](../app/src/app/api/auth/google/callback/route.ts).

## 2. Validation tooling per route — coverage matrix

Counted `await req.json()` calls (J), `typeof` runtime checks (T), and unsafe casts (X). A high T means real validation; T=0 with J>0 means "we read the body and trusted it."

| Tier | Pattern | Routes | Verdict |
|---|---|---|---|
| **A — exemplary** | Explicit field whitelist + per-field type guards + server-side recalculation | [orders/route.ts](../app/src/app/api/orders/route.ts) (T=21) | The model. |
| **B — adequate** | Type guards on critical fields, ignores rest, often combined with bcrypt | [auth/register](../app/src/app/api/auth/register/route.ts), [auth/login](../app/src/app/api/auth/login/route.ts) (T=2), [admin/users](../app/src/app/api/admin/users/route.ts) (T=2), [admin/drivers](../app/src/app/api/admin/drivers/route.ts) (T=1), [auth/me](../app/src/app/api/auth/me/route.ts) (T=2), [customers/[id]](../app/src/app/api/customers/[id]/route.ts) (allowlist), [pos/reservations/[id]](../app/src/app/api/pos/reservations/[id]/route.ts) (status enum check) | OK. Type narrowing on the most dangerous fields only. |
| **C — minimal** | Required-field check only, then trust everything else | [auth/reset-password](../app/src/app/api/auth/reset-password/route.ts), [auth/change-password](../app/src/app/api/auth/change-password/route.ts), [waiter/refund](../app/src/app/api/waiter/refund/route.ts), [waiter/settle](../app/src/app/api/waiter/settle/route.ts), [waiter/void](../app/src/app/api/waiter/void/route.ts), [admin/reservations](../app/src/app/api/admin/reservations/route.ts), [reservations/route.ts](../app/src/app/api/reservations/route.ts), [pos/reservations](../app/src/app/api/pos/reservations/route.ts) | Validates presence; wide types accepted. |
| **D — mass-assignment** | `body: Record<string, unknown>` → `supabaseAdmin.from(...).insert(body)` | [admin/menu (POST)](../app/src/app/api/admin/menu/route.ts), [admin/menu/[id] (PUT)](../app/src/app/api/admin/menu/[id]/route.ts), [admin/customers (POST)](../app/src/app/api/admin/customers/route.ts), [admin/customers/[id] (PUT)](../app/src/app/api/admin/customers/[id]/route.ts), [admin/settings (POST)](../app/src/app/api/admin/settings/route.ts) | 🔴 **08-F1** — see below. |
| **E — typed body but no runtime check** | `sale = await req.json() as POSSale` then trusts numeric fields | [pos/orders/route.ts](../app/src/app/api/pos/orders/route.ts) | 🔴 **08-F2**. |

## 3. Findings

### 08-F1 — Mass-assignment in 5 admin routes
**Severity:** 🔴 High
**Evidence:**
- [admin/menu POST line 24](../app/src/app/api/admin/menu/route.ts#L24): `await supabaseAdmin.from("menu_items").insert(body)` where `body: Record<string, unknown>`.
- [admin/menu/[id] PUT line 22](../app/src/app/api/admin/menu/[id]/route.ts#L22): same.
- [admin/customers POST line 24](../app/src/app/api/admin/customers/route.ts#L24): `supabaseAdmin.from("customers").insert(body)` — body contains arbitrary fields.
- [admin/customers/[id] PUT line 21](../app/src/app/api/admin/customers/[id]/route.ts#L21): `supabaseAdmin.from("customers").update(body).eq("id", id)`.
- [admin/settings POST line 26](../app/src/app/api/admin/settings/route.ts#L26): `upsert({ id: 1, data: body.data, ... })` — `body.data` is `unknown` (object-typed only).

**Why it matters:**
- An admin (or a compromised admin session) can write arbitrary columns: `password_hash`, `email_verified`, `reset_token`, `email_verification_token`, `store_credit`, `created_at`, etc. The whitelist used elsewhere ([customers/[id] PATCH](../app/src/app/api/customers/[id]/route.ts#L12) defines `ALLOWED_FIELDS = new Set([...])`) is the right pattern, just not applied here.
- Concrete harm scenarios:
  - Set another customer's `email_verified = true` to bypass verification.
  - Set arbitrary `store_credit` (financial impact).
  - Mutate `password_hash` directly to take over an account.
  - For `app_settings`: write any JSON, including malformed coupon entries, payment-method config that breaks orders, etc.
- Even though the routes are admin-gated (06-F1 fix applied to drivers; the others were already gated), trusting admins implicitly is at odds with the rest of the codebase that uses dedicated endpoints for sensitive transitions (set-password, send-reset, refund). Mass-assignment defeats that boundary.
**Possible action:** For each of the 5 routes, define an `ALLOWED_FIELDS` set or build the row explicitly:
```ts
const row = {
  id:          asString(body.id),
  name:        asString(body.name),
  category_id: asString(body.category_id),
  description: asOptString(body.description),
  price:       asNumber(body.price),
  image:       asOptString(body.image),
  // ...explicit fields only
};
```

### 08-F2 — POS sale endpoint trusts client-supplied totals (no server-side recalculation)
**Severity:** 🔴 High
**Evidence:** [pos/orders/route.ts:55–101](../app/src/app/api/pos/orders/route.ts#L55):
```ts
let sale: POSSale;
try { sale = await req.json(); }
catch { ... }
if (!sale.id || !Array.isArray(sale.items) || sale.items.length === 0) {
  return ...
}
// directly inserts:
const row = {
  id:    sale.id,
  total: sale.total,           // ← client-supplied
  items, // mapped from sale.items
  vat_amount:    sale.taxAmount,    // ← client-supplied
  vat_inclusive: sale.taxInclusive,
  tip_amount:    sale.tipAmount,
  ...
};
await supabaseAdmin.from("orders").insert(row);
```
The TS annotation `: POSSale` is stripped at runtime — there is no actual schema check beyond `id` exists and `items` is a non-empty array. `sale.total`, `sale.taxAmount`, `sale.tipAmount`, `sale.changeGiven`, `sale.paymentMethod` are accepted unchecked.
**Why it matters:**
- Compare to [/api/orders](../app/src/app/api/orders/route.ts) (the customer-facing route), which **rebuilds the total from menu_items prices server-side** so a malicious client can't claim a discount.
- POS is staff-side, but staff aren't always trusted to the same level. A POS terminal compromised by malware, a disgruntled employee, or a developer joke commit ("ring up £0.01 for everything") can write fraudulent totals into the orders table — those totals are what reports, refunds, and tax filings derive from.
- Once auth is added (06-F8), the threat shrinks to "compromised POS staff," but the same hardening pattern as `/api/orders` is appropriate.
**Possible action:**
1. Lookup each line item's authoritative price from `menu_items` (where applicable) and recalculate `total`.
2. Re-derive `taxAmount` from settings, not from client.
3. For modifiers/variations, lookup deltas from DB.
4. Where the POS handles ad-hoc items (custom amounts), require an explicit "custom" flag and audit-trail it.

### 08-F3 — `admin/settings` accepts arbitrary JSON for `data`
**Severity:** 🔴 Medium-High
**Evidence:** [admin/settings/route.ts:13–22](../app/src/app/api/admin/settings/route.ts#L13): only checks `body.data` is `typeof === "object"`. The shape of that object — `{ restaurant, paymentMethods, deliveryZones, schedule, coupons, taxSettings, breakfastMenu, waiters, kitchenStaff, diningTables, reservationSystem, ... }` — is not validated.
**Why it matters:**
- Admin can write any structure: a malformed `coupons` array breaks the order route; a malformed `schedule` breaks the store-hours computation; an injected `<script>` in `restaurant.tagline` or any text field becomes a stored XSS sink (cross-ref the upcoming Audit 10).
- Worse: settings are partially exposed to anon SELECT (07-F2). A malicious settings write can leak attacker-controlled data into every browser session.
- Cross-ref the [`AdminSettings` TS type](../app/src/types/index.ts) — it exists; we just don't validate against it at runtime.
**Possible action:** A zod schema mirroring `AdminSettings` is the canonical fix. Even a hand-rolled `validateAdminSettings(unknown): AdminSettings` would go a long way (per-key whitelist + per-field type narrowing).

### 08-F4 — `admin/users` POST relies on TS type for runtime safety
**Severity:** 🟡 Medium
**Evidence:** [admin/users/route.ts:160–167](../app/src/app/api/admin/users/route.ts#L160): `body = await req.json() as CreateUserBody;`. Per-branch validation (`type === "customer"`, `type === "driver"`, `type === "waiter"`) is correct, but inside each branch some fields are taken on faith:
- `body.waiterRole` — narrowed to `"senior" | "waiter"` by the TS type but never checked. An attacker can submit `waiterRole: "owner"` (any string) and it will be stored.
- `body.avatarColor` — string, not validated as a color.
- `body.active` — narrowed to boolean by destructure default `= true` but a non-boolean from the body becomes truthy/falsy.
- `body.vehicleInfo`, `body.notes` — strings only via `?.trim()`; if a client sends an array, `.trim()` throws and the route 500s.
**Why it matters:**
- Wrong-shaped fields don't cause data corruption beyond a weird stored value, but throwing on `.trim()` is a 500 instead of a 400 — bad UX, fills error logs.
- `waiterRole` value drift could lead to authorization bypasses if anything elsewhere does `if (role === "senior")` and the stored value is `"head_chef"`.
**Possible action:** Validate each branch's required fields with explicit type guards. Use a small `s` helper file: `asEnum`, `asBool`, `asColor`, `asEmail`.

### 08-F5 — `admin/reservations` POST accepts arbitrary `status`
**Severity:** 🟡 Medium
**Evidence:** [admin/reservations/route.ts:79](../app/src/app/api/admin/reservations/route.ts#L79): `status = "checked_in"` is destructured from body with default. The POS counterpart uses `const ALLOWED = new Set([...])` ([pos/reservations/[id]/route.ts:15](../app/src/app/api/pos/reservations/[id]/route.ts#L15)) — admin doesn't.
**Why it matters:** An admin who sends `status: "deleted_lol"` writes a row in an undefined state. Later filters (`status: "pending"` etc.) won't match it, potentially hiding the reservation. Trivial corruption, fixable with the same `ALLOWED` pattern.
**Possible action:** Reuse the `ALLOWED` set from the POS route.

### 08-F6 — Email regex used inconsistently
**Severity:** 🟡 Medium
**Evidence:** Only [auth/register/route.ts:75](../app/src/app/api/auth/register/route.ts#L75) validates email format with `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. The same regex is duplicated in [api/email/route.ts:34–36](../app/src/app/api/email/route.ts#L34) but not applied to the recipient. Other routes accepting email (`admin/customers`, `admin/users`, `auth/login`, `auth/reset-password`, `reservations`, `pos/reservations`, `guest-profile`) don't validate format.
**Why it matters:**
- Bad emails accumulate in DB. Later flows (reset password, order confirmation) silently fail.
- For `/api/email` (already 06-F5), unvalidated `to` opens up SMTP header injection if `to` contains CRLF (e.g. `victim@x.com%0ABcc:another@y.com`). nodemailer escapes addresses correctly *if* you pass them as separate params, but interpolating into the From or via `${variable}` can still be risky.
- Also worth thinking: `email` lookups vs writes use slightly different normalization (some `.trim().toLowerCase()`, some `.trim()` only). Inconsistent normalization means a user who registers as `Test@Example.com` may not be findable by `test@example.com`.
**Possible action:** Centralize: `lib/validation.ts → isValidEmail(s)`, `normalizeEmail(s) = s.trim().toLowerCase()`. Use everywhere.

### 08-F7 — Password policy is "≥6 chars" everywhere; bcrypt 72-byte truncation not handled
**Severity:** 🟡 Medium
**Evidence:**
- [auth/register/route.ts:78](../app/src/app/api/auth/register/route.ts#L78), [admin/drivers/route.ts:65](../app/src/app/api/admin/drivers/route.ts#L65), [admin/users/route.ts:181](../app/src/app/api/admin/users/route.ts#L181), [admin/drivers/[id]/route.ts:56](../app/src/app/api/admin/drivers/[id]/route.ts#L56), [auth/change-password](../app/src/app/api/auth/change-password/route.ts), [admin/users/[id]/set-password](../app/src/app/api/admin/users/[id]/set-password/route.ts).
- bcrypt has a hard 72-byte input limit; longer passwords are silently truncated to 72 bytes, meaning everything after the 72nd byte doesn't matter. NIST recommends max length ≥64 chars or hashing-before-bcrypt to extend.
**Why it matters:**
- 6-char minimum is below current NIST SP 800-63B guidance (8 minimum, 12 recommended).
- A user who pastes a 100-char passphrase has effectively used only the first 72 bytes — they may be surprised when "their" password works for an attacker who only knows those bytes.
- Length cap should also exist (e.g. ≤256) to prevent DoS via expensive bcrypt input.
**Possible action:**
1. Bump minimum to 8 or 12.
2. Cap maximum at 72 chars (and reject longer with a clear message), OR pre-hash with SHA-256 before bcrypt (lets users supply long passphrases safely).
3. Centralize the password-policy check (currently duplicated across 6 routes).

### 08-F8 — Date strings not validated
**Severity:** 🟡 Medium
**Evidence:** Date fields like `body.date` (YYYY-MM-DD) and `body.time` (HH:MM) are never validated for format. Examples:
- [reservations/route.ts:42](../app/src/app/api/reservations/route.ts#L42): `new Date(\`${date}T${time}\`)` — if the client sends garbage, you get an Invalid Date and the comparison `< Date.now() - ...` is false (NaN), so the route may accept and insert "Wed Apr 32 invalid garbage" into the DB.
- [admin/reservations/route.ts:102–103](../app/src/app/api/admin/reservations/route.ts#L102): inserts `date` and `time` strings directly.
- [api/orders/route.ts:223](../app/src/app/api/orders/route.ts#L223): falls back to `new Date().toISOString()` if not a string — good, but still no format check.
**Why it matters:**
- Malformed date strings break filters (`gte("date", from)` expects ISO format). Attackers can DoS reports by writing garbage that makes range filters return nothing.
- Reservations: a `date: "2099-99-99"` slips through and shows up in reports.
**Possible action:** A small `isISODate(s)` / `isHHMM(s)` helper used at every entry point.

### 08-F9 — Numeric fields not bounded
**Severity:** 🟡 Medium
**Evidence:**
- `partySize` in reservations: only checked for truthiness. `partySize: 1000000` is accepted (capacity gate exists but only against per-table seat count).
- `amount` in `customers/[id]/spend-credit`: positive number check (✓ good), but no upper bound — `amount: Number.MAX_SAFE_INTEGER` floors balance to 0 (mostly harmless because `Math.max(0, ...)`).
- `qty` in order items ([orders/route.ts:64](../app/src/app/api/orders/route.ts#L64)): integer + ≥1 (✓ good), but no max. `qty: 999999` ships to the kitchen.
- `tipAmount`, `changeGiven` in pos/orders: not bounded, not validated.
- `refundAmount` in waiter/refund ([waiter/refund/route.ts:40](../app/src/app/api/waiter/refund/route.ts#L40)): `> 0` only — could be larger than the order total. Code computes `Math.round(orderShare * 100) / 100` and updates `refunded_amount`, no upper-bound check vs the original total.
**Why it matters:** Defense-in-depth. Most of these are rate-limited by other constraints (a 999-quantity order is human-noticeable), but tighter caps prevent automation abuse.
**Possible action:** Per-field upper bounds (e.g. `qty <= 99`, `partySize <= reservationSystem.maxPartySize`, `refundAmount <= orderTotal`).

### 08-F10 — `email/route.ts` allows any `to`/`subject`/`html` (header & content injection)
**Severity:** 🔴 High (compounds 06-F5)
**Evidence:** [email/route.ts:53](../app/src/app/api/email/route.ts#L53): `const { to, subject, html, fromName } = body;`. Validation is presence-only; no format check on `to`, no CRLF stripping on `subject`/`fromName`.
**Why it matters:**
- nodemailer parses addresses internally; CRLF in `subject` is generally escaped, but `fromName` is interpolated into the From header (`"\"${senderName}\" <${fromAddr}>"`, [email/route.ts:88](../app/src/app/api/email/route.ts#L88)). If `fromName` contains a literal `"` or CRLF, the From header can be split.
- `html` is sent as-is. If this endpoint becomes admin-only (06-F5 fix), it's still useful for an admin to inject phishing content. Worth restricting to a known set of templates server-side.
**Possible action:** Once 06-F5 is fixed, additionally:
1. Validate `to` is a single email (or strict allowlist of multiple).
2. Strip CRLF (`\r`, `\n`) from `subject` and `fromName`.
3. Better: don't accept arbitrary `html` from the body at all. Render server-side from named templates + variable substitution (the codebase already has [emailTemplates.ts](../app/src/lib/emailTemplates.ts)).

### 08-F11 — `print/route.ts` lacks IP-range and byte-length bounds
**Severity:** 🔴 High (compounds 06-F9)
**Evidence:** [print/route.ts:43–55](../app/src/app/api/print/route.ts#L43): validates that `ip` is a non-empty string and `port` is 1–65535. No check that `ip` is a private/printer-network IP. No check on `bytes.length`.
**Why it matters:**
- SSRF ranges already in 06-F9 — but the validation gap is here. `ip: "169.254.169.254"` (cloud metadata), `ip: "127.0.0.1"` (loopback), `ip: "10.0.0.1"` are all valid strings.
- `bytes` can be megabytes — DoS the server's network stack or run up cloud egress costs.
**Possible action:**
1. Allowlist IP ranges (e.g. server-configured `PRINTER_NETWORK_CIDR=10.0.0.0/24`).
2. Cap `bytes.length` to a reasonable receipt size (e.g. 8 KB).
3. Cap `port` to common printer ports (9100, 631).

### 08-F12 — `searchParams` flow into Supabase filters without validation
**Severity:** 🟡 Low (parameterization is safe; semantic abuse possible)
**Evidence:** [admin/reservations/route.ts:39–52](../app/src/app/api/admin/reservations/route.ts#L39) takes `from`, `to`, `status` from `searchParams` and applies them as `.gte()`, `.lte()`, `.eq()`. PostgREST parameterizes — no SQL injection. But:
- `status` could be any string; a malicious admin could craft a query `?status=` to select rows where status is empty.
- `from`/`to` ditto: any string accepted.
**Why it matters:** Bounded; mostly cosmetic. Worth normalizing for consistency.
**Possible action:** Same as 08-F8 (date format) and 08-F5 (status enum). No urgent action.

### 08-F13 — Path params (`[id]`, `[token]`) flow into `.eq()` without validation
**Severity:** 🟡 Low (parameterization is safe; UUID-shaped invariants not enforced)
**Evidence:** Routes like [admin/customers/[id]](../app/src/app/api/admin/customers/[id]/route.ts) and [pos/orders/[id]/collected](../app/src/app/api/pos/orders/[id]/collected/route.ts) use `params.id` directly in `.eq("id", id)`. Supabase parameterizes the query, so SQL injection is not a concern. But:
- `id` is never validated as UUID. `/api/admin/customers/abc` runs the same query as `/api/admin/customers/<uuid>`, just returning no rows.
- Bots that fuzz these endpoints don't break anything but generate Supabase queries (cost/load).
**Why it matters:** Mostly hygiene. The existing implicit "no rows" path returns 404-ish behavior, so impact is limited.
**Possible action:** A `requireUuid(s)` helper at the top of each `[id]` handler. Optional, low priority.

### 08-F14 — `admin/auth` POST does not strip Buffer overflow guarantees from comparison
**Severity:** 🟡 Low (already flagged in 06-F17)
**Evidence:** Cross-ref 06-F17.
**Why it matters / Possible action:** See Audit 06.

### 08-F15 — Several routes return `error.message` from Supabase to the caller
**Severity:** 🟡 Low (info disclosure)
**Evidence:** Many routes do `return NextResponse.json({ ok: false, error: error.message }, { status: 500 })` where `error` is a PostgREST error. Examples: [admin/menu/route.ts:27](../app/src/app/api/admin/menu/route.ts#L27), [admin/customers/route.ts:27](../app/src/app/api/admin/customers/route.ts#L27), many more.
**Why it matters:** Postgres error messages can leak schema details (column names, constraint names, types). For an admin endpoint that's tolerable; for public ones it gives an attacker free reconnaissance.
**Possible action:** Generic "Internal error" responses for unexpected DB errors; log details server-side. Keep specific messages only for known-safe error codes (e.g. 23505 → "already exists").

### 08-F16 — Cross-cutting: there is no validation library; the project hand-rolls everything
**Severity:** 🟡 Medium (architectural)
**Evidence:** No `zod` / `valibot` / `yup` in [package.json](../app/package.json). Every typeof check is bespoke. Routes that get validation right ([orders/route.ts](../app/src/app/api/orders/route.ts)) wrote ~60 lines of manual checks; routes that get it wrong didn't write anything.
**Why it matters:**
- Inconsistency is the real problem. The "exemplary" route's pattern doesn't propagate because copying it requires writing ~60 lines.
- A 5–10 KB zod (or smaller valibot) dependency standardises this. Schemas can be reused on client + server, and TS types are inferred from the schema.
- Cross-ref 08-F1 — mass-assignment goes away if every insert goes through a schema's `.parse()` first.
**Possible action:** Adopt zod (or valibot for tree-shake) for new routes; migrate existing routes opportunistically. Minimum viable: one schema per endpoint colocated with the route.

### 08-F17 — `Header()` / nodemailer `from` interpolation susceptible to splitting
**Severity:** 🟡 Low (mostly nodemailer-handled)
**Evidence:** [email/route.ts:88](../app/src/app/api/email/route.ts#L88): `from = senderName ? \`"${senderName}" <${fromAddr}>\` : fromAddr;`. nodemailer parses this string with `addressparser`; CRLF in `senderName` is generally caught, but `"` in `senderName` will close the quoted-string and turn the rest into a comment.
**Why it matters:** With `senderName: '"', evil@attacker.com (', the From header may parse differently than the developer expected. Edge case; nodemailer's hardening is decent but not perfect.
**Possible action:** Strip `\r`, `\n`, `"` from `senderName` before interpolating.

## 4. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🔴 **High** | 08-F1 (mass-assignment in 5 admin routes), 08-F2 (POS sale totals trusted), 08-F10 (email body injection), 08-F11 (print byte/IP unbounded) | |
| 🔴 **Medium-High** | 08-F3 (admin/settings JSON unvalidated) | |
| 🟡 **Medium** | 08-F4 (admin/users field guards), 08-F5 (reservation status enum), 08-F6 (email regex inconsistent), 08-F7 (password policy weak + bcrypt 72-byte issue), 08-F8 (date strings unchecked), 08-F9 (numeric field caps), 08-F16 (no validation library) | |
| 🟡 **Low** | 08-F12 (searchParams), 08-F13 (path params UUID check), 08-F14 (admin auth length leak), 08-F15 (Supabase error.message echoed), 08-F17 (nodemailer From) | |

## 5. Highest-ROI fixes — recommended order

1. **08-F1 — Replace mass-assignment with whitelists** in the 5 admin routes. Mechanical patch, ~10 lines per route. Closes the worst hole.
2. **08-F2 — Add server-side recalc to POS orders** (mirror what `/api/orders` already does). Stops fraudulent totals.
3. **08-F10/08-F11 — Once 06-F5/06-F9 are fixed, add the additional validations** (CRLF strip, IP range, byte cap).
4. **08-F3 — Validate `app_settings.data` shape** with a hand-rolled or zod schema.
5. **Centralize validation helpers** (08-F6, 08-F7, 08-F8): create `lib/validation.ts` with `isValidEmail`, `normalizeEmail`, `isISODate`, `isHHMM`, `validatePassword`, `requireUuid`. Reuse across routes.
6. **Adopt zod** (08-F16) for new routes; migrate 1–2 routes per refactor PR thereafter.

## 6. Open questions for the user

1. **zod adoption (08-F16):** are you happy to add zod (or valibot) as a dependency? Bundle cost is minor (~12 KB for zod, ~3 KB for valibot, server-side only). Alternative is hand-rolled `validation.ts`.
2. **POS server-side recalc (08-F2):** POS sometimes handles ad-hoc items (custom-priced "miscellaneous" buttons, manager comps). Are those fully captured by the menu_items table, or do they need a separate "manual override" path with audit trail?
3. **Password policy (08-F7):** willing to bump the minimum to 8 chars and add a max of 72? It's a gentle UX change but closes a real footgun.

## 7. What's next

- **Audit 09 — Rate limits & secrets** ([09-rate-limit-secrets.md](./09-rate-limit-secrets.md), pending). Will inventory rate-limit coverage across all routes, check secret loading patterns, and flag any logged-secret risks.
