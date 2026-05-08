-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS) policies for the Single-Restaurant Food Ordering System
--
-- Run this entire script in:
--   Supabase dashboard → SQL Editor → New query → Paste → Run
--
-- Safe to re-run: all DROP IF EXISTS guards make this idempotent.
--
-- What this does:
--   • Enables RLS on every table so no table is "publicly accessible"
--   • Blocks all anon writes to app_settings, categories, menu_items
--     (these now go through /api/admin/* routes using the service role key)
--   • Blocks anon INSERT on orders and customers (both now go through server-side API routes)
--   • Blocks anon UPDATE/DELETE on orders (admin-only via API routes)
--   • Allows anon SELECT everywhere except drivers
--   • Strips the `password` column from anon SELECT on customers
--     (column-level privilege — fixes the "sensitive_columns_exposed" warning)
--   • drivers table: no anon access at all (served via /api/admin/drivers)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── app_settings ──────────────────────────────────────────────────────────────
alter table app_settings enable row level security;

-- Anon can read settings (sensitive fields like SMTP/Stripe were already removed)
drop policy if exists "anon_select_settings" on app_settings;
create policy "anon_select_settings"
  on app_settings for select to anon using (true);

-- No anon INSERT / UPDATE / DELETE → absence of policy = deny

-- ── categories ───────────────────────────────────────────────────────────────
alter table categories enable row level security;

drop policy if exists "anon_select_categories" on categories;
create policy "anon_select_categories"
  on categories for select to anon using (true);

-- ── menu_items ────────────────────────────────────────────────────────────────
alter table menu_items enable row level security;

drop policy if exists "anon_select_menu_items" on menu_items;
create policy "anon_select_menu_items"
  on menu_items for select to anon using (true);

-- ── orders ────────────────────────────────────────────────────────────────────
alter table orders enable row level security;

-- Customers need to read their own orders (fetched via the customers join)
drop policy if exists "anon_select_orders" on orders;
create policy "anon_select_orders"
  on orders for select to anon using (true);

-- Order INSERT is now handled server-side via POST /api/orders.
-- That route validates the payload and enforces status = "pending",
-- preventing clients from inserting orders with arbitrary statuses or totals.
-- The anon role must NOT have INSERT on orders — drop the policy entirely.
drop policy if exists "anon_insert_orders" on orders;

-- No anon UPDATE / DELETE → updateOrderStatus, addRefund, assignDriver
-- are now enforced through /api/admin/orders/* (service role)

-- ── customers ────────────────────────────────────────────────────────────────
alter table customers enable row level security;

-- Needed for login check and admin customer list
drop policy if exists "anon_select_customers" on customers;
create policy "anon_select_customers"
  on customers for select to anon using (true);

-- Customer INSERT is now handled server-side via POST /api/auth/register,
-- which validates input and inserts using the service role key.
-- The anon role must NOT have INSERT on customers — drop the policy entirely.
drop policy if exists "anon_insert_customers" on customers;

-- Customer UPDATE is now split across three server-side routes:
--   PATCH /api/customers/[id]             — self-service (favourites, saved_addresses, name, phone only)
--   POST  /api/customers/[id]/spend-credit — store credit deduction at checkout (amount validated server-side)
--   PUT   /api/admin/customers/[id]        — full update (requires admin session cookie)
-- The anon role must NOT have UPDATE on customers — drop the policy entirely.
drop policy if exists "anon_update_customers" on customers;

-- ── Column-level security: strip `password` from anon reads ──────────────────
-- RLS controls rows; column access is controlled separately via GRANT/REVOKE.
-- The `password` column in customers contains plaintext demo passwords which
-- triggered Supabase's "sensitive_columns_exposed" warning.
-- This revoke prevents PostgREST / the anon key from ever returning that column.
-- The service role (used in API routes) retains full column access.
revoke select (password) on customers from anon;

-- Also strip password_hash from drivers for the anon role (belt-and-suspenders —
-- the drivers table already has no anon SELECT policy, but be explicit).
-- This line is safe even if the column doesn't exist yet; comment it out if
-- Postgres complains (it will if the drivers table was just created).
-- revoke select (password_hash) on drivers from anon;

-- ── drivers ──────────────────────────────────────────────────────────────────
-- Create the table first if it doesn't exist yet
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

alter table drivers enable row level security;

-- Explicit deny for the anon role — makes intent unambiguous and silences the
-- "RLS enabled, no policies" linter warning. The service role bypasses RLS
-- entirely, so /api/admin/drivers and /api/auth/driver still work normally.
-- ── POS walk-in sentinel customer ────────────────────────────────────────────
-- Pre-seed the sentinel customer used by POS → KDS order routing so that
-- walk-in POS orders always have a valid customer_id FK and appear in the KDS.
insert into customers (id, name, email, phone, tags, favourites, saved_addresses, store_credit)
values ('pos-walk-in', 'POS Walk-in', 'pos-walkin@internal', '', '{}', '{}', '[]', 0)
on conflict (id) do nothing;

-- ── Void & Refund metadata columns on orders ─────────────────────────────────
-- Safe to re-run (ADD COLUMN IF NOT EXISTS is idempotent).
-- These store who voided an order, why, and when — used by the waiter void flow.
-- The existing `refunds` (jsonb) and `refunded_amount` columns handle refund data.
alter table orders add column if not exists voided_by   text;
alter table orders add column if not exists void_reason text;
alter table orders add column if not exists voided_at   timestamptz;

drop policy if exists "deny_anon_all" on drivers;
create policy "deny_anon_all"
  on drivers
  for all
  to anon
  using (false)
  with check (false);

-- ── reservations ──────────────────────────────────────────────────────────────
-- Online table reservation system. Dining tables themselves live in app_settings;
-- reservations are a separate table so they can be queried and Realtime-subscribed.
create table if not exists reservations (
  id             text        primary key,
  table_id       text        not null,
  table_label    text        not null,
  table_seats    integer     not null,
  section        text        not null default '',
  customer_name  text        not null,
  customer_email text        not null,
  customer_phone text        not null default '',
  date           text        not null,   -- "YYYY-MM-DD"
  time           text        not null,   -- "HH:MM"
  party_size     integer     not null,
  status         text        not null default 'pending',
  note           text,
  created_at     timestamptz not null default now()
);

alter table reservations enable row level security;

-- Anon SELECT is required so the browser Supabase client can subscribe via Realtime.
-- Reservation rows contain customer names/emails but no payment data.
drop policy if exists "anon_select_reservations" on reservations;
create policy "anon_select_reservations"
  on reservations for select to anon using (true);

-- All writes (INSERT, UPDATE, DELETE) go through API routes using the service role.
-- No anon INSERT / UPDATE / DELETE — absence of policy = deny.

-- Enable Realtime so the admin panel updates live when customers book.
do $$
begin
  begin
    alter publication supabase_realtime add table reservations;
  exception when duplicate_object then null;
  end;
end $$;
