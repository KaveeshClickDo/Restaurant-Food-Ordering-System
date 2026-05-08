# Audit 12 — Query Efficiency, Atomicity, Indexes

**Phase:** 4 — API layer
**Date:** 2026-05-05
**Scope:** Supabase / PostgREST query patterns across all 67 API routes — `select("*")`, `.limit()`, N+1 loops, multi-step writes that should be atomic, race conditions on counters / inventory / coupons, missing indexes implied by frequent filters.
**Mode:** Read-only

---

## 1. Methodology

1. Counted query primitives: `from(...)`, `.select("*")`, `.limit(`, `Promise.all`, looped awaits.
2. Read every route flagged for unbounded SELECT, multi-step write, or check-then-write race.
3. Cross-referenced [supabase/setup_all.sql](../supabase/setup_all.sql) and other migration SQL for index definitions.
4. Mapped frequent filter columns to actual indexes — flagged where filters likely scan-scan.

## 2. Statistics

- Total `supabaseAdmin?.from(...)` query expressions in API routes: **38** at top level (many routes have multiple).
- `.select("*")` occurrences: **6** (admin/reservations, admin/reservation-customers, auth/login, auth/me, pos/menu × 2).
- `.limit(...)` occurrences: **20** — almost all `.limit(1).single()` for single-row fetches. **Zero** list endpoints have a `.limit()` cap.
- `Promise.all` over Supabase calls: ~6 sites (good parallelism where present).
- Loops with sequential `await` per iteration: **1 confirmed** ([admin/seed/route.ts:95](../app/src/app/api/admin/seed/route.ts#L95)). Several other routes use `Promise.all(arr.map(...))` (parallel — better).
- **No `CREATE INDEX` statements** in any [supabase/*.sql](../supabase/) file. All indexes are implicit (PK + UNIQUE constraints).

## 3. Index inventory (implicit only)

Indexes that exist (auto-created from PK / UNIQUE):

| Table | Indexed columns | Source |
|---|---|---|
| `app_settings` | `id` (PK) | setup_all.sql |
| `categories` | `id` (PK) | setup_all.sql |
| `menu_items` | `id` (PK) | setup_all.sql |
| `customers` | `id` (PK), `email` (UNIQUE — added by auth_migration) | setup_all.sql + auth_migration.sql |
| `drivers` | `id` (PK), `email` (UNIQUE) | rls_policies.sql |
| `orders` | `id` (PK) | setup_all.sql |
| `reservations` | `id` (PK), `cancel_token` (UNIQUE — added by v2_features_migration) | rls_policies.sql + v2 |
| `reservation_customers` | `id` (PK), `email` (UNIQUE) | setup_all.sql |
| `reservation_waitlist` | `id` (PK) | v2_features_migration.sql |

**Missing** indexes for columns frequently used in `.eq()` / `.in()` / `.gte()` / range filters and `.order()`:

| Table.column | Used by | Filter type |
|---|---|---|
| `orders.customer_id` | [auth/me:98](../app/src/app/api/auth/me/route.ts#L98), [admin/orders refund flow](../app/src/app/api/admin/orders/[id]/refund/route.ts) | `.eq` (per-customer history) |
| `orders.status` | admin reports, kitchen, dashboards | `.eq` / `.in` / `.not in` |
| `orders.date` | reports, dashboards, recent-orders | `.gte` / `.lte` / `.order` |
| `orders.fulfillment` | dine-in vs delivery filters everywhere | `.eq` |
| `orders.note` | [waiter/page.tsx:818](../app/src/app/waiter/page.tsx#L818) — `like("note", "[WAITER]%")` | LIKE prefix search |
| `reservations.date` | [admin/reservations:50](../app/src/app/api/admin/reservations/route.ts#L50), availability | `.eq` / `.gte` / `.lte` / `.order` |
| `reservations.status` | admin filtering | `.eq` / `.in` |
| `(reservations.table_id, reservations.date)` | slot-conflict re-check | composite for race-protection |
| `reservation_customers.last_visit_at` | [admin/reservation-customers:38](../app/src/app/api/admin/reservation-customers/route.ts#L38) — `.order()` | order desc |
| `reservation_customers.last_order_at` | guest-profile listing | order desc |

## 4. Findings — N+1 / loops

### 12-F1 — `admin/seed` does sequential per-customer + per-orders inserts in a loop
**Severity:** 🟡 Low (seed-only, but indicative)
**Evidence:** [admin/seed/route.ts:95–104](../app/src/app/api/admin/seed/route.ts#L95):
```ts
for (const c of mockCustomers) {
  const { error: custErr } = await supabaseAdmin
    .from("customers").insert(customerToRow(c));
  if (custErr) { ... continue; }
  if (c.orders.length > 0) {
    const { error: ordErr } = await supabaseAdmin
      .from("orders").insert(c.orders.map(orderToRow));
  }
}
```
Per customer = 2 sequential round trips. With N=10 mock customers = ~20 round trips, each ~30–100 ms. Total seed time ~1–2 s.
**Why it matters:** Mostly fine for a seed route. But the pattern creates a habit — and 06-F2 currently allows unauthenticated seed calls (an attacker can run this repeatedly, each time bypassing the cheap "is data already populated" check by exhausting one round-trip per call).
**Possible action:**
1. Bulk insert: `supabaseAdmin.from("customers").insert(allRows)` (one trip), then collect order rows from all customers and `insert(allOrderRows)` (one more trip). Total 2 round trips regardless of N.
2. Cross-ref 06-F2 — gate seed behind admin auth so the perf cost can't be weaponized.

### 12-F2 — `waiter/refund` does N parallel updates instead of one atomic batch
**Severity:** 🟡 Medium (atomicity issue more than perf)
**Evidence:** [waiter/refund/route.ts:98–106](../app/src/app/api/waiter/refund/route.ts#L98):
```ts
const errors: string[] = [];
await Promise.all(
  updates.map(async ({ id, status, refunds, refunded_amount }) => {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status, refunds, refunded_amount })
      .eq("id", id);
    if (error) errors.push(`${id}: ${error.message}`);
  })
);
```
Parallel (good — not strictly N+1) but each order is its own UPDATE. If 5 orders are being refunded together and order #3 fails, orders #1–2 are refunded, #4–5 may also be refunded. Refund records aren't consistent.
**Why it matters:**
- Customer paid £X for a 5-order table; refund flow either fully refunds or partially refunds. Partial-failure leaves the books in an inconsistent state — auditor's nightmare.
- No transaction wraps the batch. Supabase JS client doesn't expose Postgres transactions; you'd need `rpc()` with a stored procedure or do all the math server-side first then a single multi-row UPSERT.
**Possible action:**
1. Compute all refund records server-side, then issue one `UPSERT` to `orders` with all rows in the request. PostgREST supports `.upsert(rows, { onConflict: "id" })` — atomic for the batch (still one transaction at the DB).
2. Alternatively: write a Postgres function `process_table_refund(order_ids text[], refund_amount numeric, ...)` and call via `.rpc("process_table_refund", {...})`. This guarantees atomicity at the DB level.
3. Cross-ref 06-F12 (waiter/refund unauthenticated) — fix order: auth first, then atomicity.

### 12-F3 — Other endpoints don't have N+1 patterns (positive note)
**Severity:** ⚠️ Positive
**Evidence:** Most multi-table operations in the codebase use Promise.all of independent queries (login, admin/users GET, kds/orders/[id]/status, pos/menu, admin/reservations/[id] PUT). These are genuine parallelism, not N+1.
**Why it matters:** Confirms 12-F1 / 12-F2 are exceptions, not the rule.

## 5. Findings — atomicity / multi-step writes

### 12-F4 — `orders POST` increments coupon `usageCount` non-atomically
**Severity:** 🔴 High
**Evidence:** [orders/route.ts:184–195](../app/src/app/api/orders/route.ts#L184):
```ts
verifiedCouponDiscount = ...

// Increment usage count atomically via JSON patch on the settings row
const updatedCoupons = coupons.map((c) =>
  c.id === coupon.id ? { ...c, usageCount: c.usageCount + 1 } : c,
);
await supabaseAdmin
  .from("app_settings")
  .update({ data: { ...settingsRow!.data, coupons: updatedCoupons } })
  .eq("id", 1);
```
Comment says "atomically" but it's a **read–modify–write on the settings JSON** with no concurrency control. Two concurrent orders using the same coupon both:
1. Read `usageCount = 4`.
2. Build `usageCount = 5`.
3. Write back `5`.

End state: `usageCount = 5`, but two orders were placed → real usage is 6.
**Why it matters:**
- Lost-update bug. Limited-use coupons (`usageLimit > 0`) can be over-redeemed by concurrent customers.
- Worse: the *whole `data` blob* is rewritten by both requests. If anything else in `app_settings.data` changed between Promise A's read and write, those changes are clobbered. Multiple admin tabs editing settings while customers place orders is a recipe for silent settings loss.
**Possible action:**
1. **Best fix**: move coupons to their own `coupons` table with row-level rows. `update coupons set usage_count = usage_count + 1 where id = $1` is atomic at the DB level.
2. **Stop-gap**: Postgres function `increment_coupon_usage(coupon_id text)` called via `.rpc(...)`. Atomic without table changes.
3. **Don't do** read-modify-write on JSON blobs from multiple writers. The existing pattern is unsafe even before considering coupons.
4. Cross-ref 07-F8 (coupon code leak via anon SELECT on `app_settings`) and 11-F19 (no idempotency on order POST).

### 12-F5 — `admin/orders/[id]/refund` — order update + customer credit are two separate writes
**Severity:** 🟡 Medium
**Evidence:** [admin/orders/[id]/refund/route.ts:29–53](../app/src/app/api/admin/orders/[id]/refund/route.ts#L29):
```ts
const { error: orderErr } = await supabaseAdmin.from("orders").update({...}).eq("id", id);
if (orderErr) return ...;

if (body.customerId !== undefined && body.newStoreCredit !== undefined) {
  const { error: custErr } = await supabaseAdmin.from("customers").update({...}).eq("id", body.customerId);
  if (custErr) {
    console.error(...);
    // Non-fatal — order was already updated; log but don't fail the response
  }
}
```
The comment acknowledges the gap. If order is refunded but `customers.store_credit` update fails (network blip, DB hiccup), customer permanently loses their refund.
**Why it matters:** Compounds with 04-F1 — if customer's store_credit lives in localStorage on POS but DB update silently fails, the discrepancy widens.
**Possible action:**
1. Postgres function `process_refund(order_id text, refunds jsonb, refunded_amount numeric, customer_id text, new_credit numeric)` that does both updates in one transaction.
2. Or accept eventual consistency: re-queue the credit-update on failure (outbox pattern). More complex.
3. Cross-ref 12-F2 — same shape of issue.

### 12-F6 — `customers/[id]/spend-credit` is read-modify-write on store_credit
**Severity:** 🔴 High
**Evidence:** [customers/[id]/spend-credit/route.ts:27–46](../app/src/app/api/customers/[id]/spend-credit/route.ts#L27):
```ts
const { data, error: fetchErr } = await supabaseAdmin
  .from("customers")
  .select("store_credit")
  .eq("id", id).maybeSingle();
// ...
const newBalance = Math.max(0, (Number(data.store_credit) || 0) - amount);

const { error: updateErr } = await supabaseAdmin
  .from("customers")
  .update({ store_credit: newBalance })
  .eq("id", id);
```
Same lost-update pattern as 12-F4. Two concurrent checkouts both read `store_credit = 10`, both compute `newBalance = 5`, both write 5. Customer used £10 of credit but the system only deducted £5.
**Why it matters:**
- Real money. Customer can chain concurrent orders to use more credit than they have.
- Combined with 06-F4 (no auth on this route), an attacker can race their own checkout to drain credit beyond the balance.
**Possible action:** Atomic decrement:
```sql
UPDATE customers
SET store_credit = store_credit - $1
WHERE id = $2 AND store_credit >= $1
RETURNING store_credit;
```
If 0 rows returned, balance was insufficient → 400. Single round trip, atomic, no race.

### 12-F7 — `reservations POST` slot-conflict check has TOCTOU race
**Severity:** 🔴 High
**Evidence:** [reservations/route.ts:65–92](../app/src/app/api/reservations/route.ts#L65):
```ts
// Re-check availability (race condition protection)
const { data: conflicts } = await supabaseAdmin
  .from("reservations")
  .select("id, time, status")
  .eq("date", date)
  .eq("table_id", tableId)
  .in("status", ["pending", "confirmed", "checked_in"]);

const requestedMins = toMins(time);
const hasConflict = (conflicts ?? []).some((r) =>
  r.status === "checked_in" ||
  Math.abs(toMins(r.time as string) - requestedMins) < slotDuration
);

if (hasConflict) return ... 409;

// ... then INSERT
```
The comment says "race condition protection" but **the code only protects against client-side stale availability data**. Between the SELECT and INSERT here on the server, another concurrent request can pass the same check. Both insert.
**Why it matters:**
- Double-booked tables. Real-world impact when bookings spike (e.g. Valentine's Day at 7pm).
- The DB has no UNIQUE constraint enforcing "no two reservations at same `(table_id, date)` within `slotDuration`" — and can't, since the slot-overlap math is in app code.
**Possible action:**
1. **Postgres advisory lock** on `(table_id, date)` for the duration of the insert: `SELECT pg_advisory_xact_lock(hashtext($1 || $2))`. Forces serial execution of conflicting inserts.
2. **Row-level lock**: `SELECT ... FOR UPDATE` on the table-day's existing reservations. Subsequent inserts wait.
3. **Move logic to a Postgres function** that does check + insert in one transaction.
4. Pragmatic: a generous "buffer" check (current slot - 5 min, current slot + 5 min) catches most races; full fix needs DB-level.

### 12-F8 — POS receipt counter is also race-prone (cross-ref 04-F4)
**Severity:** see Audit 04
**Evidence:** [POSContext.tsx:303,542](../app/src/context/POSContext.tsx#L303). Already in 04-F4. Restated for completeness.

## 6. Findings — `select("*")` and column over-fetch

### 12-F9 — `auth/me` returns full order rows including refund history JSON
**Severity:** 🟡 Low
**Evidence:** [auth/me/route.ts:95–99](../app/src/app/api/auth/me/route.ts#L95):
```ts
const { data: ordersData } = await supabaseAdmin
  .from("orders")
  .select("*")
  .eq("customer_id", session.id)
  .order("date", { ascending: false });
```
**Why it matters:**
- Account page displays orders. Returning every column for every order isn't catastrophic but inflates payload (refund records, void reason, scheduled time, store_credit_used, etc.).
- Long-tail problem: customers with many orders → linearly larger payload.
- No `.limit()` — a customer with 1000+ orders gets 1000 row payloads on every account-page load.
**Possible action:**
1. Add `.limit(50)` and a "load more" UX.
2. Restrict columns to display fields. The mapper at [auth/me/route.ts:16–42](../app/src/app/api/auth/me/route.ts#L16) shows what's actually used — explicit `.select("id, customer_id, date, status, ...")` matching that.

### 12-F10 — `admin/reservations GET` selects all columns including `cancel_token`
**Severity:** 🔴 High (cross-ref 07-F5)
**Evidence:** [admin/reservations/route.ts:46](../app/src/app/api/admin/reservations/route.ts#L46) — `.select("*")`. The `*` includes `cancel_token`. Even with admin auth, if any client renders the response into HTML, `cancel_token` could leak via DOM source-view, screenshots, or non-https log capture.
**Why it matters:**
- 07-F5 already revokes `cancel_token` from anon SELECT. But admin reads still pull it. If admin UI ever exposes it inadvertently (e.g. a future "show all data" debug toggle), tokens leak.
- Defense-in-depth: don't fetch what you don't need.
**Possible action:** Replace `.select("*")` with explicit columns: `.select("id, table_id, table_label, table_seats, section, customer_name, customer_email, customer_phone, date, time, party_size, status, note, source, created_at, checked_in_at, checked_out_at")` — i.e. everything except `cancel_token`.

### 12-F11 — `admin/reservation-customers GET` is unbounded `.select("*")` ordered by nullable column
**Severity:** 🟡 Low
**Evidence:** [admin/reservation-customers/route.ts:35–38](../app/src/app/api/admin/reservation-customers/route.ts#L35):
```ts
.from("reservation_customers")
.select("*")
.order("last_visit_at", { ascending: false, nullsFirst: false });
```
**Why it matters:**
- No `LIMIT`. As the CRM grows, this returns every guest profile.
- `last_visit_at` is nullable and has no index; Postgres must sort the entire table.
- Already in 11-F15 for pagination; here for index recommendation.
**Possible action:** `CREATE INDEX ON reservation_customers (last_visit_at DESC NULLS LAST);` + `.limit(100)` + cursor pagination.

### 12-F12 — `pos/menu GET` fetches full categories + menu_items rows
**Severity:** 🟡 Low
**Evidence:** [pos/menu/route.ts:18–22](../app/src/app/api/pos/menu/route.ts#L18). Acceptable for POS startup (one-shot full-menu load). Worth flagging if menus grow large.
**Possible action:** Probably fine. Add `.limit(1000)` defensively.

### 12-F13 — `auth/login` selects full customer row including columns it doesn't use
**Severity:** 🟡 Low
**Evidence:** [auth/login/route.ts:115](../app/src/app/api/auth/login/route.ts#L115). Login needs `id`, `name`, `email`, `password_hash` (or fallback `password`), `email_verified`. Gets everything.
**Why it matters:** Hot path; minor perf gain from explicit columns. More importantly, `*` includes `reset_token`, `email_verification_token` — no harm in fetching them server-side, but explicit columns signal intent.

## 7. Findings — missing indexes

### 12-F14 — No declared indexes anywhere (only PK + UNIQUE auto-indexes)
**Severity:** 🟡 Medium
**Evidence:** `grep -i "create index" supabase/*.sql` returns zero hits.
**Why it matters:**
- Most filters in the codebase target columns that aren't indexed. Postgres scans the whole table for each.
- At small scale (development, demo) this is invisible. At restaurant-production scale (50K+ orders, daily reports) it's slow.
- Common pain points: admin reports filtering `orders.status` + `orders.date`, kitchen Realtime subscriptions filtering by `status`, customer order history by `customer_id`.

**Possible action — recommended index set:**

```sql
-- orders — high read volume, multiple filter dimensions
create index if not exists orders_customer_id_idx     on orders (customer_id);
create index if not exists orders_status_idx          on orders (status);
create index if not exists orders_fulfillment_idx     on orders (fulfillment);
create index if not exists orders_date_idx            on orders (date desc);
create index if not exists orders_status_date_idx     on orders (status, date desc);  -- composite for dashboards

-- reservations — slot-conflict + admin filtering
create index if not exists reservations_date_idx          on reservations (date);
create index if not exists reservations_status_idx        on reservations (status);
create index if not exists reservations_table_date_idx    on reservations (table_id, date);

-- reservation_customers — admin sort
create index if not exists reservation_customers_last_visit_idx on reservation_customers (last_visit_at desc nulls last);
create index if not exists reservation_customers_last_order_idx on reservation_customers (last_order_at desc nulls last);
```

Cost: each index adds storage + slower writes. For an order-heavy app the read benefit dwarfs the write cost. Be selective on `reservation_customers` — both indexes might be overkill if only one is used.

### 12-F15 — `orders.note` LIKE-prefix search has no trigram / pattern index
**Severity:** 🟡 Low
**Evidence:** [waiter/page.tsx:818–820](../app/src/app/waiter/page.tsx#L818):
```ts
const { data } = await supabase.from("orders")
  .select("note, status")
  .like("note", "[WAITER]%")
  .not("status", "in", '("delivered","cancelled")');
```
Used to determine occupied tables. With many orders this scans every active order.
**Why it matters:** "[WAITER]" prefix is structural — the data model conflates "type of order" into a free-text note column. Filtering by prefix is an index-unfriendly operation.
**Possible action:**
1. **Best**: add a dedicated `source` column (`'waiter'`, `'pos'`, `'online'`) and index it. Migration: `alter table orders add column source text` + backfill from note prefix + index.
2. **Stop-gap**: `text_pattern_ops` index for prefix LIKE: `create index ... on orders (note text_pattern_ops);`. Less clean.

## 8. Findings — read-then-write composition

### 12-F16 — `pos/orders/[id]/collected` reads then writes (acceptable here)
**Severity:** ⚠️ Acceptable
**Evidence:** [pos/orders/[id]/collected/route.ts:18–38](../app/src/app/api/pos/orders/[id]/collected/route.ts#L18) — fetches order, checks `status === "ready"`, then updates to `"delivered"`. Race window between SELECT and UPDATE.
**Why it matters:** A double-collect callback could transition twice. But the second transition `ready → delivered` would fail the read check if the first already happened, so race-collisions naturally fail-safe.
**Possible action:** Tighten to a single conditional UPDATE:
```ts
.update({ status: "delivered" })
.eq("id", id)
.eq("status", "ready");
```
Returns 0 rows if status wasn't `"ready"`, so the route can branch on that. Single round-trip, atomic.

### 12-F17 — `reservation/[token]` cancel flow reads then updates
**Severity:** 🟡 Low
**Evidence:** [reservation/[token]/route.ts:37–58](../app/src/app/api/reservation/[token]/route.ts#L37). Reads, validates `cancellableStatuses`, then updates. Same TOCTOU pattern as 12-F16.
**Possible action:** Same — combine into one conditional UPDATE: `.eq("cancel_token", token).in("status", ["pending", "confirmed"])`.

## 9. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🔴 **High** | 12-F4 (coupon usageCount lost-update), 12-F6 (store_credit lost-update), 12-F7 (reservation slot TOCTOU), 12-F10 (admin/reservations leaks `cancel_token` server-side) | |
| 🟡 **Medium** | 12-F2 (waiter/refund non-atomic batch), 12-F5 (refund + store_credit two-step), 12-F14 (no declared indexes) | |
| 🟡 **Low** | 12-F1 (seed loop), 12-F9 (auth/me unbounded order list), 12-F11 (reservation_customers unbounded), 12-F12 (pos/menu unbounded), 12-F13 (auth/login `*`), 12-F15 (orders.note LIKE), 12-F17 (cancel reservation TOCTOU) | |
| ⚠️ **Acceptable / positive** | 12-F3 (no widespread N+1), 12-F16 (collected status guard fail-safes) | |

## 10. Highest-ROI fixes

1. **12-F6 — Atomic `store_credit` decrement** (one SQL change). Closes a real money-bleed bug.
2. **12-F4 — Atomic coupon `usage_count` increment** (introduce `coupons` table or `.rpc(...)`). Closes coupon over-redemption.
3. **12-F7 — Slot-conflict via advisory lock or stored function**. Closes double-booking.
4. **12-F10 — Drop `cancel_token` from `admin/reservations` SELECT** (one column change, deploy ASAP, parallel to 07-F5).
5. **12-F2 / 12-F5 — Atomicity of waiter refund + admin refund credit update**. Stored function or single UPSERT batch.
6. **12-F14 — Declare the recommended index set** (one migration, big read-side win).
7. **12-F9 — Limit + paginate `auth/me` orders** (UX + perf).
8. **12-F1 — Bulk insert in seed** (cleanup; gate behind admin auth per 06-F2 first).

## 11. Open questions for the user

1. **Coupon table extraction (12-F4):** OK to introduce a new `coupons` table (with its own RLS policy), or do you prefer to keep coupons in `app_settings.data` and use a stored function for atomic increment?
2. **Atomicity primitive:** are you comfortable adding Postgres functions (.rpc) and managing them in migrations, or would you rather solve atomicity application-side (e.g. optimistic locking, retry-on-conflict)?
3. **Index maintenance:** running `EXPLAIN ANALYZE` against current production volume would tell us which indexes from 12-F14 actually matter. Do you have prod-like data to test against, or should we declare them all and let Postgres / pg_stat_user_indexes report after the fact?
4. **Concurrency expected scale:** how many concurrent customers / orders per minute do you expect at peak? If the answer is "low" (small restaurant, <5 orders/min), the lost-update bugs are theoretical. If "high" (busy chain), they bite immediately.

## 12. What's next

- This concludes **Phase 4 — API layer**.
- **Phase 5 — Frontend quality** begins next. Audit 13: TypeScript escape hatches (`any`, `@ts-ignore`, `as ...`, eslint-disable counts).
