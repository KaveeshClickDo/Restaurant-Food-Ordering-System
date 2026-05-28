# 06 · Schema changes — additive only

Concrete SQL for every database change the offline POS work needs.
Every change is **additive**: new columns default to safe values, new
tables don't change existing reads, the `receipt_no` constraint
relaxation preserves the existing online-allocator behaviour.

> **Discipline rule:** every block here goes into `supabase/schema.sql`
> at the position indicated. `schema.sql` is idempotent (uses
> `create ... if not exists` and `add column if not exists`). Re-running
> the full file against an existing DB is a no-op for unchanged blocks.

## Summary of what changes

| Phase | Change | Object | Risk |
|---|---|---|---|
| 1 | New table `pos_terminals` | new | None — additive |
| 1 | Add `terminal_id text` to `pos_sales` | column | None — nullable default |
| 1 | Add `client_created_at timestamptz` to `pos_sales` | column | None — nullable default |
| 1 | Add `synced_at timestamptz default now()` to `pos_sales` | column | None — default = existing semantics |
| 2 | Loosen `pos_sales.receipt_no` default | constraint | Low — see below |
| 2 | Add per-terminal sequence column to `pos_terminals` | column | None — additive |
| 3 | Add `oversold boolean default false` to `pos_sales` | column | None — mirrors `orders.oversold` |
| 3 | New table `pos_oversell_events` | new | None — additive |
| 4 | Add column-level grant for `pin_hash` to service_role only (already in place — verify) | grant | None — defensive verification |
| 5 | No schema changes (service-worker / manifest are public file changes) | — | — |

## Phase 1 — Offline outbox plumbing

### 1.1 `pos_terminals` table

Registered tablets. One row per physical device that participates as a
POS terminal. Created the first time the device successfully completes
an online login.

```sql
-- Append to supabase/schema.sql, after the pos_clock_entries CREATE block
-- (around line 526). Position chosen so it sits alongside other pos_*
-- tables; the foreign key from pos_sales.terminal_id below points here.

-- POS terminals — one row per physical Android tablet that's registered
-- to ring up offline sales. Created on the device's first successful
-- online PIN login; updated on every subsequent sync. The terminal
-- prefix (`prefix`) namespaces offline-minted receipt numbers so two
-- tablets can never produce the same `pos_sales.receipt_no`.
create table if not exists pos_terminals (
  id              text        primary key default gen_random_uuid()::text,
  -- Human-readable label set in admin (e.g. "Front counter", "Bar").
  label           text        not null,
  -- Short receipt prefix, 1–4 chars [A-Z0-9]. Receipt numbers offline:
  -- '<prefix>-<seq_no>' (e.g. 'T1-1042'). MUST be unique across active
  -- terminals so receipt strings never collide.
  prefix          text        not null,
  -- Per-terminal monotonic counter. Incremented client-side, validated
  -- server-side on sync. Persisted as a backup if the device's local
  -- counter is lost (e.g. user wipes app data).
  next_seq_no     integer     not null default 1,
  -- Device fingerprint hash. Used to detect "same device re-registering
  -- after a wipe" vs. "completely new device steals an existing prefix".
  device_fingerprint text     not null default '',
  -- Activity bookkeeping for admin "online terminals" dashboard.
  last_seen_at    timestamptz,
  last_sync_at    timestamptz,
  active          boolean     not null default true,
  created_at      timestamptz not null default now()
);

create unique index if not exists uniq_pos_terminals_prefix_active
  on pos_terminals (prefix) where active = true;

create index if not exists idx_pos_terminals_active
  on pos_terminals (active) where active = true;

-- RLS — same posture as the other pos_* tables. service_role bypasses;
-- anon and authenticated have no access. Append to the RLS block (~line 880).
alter table pos_terminals enable row level security;
drop policy if exists "deny_anon_all" on pos_terminals;
create policy "deny_anon_all" on pos_terminals
  for all to anon using (false) with check (false);
```

### 1.2 `pos_sales.terminal_id`

Records which terminal originated the sale. NULL for online web POS
(no terminal registered); non-NULL for sales minted by a registered
tablet (online or offline).

```sql
-- Append to supabase/schema.sql, immediately after the pos_sales gift_card
-- columns block (~line 729). Sits alongside other additive pos_sales columns
-- and benefits from the same "alter table ... add column if not exists"
-- idempotency.
alter table pos_sales add column if not exists terminal_id text
  references pos_terminals(id) on delete set null;
-- on delete set null so a deactivated/deleted terminal doesn't cascade-wipe
-- its sale history (audit/tax records must survive terminal lifecycle).

create index if not exists idx_pos_sales_terminal_id
  on pos_sales (terminal_id) where terminal_id is not null;
```

### 1.3 `pos_sales.client_created_at`

Time the sale was rung up on the tablet, vs. server-side `created_at`
which gets stamped at sync time. Admin reports and tax reconciliation
need the client time for offline sales; otherwise a sale rung up
Thursday but synced Friday looks like a Friday sale.

```sql
alter table pos_sales add column if not exists client_created_at timestamptz;
-- nullable: online web POS sales don't need this (created_at == client_created_at semantically).
```

### 1.4 `pos_sales.synced_at`

Stamps when the row landed on the server. For online sales this equals
`created_at`; for offline-then-synced sales it's the sync time.

```sql
alter table pos_sales add column if not exists synced_at timestamptz default now();
-- default `now()` means existing rows + new online inserts behave the same.
-- Offline-synced rows get the timestamp on INSERT, which is the sync moment.
```

Admin dashboards can compute "lag" as `synced_at - client_created_at`
to highlight terminals that ran offline for a long time.

## Phase 2 — Per-terminal receipt numbering

### 2.1 Loosen `pos_sales.receipt_no` default

Today the column has `NOT NULL DEFAULT ('R' || nextval('pos_receipt_seq'))`.
Online web POS continues to use this — the route inserts the row
without supplying `receipt_no`, the default fires. For offline sales
the **client** supplies a value like `T1-1042`, and we want the DB to
accept it.

The simplest change: keep `NOT NULL`, keep the default, keep the
`UNIQUE` constraint. **No SQL change is needed at all** — a client
supplying `receipt_no` simply overrides the default; the unique
constraint catches collisions. The web POS keeps not supplying it and
keeps getting the `R<seq>` default.

```sql
-- No schema change. Behaviour is achieved by /api/pos/sales accepting
-- an optional `receiptNo` field from offline clients and passing it
-- through. The DB default only fires for inserts that omit the column.
```

Server-side validation (in `/api/pos/sales`) ensures:
- A client-supplied `receipt_no` matches the calling terminal's
  `prefix-seq` pattern (rejects spoofing).
- The `seq_no` portion equals or exceeds `pos_terminals.next_seq_no`
  for that terminal (idempotent replay tolerance: if the same offline
  sale is sent twice, the second hits `UNIQUE` and we 200-with-duplicate).

### 2.2 `pos_terminals.next_seq_no` advance on sync

This column was already added in 1.1 above with default `1`. The route
handler bumps it via `update ... set next_seq_no = greatest(next_seq_no, $new+1)`
inside the same transaction as the `pos_sales` insert.

## Phase 3 — Offline stock + oversell policy

### 3.1 `pos_sales.oversold`

Mirrors the existing `orders.oversold` column ([schema.sql:227](../../supabase/schema.sql#L227)).
Stamped when an offline-synced sale would have failed the live stock
check but we accept it anyway (cash already paid, food already eaten).

```sql
-- Append after the synced_at addition in 1.4.
alter table pos_sales add column if not exists oversold boolean not null default false;

create index if not exists idx_pos_sales_oversold
  on pos_sales (oversold) where oversold = true;
```

Admin "POS Reports" panel gains a new filter / badge for `oversold = true`
so the manager can reconcile the inventory shortfall after service.

### 3.2 `pos_oversell_events` ledger (optional but recommended)

Per-line audit of which items oversold on which sale. Cleaner than
re-parsing `pos_sales.items` after the fact, and lets the admin "stock
adjustments" panel show the exact units to write off.

```sql
-- Append after the pos_oversold column.
create table if not exists pos_oversell_events (
  id            text        primary key default gen_random_uuid()::text,
  pos_sale_id   text        not null references pos_sales(id) on delete cascade,
  menu_item_id  text        not null,  -- no FK: items may be deleted; we keep the id string for history
  menu_item_name text       not null,
  requested_qty integer     not null,
  available_qty integer     not null,
  detected_at   timestamptz not null default now()
);

create index if not exists idx_pos_oversell_events_sale
  on pos_oversell_events (pos_sale_id);
create index if not exists idx_pos_oversell_events_item
  on pos_oversell_events (menu_item_id);

alter table pos_oversell_events enable row level security;
drop policy if exists "deny_anon_all" on pos_oversell_events;
create policy "deny_anon_all" on pos_oversell_events
  for all to anon using (false) with check (false);
```

## Phase 4 — Offline PIN auth

### 4.1 `pin_hash` exposure — no schema change, new endpoint instead

The cached offline PIN check needs `pos_staff.pin_hash` on the tablet.
Currently `/api/pos/auth` POST response excludes it
([route.ts:25](../../app/src/app/api/pos/auth/route.ts#L25): `PUBLIC_COLUMNS`).

The column-level grants ([schema.sql:1027](../../supabase/schema.sql#L1027))
correctly revoke `pin_hash` from anon and authenticated. service_role
keeps access (bypasses column-level revokes). **No grant change needed
— the existing posture is correct.**

What we add: a new endpoint `GET /api/pos/staff/credentials` that uses
service_role and is gated by an active POS session, returning the
caller's own `pin_hash` + `permissions` + `session_version` so the
client can cache them for offline login.

> *Caveat:* this endpoint must **only** return the caller's own row.
> An attacker with a stolen session must not be able to enumerate other
> cashiers' hashes. Implementation enforces `where id = session.id`.

This is an API change, documented in `07-phases.md` under Phase 4. No
SQL is needed for it.

### 4.2 `session_version` tie-in

`pos_staff.session_version` already exists ([schema.sql:739](../../supabase/schema.sql#L739)).
The offline cache stores it alongside `pin_hash`. On reconnect the
client revalidates: if the server's current `session_version` >
cached, the cache is invalidated and the cashier is forced to
re-authenticate online.

**No schema change** — uses the existing column.

## Phase 5 — Service worker / manifest

Public file changes only (`app/public/sw.js`, `app/public/manifest.json`,
`app/src/app/layout.tsx`, `app/src/app/pos/page.tsx`). **No SQL.**

## Migration ordering

If we run `schema.sql` against a live DB, the order matters because of
the FK from `pos_sales.terminal_id` → `pos_terminals.id`:

```
1.1 (create pos_terminals)    → must run before
1.2 (alter pos_sales add FK column)
```

Both are in the same file; Postgres processes statements top-to-bottom,
so placing 1.1 above 1.2 in `schema.sql` is sufficient. Verified safe
ordering proposal: insert all of 1.1 (table + index + RLS) **between
the existing `pos_clock_entries` block and the existing `pos_sales`
add-column block** in `schema.sql`. Easy patch.

## Rollback plan

Every change is additive and reversible:

```sql
-- Phase 1
alter table pos_sales drop column if exists terminal_id;
alter table pos_sales drop column if exists client_created_at;
alter table pos_sales drop column if exists synced_at;
drop table if exists pos_terminals;

-- Phase 3
alter table pos_sales drop column if exists oversold;
drop table if exists pos_oversell_events;
```

Rollback wipes new data but leaves the original `pos_sales` and
existing reports untouched. We won't need this in production unless a
phase has to be reverted mid-rollout — but it's good hygiene.

## What's NOT changing

For transparency, every POS-touching table whose schema **stays the
same**:

- `pos_staff` — no new columns. `session_version` exists.
- `pos_clock_entries` — no new columns. Offline clock-in/out is
  disabled in Phase 1 (cashiers clock in/out online).
- `orders` — POS continues to write via `pushToKDS` exactly as today.
- `menu_items` — no new columns. Offline stock cache lives in client
  SQLite, not the DB.
- `customers` — no new columns. Loyalty bump from offline sales uses
  existing `loyalty_points`.
- `gift_cards`, `gift_card_transactions` — no new columns. Offline
  mode disables gift card tender; nothing to change.
- `pos_receipt_seq` (sequence) — no change. Continues serving the web
  POS allocator.
- All RPCs (`decrement_stock_atomic`, `restore_stock`) — no change.
