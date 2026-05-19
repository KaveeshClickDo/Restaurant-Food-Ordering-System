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
  sort_order integer not null default 0
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
  offer        jsonb
);

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
  customer_lng             double precision
);

-- Backfill for existing installs where the columns were not in the original CREATE.
alter table orders add column if not exists customer_lat double precision;
alter table orders add column if not exists customer_lng double precision;

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
-- counters, hashed PINs, and append-only audit semantics where applicable.

-- POS terminal staff (replaces app_settings.data.pos_staff).
-- PINs are bcrypt-hashed; the salt+hash live in pin_hash and never leave
-- the server. permissions is a free-form jsonb keyed by capability flags.
create table if not exists pos_staff (
  id            text        primary key default gen_random_uuid()::text,
  name          text        not null,
  email         text        not null default '',
  role          text        not null default 'cashier'
                check (role in ('admin','manager','cashier')),
  pin_hash      text        not null,
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
  pin_hash      text        not null,
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
  pin_hash      text        not null,
  active        boolean     not null default true,
  avatar_color  text        not null default '#dc2626',
  created_at    timestamptz not null default now()
);

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
  created_at  timestamptz not null default now()
);

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
  total           numeric     not null,
  payment_method  text        not null check (payment_method in ('cash','card','split')),
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
  created_at    timestamptz not null default now()
);

create table if not exists menu_item_meal_periods (
  menu_item_id    text not null references menu_items(id)   on delete cascade,
  meal_period_id  text not null references meal_periods(id) on delete cascade,
  primary key (menu_item_id, meal_period_id)
);


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
create index if not exists idx_menu_items_category   on menu_items(category_id);
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
create index if not exists idx_coupons_active        on coupons(active)   where active = true;
create index if not exists idx_payment_audit_time    on payment_audit_log(timestamp desc);
create index if not exists idx_payment_sessions_pi      on payment_sessions(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists idx_payment_sessions_paypal  on payment_sessions(paypal_order_id)          where paypal_order_id          is not null;
create index if not exists idx_payment_sessions_exp     on payment_sessions(expires_at);


-- ── 4. RLS — enable + policies ───────────────────────────────────────────────

-- 4a. Enable RLS on every table.
alter table app_settings           enable row level security;
alter table categories             enable row level security;
alter table menu_items             enable row level security;
alter table customers              enable row level security;
alter table orders                 enable row level security;
alter table drivers                enable row level security;
alter table reservations           enable row level security;
alter table reservation_customers  enable row level security;
alter table reservation_waitlist   enable row level security;
alter table pos_staff              enable row level security;
alter table pos_sales              enable row level security;
alter table pos_clock_entries      enable row level security;
alter table waiters                enable row level security;
alter table kitchen_staff          enable row level security;
alter table coupons                enable row level security;
alter table payment_audit_log      enable row level security;
alter table payment_sessions       enable row level security;
alter table dining_tables          enable row level security;
alter table meal_periods           enable row level security;
alter table menu_item_meal_periods enable row level security;

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

drop policy if exists "deny_anon_all" on pos_sales;
create policy "deny_anon_all" on pos_sales
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on pos_clock_entries;
create policy "deny_anon_all" on pos_clock_entries
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
revoke select (pin_hash)      on pos_staff     from anon, authenticated;
revoke select (pin_hash)      on waiters       from anon, authenticated;
revoke select (pin_hash)      on kitchen_staff from anon, authenticated;
revoke select (password_hash) on drivers       from anon, authenticated;
revoke select (reset_token)         on drivers from anon, authenticated;
revoke select (reset_token_expires) on drivers from anon, authenticated;


-- ── 6. Sentinel rows ─────────────────────────────────────────────────────────
-- app_settings row id=1 must exist for the UPSERT pattern in /api/admin/settings
-- to behave correctly on a fresh install. Populated with an empty data blob
-- here; the settings seed script fills in defaults (theme, restaurant info,
-- email templates, etc.) on top.
insert into app_settings (id, data) values (1, '{}'::jsonb)
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
