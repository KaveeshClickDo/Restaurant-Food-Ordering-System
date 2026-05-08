# Audit 07 — Service-Role Key Exposure & RLS Coverage

**Phase:** 3 — Security
**Date:** 2026-05-04
**Scope:**
- Confirm `supabaseAdmin` (service-role-key client) never reaches client-side code.
- Verify `NEXT_PUBLIC_*` env vars don't accidentally include the service role key.
- Audit RLS coverage on every Supabase table.
- Audit column-level GRANT/REVOKE on tables anon can SELECT.
**Mode:** Read-only

---

## 1. Methodology

1. Grep'd every file under [app/src/](../app/src/) for `supabaseAdmin`, `@/lib/supabaseAdmin`, and `SUPABASE_SERVICE_ROLE_KEY`. Cross-referenced the result list against the list of files with `'use client'` at the top.
2. Listed every `process.env.NEXT_PUBLIC_*` reference and checked whether any sensitive secret is in there.
3. Read every `.sql` file under [supabase/](../supabase/) to enumerate tables, RLS policies, and column-level grants.
4. Mapped each table to: RLS enabled? anon SELECT allowed? what's exposed? what should be hidden?

## 2. Service-role key — client-import audit

### 2.1 — Files importing `supabaseAdmin` (62 total)

Cross-checked against the `'use client'` file list (69 total). Intersection: **1 file** — [components/admin/IntegrationsPanel.tsx](../app/src/components/admin/IntegrationsPanel.tsx).

I read the relevant lines. The file is a client component but **does not actually import `supabaseAdmin`** — it only renders the *string* `"SUPABASE_SERVICE_ROLE_KEY"` inside an `<EnvVarRow name="SUPABASE_SERVICE_ROLE_KEY" ... />` UI element ([IntegrationsPanel.tsx:390](../app/src/components/admin/IntegrationsPanel.tsx#L390)). That's documentation in the admin UI, not a code import. **False positive — confirmed safe.**

The remaining 61 importers are all:
- API routes under [app/src/app/api/](../app/src/app/api/) — server-side ✓
- [lib/supabaseAdmin.ts](../app/src/lib/supabaseAdmin.ts) (the module itself) ✓
- [lib/emailServer.ts](../app/src/lib/emailServer.ts) — server-side helper, has JSDoc comment "Import this only from API routes, never from client components" ✓

**Finding:** No client-side leak of `supabaseAdmin`. The discipline holds today, but it's enforced only by convention (JSDoc comments) — see 07-F1.

### 2.2 — `NEXT_PUBLIC_*` env var inventory

Grep'd `NEXT_PUBLIC_` across [app/src/](../app/src/). Used vars:

| Var | Sensitive? | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | No | Project URL is public knowledge once a query is made. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No (by design) | Anon key is meant to be public; security comes from RLS. |
| `NEXT_PUBLIC_SITE_URL` | No | Used to build email links and OAuth redirects. |
| `NEXT_PUBLIC_ADMIN_CONFIGURED` | No | Boolean flag referenced in [admin/page.tsx:293](../app/src/app/admin/page.tsx#L293). |

**Sensitive secrets correctly kept server-side:** `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `AUTH_JWT_SECRET`, `ADMIN_JWT_SECRET`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, `SMTP_PASS`. Confirmed via [example.env](../app/example.env) and direct grep — none appear with a `NEXT_PUBLIC_` prefix anywhere in the source.

## 3. RLS coverage matrix (per Supabase table)

I cross-referenced [supabase/setup_all.sql](../supabase/setup_all.sql), [supabase/rls_policies.sql](../supabase/rls_policies.sql), [supabase/auth_migration.sql](../supabase/auth_migration.sql), [supabase/v2_features_migration.sql](../supabase/v2_features_migration.sql), [supabase/checkin_migration.sql](../supabase/checkin_migration.sql), [supabase/reservations_migration.sql](../supabase/reservations_migration.sql), and [supabase/driver_reset_migration.sql](../supabase/driver_reset_migration.sql).

| Table | RLS on? | Anon SELECT | Anon INSERT | Anon UPDATE | Anon DELETE | Sensitive cols revoked? | Verdict |
|---|---|---|---|---|---|---|---|
| `app_settings` | ✓ | ✓ all rows | ⛔ | ⛔ | ⛔ | n/a (assumed sensitive fields stripped) | 🟡 see 07-F2 |
| `categories` | ✓ | ✓ all rows | ⛔ | ⛔ | ⛔ | n/a | ✓ |
| `menu_items` | ✓ | ✓ all rows | ⛔ | ⛔ | ⛔ | n/a | ✓ |
| `orders` | ✓ | ✓ **all rows** | ⛔ | ⛔ | ⛔ | n/a | 🔴 **07-F3** |
| `customers` | ✓ | ✓ **all rows** | ⛔ | ⛔ | ⛔ | `password`, `password_hash`, `reset_token`, `reset_token_expires`, `email_verification_token`, `email_verification_expires` revoked from anon | 🔴 **07-F4** (PII) |
| `drivers` | ✓ | ⛔ deny-all to anon | ⛔ | ⛔ | ⛔ | n/a (deny-all already covers it; commented-out `revoke select (password_hash)` line for belt-and-suspenders) | ✓ |
| `reservations` | ✓ | ✓ **all rows** | ⛔ | ⛔ | ⛔ | **none** — `cancel_token` exposed | 🔴 **07-F5** |
| `reservation_customers` | ✓ | implicit deny (no SELECT policy) | ⛔ | ⛔ | ⛔ | n/a | ✓ — but verify in 07-F6 |
| `reservation_waitlist` | ✓ | ⛔ explicit `using (false)` | ✓ INSERT only (`with check (true)`) | ⛔ | ⛔ | n/a | ✓ |

> Verdict ✓ means policies match what they should be for the role. 🟡 / 🔴 means an issue is discussed in §4.

## 4. Findings

### 07-F1 — `supabaseAdmin` is client-safe today by convention only
**Severity:** 🟡 Low (preventive)
**Evidence:** [lib/supabaseAdmin.ts:1–10](../app/src/lib/supabaseAdmin.ts#L1) and [lib/emailServer.ts:1–7](../app/src/lib/emailServer.ts#L1) document "import only from API routes." Nothing enforces it at build time; a future contributor importing `supabaseAdmin` from a client component would compile and ship.
**Why it matters:**
- The service role key bypasses RLS. A leaked service-role key = full DB compromise (read/write/delete every row, every table).
- Next.js will tree-shake it from the client bundle if it's only used on the server, but if a client component touches it, the module's `process.env.SUPABASE_SERVICE_ROLE_KEY` access becomes a *server-only at build time* error — except not always (the env var read happens lazily inside `getClient()`, so it might silently fail at runtime instead of failing the build).
**Possible action:**
1. Rename [lib/supabaseAdmin.ts](../app/src/lib/supabaseAdmin.ts) to `server/supabaseAdmin.ts` (or move under `lib/server/`) — colocate every server-only module.
2. Add the `import "server-only"` package import as the very first line of [lib/supabaseAdmin.ts](../app/src/lib/supabaseAdmin.ts), [lib/emailServer.ts](../app/src/lib/emailServer.ts), [lib/auth.ts](../app/src/lib/auth.ts), [lib/adminAuth.ts](../app/src/lib/adminAuth.ts), [lib/waiterAuth.ts](../app/src/lib/waiterAuth.ts), [lib/rateLimit.ts](../app/src/lib/rateLimit.ts), [lib/apiHandler.ts](../app/src/lib/apiHandler.ts). With `server-only` installed, importing any of these from a `'use client'` file fails the Next.js build immediately.
3. Add an ESLint rule (e.g. `no-restricted-imports`) blocking `@/lib/supabaseAdmin` (and friends) from `'use client'` files.

Cross-ref 01-F4 — this is the same `lib/` boundary problem from the structural audit. The fix here doubles as part of the structural fix.

### 07-F2 — `app_settings` is anon-readable; sensitive fields rely on application discipline to be absent
**Severity:** 🟡 Medium
**Evidence:** [rls_policies.sql:25–27](../supabase/rls_policies.sql#L25): `anon_select_settings` is `using (true)`. The whole `data` JSONB column is exposed to the anon key. Comment says "sensitive fields like SMTP/Stripe were already removed" — meaning the convention is "don't store secrets in app_settings", reinforced by [example.env:57–60](../app/example.env#L57) ("SMTP and Stripe/PayPal credentials are NOT set here. They are entered through Admin → Integrations and stored in the `app_settings` table"). **Wait — that contradicts the rls comment.** Looking again at example.env: the comment says SMTP creds *are* stored in `app_settings`. But the rls_policies.sql comment says they "were already removed".
**Why it matters:**
- If SMTP creds are still in `app_settings.data`, **the anon key can read them**: `SELECT data FROM app_settings WHERE id = 1` from any browser exposes SMTP password, Stripe secret, etc.
- Even if the *currently committed* JSON shape is clean, "sensitive fields removed" is an application-level invariant that nothing enforces.
- An admin who edits a settings field through the panel today might re-introduce a secret tomorrow with no protection.
**Possible action:**
1. **Verify what's actually stored.** Run `SELECT data FROM app_settings;` and inspect for any field that looks like an SMTP password, Stripe secret key, etc. If found, this is a real exposure today.
2. Move every secret out of `app_settings` into either env vars or a separate `secrets` table that has no anon SELECT policy.
3. Tighten the policy to be column-bounded — but JSONB column-level revoke isn't possible. Real fix is splitting the data: a public `app_settings_public` view (anon SELECT) and `app_settings_private` table (no anon).

### 07-F3 — `orders` table is anon-SELECT-all — every order's data leaks to any browser
**Severity:** 🔴 High
**Evidence:** [rls_policies.sql:49–51](../supabase/rls_policies.sql#L49):
```sql
create policy "anon_select_orders"
  on orders for select to anon using (true);
```
Comment says "Customers need to read their own orders (fetched via the customers join)." — but the policy doesn't limit to "their own".
**Why it matters:**
- Any browser with the anon key (which is public, by design) can run `supabase.from("orders").select("*")` and receive **every order from every customer**: items, totals, delivery addresses, customer phone numbers, payment methods, refund history, driver assignments, etc.
- This is direct PII exposure — UK GDPR / similar. Customer A can read Customer B's home address.
- Combined with 06-F6 (orders endpoint accepts arbitrary customer_id) the attack chain is: enumerate `orders` → harvest customer_ids → place fraudulent orders.
**Possible action:**
1. Tighten the policy: `using (false)` — block anon SELECT entirely. Customer's own orders are already fetched server-side by [api/auth/me/route.ts:95–99](../app/src/app/api/auth/me/route.ts#L95) using `supabaseAdmin`. Driver/admin/POS reads also go through API routes.
2. If Realtime subscriptions are needed for orders (the kitchen page subscribes), we need a finer-grained policy — `using (auth.uid() = customer_id)` works in classic Supabase auth, but this codebase uses its own custom session cookies, so we can't use `auth.uid()`. Two options:
   - Move all Realtime subscriptions to authenticated channels via a server-side proxy.
   - Or use Supabase auth as a layer on top of the custom session (more work).
3. Verify which app routes actually call `supabase.from("orders")` from the client and migrate them to API routes (server-side) before tightening RLS — already partially done for writes per the comment, but read paths are still anon.

### 07-F4 — `customers` table is anon-SELECT-all — name, email, phone, addresses, store_credit, favourites all leak
**Severity:** 🔴 High (privacy)
**Evidence:** [rls_policies.sql:66–68](../supabase/rls_policies.sql#L66):
```sql
create policy "anon_select_customers"
  on customers for select to anon using (true);
```
Comment: "Needed for login check and admin customer list."
**Why it matters:**
- Any browser can `supabase.from("customers").select("*")` and receive: every customer's `name`, `email`, `phone`, `tags`, `favourites`, `saved_addresses`, `store_credit`, `created_at`, `email_verified`. Sensitive auth columns ARE correctly revoked (✓): `password`, `password_hash`, `reset_token`, `reset_token_expires`, `email_verification_token`, `email_verification_expires`.
- The comment ("needed for login check") is a code smell: login is now done via [api/auth/login/route.ts](../app/src/app/api/auth/login/route.ts) (server-side, service role) — the anon SELECT is a vestige of the old client-side login flow.
- "Admin customer list" is fetched via [api/admin/customers/route.ts](../app/src/app/api/admin/customers/route.ts) (also service role).
- So the policy is **leftover** — almost certainly nothing legitimate depends on anon SELECT to `customers` anymore.
**Possible action:**
1. Drop the `anon_select_customers` policy entirely (verify by running through the customer login flow + admin customer list after the change).
2. If Realtime needs are similar to orders, see options in 07-F3.

### 07-F5 — `reservations` exposes `cancel_token` under anon SELECT
**Severity:** 🔴 High
**Evidence:** [rls_policies.sql:160–164](../supabase/rls_policies.sql#L160):
```sql
create policy "anon_select_reservations"
  on reservations for select to anon using (true);
```
The reservations table includes `cancel_token` ([rls_policies.sql:141–156](../supabase/rls_policies.sql#L141), `cancel_token` added by [v2_features_migration.sql:13](../supabase/v2_features_migration.sql#L13)). The cancellation route [api/reservation/[token]/route.ts](../app/src/app/api/reservation/[token]/route.ts) treats the token as the only authentication for cancellation: "the token itself is the credential."
**Why it matters:**
- Any browser can `supabase.from("reservations").select("cancel_token")` and harvest **every** cancel_token in the system. Then it can `POST /api/reservation/<token>` for each one — **mass-cancel every reservation in the database**.
- This is single-step end-to-end exploitable: token is exposed → token is the credential.
- Customer PII (name, email, phone) is also exposed — same privacy class as 07-F4.
**Possible action (urgent):**
1. **Immediate**: revoke `cancel_token` from anon SELECT (column-level revoke, possible because it's a regular column not JSONB):
   ```sql
   revoke select (cancel_token) on reservations from anon;
   ```
   This is a one-liner deploy.
2. Strongly consider also dropping anon SELECT entirely on reservations (admin reads via service role; customer's own reservations have no current client-side fetch path that I've seen).
3. Cross-ref 06-F8 — reservation creation/check-in/check-out are also unauth'd. The reservation system has multiple security gaps that compound.

### 07-F6 — RLS-enabled tables without explicit policies (verify deny-by-default actually works)
**Severity:** 🟡 Low (verification needed)
**Evidence:** [reservation_customers](../supabase/setup_all.sql#L111) has `enable row level security` but I see no explicit anon policy. With RLS on and no policy, anon role gets implicit deny — that's the intended behavior. **But this should be verified** (one quick query from a test client) because Supabase's behavior under "RLS on, no policy" can change with publication settings, defaults, etc.
**Why it matters:** [reservation_customers](../app/src/app/api/guest-profile/route.ts) holds CRM data — name, email, phone, order_count, total_spend. If anon SELECT actually works, that's another PII leak.
**Possible action:** Add an explicit `using (false)` deny policy for clarity, mirroring the `drivers` table pattern ([rls_policies.sql:130–136](../supabase/rls_policies.sql#L130)).

### 07-F7 — `withError` is duplicated between `apiHandler.ts` and `supabaseAdmin.ts`
**Severity:** 🟡 Low (code-quality, not security)
**Evidence:** [lib/apiHandler.ts:9–19](../app/src/lib/apiHandler.ts#L9) and [lib/supabaseAdmin.ts:55–65](../app/src/lib/supabaseAdmin.ts#L55) both export a `withError` helper with the same purpose and very similar implementations. Cross-ref 03-F11 (general duplication).
**Why it matters:** Two implementations of error wrapping diverge over time; routes might pick the wrong one and behavior subtly differs.
**Possible action:** Delete the copy in `supabaseAdmin.ts`; standardize on `apiHandler.ts`. Then audit which routes actually use which (the matrix in Audit 06 didn't track this).

### 07-F8 — Anon SELECT on `app_settings` exposes coupon codes pre-redemption
**Severity:** 🟡 Medium (separate concern within 07-F2)
**Evidence:** Coupons live in `app_settings.data.coupons` ([orders/route.ts:152–170](../app/src/app/api/orders/route.ts#L152)). The anon SELECT policy on `app_settings` exposes the entire `data` JSONB column.
**Why it matters:**
- Any browser can list every coupon code, expiry, value, and current usage count.
- Marketing campaigns relying on private coupon codes (e.g. "use code WELCOME10 if you signed up via newsletter") leak. Anyone with the anon key can use any code.
- The `usageLimit` field is also visible — attackers can predict when a coupon runs out.
- The order route validates server-side (good — coupons can't be forged client-side), but the *intended exclusivity* of private codes is broken.
**Possible action:**
1. Move coupons out of `app_settings.data` into a `coupons` table with explicit policies (anon can SELECT only `id`, `active=true`, public-marketing-tagged).
2. Or expose only a public subset via a view.
3. The existing server-side validation handles forge-prevention; this is purely about *read* leakage.

### 07-F9 — Migration script runs `crypt()` to bcrypt-hash existing plaintext passwords (positive note)
**Severity:** ⚠️ Positive
**Evidence:** [auth_migration.sql:40–45](../supabase/auth_migration.sql#L40):
```sql
update customers
set password_hash = crypt(password, gen_salt('bf', 10))
where password is not null and password <> '' and password_hash is null;
```
The migration retains the legacy plaintext `password` column for a fallback path in [api/auth/login/route.ts](../app/src/app/api/auth/login/route.ts), but column-level revoke ensures anon can't SELECT it.
**Why it matters:** Backfill plus revoke is the correct migration shape. Once all users have logged in once and `password_hash` is populated, the plaintext column can be `UPDATE customers SET password = ''` (or dropped). Worth flagging as a follow-up cleanup.
**Possible action:** After enough time has passed (e.g. 30–90 days post-deploy of `auth_migration.sql`), null out the `password` column for users who have a `password_hash` and drop the column.

## 5. Severity summary

| Severity | IDs |
|---|---|
| 🔴 **High** | 07-F3 (orders anon-SELECT-all), 07-F4 (customers anon-SELECT-all PII), 07-F5 (cancel_token leak — mass-cancel exploit) |
| 🟡 **Medium** | 07-F2 (app_settings anon-SELECT may include SMTP creds — needs verification), 07-F8 (coupon code leak) |
| 🟡 **Low** | 07-F1 (`server-only` not enforced at build), 07-F6 (deny-by-default not explicit on reservation_customers), 07-F7 (`withError` duplication) |
| ⚠️ **Positive** | 07-F9 (bcrypt backfill done correctly) |
| ✅ **Verified safe** | No client-side import of `supabaseAdmin`. No service-role key in `NEXT_PUBLIC_*`. Sensitive auth columns revoked from anon (`password`, `password_hash`, `reset_token*`, `email_verification_token*`). `drivers` table fully blocked from anon. `reservation_waitlist` has correct insert-only policy. |

## 6. Recommended fixes — ordered by ROI

In rough priority for the security-fix PR after Audit 06:

1. **07-F5 (cancel_token leak)** — one line, deploy ASAP:
   ```sql
   revoke select (cancel_token) on reservations from anon;
   ```
2. **07-F2 (app_settings)** — verify the *current contents* of `app_settings.data`. If it contains any SMTP password, Stripe key, etc., this is an active leak today. One DB query to confirm.
3. **07-F3 + 07-F4 (orders/customers anon SELECT)** — drop the `using (true)` policies. Need to verify what client code currently relies on the anon read first (cross-ref what `lib/supabase.ts` callers do — the first audit phase showed `AppContext` does some Realtime subscriptions). May need a migration of those subscriptions to server-driven Realtime channels.
4. **07-F8 (coupon code leak)** — depends on 07-F2 fix. If `app_settings` is split into public/private, coupons go to the private side.
5. **07-F1 (server-only enforcement)** — install `server-only`, add the import to 7 files. Two-line change per file. Catches future regressions at build time.
6. **07-F6 (explicit deny on reservation_customers)** — one SQL statement. Mostly cosmetic, but valuable for clarity.
7. **07-F7 (withError dedup)** — code-quality cleanup; do during Phase-1 dedup pass.
8. **07-F9 (drop plaintext password column)** — schedule for ~30 days post-`auth_migration.sql` deploy.

## 7. Open questions for the user

1. **07-F2 verification:** can you run `SELECT jsonb_pretty(data) FROM app_settings;` in the Supabase SQL Editor and confirm whether SMTP/Stripe/etc. credentials are stored there? The fix shape depends on the answer.
2. **07-F3:** which client-side code currently calls `supabase.from("orders")` / `.from("customers")`? If it's only `AppContext`'s Realtime subscriptions, we can move those. If many callers do direct SELECTs, this is a larger refactor.
3. **07-F5 (cancel_token):** are there any client features that currently SELECT `cancel_token` from the browser? If yes, they'll break when anon column revoke ships — needs to migrate those reads to a server endpoint first.
4. **07-F1:** any objection to adding `server-only` as a dependency? It's a Vercel/Next.js-published package, ~0 install cost, build-time only.

## 8. What's next

- **Audit 08 — Input validation** ([08-input-validation.md](./08-input-validation.md), pending). Will sample API routes for: schema validation (zod/valibot vs ad-hoc), type-narrowing of body fields, SQL/`.eq()` filters built from unchecked input, and untyped `as any` cast points.
