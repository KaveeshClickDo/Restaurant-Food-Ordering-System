-- ═══════════════════════════════════════════════════════════════════════════════
-- Single-Restaurant Food Ordering System — canonical database schema
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Canonical schema for first deploy. Run via `npm run db:migrate` on a fresh
-- Supabase project.
--
-- How to apply:
--   • Local script:   cd app && npm run db:migrate
--   • Supabase UI:    Dashboard → SQL Editor → New query → Paste this file → Run
--
-- Layout:
--    1. Extensions
--    2. Tables (in dependency order)
--    3. Indexes
--    4. RLS — enable + policies
--    5. Grants (base table grants + column-level revokes)
--    6. Sentinel rows (app_settings, pos-walk-in)
--    7. Realtime publications
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── 1. Extensions ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;


-- ── 2. Tables ─────────────────────────────────────────────────────────────────

-- 2a. Existing core tables ----------------------------------------------------

create table if not exists app_settings (
  id         integer primary key default 1,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);

create table if not exists categories (
  id         text primary key,
  name       text not null,
  emoji      text not null default '',
  sort_order integer not null default 0,
  parent_id  text references categories(id) on delete set null
);

-- menu_items — admin/POS unified item catalog.
-- POS-side fields (cost, sku, emoji, color, active, offer, track_stock) are
-- included so both the admin and POS editors round-trip losslessly. See the
-- Bug #2 refactor for the unified MenuItem type that drives this.
create table if not exists menu_items (
  id           text primary key,
  category_id  text not null references categories(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  price        numeric not null,
  image        text,
  dietary      text[] not null default '{}',
  popular      boolean not null default false,
  variations   jsonb,
  add_ons      jsonb,
  stock_qty    integer,
  stock_status text,
  sort_order   integer not null default 0,
  cost         numeric,
  sku          text,
  emoji        text,
  color        text,
  active       boolean not null default true,
  track_stock  boolean not null default false,
  offer        jsonb,
  -- ── Channel split (admin / POS / customer site) ────────────────────────────
  -- `channels` controls which storefronts surface the item. Existing rows
  -- default to both so a fresh install behaves the same as before. POS-only
  -- items (alcohol, fries, anything unsuitable for delivery) carry
  -- ['in_store']; online-exclusive deals carry ['online'].
  -- `price_online` is an optional override used only by the customer site;
  -- POS and waiter always use `price`. NULL means "use base price".
  channels       text[]   not null default '{in_store,online}',
  price_online   numeric
);

-- Backfill defaults on existing rows when the columns were added by a
-- migration rather than CREATE TABLE. Idempotent: no-op if already populated.
alter table menu_items add column if not exists channels     text[]  not null default '{in_store,online}';
alter table menu_items add column if not exists price_online numeric;

-- customers — registered + sentinel walk-in.
-- Auth columns (password_hash, reset_token, email_verified, email_verification_*)
-- support self-serve login, password reset, and email verification.
-- POS-shared fields (loyalty_points, gift_card_balance, notes) let POS and admin
-- share the customers table as the single source of truth (Bug #11). totalSpend
-- / visitCount / lastVisit are NOT stored — they're computed server-side by the
-- list endpoints by joining orders + pos_sales.
create table if not exists customers (
  id                         text          primary key,
  name                       text          not null,
  email                      text          not null unique,
  phone                      text          not null default '',
  password_hash              text,
  reset_token                text,
  reset_token_expires        timestamptz,
  email_verified             boolean       not null default false,
  email_verification_token   text,
  email_verification_expires timestamptz,
  created_at                 timestamptz   not null default now(),
  tags                       text[]        not null default '{}',
  favourites                 text[]        not null default '{}',
  saved_addresses            jsonb         not null default '[]',
  store_credit               numeric       not null default 0,
  loyalty_points             integer       default 0,
  gift_card_balance          numeric(10,2) default 0,
  notes                      text          default '',
  -- Toggle from Admin → User Management. Inactive customers cannot log in
  -- (auth/login rejects them with a clear message). Their order history is
  -- preserved either way.
  active                     boolean       not null default true
);

-- Note on customer_id: nullable + ON DELETE SET NULL. When admin deletes a
-- customer we must preserve the order row (totals, payment_method, refunds,
-- VAT, fees, dates) for financial audit. The customer link is severed; admin
-- UI shows "Deleted customer" for these rows. POS sales follow the same
-- pattern (no FK at all).
--
-- delivery_code: 4-digit PIN the customer reads to the driver to confirm
-- hand-off, preventing misdelivery. Populated only for delivery fulfillment at
-- order-creation time; null for collection / dine-in.
--
-- payment_status distinguishes "money collected" from order fulfillment status:
--   • 'unpaid'   — cash / pay-on-delivery; expect to collect at hand-off.
--   • 'paid'     — Stripe or PayPal authorised + captured.
--   • 'refunded' — full refund processed through the gateway.
--   • 'partially_refunded' — at least one partial refund processed.
-- The `status` column continues to track fulfillment (pending → preparing →
-- delivered). The two move independently: a 'paid' order can still be 'pending'
-- (just placed), and a 'delivered' order can be 'unpaid' (cash).
--
-- cash_reconciled_at: when admin marks the driver as having handed in the
-- cash for a delivered COD order. Null = the driver still owes the business
-- this cash. Only meaningful for delivery + cash + paid + delivered rows;
-- card/PayPal orders never need reconciling.
--
-- Gateway-specific columns:
--   • stripe_payment_intent_id / stripe_charge_id — populated for Stripe orders.
--   • paypal_order_id / paypal_capture_id         — populated for PayPal orders.
-- Exactly one pair is set per paid order; cash orders leave both pairs null.
create table if not exists orders (
  id                       text        primary key,
  customer_id              text        references customers(id) on delete set null,
  date                     timestamptz not null default now(),
  status                   text        not null default 'pending',
  fulfillment              text        not null default 'delivery',
  total                    numeric     not null,
  items                    jsonb       not null default '[]',
  address                  text,
  note                     text,
  payment_method           text,
  delivery_fee             numeric,
  service_fee              numeric,
  scheduled_time           text,
  coupon_code              text,
  coupon_discount          numeric,
  vat_amount               numeric,
  vat_inclusive            boolean,
  driver_id                text,
  driver_name              text,
  delivery_status          text,
  delivery_code            text,
  refunds                  jsonb       not null default '[]',
  refunded_amount          numeric     not null default 0,
  store_credit_used        numeric     not null default 0,
  voided_by                text,
  void_reason              text,
  voided_at                timestamptz,
  payment_status           text        not null default 'unpaid'
                           check (payment_status in ('unpaid','paid','refunded','partially_refunded','failed')),
  stripe_payment_intent_id text,
  stripe_charge_id         text,
  paypal_order_id          text,
  paypal_capture_id        text,
  -- Customer-provided pin coordinates captured at checkout. Optional: only set
  -- when the customer placed/dragged a pin or used "Detect location". The driver
  -- map prefers these over re-geocoding the address string.
  customer_lat             double precision,
  customer_lng             double precision,
  -- Driver cash reconciliation: stamped when admin confirms the driver has
  -- handed in the cash for a delivered COD order. Null = still outstanding.
  cash_reconciled_at       timestamptz,
  cash_reconciled_by       text
);

-- Backfill for existing installs where the columns were not in the original CREATE.
alter table orders add column if not exists customer_lat double precision;
alter table orders add column if not exists customer_lng double precision;
alter table orders add column if not exists cash_reconciled_at timestamptz;
alter table orders add column if not exists cash_reconciled_by text;

-- Dine-in tip + manual discount. Online orders use coupon_discount for promo
-- codes; these columns carry the waiter-applied bill-level discount and the
-- table-service tip. Stamped on the bill's anchor order at settle time (mirrors
-- the gift-card stamp), so the figures survive on the order row and flow into
-- reports / receipts the same way POS tip + discount do on pos_sales.
alter table orders add column if not exists tip_amount      numeric not null default 0;
alter table orders add column if not exists discount_amount numeric not null default 0;
alter table orders add column if not exists discount_note   text;

-- Dine-in table linkage. Historically dine-in orders linked to a table only via
-- the free-text note ("[WAITER] Table T4 · …"), which is fragile to parse and
-- impossible to index. These columns make the link structural — set at order
-- creation, matching reservations.table_id — so live occupancy AND reservation
-- availability can join orders↔tables reliably. Nullable: only dine-in orders
-- set them; delivery / collection leave them null.
alter table orders add column if not exists table_id    text;
alter table orders add column if not exists table_label text;

-- Fast "which tables are occupied right now" lookups — only active dine-in
-- orders carry a table_id, so this partial index stays tiny.
create index if not exists orders_dine_in_table_idx
  on orders (table_id)
  where fulfillment = 'dine-in' and table_id is not null;
-- NOTE: the one-time backfill that populates these columns from old notes lives
-- AFTER the dining_tables table is created (it joins against it) — see below.

-- Set when the webhook accepted a paid order that failed the stock check
-- (we couldn't reject — customer's money was already captured). Admin sees
-- the flag in the orders view for reconciliation, and void/refund flows use
-- it to know that restore_stock would create false inventory because the
-- original decrement never ran.
alter table orders add column if not exists oversold boolean not null default false;

-- ── Dine-in kitchen tickets (rounds) ─────────────────────────────────────────
-- A dine-in table bill is ONE `orders` row (the running tab). Each round the
-- waiter fires — the first order and every "add more" — is a separate row here,
-- so the KDS shows them as discrete kitchen tickets that never mutate, while the
-- bill stays a single order for admin / finance / POS / settlement.
--
-- Source of truth split:
--   • `orders` (one dine-in row per table)  → admin, finance, POS dashboard, settle
--   • `dine_in_tickets` (one row per round) → KDS feed + /waiter floor occupancy,
--     kitchen status and ready-to-serve. The kitchen advances `status` HERE
--     (pending → confirmed → preparing → ready), never on the bill.
-- Online + POS keep flowing through `orders` to the KDS unchanged; only dine-in
-- kitchen units move here.
create table if not exists dine_in_tickets (
  id          text        primary key,
  order_id    text        not null references orders(id) on delete cascade,
  table_id    text,
  table_label text,
  round_no    integer     not null default 1,
  items       jsonb       not null default '[]',
  status      text        not null default 'pending',
  note        text,
  oversold    boolean     not null default false,
  date        timestamptz not null default now()
);

-- KDS feed: active tickets, oldest first (mirrors the orders ACTIVE_STATUSES read).
create index if not exists dine_in_tickets_status_idx on dine_in_tickets (status, date);
-- Floor occupancy + a table's currently-open rounds.
create index if not exists dine_in_tickets_table_idx on dine_in_tickets (table_id) where table_id is not null;
-- All rounds belonging to one bill.
create index if not exists dine_in_tickets_order_idx on dine_in_tickets (order_id);

-- Stock-status CHECK so a typo or bad client can't store an arbitrary string
-- in stock_status (which resolveStock would silently treat as "in_stock"
-- and let through). Allowed values match the enum used app-wide. Dropped
-- first so re-runs after the enum changes still work. NULL is allowed and
-- means "fall back to default" (in_stock).
alter table menu_items drop constraint if exists menu_items_stock_status_check;
alter table menu_items add constraint menu_items_stock_status_check
  check (stock_status is null or stock_status in ('in_stock','low_stock','out_of_stock'));

create table if not exists drivers (
  id                  text        primary key,
  name                text        not null,
  email               text        not null unique,
  phone               text        not null default '',
  password_hash       text        not null,
  reset_token         text,
  reset_token_expires timestamptz,
  active              boolean     not null default true,
  vehicle_info        text,
  notes               text,
  created_at          timestamptz not null default now()
);

create table if not exists reservations (
  id             text        primary key,
  table_id       text        not null,
  table_label    text        not null,
  table_seats    integer     not null,
  section        text        not null default '',
  customer_name  text        not null,
  customer_email text        not null,
  customer_phone text        not null default '',
  date           text        not null,                 -- "YYYY-MM-DD"
  time           text        not null,                 -- "HH:MM"
  party_size     integer     not null,
  status         text        not null default 'pending',
  note           text,
  checked_in_at  timestamptz,
  checked_out_at timestamptz,
  source         text        not null default 'online',
  cancel_token   text        not null default gen_random_uuid()::text unique,
  -- VIP booking fee captured at reservation time. vip_fee is the amount charged
  -- (0 for normal tables); payment_status is 'none' for free bookings and 'paid'
  -- once the fee is collected; payment_method records how ('stripe'/'paypal' for
  -- online, 'cash'/'card' for POS & admin); payment_ref holds the gateway id or
  -- till receipt reference. The fee is non-refundable on cancellation.
  vip_fee        numeric(10,2) not null default 0,
  payment_status text        not null default 'none'
                 check (payment_status in ('none','paid')),
  payment_method text,
  payment_ref    text,
  created_at     timestamptz not null default now()
);

-- reservation_customers.customer_id is nullable: not every reservation guest is
-- (or becomes) a registered customer. ON DELETE SET NULL so deleting a customer
-- record doesn't cascade-wipe their reservation history.
create table if not exists reservation_customers (
  id               text          primary key default gen_random_uuid()::text,
  email            text          not null unique,
  name             text          not null default '',
  phone            text          not null default '',
  visit_count      integer       not null default 0,
  first_visit_at   timestamptz,
  last_visit_at    timestamptz,
  tags             text[]        not null default '{}',
  notes            text          not null default '',
  marketing_opt_in boolean       not null default false,
  order_count      integer       not null default 0,
  total_spend      numeric(10,2) not null default 0,
  last_order_at    timestamptz,
  customer_id      text          references customers(id) on delete set null,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

create table if not exists reservation_waitlist (
  id          text        primary key default gen_random_uuid()::text,
  date        text        not null,
  time        text        not null,
  party_size  integer     not null,
  name        text        not null,
  email       text        not null,
  phone       text        not null default '',
  notified_at timestamptz,
  created_at  timestamptz not null default now()
);


-- 2b. New tables — moved out of app_settings.data ----------------------------
-- Each one used to live as a JSONB key inside app_settings. Promoted to its
-- own table for: row-level edits, FK targets, indexed lookups, atomic
-- counters, hashed passwords, and append-only audit semantics where applicable.

-- POS terminal staff (replaces app_settings.data.pos_staff).
-- Passwords are bcrypt-hashed; the salt+hash live in password_hash and never
-- leave the server. POS staff ALSO get a 6-digit PIN (pin_hash) for the tablet:
-- it is validated locally on the device and never authenticates server-side —
-- sessions are always minted from the password (or a device token). Other staff
-- surfaces (waiter/kitchen/collection) are password-only (web, no APK).
-- permissions is a free-form jsonb keyed by capability flags.
create table if not exists pos_staff (
  id            text        primary key default gen_random_uuid()::text,
  name          text        not null,
  email         text        not null default '',
  role          text        not null default 'cashier'
                check (role in ('admin','manager','cashier')),
  password_hash text,
  pin_hash      text,
  active        boolean     not null default true,
  permissions   jsonb       not null default '{}',
  hourly_rate   numeric,
  avatar_color  text        not null default '#7c3aed',
  created_at    timestamptz not null default now()
);

-- Waitstaff that log into /waiter (replaces app_settings.data.waiters).
create table if not exists waiters (
  id            text        primary key default gen_random_uuid()::text,
  name          text        not null,
  email         text        not null default '',
  role          text        not null default 'waiter'
                check (role in ('waiter','senior')),
  password_hash text,
  active        boolean     not null default true,
  hourly_rate   numeric,
  avatar_color  text        not null default '#0891b2',
  created_at    timestamptz not null default now()
);

-- Kitchen staff that log into /kitchen (replaces app_settings.data.kitchenStaff).
create table if not exists kitchen_staff (
  id            text        primary key default gen_random_uuid()::text,
  name          text        not null,
  email         text        not null default '',
  role          text        not null default 'chef'
                check (role in ('chef','head_chef','kitchen_manager')),
  password_hash text,
  active        boolean     not null default true,
  avatar_color  text        not null default '#dc2626',
  created_at    timestamptz not null default now()
);

-- Collection staff that log into /collection — the standalone pickup-payment
-- surface for shops that run online orders without the POS. Flat list (no
-- roles/permissions); passwords are bcrypt-hashed in password_hash. session_version is
-- inline (mirrors the staff invalidation pattern) so an admin password reset or
-- deactivation signs the operator out on their next request.
create table if not exists collection_staff (
  id              text        primary key default gen_random_uuid()::text,
  name            text        not null,
  email           text        not null default '',
  password_hash   text,
  active          boolean     not null default true,
  avatar_color    text        not null default '#f97316',
  session_version integer     not null default 1,
  created_at      timestamptz not null default now()
);

-- ── Migration: staff credential PIN → password ───────────────────────────────
-- Staff auth switched from a numeric PIN to a password. The column holds a
-- bcrypt hash either way, so on EXISTING databases we just rename it. The rename
-- is guarded on "pin_hash still exists" so it runs exactly once (subsequent
-- idempotent re-runs skip it — and so never wipe live passwords). At the same
-- time we FORCE-RESET every existing credential to NULL ("no password set"):
-- old hashes were of numeric PINs, and the product now requires a real password
-- set by an admin. A NULL password_hash means the auth route rejects login until
-- an admin sets one. Fresh DBs already create password_hash above, so this is a
-- no-op there.
-- Guard requires pin_hash present AND password_hash absent so it fires ONLY on
-- the genuinely-old schema. pos_staff later re-gains a pin_hash column (the POS
-- tablet PIN, below); without the password_hash check this block would wrongly
-- try to rename that new column on every subsequent migrate.
do $$
declare t text;
begin
  foreach t in array array['pos_staff','waiters','kitchen_staff','collection_staff'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'pin_hash'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'password_hash'
    ) then
      execute format('alter table %I rename column pin_hash to password_hash', t);
      execute format('alter table %I alter column password_hash drop not null', t);
      execute format('update %I set password_hash = null', t);   -- force reset (one-time)
    end if;
  end loop;
end $$;

-- ── B2: POS tablet PIN + device tokens ───────────────────────────────────────
-- POS staff get a 6-digit PIN (admin-set) IN ADDITION to their password. The PIN
-- is validated locally on the tablet (its hash is cached after a password login)
-- and never authenticates against the server — sessions stay password-only.
-- Re-add pin_hash on databases that already migrated to the password-only schema.
alter table pos_staff add column if not exists pin_hash text;

-- Device refresh tokens: issued to a tablet after a successful password login so
-- the device can mint fresh sessions (unlocked by the local PIN) without
-- re-entering the password. The raw token is returned once; only its sha256 hash
-- is stored. Revoked on password/PIN change or deactivation; expires after 30
-- days (forces a password re-auth). One row per (staff, device) — re-enrolling a
-- device replaces its token.
create table if not exists pos_device_tokens (
  id           text        primary key default gen_random_uuid()::text,
  staff_id     text        not null references pos_staff(id) on delete cascade,
  device_id    text        not null,
  token_hash   text        not null,
  device_label text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz not null,
  revoked      boolean     not null default false,
  unique (staff_id, device_id)
);
create index if not exists idx_pos_device_tokens_staff on pos_device_tokens (staff_id);

-- Promo codes (replaces app_settings.data.coupons). Lives as a real table
-- so usage_count can be incremented atomically at checkout without
-- rewriting the entire settings blob (the old race window).
create table if not exists coupons (
  code             text        primary key,
  description      text        not null default '',
  discount_type    text        not null check (discount_type in ('percent','fixed')),
  discount_value   numeric     not null,
  min_order_total  numeric     not null default 0,
  max_uses         integer,                                -- null = unlimited
  usage_count      integer     not null default 0,
  expires_at       timestamptz,
  active           boolean     not null default true,
  created_at       timestamptz not null default now()
);

-- Append-only audit trail (replaces app_settings.data.paymentAuditLog).
-- Storing this as a growing JSONB array made every audit entry rewrite
-- the whole settings row. A dedicated table makes this a single INSERT
-- and unlocks queries by date / actor.
create table if not exists payment_audit_log (
  id         bigserial   primary key,
  timestamp  timestamptz not null default now(),
  actor      text        not null,
  action     text        not null,
  details    jsonb       not null default '{}'
);

-- Payment sessions — staging table for the "payment-first" checkout flow.
-- A row is created when the customer clicks Pay; it holds the verified cart and
-- delivery details while the gateway authorises the charge (Stripe 3D Secure
-- can take 30+ seconds; PayPal approval runs in a popup). On the success
-- webhook (Stripe payment_intent.succeeded / PayPal PAYMENT.CAPTURE.COMPLETED)
-- the row is converted into a real `orders` row. On failure or abandonment
-- the row expires and is cleaned up. The kitchen / driver views never see
-- this table — only `orders`.
--
-- `gateway` discriminates between Stripe and PayPal sessions. Exactly one of
-- stripe_payment_intent_id / paypal_order_id is populated per row; the other
-- stays null. Both columns are unique-when-present so a single gateway id
-- can never own two sessions.
create table if not exists payment_sessions (
  id                       text        primary key default gen_random_uuid()::text,
  gateway                  text        not null default 'stripe'
                           check (gateway in ('stripe','paypal')),
  stripe_payment_intent_id text        unique,
  paypal_order_id          text        unique,
  customer_id              text        not null,
  amount                   numeric     not null,
  currency                 text        not null,
  order_payload            jsonb       not null,
  status                   text        not null default 'pending'
                           check (status in ('pending','succeeded','failed','expired')),
  created_at               timestamptz not null default now(),
  expires_at               timestamptz not null default (now() + interval '1 hour'),
  completed_order_id       text,
  last_error               text,
  -- Exactly one gateway-id column must be populated, matching the `gateway` value.
  constraint payment_sessions_gateway_id_check check (
    (gateway = 'stripe' and stripe_payment_intent_id is not null and paypal_order_id is null)
    or (gateway = 'paypal' and paypal_order_id is not null and stripe_payment_intent_id is null)
  )
);

-- Dining tables (replaces app_settings.data.diningTables). Promoted to a
-- real table so reservations.table_id and POS dine-in orders have a real
-- FK target.
create table if not exists dining_tables (
  id          text        primary key default gen_random_uuid()::text,
  label       text        not null,
  number      integer,
  seats       integer     not null,
  section     text        not null default '',
  active      boolean     not null default true,
  sort_order  integer     not null default 0,
  -- VIP tables charge a non-refundable booking fee at reservation time. is_vip
  -- toggles the crown/special UI everywhere; vip_price is the fee (0 for normal
  -- tables). Reservations against a VIP table can only be created after the fee
  -- is paid (online: Stripe/PayPal via webhook; POS/admin: cash/card recorded).
  is_vip      boolean     not null default false,
  vip_price   numeric(10,2) not null default 0,
  -- Position on the customer-facing floor-plan map, stored as a 0..1 fraction of
  -- the plan image's width/height so the layout scales to any screen. NULL = the
  -- table hasn't been placed on the map yet (it falls back to the card list).
  pos_x       real,
  pos_y       real,
  -- Which named floor plan the table is placed on (FloorPlan.id from
  -- app_settings.data.reservationSystem.floorPlans). NULL on tables placed
  -- before multi-floor support — those belong to the first floor plan.
  floor_plan_id text,
  created_at  timestamptz not null default now()
);

-- One-time backfill for dine-in orders created before orders.table_id existed:
-- recover the table from the "[WAITER] Table <label>" note by matching
-- dining_tables.label. Placed here (not next to the orders columns) because it
-- joins dining_tables, which is only created above. Idempotent — fills nulls
-- only; rows that don't match stay null and fall back to note-parsing at read.
update orders o
   set table_id    = dt.id,
       table_label = dt.label
  from dining_tables dt
 where o.fulfillment = 'dine-in'
   and o.table_id is null
   and o.note like '[WAITER] Table %'
   and dt.label = substring(o.note from '\[WAITER\] Table (\S+)');

-- Atomic receipt-number allocator. nextval() is a serializable database
-- operation, so two concurrent tills always get distinct numbers — the
-- per-device counter race goes away by definition. start 1000 keeps printed
-- receipts looking like the existing format. Defined *before* pos_sales so
-- its default expression can reference the sequence.
create sequence if not exists pos_receipt_seq start 1000;

-- POS sales — full audit/tax record of every till transaction.
-- Replaces the per-device pos_sales localStorage key. Each terminal POSTs to
-- /api/pos/sales which inserts here, then also writes a summary into orders
-- so the Kitchen Display System sees the ticket in real-time.
--
-- receipt_no defaults to 'R<nextval>' so the client never has to (and never
-- gets to) pick its own number — duplicates across tills are impossible.
create table if not exists pos_sales (
  id              text        primary key,
  receipt_no      text        not null unique default ('R' || nextval('pos_receipt_seq')::text),
  date            timestamptz not null default now(),
  staff_id        text,
  staff_name      text        not null default '',
  customer_id     text,
  customer_name   text,
  table_number    integer,
  items           jsonb       not null default '[]',
  subtotal        numeric     not null,
  discount_amount numeric     not null default 0,
  discount_note   text,
  tax_amount      numeric     not null default 0,
  tax_rate        numeric     not null default 0,
  tax_inclusive   boolean     not null default false,
  tip_amount      numeric     not null default 0,
  service_fee_amount     numeric     not null default 0,
  total           numeric     not null,
  payment_method  text        not null check (payment_method in ('cash','card','split','gift_card')),
  payments        jsonb       not null default '[]',
  cash_tendered   numeric,
  change_given    numeric,
  voided          boolean     not null default false,
  void_reason     text,
  voided_at       timestamptz,
  refund_method   text                  check (refund_method in ('cash','card','none')),
  refund_amount   numeric,
  created_at      timestamptz not null default now()
);

-- POS clock-in/out — shared across all terminals so admin payroll reports
-- aggregate across the fleet. Replaces the per-device pos_clock localStorage
-- key. The partial unique index enforces "at most one open entry per staff
-- member" at the database level — a second clock-in without clock-out is
-- rejected by Postgres, not by application logic.
create table if not exists pos_clock_entries (
  id            text        primary key default gen_random_uuid()::text,
  staff_id      text        not null,
  staff_name    text        not null,
  clock_in      timestamptz not null default now(),
  clock_out     timestamptz,
  total_minutes integer,
  notes         text,
  created_at    timestamptz not null default now()
);

create unique index if not exists uniq_pos_clock_open
  on pos_clock_entries (staff_id) where clock_out is null;

-- POS terminals — one row per physical Android tablet registered to ring up
-- offline sales. Created on the device's first successful online password login;
-- updated on every subsequent sync. `prefix` namespaces offline-minted
-- receipt numbers so two tablets can never collide on pos_sales.receipt_no
-- (e.g. terminal T1 produces 'T1-1042', T2 produces 'T2-1042'). Online web
-- POS continues to use the pos_receipt_seq default and never references
-- this table — pos_sales.terminal_id stays NULL for those rows.
create table if not exists pos_terminals (
  id                 text        primary key default gen_random_uuid()::text,
  -- Human-readable label set in admin (e.g. "Front counter", "Bar").
  label              text        not null,
  -- Short receipt prefix, 1–4 chars [A-Z0-9] enforced application-side. Unique
  -- across active terminals so receipt strings never collide.
  prefix             text        not null,
  -- Per-terminal monotonic counter. Incremented client-side, validated
  -- server-side on sync. Persisted as a backup if the device's local counter
  -- is lost (e.g. user wipes app data).
  next_seq_no        integer     not null default 1,
  -- Device fingerprint hash. Used to detect "same device re-registering
  -- after a wipe" vs. "different device steals an existing prefix".
  device_fingerprint text        not null default '',
  -- Activity bookkeeping for an admin "online terminals" dashboard. Nullable
  -- so a freshly-created terminal that has never synced reads correctly.
  last_seen_at       timestamptz,
  last_sync_at       timestamptz,
  active             boolean     not null default true,
  created_at         timestamptz not null default now()
);

-- Prefix must be unique among ACTIVE terminals. Deactivated terminals keep
-- their prefix recorded for audit history without blocking re-use.
create unique index if not exists uniq_pos_terminals_prefix_active
  on pos_terminals (prefix) where active = true;

create index if not exists idx_pos_terminals_active
  on pos_terminals (active) where active = true;

-- Case-insensitive unique label. Closes the race window where two concurrent
-- POSTs could each pass the application-level duplicate check before either
-- INSERT commits. Application code still does a friendly pre-check; this is
-- the hard backstop.
create unique index if not exists dining_tables_label_unique
  on dining_tables (lower(label));


-- Meal periods — time-bounded sections on the customer menu.
-- Many-to-many model:
--   * `meal_periods` row per period (Breakfast, Lunch, Dinner, Sunday Brunch…)
--     with schedule (enabled, time window, days of week, sort_order).
--   * `menu_item_meal_periods` join row per (item × period) pair.
-- Items with zero join rows are "anytime" items shown on the customer menu
-- regardless of time. Cascade deletes both ways so removing either side is
-- self-cleaning.
create table if not exists meal_periods (
  id            text        primary key default gen_random_uuid()::text,
  name          text        not null,
  enabled       boolean     not null default true,
  start_time    text        not null,           -- "HH:MM"
  end_time      text        not null,           -- "HH:MM"
  days_of_week  integer[]   not null default array[0,1,2,3,4,5,6], -- 0=Sun..6=Sat
  sort_order    integer     not null default 0,
  theme_color   text        not null default '#f59e0b',
  created_at    timestamptz not null default now()
);

-- Backfill for databases created before theme_color existed: `create table if
-- not exists` above is a no-op on an existing meal_periods table, so the column
-- must be added explicitly.
alter table meal_periods add column if not exists theme_color text not null default '#f59e0b';

create table if not exists menu_item_meal_periods (
  menu_item_id    text not null references menu_items(id)   on delete cascade,
  meal_period_id  text not null references meal_periods(id) on delete cascade,
  primary key (menu_item_id, meal_period_id)
);


-- ── 2c. Functions ────────────────────────────────────────────────────────────
-- Atomic stock mutations. The whole loop runs inside a single Postgres
-- transaction so a multi-item order either decrements every tracked line or
-- none — partial state is impossible.
--
-- Enforcement rules (must match the customer-facing rule):
--   • track_stock = true              → stock_qty is the single source of
--                                       truth. Hard reject when qty <
--                                       requested; decrement on success. A
--                                       stale stock_status from a previous
--                                       mode is ignored — qty wins.
--   • track_stock = false + stock_status = "out_of_stock"
--                                     → hard reject. Admin's explicit
--                                       "do not sell" signal in manual mode.
--   • Otherwise (manual in_stock / low_stock, or missing row, or ad-hoc
--     hand-typed POS line) → no quantity to deduct, skip silently.
--
-- Called from app/src/lib/stockMutation.ts via supabase.rpc().
--
-- p_force (default false): when true, NEVER raise — decrement tracked items
-- even past zero (stock_qty goes negative) and ignore manual out_of_stock.
-- This is the OFFLINE-SALE RECONCILIATION path: a sale rung on a Capacitor POS
-- while offline (receipt_no 'OFF…') is replayed by the outbox on reconnect.
-- That sale already happened — the customer paid and walked out — so the server
-- must NEVER reject it on a stock grounds (that would strand the sale and lose
-- the money). Instead we let the count go negative; a negative stock_qty is the
-- visible "this oversold while offline" flag a manager reconciles. Online sales
-- (p_force = false) keep the hard limit.

-- Drop the old single-arg signature so the new defaulted-arg version is the
-- only one (create-or-replace can't change a function's argument list).
drop function if exists decrement_stock_atomic(jsonb);

create or replace function decrement_stock_atomic(p_items jsonb, p_force boolean default false)
returns void
language plpgsql
as $$
declare
  item     jsonb;
  v_id     text;
  v_qty    int;
  v_avail  int;
  v_tracks boolean;
  v_status text;
  v_name   text;
begin
  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_id  := item->>'id';
    v_qty := (item->>'qty')::int;
    if v_id is null or v_qty is null or v_qty <= 0 then continue; end if;

    select track_stock, stock_qty, stock_status, name
      into v_tracks, v_avail, v_status, v_name
      from menu_items
     where id = v_id
       for update;
    if not found then continue; end if;

    -- Manual Status override wins on every channel. We only honour it when
    -- the row is NOT in track-quantity mode — once tracked, stock_qty is the
    -- single source of truth (a stale stock_status carried over from the
    -- previous mode must not block a sale). Skipped entirely under p_force.
    if not coalesce(v_tracks, false) and v_status = 'out_of_stock' then
      if p_force then continue; end if;   -- offline replay: accept, nothing to deduct
      raise exception 'INSUFFICIENT_STOCK %', v_id
        using detail = jsonb_build_object(
          'id',        v_id,
          'name',      coalesce(v_name, ''),
          'requested', v_qty,
          'available', 0
        )::text;
    end if;

    if not coalesce(v_tracks, false) then continue; end if;

    if coalesce(v_avail, 0) < v_qty and not p_force then
      raise exception 'INSUFFICIENT_STOCK %', v_id
        using detail = jsonb_build_object(
          'id',        v_id,
          'name',      coalesce(v_name, ''),
          'requested', v_qty,
          'available', coalesce(v_avail, 0)
        )::text;
    end if;

    -- Under p_force this may drive stock_qty negative — intentional (see header).
    update menu_items
       set stock_qty = stock_qty - v_qty
     where id = v_id;
  end loop;
end;
$$;

create or replace function restore_stock(p_items jsonb)
returns void
language plpgsql
as $$
declare
  item  jsonb;
  v_id  text;
  v_qty int;
begin
  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_id  := item->>'id';
    v_qty := (item->>'qty')::int;
    if v_id is null or v_qty is null or v_qty <= 0 then continue; end if;

    update menu_items
       set stock_qty = stock_qty + v_qty
     where id = v_id
       and track_stock = true;
  end loop;
end;
$$;

revoke all     on function decrement_stock_atomic(jsonb, boolean) from public, anon, authenticated;
revoke all     on function restore_stock(jsonb)                   from public, anon, authenticated;
grant execute  on function decrement_stock_atomic(jsonb, boolean) to service_role;
grant execute  on function restore_stock(jsonb)                   to service_role;


-- ── Store credit + coupon atomic mutations ───────────────────────────────────
-- Same rationale as the stock functions: the previous read-in-JS → write-back
-- pattern let two concurrent orders double-spend a customer's store credit (or
-- clobber the coupon counter / settings blob). These do the check + mutation in
-- a single atomic statement so concurrent callers can't both win.
--
-- Called from app/src/lib/storeCredit.ts via supabase.rpc().

-- Spend store credit. Single UPDATE guarded by `store_credit >= p_amount`, so a
-- concurrent spend that already drained the balance matches zero rows and the
-- function returns NULL (the caller treats NULL as "insufficient"). Returns the
-- new balance on success.
create or replace function spend_store_credit_atomic(p_customer_id text, p_amount numeric)
returns numeric
language sql
as $$
  update customers
     set store_credit = round((store_credit - p_amount)::numeric, 2)
   where id = p_customer_id
     and store_credit >= p_amount
  returning store_credit;
$$;

-- Add store credit back (compensation when a later gate fails, and reusable by
-- the refund / cancel restore paths). No guard — adding is always valid.
create or replace function add_store_credit_atomic(p_customer_id text, p_amount numeric)
returns numeric
language sql
as $$
  update customers
     set store_credit = round((store_credit + p_amount)::numeric, 2)
   where id = p_customer_id
  returning store_credit;
$$;

-- Atomically claim one use of a coupon. Locks the singleton app_settings row so
-- concurrent claims serialise (no lost update on the JSONB blob), and only
-- increments when the limit allows. Returns true if a use was claimed, false if
-- the coupon is at its usage limit (or not found). usageLimit = 0 means no limit.
create or replace function claim_coupon_usage(p_coupon_id text)
returns boolean
language plpgsql
as $$
declare
  v_data    jsonb;
  v_coupons jsonb;
  v_idx     int;
  v_coupon  jsonb;
  v_limit   numeric;
  v_count   numeric;
begin
  select data into v_data from app_settings where id = 1 for update;
  if v_data is null then return false; end if;

  v_coupons := coalesce(v_data->'coupons', '[]'::jsonb);

  -- Find the array index of the coupon with this id.
  v_idx := null;
  for i in 0 .. jsonb_array_length(v_coupons) - 1 loop
    if (v_coupons->i->>'id') = p_coupon_id then
      v_idx := i;
      v_coupon := v_coupons->i;
      exit;
    end if;
  end loop;
  if v_idx is null then return false; end if;

  v_limit := coalesce((v_coupon->>'usageLimit')::numeric, 0);
  v_count := coalesce((v_coupon->>'usageCount')::numeric, 0);

  -- A positive limit that's already reached ⇒ refuse to claim.
  if v_limit > 0 and v_count >= v_limit then
    return false;
  end if;

  -- Increment usageCount in place and persist the whole blob back atomically.
  v_coupon  := jsonb_set(v_coupon, '{usageCount}', to_jsonb(v_count + 1));
  v_coupons := jsonb_set(v_coupons, array[v_idx::text], v_coupon);
  update app_settings set data = jsonb_set(v_data, '{coupons}', v_coupons) where id = 1;
  return true;
end;
$$;

revoke all    on function spend_store_credit_atomic(text, numeric) from public, anon, authenticated;
revoke all    on function add_store_credit_atomic(text, numeric)   from public, anon, authenticated;
revoke all    on function claim_coupon_usage(text)                 from public, anon, authenticated;
grant execute on function spend_store_credit_atomic(text, numeric) to service_role;
grant execute on function add_store_credit_atomic(text, numeric)   to service_role;
grant execute on function claim_coupon_usage(text)                 to service_role;


-- Gift cards — code-based / transferable. Anyone holding the code can redeem,
-- regardless of which surface they're ordering from (online, POS, waiter).
-- See plan: code-based bearer model with gift_card_transactions ledger.
--
-- The buyer's account-bound `customers.gift_card_balance` column is left in
-- place but unused by Phase 1; the new `gift_cards.balance` is the canonical
-- per-code remaining amount. A future Phase 2 "claim to account" flow could
-- transfer between the two.
create table if not exists gift_cards (
  id                       text        primary key default gen_random_uuid()::text,
  code                     text        not null unique,
  initial_amount           numeric(10,2) not null check (initial_amount > 0),
  balance                  numeric(10,2) not null check (balance >= 0),
  status                   text        not null default 'active'
                                       check (status in ('inactive','active','redeemed','voided','expired')),
  issued_to_email          text,
  issued_to_name           text,
  -- Buyer attribution — set when the purchase was made by a logged-in customer.
  -- ON DELETE SET NULL so deleting a customer doesn't cascade-void their gifts.
  issued_by_customer_id    text        references customers(id) on delete set null,
  personal_message         text,
  expires_at               timestamptz,
  -- Links back to the payment_sessions row that created this card.
  stripe_payment_intent_id text        unique,
  delivered_at             timestamptz,
  created_at               timestamptz not null default now()
);

-- Case-insensitive code lookup. The redeem path normalises user input
-- (strip dashes, uppercase) before querying; this index lets the lookup
-- hit indexes even when the stored code is mixed-case or the user typed it
-- differently.
create unique index if not exists gift_cards_code_lower_unique
  on gift_cards (lower(code));

-- Sale attribution for gift cards (mirrors reservations.payment_method/_ref).
-- Online purchases: payment_method='stripe', payment_ref = PaymentIntent id.
-- Admin-issued sales: payment_method='cash'|'card', payment_ref='admin:cash'|'admin:card'.
-- Lets the finance reports book a gift card SALE as income and split it onto the
-- Online tab (gateway) vs the Admin tab (back-office), the same way VIP booking
-- fees are split. POS cannot issue gift cards, so there is no 'pos:' variant.
alter table gift_cards add column if not exists payment_method text;
alter table gift_cards add column if not exists payment_ref    text;

-- Pre-issued (inactive) gift card support. An inactive card is minted with a
-- value + code but NO payment, NO recipient — it sits UNREDEEMABLE until an
-- admin activates it at the point of physical sale. This is how physical cards
-- on a counter stay safe: a code copied off the rack is worthless because the
-- card holds no spendable balance until it's sold & activated.
-- activated_at stamps the sale moment so finance recognises the income in the
-- ACTIVATION period, not the (earlier) creation period — see
-- /api/admin/gift-cards/[id]/activate and /api/admin/gift-card-sales.
alter table gift_cards add column if not exists activated_at timestamptz;

-- Widen the status check to allow 'inactive' on already-created DBs (the inline
-- definition above only applies on a fresh install).
do $$
begin
  if exists (select 1 from information_schema.constraint_column_usage where constraint_name = 'gift_cards_status_check') then
    alter table gift_cards drop constraint gift_cards_status_check;
  end if;
  alter table gift_cards
    add constraint gift_cards_status_check check (status in ('inactive','active','redeemed','voided','expired'));
end $$;

-- Append-only audit log. Every state change on gift_cards (issue, redeem,
-- refund, void, adjust) produces one row here. Never updated, never deleted.
-- balance_after is a snapshot for reconciliation (without it you'd need to
-- replay every prior transaction to verify history).
create table if not exists gift_card_transactions (
  id              text        primary key default gen_random_uuid()::text,
  gift_card_id    text        not null references gift_cards(id) on delete cascade,
  type            text        not null check (type in ('issue','redeem','refund','void','adjust','activate')),
  amount          numeric(10,2) not null,
  balance_after   numeric(10,2) not null,
  -- Exactly one of order_id / pos_sale_id is set for redeem/refund rows;
  -- both null for issue/void/adjust.
  order_id        text,
  pos_sale_id     text,
  performed_by    text        not null default 'system',
  notes           text,
  created_at      timestamptz not null default now()
);

-- Widen the txn type check to allow 'activate' (the audit row written when an
-- inactive pre-issued card is sold & activated) on already-created DBs.
do $$
begin
  if exists (select 1 from information_schema.constraint_column_usage where constraint_name = 'gift_card_transactions_type_check') then
    alter table gift_card_transactions drop constraint gift_card_transactions_type_check;
  end if;
  alter table gift_card_transactions
    add constraint gift_card_transactions_type_check check (type in ('issue','redeem','refund','void','adjust','activate'));
end $$;

-- ── display_auth — Customer Display screen password ──────────────────────────
-- Single-row table (id=1) gating the public /customer-display order board.
--   • password_hash   NULL  = no password set → the display is OPEN (current
--                             behaviour). Non-null = a bcrypt hash; the screen
--                             must present /customer-display/login first.
--   • session_version is embedded in the display session token. Setting,
--     changing, or clearing the password bumps it, which invalidates every
--     live display session on its next poll (the only thing that logs a screen
--     out — display sessions otherwise never expire). Mirrors the staff
--     session_version pattern. Server-only: anon has no access (see RLS below),
--     so the hash is never readable from the browser. NEVER store this in
--     app_settings.data — that blob is read by the anon client on every page.
create table if not exists display_auth (
  id              integer primary key default 1,
  password_hash   text,
  session_version integer not null default 1,
  updated_at      timestamptz default now()
);

-- ── Gift card columns on consuming tables ────────────────────────────────────
-- Mirrors store_credit_used pattern. The stamp on the order/sale row is what
-- makes the redemption idempotent — see /api/gift-cards/[code]/redeem.
alter table orders     add column if not exists gift_card_id   text references gift_cards(id);
alter table orders     add column if not exists gift_card_used numeric(10,2) not null default 0;
alter table pos_sales  add column if not exists gift_card_id   text references gift_cards(id);
alter table pos_sales  add column if not exists gift_card_used numeric(10,2) not null default 0;


-- ── Service fee columns on consuming tables ───────────────────────────────────
-- For recording the non-refundable service fee collected on dine-in orders.
alter table pos_sales  add column if not exists service_fee_amount numeric not null default 0;

-- ── Offline POS terminal columns ─────────────────────────────────────────────
-- Populated for sales minted on a registered Android tablet (offline or online).
-- NULL for sales rung up on the online web POS, which doesn't register a
-- terminal — preserves identical semantics for existing reads.
--
--   terminal_id         FK to pos_terminals; on terminal deactivation we set
--                       null rather than cascade, so audit / tax history survives
--                       a terminal's lifecycle.
--   client_created_at   when the sale was rung up on the tablet, vs. the
--                       server-side `created_at` which is the sync time. Admin
--                       reports / tax reconciliation use this for offline sales.
--   synced_at           when the row landed on the server. Defaults to now() so
--                       online inserts continue to behave the same; offline-then-
--                       synced rows record the moment of sync.
alter table pos_sales add column if not exists terminal_id        text references pos_terminals(id) on delete set null;
alter table pos_sales add column if not exists client_created_at  timestamptz;
alter table pos_sales add column if not exists synced_at          timestamptz default now();

create index if not exists idx_pos_sales_terminal_id
  on pos_sales (terminal_id) where terminal_id is not null;

-- ── Session versioning for staff roles ───────────────────────────────────────
-- Embedded in the HMAC session token so admin-initiated credential changes
-- (password/email) or deactivation immediately invalidate all live
-- sessions for that staff member. Bumped from the admin update endpoints;
-- verified server-side on every authed staff request in lib/auth.ts.
alter table drivers       add column if not exists session_version integer not null default 1;
alter table waiters       add column if not exists session_version integer not null default 1;
alter table kitchen_staff add column if not exists session_version integer not null default 1;
alter table pos_staff     add column if not exists session_version integer not null default 1;
-- Customers carry it too so an admin password reset (User Management → Set
-- password) invalidates the customer's live sessions on their next request.
alter table customers     add column if not exists session_version integer not null default 1;

-- ── waiters.role ─────────────────────────────────────────────────────────────
-- 'senior' (Senior / Head Waiter) gates voids, refunds, and bill discounts in
-- the /waiter app; 'waiter' is the default. Backfills existing deploys whose
-- waiters table predates this column.
alter table waiters add column if not exists role text not null default 'waiter';
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'waiters' and constraint_name = 'waiters_role_check'
  ) then
    alter table waiters add constraint waiters_role_check check (role in ('waiter','senior'));
  end if;
end $$;

-- ── payment_sessions: discriminator for non-order purchases ──────────────────
-- The same stash-then-webhook pattern now serves both order checkout AND gift
-- card purchase. kind='order' (default) keeps existing behaviour; kind='gift_card'
-- means the webhook should create a gift card instead of an order on success.
-- gift_card_payload carries the recipient details captured at purchase time so
-- the webhook can build the email without re-trusting the browser.
alter table payment_sessions
  add column if not exists kind text not null default 'order';
alter table payment_sessions
  add column if not exists gift_card_payload jsonb;
-- reservation_payload carries the booking details captured at payment time so
-- the webhook can create the reservation (and email the bill) without
-- re-trusting the browser — same role gift_card_payload plays for gift cards.
alter table payment_sessions
  add column if not exists reservation_payload jsonb;
-- Widen the kind check to allow reservation booking-fee payments. Drop the old
-- constraint (if present) and re-add the superset so re-running is idempotent.
do $$
begin
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'payment_sessions' and constraint_name = 'payment_sessions_kind_check'
  ) then
    alter table payment_sessions drop constraint payment_sessions_kind_check;
  end if;
  alter table payment_sessions
    add constraint payment_sessions_kind_check check (kind in ('order','gift_card','reservation'));
end $$;
-- Widen the status check to allow 'refunded_shortfall': the gift-card
-- double-spend guard marks a card-paid order session this way when the gift
-- card was drained by a concurrent order before capture — the charge is
-- auto-refunded and no order is created (see /api/webhooks/stripe). Drop the
-- old constraint (inline checks are named '<table>_<column>_check') and re-add
-- the superset so re-running is idempotent.
do $$
begin
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'payment_sessions' and constraint_name = 'payment_sessions_status_check'
  ) then
    alter table payment_sessions drop constraint payment_sessions_status_check;
  end if;
  alter table payment_sessions
    add constraint payment_sessions_status_check
      check (status in ('pending','succeeded','failed','expired','refunded_shortfall'));
end $$;
-- Drop the legacy CHECK that required order_payload always be set. With the
-- gift_card kind the order_payload is null and gift_card_payload is set.
-- (Postgres lets us add a not-null column with a default, then relax the
--  application-level requirement; we already allow order_payload nullable
--  semantically since gift card kind doesn't populate it.)
alter table payment_sessions
  alter column order_payload drop not null;

-- ── VIP tables + reservation booking fees ────────────────────────────────────
-- Backfills existing deploys whose dining_tables / reservations predate the VIP
-- feature. is_vip/vip_price mark a table as premium and set its booking fee;
-- the reservation columns record the fee actually collected. See the create
-- table blocks above for column semantics.
alter table dining_tables add column if not exists is_vip    boolean       not null default false;
alter table dining_tables add column if not exists vip_price numeric(10,2) not null default 0;

-- ── Floor-plan map coordinates ───────────────────────────────────────────────
-- Normalised 0..1 position of each table on the customer-facing floor-plan
-- image. NULL until an admin places the table in the floor-plan editor; such
-- tables fall back to the booking card list. The plan image URL itself lives in
-- app_settings.data.reservationSystem.floorPlanImageUrl (Storage bucket
-- "floor-plan"), not in this table.
alter table dining_tables add column if not exists pos_x real;
alter table dining_tables add column if not exists pos_y real;

-- ── Multiple named floor plans ───────────────────────────────────────────────
-- A restaurant can have several floor plans ("Ground Floor", "Rooftop", …),
-- stored as app_settings.data.reservationSystem.floorPlans. Each placed table
-- records which plan it sits on; NULL = placed before multi-floor support and
-- belongs to the first plan.
alter table dining_tables add column if not exists floor_plan_id text;
alter table reservations  add column if not exists vip_fee        numeric(10,2) not null default 0;
alter table reservations  add column if not exists payment_status text          not null default 'none';
alter table reservations  add column if not exists payment_method text;
alter table reservations  add column if not exists payment_ref    text;
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'reservations' and constraint_name = 'reservations_payment_status_check'
  ) then
    alter table reservations add constraint reservations_payment_status_check
      check (payment_status in ('none','paid'));
  end if;
end $$;


-- ── 3. Indexes ───────────────────────────────────────────────────────────────
-- Speeds up the queries the app actually runs (admin reports, KDS filters,
-- reservations lookup, driver dashboards).

create index if not exists idx_orders_customer_id    on orders(customer_id);
create index if not exists idx_orders_date           on orders(date desc);
create index if not exists idx_orders_status         on orders(status);
create index if not exists idx_orders_driver_id      on orders(driver_id) where driver_id is not null;
create index if not exists idx_orders_payment_status on orders(payment_status);
create index if not exists idx_orders_stripe_pi      on orders(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists idx_orders_paypal_order    on orders(paypal_order_id)          where paypal_order_id          is not null;
create index if not exists idx_orders_paypal_capture  on orders(paypal_capture_id)        where paypal_capture_id        is not null;
-- Outstanding driver cash: rows the admin "cash owed" view needs to scan.
-- Partial so it's cheap even on large orders tables.
create index if not exists idx_orders_driver_cash_outstanding
  on orders(driver_id)
  where cash_reconciled_at is null
    and payment_status = 'paid'
    and status = 'delivered'
    and driver_id is not null;
create index if not exists idx_menu_items_category   on menu_items(category_id);
create index if not exists idx_menu_items_channels   on menu_items using gin (channels);
create index if not exists idx_mimp_item             on menu_item_meal_periods(menu_item_id);
create index if not exists idx_mimp_period           on menu_item_meal_periods(meal_period_id);
create index if not exists idx_meal_periods_order    on meal_periods(sort_order);
create index if not exists idx_reservations_slot     on reservations(date, time);
create index if not exists idx_reservations_status   on reservations(status);
create index if not exists idx_pos_staff_active      on pos_staff(active) where active = true;
create index if not exists idx_pos_sales_date        on pos_sales(date desc);
create index if not exists idx_pos_sales_staff       on pos_sales(staff_id) where staff_id is not null;
create index if not exists idx_pos_sales_voided      on pos_sales(voided) where voided = true;
create index if not exists idx_pos_clock_staff_in    on pos_clock_entries(staff_id, clock_in desc);
create index if not exists idx_waiters_active        on waiters(active)   where active = true;
create index if not exists idx_kitchen_staff_active  on kitchen_staff(active) where active = true;
create index if not exists idx_collection_staff_active on collection_staff(active) where active = true;
create index if not exists idx_coupons_active        on coupons(active)   where active = true;
create index if not exists idx_payment_audit_time    on payment_audit_log(timestamp desc);
create index if not exists idx_payment_sessions_pi      on payment_sessions(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists idx_payment_sessions_paypal  on payment_sessions(paypal_order_id)          where paypal_order_id          is not null;
create index if not exists idx_payment_sessions_exp     on payment_sessions(expires_at);
create index if not exists idx_payment_sessions_kind    on payment_sessions(kind);
create index if not exists idx_gift_cards_status        on gift_cards(status);
create index if not exists idx_gift_cards_issued_by     on gift_cards(issued_by_customer_id) where issued_by_customer_id is not null;
create index if not exists idx_gift_cards_stripe_pi     on gift_cards(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists idx_gift_card_txns_card      on gift_card_transactions(gift_card_id);
create index if not exists idx_gift_card_txns_order     on gift_card_transactions(order_id) where order_id is not null;
create index if not exists idx_gift_card_txns_pos_sale  on gift_card_transactions(pos_sale_id) where pos_sale_id is not null;
create index if not exists idx_orders_gift_card_id      on orders(gift_card_id) where gift_card_id is not null;
create index if not exists idx_pos_sales_gift_card_id   on pos_sales(gift_card_id) where gift_card_id is not null;


-- ── 4. RLS — enable + policies ───────────────────────────────────────────────

-- 4a. Enable RLS on every table.
alter table app_settings           enable row level security;
alter table categories             enable row level security;
alter table menu_items             enable row level security;
alter table customers              enable row level security;
alter table orders                 enable row level security;
alter table dine_in_tickets        enable row level security;
alter table drivers                enable row level security;
alter table reservations           enable row level security;
alter table reservation_customers  enable row level security;
alter table reservation_waitlist   enable row level security;
alter table pos_staff              enable row level security;
alter table pos_sales              enable row level security;
alter table pos_clock_entries      enable row level security;
alter table pos_terminals          enable row level security;
alter table pos_device_tokens      enable row level security;
alter table waiters                enable row level security;
alter table kitchen_staff          enable row level security;
alter table collection_staff       enable row level security;
alter table coupons                enable row level security;
alter table payment_audit_log      enable row level security;
alter table payment_sessions       enable row level security;
alter table dining_tables          enable row level security;
alter table meal_periods           enable row level security;
alter table menu_item_meal_periods enable row level security;
alter table gift_cards             enable row level security;
alter table gift_card_transactions enable row level security;
alter table display_auth           enable row level security;

-- 4b. Read policies for anon. Public catalog tables are readable so the
-- storefront can render without a session; everything that holds customer
-- PII or operational records is locked behind the service-role API layer.
drop policy if exists "anon_select_settings"       on app_settings;
create policy "anon_select_settings"
  on app_settings for select to anon using (true);

drop policy if exists "anon_select_categories"     on categories;
create policy "anon_select_categories"
  on categories for select to anon using (true);

drop policy if exists "anon_select_menu_items"     on menu_items;
create policy "anon_select_menu_items"
  on menu_items for select to anon using (true);

drop policy if exists "anon_select_dining_tables"  on dining_tables;
create policy "anon_select_dining_tables"
  on dining_tables for select to anon using (true);

drop policy if exists "anon_select_meal_periods"   on meal_periods;
create policy "anon_select_meal_periods"
  on meal_periods for select to anon using (true);

drop policy if exists "anon_select_mimp"           on menu_item_meal_periods;
create policy "anon_select_mimp"
  on menu_item_meal_periods for select to anon using (true);

-- 4b-i. Deny anon select on PII-carrying tables (F-DATA-1 fix).
-- Replaces the prior `using (true)` policies which let any anon caller read
-- every customer's name/email/phone/address and every order. All reads now
-- go through service-role API routes (lib/supabaseAdmin) that enforce
-- per-role authorization (customer session, admin cookie, etc.).
drop policy if exists "anon_select_customers"      on customers;
drop policy if exists "anon_select_orders"         on orders;
drop policy if exists "anon_select_reservations"   on reservations;
-- Drop the deny_anon_select policies too before re-creating, so a re-run of
-- this schema is idempotent (Postgres has no CREATE POLICY IF NOT EXISTS).
drop policy if exists "deny_anon_select"           on customers;
drop policy if exists "deny_anon_select"           on orders;
drop policy if exists "deny_anon_select"           on reservations;
create policy "deny_anon_select" on customers     for select to anon using (false);
create policy "deny_anon_select" on orders        for select to anon using (false);
create policy "deny_anon_select" on reservations  for select to anon using (false);

-- 4c. Write policies for anon — none, except waitlist signup.
-- Belt-and-suspenders drops for any DB that picked up stray policies from
-- earlier migrations.
drop policy if exists "anon_insert_orders"    on orders;
drop policy if exists "anon_insert_customers" on customers;
drop policy if exists "anon_update_customers" on customers;

drop policy if exists "anon_insert_waitlist"      on reservation_waitlist;
create policy "anon_insert_waitlist"
  on reservation_waitlist for insert to anon with check (true);

drop policy if exists "deny_anon_select_waitlist" on reservation_waitlist;
create policy "deny_anon_select_waitlist"
  on reservation_waitlist for select to anon using (false);

-- 4d. Deny-anon policies on the staff/auth/audit tables.
-- service_role bypasses RLS, so this only locks out the browser-facing client.
drop policy if exists "deny_anon_all" on drivers;
create policy "deny_anon_all" on drivers
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on pos_staff;
create policy "deny_anon_all" on pos_staff
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on dine_in_tickets;
create policy "deny_anon_all" on dine_in_tickets
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on pos_sales;
create policy "deny_anon_all" on pos_sales
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on pos_clock_entries;
create policy "deny_anon_all" on pos_clock_entries
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on pos_terminals;
create policy "deny_anon_all" on pos_terminals
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on pos_device_tokens;
create policy "deny_anon_all" on pos_device_tokens
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on waiters;
create policy "deny_anon_all" on waiters
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on kitchen_staff;
create policy "deny_anon_all" on kitchen_staff
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on coupons;
create policy "deny_anon_all" on coupons
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on payment_audit_log;
create policy "deny_anon_all" on payment_audit_log
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on payment_sessions;
create policy "deny_anon_all" on payment_sessions
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on gift_cards;
create policy "deny_anon_all" on gift_cards
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on gift_card_transactions;
create policy "deny_anon_all" on gift_card_transactions
  for all to anon using (false) with check (false);

-- display_auth holds the Customer Display password hash — anon must never read
-- or write it. Only the service-role API layer touches this table.
drop policy if exists "deny_anon_all" on display_auth;
create policy "deny_anon_all" on display_auth
  for all to anon using (false) with check (false);


-- ── 5. Grants ────────────────────────────────────────────────────────────────
-- Supabase applies the base grants below automatically at project creation,
-- but a full DB reset (e.g. dropping the public schema) wipes them and leaves
-- every role with "permission denied for table X". Re-applying here keeps
-- the schema self-contained and survives a reset.

grant usage on schema public to anon, authenticated, service_role;

grant all    on all tables    in schema public to service_role;
grant all    on all sequences in schema public to service_role;
grant select on all tables    in schema public to anon, authenticated;
grant insert on reservation_waitlist           to anon, authenticated;

alter default privileges in schema public grant all    on tables    to service_role;
alter default privileges in schema public grant all    on sequences to service_role;
alter default privileges in schema public grant select on tables    to anon, authenticated;

-- Column-level grants on customers — the only way to actually keep secrets
-- (password_hash, reset_token, email_verification_token) out of the browser.
-- Postgres ignores column-level REVOKEs when a table-level GRANT exists, so
-- we first take the table-level grant back and then re-grant only the safe
-- columns. service_role bypasses both and retains full access.
revoke select on customers from anon, authenticated;
grant select
  (id, name, email, phone, created_at, tags, favourites,
   saved_addresses, store_credit, email_verified)
  on customers to anon, authenticated;

-- Other staff/audit tables don't need column-level grants because the RLS
-- deny_anon_all policies above already block every anon/authenticated read.
-- These column-level revokes remain as a third line of defence in case a
-- future policy mistakenly loosens the RLS.
revoke select (password_hash) on pos_staff     from anon, authenticated;
revoke select (pin_hash)      on pos_staff     from anon, authenticated;
revoke select (password_hash) on waiters       from anon, authenticated;
revoke select (password_hash) on kitchen_staff from anon, authenticated;
revoke select (password_hash) on drivers       from anon, authenticated;
revoke select (reset_token)         on drivers from anon, authenticated;
revoke select (reset_token_expires) on drivers from anon, authenticated;
revoke select (password_hash) on display_auth  from anon, authenticated;
revoke select (token_hash)    on pos_device_tokens from anon, authenticated;


-- ── 6. Sentinel rows ─────────────────────────────────────────────────────────
-- app_settings row id=1 must exist for the UPSERT pattern in /api/admin/settings
-- to behave correctly on a fresh install. Populated with an empty data blob
-- here; the settings seed script fills in defaults (theme, restaurant info,
-- email templates, etc.) on top.
insert into app_settings (id, data) values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- display_auth row id=1 must exist for the password set/clear UPSERT. Starts
-- with a null password_hash, i.e. the Customer Display is OPEN until an admin
-- sets a password in Admin → Operations → Customer Display Access.
insert into display_auth (id, password_hash, session_version) values (1, null, 1)
on conflict (id) do nothing;

-- The 'pos-walk-in' synthetic customer is an FK-only sentinel row. POS-placed
-- orders (and waiter / dine-in orders) write customer_id = 'pos-walk-in' so
-- they satisfy the orders.customer_id foreign key — these orders have no real
-- registered customer behind them. This row MUST exist before any POS or
-- waiter order is inserted.
--
-- IMPORTANT: this sentinel is internal plumbing only. It must NEVER appear
-- in the admin "Customers" list, in customer-search results, in marketing
-- exports, in loyalty reports, etc. The admin customer-list endpoint
-- (app/src/app/api/admin/customers/list/route.ts) filters out id = 'pos-walk-in'
-- before returning rows; any new code that lists customers must do the same.
-- The email is a non-routable internal address (no MX); login as this row
-- is also blocked because password_hash is null.
insert into customers (id, name, email, phone, tags, favourites, saved_addresses, store_credit)
values ('pos-walk-in', 'POS Walk-in', 'pos-walkin@internal', '', '{}', '{}', '[]', 0)
on conflict (id) do nothing;


-- ── 7. Realtime publications ─────────────────────────────────────────────────
-- Tables that drive live subscriptions (postgres_changes) in the client.
-- Staff / coupon / audit tables are intentionally NOT in the publication —
-- they hold secrets (pin_hash) or admin-only data, and Realtime broadcasts
-- the full row to every subscriber regardless of column-level grants.
-- Customers is published with a column list so password_hash, reset_token,
-- and email_verification_token are never broadcast.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'app_settings', 'categories', 'menu_items',
      'orders', 'drivers',
      'reservations', 'reservation_customers',
      'dining_tables',
      'meal_periods', 'menu_item_meal_periods'
    ]
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;

-- customers: re-publish with an explicit column list so the realtime stream
-- never includes auth secrets. Drop and re-add to apply the column filter
-- even if the table is already in the publication from an older migration.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'customers'
    ) then
      alter publication supabase_realtime drop table customers;
    end if;
    alter publication supabase_realtime add table customers
      (id, name, email, phone, created_at, tags, favourites,
       saved_addresses, store_credit, email_verified,
       loyalty_points, gift_card_balance, notes);
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- Loyalty rewards program (McDonald's-style: points buy reward items, not money)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Two tables + one atomic function:
--   loyalty_rewards       — the reward catalog (point-priced menu items)
--   loyalty_transactions  — append-only ledger of every points movement
--   apply_loyalty_points  — the ONLY way points move. Row-locks the customer,
--                           enforces/clamps the balance, dedupes per order/sale,
--                           and writes the ledger row + cached balance in one
--                           transaction. Fixes the lost-update races the old
--                           read-modify-write JS code had.
--
-- customers.loyalty_points stays as the cached balance every existing surface
-- reads; the ledger is the audit trail and powers the customer History screen.

-- Reward catalog. Each reward is a free menu item priced in points. Image /
-- live availability come from the joined menu_items row at render time, so
-- menu edits propagate automatically. ON DELETE CASCADE: deleting the menu
-- item retires the reward.
create table if not exists loyalty_rewards (
  id           text        primary key default gen_random_uuid()::text,
  menu_item_id text        not null references menu_items(id) on delete cascade,
  -- Optional display overrides; empty string = use the menu item's own.
  name         text        not null default '',
  description  text        not null default '',
  points_cost  integer     not null check (points_cost > 0),
  active       boolean     not null default true,
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now()
);

-- Points ledger. `points` is signed: positive = credit (earn, redeem_reversal,
-- adjust up), negative = debit (redeem, earn_reversal, adjust down).
-- balance_after snapshots the cached balance after this row applied.
create table if not exists loyalty_transactions (
  id            text        primary key default gen_random_uuid()::text,
  customer_id   text        not null references customers(id) on delete cascade,
  type          text        not null check (type in
                  ('earn','redeem','earn_reversal','redeem_reversal','adjust','expire')),
  points        integer     not null,
  balance_after integer     not null,
  order_id      text,
  pos_sale_id   text,
  reward_id     text        references loyalty_rewards(id) on delete set null,
  note          text        not null default '',
  -- Legacy column from before lot-based expiry; the live expiry date now lives
  -- on loyalty_lots.expires_at, not here. Kept for backwards compatibility.
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
-- Older deploys created loyalty_transactions before 'expire' existed; widen the
-- check constraint in place so the FIFO sweep can write expiry rows.
do $$ begin
  alter table loyalty_transactions drop constraint if exists loyalty_transactions_type_check;
  alter table loyalty_transactions add  constraint loyalty_transactions_type_check
    check (type in ('earn','redeem','earn_reversal','redeem_reversal','adjust','expire'));
end $$;

create index if not exists idx_loyalty_txns_customer on loyalty_transactions(customer_id, created_at desc);
create index if not exists idx_loyalty_txns_order    on loyalty_transactions(order_id)    where order_id    is not null;
create index if not exists idx_loyalty_txns_pos_sale on loyalty_transactions(pos_sale_id) where pos_sale_id is not null;
create index if not exists idx_loyalty_rewards_item  on loyalty_rewards(menu_item_id);

-- ── Points lots (FIFO expiry) ────────────────────────────────────────────────
-- Every credit (earn / redeem_reversal / positive adjust) opens a *lot*: a
-- bucket of points with its own expiry. Debits (redeem / earn_reversal / negative
-- adjust / expire) consume lots SOONEST-EXPIRY-FIRST, so the points a customer is
-- about to lose are always spent before longer-lived ones. customers.loyalty_points
-- is the cached sum of every lot's points_remaining that has not yet expired.
--
--   expires_at NULL  → never expires (grandfathered balances, or expiry disabled
--                      when loyaltyPointsExpiryMonths is 0/unset at earn time).
--
-- This resolves the "which earning did a redemption come from?" ambiguity by
-- policy: redemptions drain the oldest-expiring lot first (FIFO).
create table if not exists loyalty_lots (
  id                 text        primary key default gen_random_uuid()::text,
  customer_id        text        not null references customers(id) on delete cascade,
  points_total       integer     not null check (points_total > 0),
  points_remaining   integer     not null check (points_remaining >= 0 and points_remaining <= points_total),
  source_order_id    text,
  source_pos_sale_id text,
  note               text        not null default '',
  earned_at          timestamptz not null default now(),
  expires_at         timestamptz,            -- null = never expires
  created_at         timestamptz not null default now()
);
-- FIFO consumption order: soonest expiry first, never-expiring (null) last.
create index if not exists idx_loyalty_lots_fifo  on loyalty_lots(customer_id, expires_at asc nulls last, earned_at asc) where points_remaining > 0;
-- Sweep lookup: live lots that have a due expiry.
create index if not exists idx_loyalty_lots_sweep on loyalty_lots(expires_at) where points_remaining > 0 and expires_at is not null;

-- Grandfather existing balances: every customer who already holds points (and has
-- no lots yet) gets one never-expiring lot for their current balance, so the
-- cached customers.loyalty_points stays exactly in sync with the new lot model.
-- Idempotent — a customer with any lot is skipped.
insert into loyalty_lots (customer_id, points_total, points_remaining, note, expires_at)
select id, loyalty_points, loyalty_points, 'Grandfathered balance (pre-expiry)', null
  from customers
 where coalesce(loyalty_points, 0) > 0
   and not exists (select 1 from loyalty_lots l where l.customer_id = customers.id);

-- Redemption stamp on orders — which reward this order carries and what it
-- cost in points. Mirrors the gift_card_id / gift_card_used pattern.
alter table orders add column if not exists loyalty_reward_id    text references loyalty_rewards(id) on delete set null;
alter table orders add column if not exists loyalty_points_spent integer not null default 0;

-- Expire a single customer's due lots in one shot: zero every lot whose
-- expires_at has passed, drop the cached balance by the same amount, and write
-- ONE 'expire' ledger row. Returns the points expired (0 if none). The caller
-- MUST already hold the customer row lock (apply_loyalty_points / the sweep do).
-- Idempotent: once a lot's points_remaining hits 0 it is never revisited.
create or replace function _expire_loyalty_lots(p_customer_id text)
returns integer
language plpgsql
as $$
declare
  v_expired integer;
  v_balance integer;
begin
  select coalesce(sum(points_remaining), 0) into v_expired
    from loyalty_lots
   where customer_id = p_customer_id
     and points_remaining > 0
     and expires_at is not null
     and expires_at <= now();

  if v_expired <= 0 then
    return 0;
  end if;

  update loyalty_lots
     set points_remaining = 0
   where customer_id = p_customer_id
     and points_remaining > 0
     and expires_at is not null
     and expires_at <= now();

  update customers
     set loyalty_points = greatest(coalesce(loyalty_points, 0) - v_expired, 0)
   where id = p_customer_id
   returning loyalty_points into v_balance;

  -- note left blank: the UI labels `expire` rows "Points expired" already, so a
  -- note here would render the phrase twice ("Points expired - Points expired").
  insert into loyalty_transactions
    (customer_id, type, points, balance_after, note)
  values
    (p_customer_id, 'expire', -v_expired, coalesce(v_balance, 0), '');

  return v_expired;
end;
$$;

-- The single atomic mutation for loyalty points (FIFO lot model).
--   p_delta       signed points to apply.
--   p_expires_at  expiry stamped on the lot a CREDIT opens (null = never).
--   p_enforce     true  → fail with 'insufficient' if balance + delta < 0 (redeem).
--                 false → clamp the debit so the balance floors at 0 (reversals).
-- A positive delta opens a lot; a negative delta drains lots soonest-expiry-first.
-- Before anything is applied the customer's due lots are expired in-line, so the
-- cached balance is always current for active customers (the cron sweep covers
-- dormant ones). Dedupe: for types earn / redeem / redeem_reversal a second call
-- with the same order_id (or pos_sale_id) is a no-op success — this is what makes
-- webhook retries and POS outbox replays safe. earn_reversal / adjust / expire are
-- intentionally NOT deduped (an order can take several partial refunds); their
-- callers compute the remaining-reversible amount from the ledger first.
drop function if exists apply_loyalty_points(text, integer, text, text, text, text, text, boolean);
create or replace function apply_loyalty_points(
  p_customer_id text,
  p_delta       integer,
  p_type        text,
  p_order_id    text default null,
  p_pos_sale_id text default null,
  p_reward_id   text default null,
  p_note        text default '',
  p_enforce     boolean default false,
  p_expires_at  timestamptz default null
) returns jsonb
language plpgsql
as $$
declare
  v_balance   integer;
  v_applied   integer;
  v_remaining integer;
  v_take      integer;
  r           record;
begin
  if p_delta = 0 then
    return jsonb_build_object('ok', true, 'applied', 0, 'duplicate', false);
  end if;

  -- Lock the customer row first: all concurrent loyalty ops on this customer
  -- serialise here, which also makes the dedupe + FIFO drain below race-free.
  select loyalty_points into v_balance
    from customers where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Expire-on-touch: clear any due lots before reading the working balance.
  perform _expire_loyalty_lots(p_customer_id);
  select coalesce(loyalty_points, 0) into v_balance from customers where id = p_customer_id;

  if p_type in ('earn','redeem','redeem_reversal') then
    if (p_order_id is not null and exists (
          select 1 from loyalty_transactions
          where order_id = p_order_id and type = p_type))
    or (p_pos_sale_id is not null and exists (
          select 1 from loyalty_transactions
          where pos_sale_id = p_pos_sale_id and type = p_type)) then
      return jsonb_build_object('ok', true, 'applied', 0, 'duplicate', true, 'balance', v_balance);
    end if;
  end if;

  if p_delta > 0 then
    -- CREDIT: open a lot. The cached balance equals Σ(live lot remainders), so
    -- adding a lot and bumping the cache keeps the invariant.
    v_applied := p_delta;
    insert into loyalty_lots
      (customer_id, points_total, points_remaining, source_order_id, source_pos_sale_id, note, expires_at)
    values
      (p_customer_id, v_applied, v_applied, p_order_id, p_pos_sale_id, coalesce(p_note, ''), p_expires_at);
  else
    -- DEBIT: drain live lots soonest-expiry-first (FIFO).
    if p_enforce and v_balance + p_delta < 0 then
      return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', v_balance);
    end if;
    v_applied := p_delta;
    if not p_enforce then
      v_applied := greatest(p_delta, -v_balance);  -- clamp: never go negative
    end if;
    if v_applied = 0 then
      return jsonb_build_object('ok', true, 'applied', 0, 'duplicate', false, 'balance', v_balance);
    end if;

    v_remaining := -v_applied;  -- positive amount still to consume
    for r in
      select id, points_remaining
        from loyalty_lots
       where customer_id = p_customer_id
         and points_remaining > 0
         and (expires_at is null or expires_at > now())
       order by expires_at asc nulls last, earned_at asc, id asc
       for update
    loop
      exit when v_remaining <= 0;
      v_take := least(r.points_remaining, v_remaining);
      update loyalty_lots set points_remaining = points_remaining - v_take where id = r.id;
      v_remaining := v_remaining - v_take;
    end loop;
  end if;

  update customers set loyalty_points = v_balance + v_applied where id = p_customer_id;

  insert into loyalty_transactions
    (customer_id, type, points, balance_after, order_id, pos_sale_id, reward_id, note)
  values
    (p_customer_id, p_type, v_applied, v_balance + v_applied,
     p_order_id, p_pos_sale_id, p_reward_id, coalesce(p_note, ''));

  return jsonb_build_object('ok', true, 'applied', v_applied, 'duplicate', false, 'balance', v_balance + v_applied);
end;
$$;

-- Global sweep — expire due lots for EVERY customer that has one. Locks each
-- customer row before expiring (serialising with apply_loyalty_points), so it is
-- safe to run alongside live traffic. Scheduled daily by pg_cron (see the
-- cron.schedule block below).
create or replace function expire_loyalty_points()
returns jsonb
language plpgsql
as $$
declare
  r           record;
  v_points    integer;
  v_total     integer := 0;
  v_customers integer := 0;
begin
  for r in
    select distinct customer_id
      from loyalty_lots
     where points_remaining > 0
       and expires_at is not null
       and expires_at <= now()
  loop
    perform 1 from customers where id = r.customer_id for update;
    v_points := _expire_loyalty_lots(r.customer_id);
    if v_points > 0 then
      v_total     := v_total + v_points;
      v_customers := v_customers + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'customers', v_customers, 'points', v_total);
end;
$$;

revoke all    on function apply_loyalty_points(text, integer, text, text, text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function apply_loyalty_points(text, integer, text, text, text, text, text, boolean, timestamptz) to service_role;
revoke all    on function _expire_loyalty_lots(text)   from public, anon, authenticated;
grant execute on function _expire_loyalty_lots(text)   to service_role;
revoke all    on function expire_loyalty_points()      from public, anon, authenticated;
grant execute on function expire_loyalty_points()      to service_role;

-- ── Daily expiry sweep schedule (Supabase pg_cron) ───────────────────────────
-- Runs expire_loyalty_points() every day at 00:05 UTC so DORMANT customers' due
-- lots are cleared even if they never transact (active customers are expired
-- in-line by apply_loyalty_points). This is the whole scheduler — no web server,
-- no HTTP route and no CRON_SECRET are involved; pg_cron calls the function
-- directly inside Postgres.
--
-- NO-OP until the pg_cron extension is enabled. Enable it ONCE in the Supabase
-- dashboard (Database → Extensions → "pg_cron"), then re-run this schema. The
-- block is idempotent — it replaces any prior job of the same name.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'loyalty-expiry-daily') then
      perform cron.unschedule('loyalty-expiry-daily');
    end if;
    perform cron.schedule('loyalty-expiry-daily', '5 0 * * *', 'select expire_loyalty_points();');
  end if;
end $$;

-- RLS — all three tables are server-route only (service role); anon gets nothing.
alter table loyalty_rewards      enable row level security;
alter table loyalty_transactions enable row level security;
alter table loyalty_lots         enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'loyalty_rewards' and policyname = 'deny_anon_all') then
    create policy "deny_anon_all" on loyalty_rewards      for all to anon using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'loyalty_transactions' and policyname = 'deny_anon_all') then
    create policy "deny_anon_all" on loyalty_transactions for all to anon using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'loyalty_lots' and policyname = 'deny_anon_all') then
    create policy "deny_anon_all" on loyalty_lots         for all to anon using (false) with check (false);
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- Digital signage / menu boards (public TV poster displays)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Each row is one display with its own public URL: /display/<slug>. A display
-- carries an ordered list of poster images in the `slides` JSONB column
-- ([{id,imageUrl,order,enabled}], mirroring app_settings.data.footerLogos). One
-- enabled slide → a static fullscreen poster; several → an auto-looping
-- slideshow. The public /display/<slug> page is unauthenticated (the middleware
-- matcher does NOT cover /display); it reads through the service-role API layer
-- (api/signage/[slug]), while admin CRUD goes through api/admin/signage. Poster
-- image files live in the lazily-created `signage-images` storage bucket — only
-- the short public URL is stored here.

create table if not exists signage_displays (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null,
  active      boolean     not null default true,
  slides      jsonb       not null default '[]',      -- [{id,imageUrl,order,enabled}]
  interval_ms integer     not null default 8000,      -- ms each slide is shown
  transition  text        not null default 'fade',    -- 'fade' | 'none'
  fit         text        not null default 'contain', -- 'contain' | 'cover'
  background  text        not null default '#000000',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Slug is the public URL key — unique, case-insensitively.
create unique index if not exists signage_displays_slug_lower_unique
  on signage_displays (lower(slug));

-- RLS — server-route only (service role); anon (the browser client) gets
-- nothing. The public display page reads via the service-role API, so even the
-- unauthenticated TV never touches this table directly.
alter table signage_displays enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'signage_displays' and policyname = 'deny_anon_all') then
    create policy "deny_anon_all" on signage_displays for all to anon using (false) with check (false);
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- Verification queries (paste these separately after running the above):
--
--   -- new tables present?
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('pos_staff','waiters','kitchen_staff','coupons',
--                        'payment_audit_log','dining_tables')
--   order by table_name;
--
--   -- meal-period tables present?
--   select count(*) from meal_periods;
--   select count(*) from menu_item_meal_periods;
--
--   -- sentinel rows?
--   select id from app_settings;            -- expect 1
--   select id, email from customers where id = 'pos-walk-in';
--
--   -- realtime tables?
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
-- ═══════════════════════════════════════════════════════════════════════════════
