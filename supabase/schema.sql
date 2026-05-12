-- ═══════════════════════════════════════════════════════════════════════════════
-- Single-Restaurant Food Ordering System — canonical database schema
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- One file, one truth. Replaces all the earlier `*_migration.sql` files and the
-- inline base schema that used to live in app/migrate.mjs.
--
-- How to apply:
--   • Local script:   cd app && npm run db:migrate
--   • Supabase UI:    Dashboard → SQL Editor → New query → Paste this file → Run
--
-- Safety:
--   • Every statement is idempotent (IF NOT EXISTS / DROP IF EXISTS / DO $$).
--   • Safe to re-run any number of times. New deploys and existing DBs both
--     converge to the same end state.
--   • No data is dropped, mutated, or back-filled. New columns get defaults;
--     existing rows keep their values.
--
-- Layout:
--   1. Extensions
--   2. Tables (in dependency order)
--   3. Auth + email-verification columns on customers
--   4. Driver password-reset columns
--   5. Order audit columns (void, refund)
--   6. RLS — enable + policies
--   7. Column-level grants (strip sensitive columns from anon)
--   8. Sentinel rows (pos-walk-in)
--   9. Realtime publications
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── 1. Extensions ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;


-- ── 2. Tables ─────────────────────────────────────────────────────────────────

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


-- ── 3. Auth + email-verification columns on customers ────────────────────────
-- Added separately as ALTERs so existing DBs created before these columns
-- existed pick them up on first re-run.

alter table customers add column if not exists password_hash               text;
alter table customers add column if not exists reset_token                 text;
alter table customers add column if not exists reset_token_expires         timestamptz;
alter table customers add column if not exists email_verified              boolean     not null default false;
alter table customers add column if not exists email_verification_token    text;
alter table customers add column if not exists email_verification_expires  timestamptz;


-- ── 4. Driver password-reset columns ─────────────────────────────────────────
alter table drivers add column if not exists reset_token         text;
alter table drivers add column if not exists reset_token_expires timestamptz;


-- ── 5. Order audit + reservation v2 columns ──────────────────────────────────
-- Order void/refund metadata
alter table orders add column if not exists voided_by   text;
alter table orders add column if not exists void_reason text;
alter table orders add column if not exists voided_at   timestamptz;

-- Reservation check-in/out timestamps
alter table reservations add column if not exists checked_in_at  timestamptz;
alter table reservations add column if not exists checked_out_at timestamptz;

-- Reservation source attribution (online/walk-in/phone) and self-service cancel token
alter table reservations add column if not exists source       text;
alter table reservations add column if not exists cancel_token text;

-- Backfill source/cancel_token BEFORE adding constraints (safe on empty DBs too)
update reservations set source       = 'online'                where source is null;
update reservations set cancel_token = gen_random_uuid()::text where cancel_token is null or cancel_token = 'online';

-- Re-roll any duplicate cancel_tokens that survived the backfill
update reservations r
set cancel_token = gen_random_uuid()::text
where exists (
  select 1 from reservations r2
  where r2.cancel_token = r.cancel_token and r2.id < r.id
);

-- Drop any stale unique constraint on source (a previous migration mistakenly added one)
alter table reservations drop constraint if exists reservations_source_key;

-- Now apply defaults + NOT NULL + unique on cancel_token
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


-- ── 6. RLS — enable on every table ───────────────────────────────────────────
alter table app_settings           enable row level security;
alter table categories             enable row level security;
alter table menu_items             enable row level security;
alter table customers              enable row level security;
alter table orders                 enable row level security;
alter table drivers                enable row level security;
alter table reservations           enable row level security;
alter table reservation_customers  enable row level security;
alter table reservation_waitlist   enable row level security;

-- ── 6a. Read policies (anon SELECT where the browser needs it) ───────────────
drop policy if exists "anon_select_settings"     on app_settings;
create policy "anon_select_settings"
  on app_settings for select to anon using (true);

drop policy if exists "anon_select_categories"   on categories;
create policy "anon_select_categories"
  on categories for select to anon using (true);

drop policy if exists "anon_select_menu_items"   on menu_items;
create policy "anon_select_menu_items"
  on menu_items for select to anon using (true);

drop policy if exists "anon_select_customers"    on customers;
create policy "anon_select_customers"
  on customers for select to anon using (true);

drop policy if exists "anon_select_orders"       on orders;
create policy "anon_select_orders"
  on orders for select to anon using (true);

drop policy if exists "anon_select_reservations" on reservations;
create policy "anon_select_reservations"
  on reservations for select to anon using (true);

-- ── 6b. Write policies — none for anon ────────────────────────────────────────
-- Absence of a policy = deny. The following drops are belt-and-suspenders for
-- any DB that picked up stray policies from earlier migrations.
drop policy if exists "anon_insert_orders"    on orders;
drop policy if exists "anon_insert_customers" on customers;
drop policy if exists "anon_update_customers" on customers;

-- ── 6c. drivers — no anon access at all ──────────────────────────────────────
drop policy if exists "deny_anon_all" on drivers;
create policy "deny_anon_all"
  on drivers for all
  to anon
  using (false) with check (false);

-- ── 6d. reservation_waitlist — anon may sign up, never read ──────────────────
drop policy if exists "anon_insert_waitlist"      on reservation_waitlist;
create policy "anon_insert_waitlist"
  on reservation_waitlist for insert to anon with check (true);

drop policy if exists "deny_anon_select_waitlist" on reservation_waitlist;
create policy "deny_anon_select_waitlist"
  on reservation_waitlist for select to anon using (false);


-- ── 7. Column-level grants ───────────────────────────────────────────────────
-- RLS controls rows; column access is granted/revoked separately. The service
-- role bypasses both and retains full access — these revokes only affect anon.
revoke select (password)                   on customers from anon;
revoke select (password_hash)              on customers from anon;
revoke select (reset_token)                on customers from anon;
revoke select (reset_token_expires)        on customers from anon;
revoke select (email_verification_token)   on customers from anon;
revoke select (email_verification_expires) on customers from anon;


-- ── 8. Sentinel rows ─────────────────────────────────────────────────────────
-- The pos-walk-in synthetic customer is referenced by POS-placed orders so
-- they satisfy the orders.customer_id FK. Must exist before any POS order.
insert into customers (id, name, email, phone, tags, favourites, saved_addresses, store_credit)
values ('pos-walk-in', 'POS Walk-in', 'pos-walkin@internal', '', '{}', '{}', '[]', 0)
on conflict (id) do nothing;


-- ── 9. Realtime publications ─────────────────────────────────────────────────
-- All tables that drive live subscriptions (postgres_changes) in the client.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'app_settings', 'categories', 'menu_items',
      'customers', 'orders', 'drivers',
      'reservations', 'reservation_customers'
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


-- ═══════════════════════════════════════════════════════════════════════════════
-- Verification queries (paste these separately after running the above):
--
--   -- columns present?
--   select column_name from information_schema.columns
--   where table_name = 'customers' and column_name in ('password_hash', 'email_verified');
--
--   -- realtime tables?
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
--
--   -- sentinel row?
--   select id, email from customers where id = 'pos-walk-in';
-- ═══════════════════════════════════════════════════════════════════════════════
