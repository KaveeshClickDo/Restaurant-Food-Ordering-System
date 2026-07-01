# 02 · Audit — POS-touching schema

Every database object the offline POS work will read, write, or extend.
Direct extracts from [supabase/schema.sql](../../supabase/schema.sql) — line refs
point at the canonical definitions, not migrations.

## Tables — POS-owned

### `pos_staff` ([schema.sql:326-338](../../supabase/schema.sql#L326-L338))

| Column | Type | Notes for offline |
|---|---|---|
| `id` | text PK (uuid string) | Used in session cookie and `pos_sales.staff_id` |
| `name` | text | Cached for receipts |
| `email` | text | |
| `role` | text check in `('admin','manager','cashier')` | Drives UI permissions |
| `pin_hash` | text NOT NULL | **bcrypt.** Must cache for offline login. |
| `active` | bool | Inactive = login refused |
| `permissions` | jsonb | Free-form capability flags (`canApplyDiscount`, `canVoid`, `canManageStaff`, …) |
| `hourly_rate` | numeric | Payroll only |
| `avatar_color` | text | UI only |
| `created_at` | timestamptz | |
| `session_version` | int default 1 ([schema.sql:739](../../supabase/schema.sql#L739)) | Bumped on credential change. **Critical for offline cache invalidation.** |

Index: `idx_pos_staff_active` partial on `active = true` ([schema.sql:845](../../supabase/schema.sql#L845)).

Offline implication: the offline mode must cache `(id, name, role, pin_hash,
active, permissions, avatar_color, session_version)`. On reconnect, if the
cached `session_version` mismatches the server, the cache is invalidated and
the cashier is forced to re-authenticate online.

### `pos_sales` ([schema.sql:479-507](../../supabase/schema.sql#L479-L507))

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | text PK | (client-supplied UUID) | Already the idempotency key. |
| `receipt_no` | text NOT NULL UNIQUE | `'R' \|\| nextval('pos_receipt_seq')` | **DB-allocated.** Blocks offline. |
| `date` | timestamptz | `now()` | Client provides for offline-created rows; default falls back |
| `staff_id` | text | (from session, not body) | nullable |
| `staff_name` | text | `''` | |
| `customer_id` | text | nullable | No FK (preserves financial audit if customer deleted) |
| `customer_name` | text | nullable | |
| `table_number` | int | nullable | POS dine-in linkage (legacy) |
| `items` | jsonb | `'[]'` | Full cart shape with modifiers + notes |
| `subtotal` | numeric | required | Server recomputes + tolerance-checks |
| `discount_amount` | numeric | `0` | |
| `discount_note` | text | nullable | |
| `tax_amount` | numeric | `0` | |
| `tax_rate` | numeric | `0` | Snapshot at sale time |
| `tax_inclusive` | bool | `false` | Snapshot at sale time |
| `tip_amount` | numeric | `0` | |
| `total` | numeric | required | Server recomputes + tolerance-checks |
| `payment_method` | text check in `('cash','card','split','gift_card')` | | |
| `payments` | jsonb | `'[]'` | Split payment breakdown |
| `cash_tendered` | numeric | nullable | Cash payment only |
| `change_given` | numeric | nullable | Cash payment only |
| `voided` | bool | `false` | |
| `void_reason` | text | nullable | |
| `voided_at` | timestamptz | nullable | |
| `refund_method` | text check in `('cash','card','none')` | nullable | |
| `refund_amount` | numeric | nullable | |
| `created_at` | timestamptz | `now()` | |
| `gift_card_id` | text → `gift_cards(id)` ([schema.sql:728](../../supabase/schema.sql#L728)) | nullable | Gift card tender |
| `gift_card_used` | numeric | `0` | Amount redeemed |

Indexes ([schema.sql:846-848, 865](../../supabase/schema.sql#L846-L848)):
- `idx_pos_sales_date` on `date desc`
- `idx_pos_sales_staff` partial on `staff_id is not null`
- `idx_pos_sales_voided` partial on `voided = true`
- `idx_pos_sales_gift_card_id` partial on `gift_card_id is not null`

**Offline implication**: the schema is mostly fine. The `receipt_no` default
expression and uniqueness constraint are the only structural blockers. Plan:
either (a) allow client to supply `receipt_no` (drop NOT NULL DEFAULT, keep
UNIQUE) and mint per-terminal, or (b) add `terminal_id` + `terminal_seq` and
make `receipt_no` a generated column from them.

### `pos_clock_entries` ([schema.sql:514-526](../../supabase/schema.sql#L514-L526))

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | uuid |
| `staff_id` | text NOT NULL | |
| `staff_name` | text NOT NULL | |
| `clock_in` | timestamptz NOT NULL `now()` | |
| `clock_out` | timestamptz | NULL = currently clocked in |
| `total_minutes` | int | Computed by server on clock-out |
| `notes` | text | |
| `created_at` | timestamptz `now()` | |

`uniq_pos_clock_open` partial unique on `staff_id` where `clock_out is null`
— **enforces "at most one open entry per staff"** at the DB level.

**Offline implication**: clock-in/out should also be queueable. Conflict
case: cashier clocks in offline, then clocks in again on another device
while still offline. On sync the partial unique index will reject the
second. Plan: server reconciles by accepting the earliest open entry,
auto-closing it on the later one's `clock_in`, and surfacing the conflict
to admin. (Or — simpler — disallow offline clock-in/out and require online
for time tracking. Recommended.)

### `pos_receipt_seq` ([schema.sql:470](../../supabase/schema.sql#L470))

Standalone Postgres sequence, `start 1000`. Used by `pos_sales.receipt_no`
default expression. **The single source of receipt-number atomicity.**
Offline plan must replace this with a per-terminal scheme or pre-allocated
ranges.

## Tables — POS-consumed (read by POS, owned elsewhere)

### `menu_items` ([schema.sql:48-78](../../supabase/schema.sql#L48-L78))

Heavy POS dependency: stock validation, channel check, modifier resolution.

| Column | Type | POS use |
|---|---|---|
| `id` | text PK | Cart line `productId` |
| `category_id` | text → `categories(id)` cascade | UI grouping |
| `name`, `description`, `price`, `image` | text/numeric | Display |
| `dietary` | text[] | Display badges |
| `popular`, `sort_order` | bool / int | Display |
| `variations` | jsonb | POS modifiers (radio groups) |
| `add_ons` | jsonb | POS modifiers (multi-select) |
| `stock_qty` | int | **Decremented atomically by `decrement_stock_atomic`** |
| `stock_status` | text check in `('in_stock','low_stock','out_of_stock')` | Manual override when `track_stock = false` |
| `cost`, `sku` | numeric / text | Admin only |
| `emoji`, `color` | text | POS UI styling |
| `active` | bool | POS hides inactive items |
| `track_stock` | bool | Toggles `stock_qty` vs `stock_status` semantics |
| `offer` | jsonb | Discount offers (already-rich shape) |
| `channels` | text[] `{in_store,online}` | POS shows only items containing `in_store` |
| `price_online` | numeric | Customer site only — POS ignores |

Index: `idx_menu_items_channels` GIN on `channels` ([schema.sql:839](../../supabase/schema.sql#L839)).

**Offline implication**: full snapshot is cached locally. `stock_qty` reads
are best-effort offline (will drift). On sync the server is the truth.

### `categories` ([schema.sql:37-42](../../supabase/schema.sql#L37-L42))

Simple — id, name, emoji, sort_order. Cached locally.

### `customers` ([schema.sql:92-115](../../supabase/schema.sql#L92-L115))

POS-relevant columns: `id, name, email, phone, loyalty_points,
store_credit, gift_card_balance, notes, tags, favourites, active`.

POS-irrelevant (PII / auth): `password_hash, reset_token, *_token, *_expires,
saved_addresses, session_version (matters for online sessions only)`.

**Offline implication**: cache the lookup subset (name/email/phone/loyalty)
for assignment to sales offline. Edits offline must queue. New customers
created offline get a client UUID; server accepts via `pos/customers` POST.

### `orders` ([schema.sql:145-227](../../supabase/schema.sql#L145-L227))

POS only **writes** here via `pushToKDS` (route.ts:408). Columns POS uses:

| Column | POS value |
|---|---|
| `id` | Same as `pos_sales.id` (idempotent re-insert returns 23505) |
| `customer_id` | Always `'pos-walk-in'` sentinel |
| `date`, `status`, `fulfillment`, `total`, `items`, `note`, `payment_method`, `vat_amount`, `vat_inclusive` | from the sale |

**Offline implication**: the KDS push happens **server-side** at sync, so
this table is touched only on reconnect — no client-side write. No schema
change needed for offline.

### `gift_cards` ([schema.sql:677-695](../../supabase/schema.sql#L677-L695)) + `gift_card_transactions` ([schema.sql:708-721](../../supabase/schema.sql#L708-L721))

Hit by `lookupActiveGiftCard` + `redeemGiftCardForRow` during sale. Cannot
be validated offline. **Plan: disable gift card tender offline.**

### `app_settings` ([schema.sql:31-35](../../supabase/schema.sql#L31-L35))

Single row id=1. POS reads currency symbol, tax rate, restaurant info, POS
settings from `data.pos` (free-form jsonb). Cache locally.

### `dining_tables` ([schema.sql:434-449](../../supabase/schema.sql#L434-L449))

Read by POS for table-service tab. Polled every 15s in the current
[POSPage layout](../../app/src/app/pos/page.tsx#L48-L60). Cache locally.

## Functions — POS-invoked

### `decrement_stock_atomic(p_items jsonb)` ([schema.sql:581-638](../../supabase/schema.sql#L581-L638))

Atomic per-line decrement inside a single transaction. Raises `P0001` with
`INSUFFICIENT_STOCK <id>` on shortfall. Skips rows missing or with
`track_stock = false`.

### `restore_stock(p_items jsonb)` ([schema.sql:640-665](../../supabase/schema.sql#L640-L665))

Adds units back. Called on insert error rollback and void/refund flows.

**Offline implication**: both run server-side at sync time. No client port.

## Other touch points

- **RLS** ([schema.sql:868-993](../../supabase/schema.sql#L868-L993)): All
  POS tables (`pos_staff`, `pos_sales`, `pos_clock_entries`) have
  `deny_anon_all` policies. Every read goes through service-role API routes.
  No change needed.
- **Column-level revokes** ([schema.sql:1027-1029](../../supabase/schema.sql#L1027-L1029)):
  `pin_hash` is column-revoked from anon/authenticated. The offline cache
  must obtain it via the API server's `/api/pos/auth POST` response — and
  that response currently does **NOT** return `pin_hash`
  ([api/pos/auth/route.ts:25](../../app/src/app/api/pos/auth/route.ts#L25):
  `PUBLIC_COLUMNS` excludes it). **New endpoint or new field needed for
  offline cache.**
- **Realtime publication** ([schema.sql:1068-1108](../../supabase/schema.sql#L1068-L1108)):
  `pos_sales` and `pos_clock_entries` are **NOT** in `supabase_realtime`. The
  POS web client doesn't get live updates on those today. (Customers and
  menu_items are, so live stock updates reach the POS UI.)

## Schema changes required for offline (preview — finalised in 06)

These are additive — no destructive migrations. Existing queries continue
working unchanged.

1. **`pos_terminals`** new table — registered tablets, terminal_id (short
   prefix), device fingerprint, starting receipt seq, last sync at, active flag.
2. **`pos_sales.terminal_id`** new column (text, nullable) — populated for
   offline-created rows; NULL for online web POS.
3. **`pos_sales.client_created_at`** new column (timestamptz, nullable) —
   time the sale was rung up on the tablet, vs server-side `created_at`
   which is sync time. Reports/audits use this.
4. **`pos_sales.synced_at`** new column (timestamptz, default `now()`) —
   so admin can see "this sale was offline for N hours".
5. **`pos_sales.oversold`** new column (bool, default false) — flagged
   when sync-time stock decrement would have failed but we accept the
   sale (cash paid).
6. **`pos_sales.receipt_no` default** loosened — keep UNIQUE; change
   NOT NULL DEFAULT to allow client-supplied values matching a
   per-terminal pattern. Online callers without a `terminal_id`
   continue to get `'R' || nextval('pos_receipt_seq')`.
7. **`pos_staff` PIN export** — add a new endpoint
   `GET /api/pos/staff/credentials` (POS-session-gated) that returns
   `pin_hash` + `permissions` + `session_version` for offline cache hydration.
