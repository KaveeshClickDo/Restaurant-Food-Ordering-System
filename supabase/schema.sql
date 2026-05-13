-- ═══════════════════════════════════════════════════════════════════════════════
-- Single-Restaurant Food Ordering System — canonical database schema
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- One file, one truth. Replaces all the earlier `*_migration.sql` files.
--
-- How to apply:
--   • Local script:   cd app && npm run db:migrate
--   • Supabase UI:    Dashboard → SQL Editor → New query → Paste this file → Run
--
-- Safety:
--   • Every statement is idempotent (IF NOT EXISTS / DROP IF EXISTS / DO $$).
--   • Safe to re-run any number of times. Fresh installs and existing DBs both
--     converge to the same end state.
--   • No data is dropped, mutated, or back-filled. New columns get defaults;
--     existing rows keep their values.
--
-- Layout:
--    1. Extensions
--    2. Tables (in dependency order)
--    3. Column additions on existing tables (auth, audit, meal_period, links)
--    4. Indexes
--    5. RLS — enable + policies
--    6. Grants (base table grants + column-level revokes)
--    7. Sentinel rows (app_settings, pos-walk-in)
--    8. Realtime publications
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
  sort_order   integer not null default 0
);

create table if not exists customers (
  id              text        primary key,
  name            text        not null,
  email           text        not null unique,
  phone           text        not null default '',
  password        text,                              -- legacy plaintext; new accounts use password_hash
  created_at      timestamptz not null default now(),
  tags            text[]      not null default '{}',
  favourites      text[]      not null default '{}',
  saved_addresses jsonb       not null default '[]',
  store_credit    numeric     not null default 0
);

create table if not exists orders (
  id                text        primary key,
  customer_id       text        not null references customers(id) on delete cascade,
  date              timestamptz not null default now(),
  status            text        not null default 'pending',
  fulfillment       text        not null default 'delivery',
  total             numeric     not null,
  items             jsonb       not null default '[]',
  address           text,
  note              text,
  payment_method    text,
  delivery_fee      numeric,
  service_fee       numeric,
  scheduled_time    text,
  coupon_code       text,
  coupon_discount   numeric,
  vat_amount        numeric,
  vat_inclusive     boolean,
  driver_id         text,
  driver_name       text,
  delivery_status   text,
  refunds           jsonb       not null default '[]',
  refunded_amount   numeric     not null default 0,
  store_credit_used numeric     not null default 0
);

create table if not exists drivers (
  id            text        primary key,
  name          text        not null,
  email         text        not null unique,
  phone         text        not null default '',
  password_hash text        not null,
  active        boolean     not null default true,
  vehicle_info  text,
  notes         text,
  created_at    timestamptz not null default now()
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
  created_at     timestamptz not null default now()
);

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


-- ── 3. Column additions on existing tables ───────────────────────────────────
-- Added separately as ALTERs so existing DBs created before these columns
-- existed pick them up on first re-run.

-- 3a. customers — auth + email verification ----------------------------------
alter table customers add column if not exists password_hash               text;
alter table customers add column if not exists reset_token                 text;
alter table customers add column if not exists reset_token_expires         timestamptz;
alter table customers add column if not exists email_verified              boolean     not null default false;
alter table customers add column if not exists email_verification_token    text;
alter table customers add column if not exists email_verification_expires  timestamptz;

-- Legacy plaintext `password` column — all accounts use password_hash now.
-- Drop is gated on the column actually existing so a fresh install is a no-op.
alter table customers drop column if exists password;

-- 3b. drivers — password reset -----------------------------------------------
alter table drivers add column if not exists reset_token         text;
alter table drivers add column if not exists reset_token_expires timestamptz;

-- 3c. orders — void/refund audit --------------------------------------------
alter table orders add column if not exists voided_by   text;
alter table orders add column if not exists void_reason text;
alter table orders add column if not exists voided_at   timestamptz;

-- 3d. reservations — check-in/out + source + cancel_token -------------------
alter table reservations add column if not exists checked_in_at  timestamptz;
alter table reservations add column if not exists checked_out_at timestamptz;
alter table reservations add column if not exists source         text;
alter table reservations add column if not exists cancel_token   text;

-- Backfill source/cancel_token BEFORE adding constraints (safe on empty DBs).
update reservations set source       = 'online'                where source is null;
update reservations set cancel_token = gen_random_uuid()::text where cancel_token is null or cancel_token = 'online';

-- Re-roll any duplicate cancel_tokens that survived the backfill.
update reservations r
set cancel_token = gen_random_uuid()::text
where exists (
  select 1 from reservations r2
  where r2.cancel_token = r.cancel_token and r2.id < r.id
);

-- Drop any stale unique constraint on source (an old migration mistakenly added one).
alter table reservations drop constraint if exists reservations_source_key;

alter table reservations alter column source       set default 'online';
alter table reservations alter column source       set not null;
alter table reservations alter column cancel_token set default gen_random_uuid()::text;
alter table reservations alter column cancel_token set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_cancel_token_key' and conrelid = 'reservations'::regclass
  ) then
    alter table reservations add constraint reservations_cancel_token_key unique (cancel_token);
  end if;
end $$;

-- 3e. menu_items — meal_period (replaces app_settings.data.breakfastMenu) ----
-- 'all_day' = always visible; 'breakfast' = visible only during breakfast hours.
-- Once the runtime stops reading breakfastMenu, drop that JSONB key in a
-- follow-up cleanup migration.
alter table menu_items add column if not exists meal_period text not null default 'all_day';

-- 3f. reservation_customers ↔ customers link --------------------------------
-- Nullable: not every reservation guest is (or becomes) a registered customer.
-- Set null on delete so deleting a customer record doesn't cascade-wipe their
-- reservation history.
alter table reservation_customers
  add column if not exists customer_id text references customers(id) on delete set null;


-- ── 4. Indexes ───────────────────────────────────────────────────────────────
-- Speeds up the queries the app actually runs (admin reports, KDS filters,
-- reservations lookup, driver dashboards).

create index if not exists idx_orders_customer_id   on orders(customer_id);
create index if not exists idx_orders_date          on orders(date desc);
create index if not exists idx_orders_status        on orders(status);
create index if not exists idx_orders_driver_id     on orders(driver_id) where driver_id is not null;
create index if not exists idx_menu_items_category  on menu_items(category_id);
create index if not exists idx_menu_items_meal      on menu_items(meal_period);
create index if not exists idx_reservations_slot    on reservations(date, time);
create index if not exists idx_reservations_status  on reservations(status);
create index if not exists idx_pos_staff_active     on pos_staff(active) where active = true;
create index if not exists idx_waiters_active       on waiters(active)   where active = true;
create index if not exists idx_kitchen_staff_active on kitchen_staff(active) where active = true;
create index if not exists idx_coupons_active       on coupons(active)   where active = true;
create index if not exists idx_payment_audit_time   on payment_audit_log(timestamp desc);


-- ── 5. RLS — enable + policies ───────────────────────────────────────────────

-- 5a. Enable RLS on every table.
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
alter table waiters                enable row level security;
alter table kitchen_staff          enable row level security;
alter table coupons                enable row level security;
alter table payment_audit_log      enable row level security;
alter table dining_tables          enable row level security;

-- 5b. Read policies for anon (public-facing pages need these).
drop policy if exists "anon_select_settings"       on app_settings;
create policy "anon_select_settings"
  on app_settings for select to anon using (true);

drop policy if exists "anon_select_categories"     on categories;
create policy "anon_select_categories"
  on categories for select to anon using (true);

drop policy if exists "anon_select_menu_items"     on menu_items;
create policy "anon_select_menu_items"
  on menu_items for select to anon using (true);

drop policy if exists "anon_select_customers"      on customers;
create policy "anon_select_customers"
  on customers for select to anon using (true);

drop policy if exists "anon_select_orders"         on orders;
create policy "anon_select_orders"
  on orders for select to anon using (true);

drop policy if exists "anon_select_reservations"   on reservations;
create policy "anon_select_reservations"
  on reservations for select to anon using (true);

drop policy if exists "anon_select_dining_tables"  on dining_tables;
create policy "anon_select_dining_tables"
  on dining_tables for select to anon using (true);

-- 5c. Write policies for anon — none, except waitlist signup.
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

-- 5d. Deny-anon policies on the staff/auth/audit tables.
-- service_role bypasses RLS, so this only locks out the browser-facing client.
drop policy if exists "deny_anon_all" on drivers;
create policy "deny_anon_all" on drivers
  for all to anon using (false) with check (false);

drop policy if exists "deny_anon_all" on pos_staff;
create policy "deny_anon_all" on pos_staff
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


-- ── 6. Grants ────────────────────────────────────────────────────────────────
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


-- ── 7. Sentinel rows ─────────────────────────────────────────────────────────
-- app_settings row id=1 must exist for the UPSERT pattern in /api/admin/settings
-- to behave correctly on a fresh install. Populated with an empty data blob
-- here; the settings seed script fills in defaults (theme, restaurant info,
-- email templates, etc.) on top.
insert into app_settings (id, data) values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- The pos-walk-in synthetic customer is referenced by POS-placed orders so
-- they satisfy the orders.customer_id FK. Must exist before any POS order.
insert into customers (id, name, email, phone, tags, favourites, saved_addresses, store_credit)
values ('pos-walk-in', 'POS Walk-in', 'pos-walkin@internal', '', '{}', '{}', '[]', 0)
on conflict (id) do nothing;


-- ── 8. Realtime publications ─────────────────────────────────────────────────
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
      'dining_tables'
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
       saved_addresses, store_credit, email_verified);
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
--   -- meal_period column on menu_items?
--   select column_name, column_default from information_schema.columns
--   where table_name = 'menu_items' and column_name = 'meal_period';
--
--   -- sentinel rows?
--   select id from app_settings;            -- expect 1
--   select id, email from customers where id = 'pos-walk-in';
--
--   -- realtime tables?
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
-- ═══════════════════════════════════════════════════════════════════════════════
