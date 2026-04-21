-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS) policies for the Single-Restaurant Food Ordering System
--
-- Run this entire script in:
--   Supabase dashboard → SQL Editor → New query → Paste → Run
--
-- What this does:
--   • Blocks all anon writes to app_settings, categories, menu_items
--     (these now go through /api/admin/* routes using the service role key)
--   • Allows anon INSERT on orders (customer checkout) + customers (registration)
--   • Blocks anon UPDATE/DELETE on orders (admin-only via API routes)
--   • Allows anon SELECT everywhere except drivers
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

-- Customers need to place orders (checkout)
drop policy if exists "anon_insert_orders" on orders;
create policy "anon_insert_orders"
  on orders for insert to anon with check (true);

-- No anon UPDATE / DELETE → updateOrderStatus, addRefund, assignDriver
-- are now enforced through /api/admin/orders/* (service role)

-- ── customers ────────────────────────────────────────────────────────────────
alter table customers enable row level security;

-- Needed for login check and admin customer list
drop policy if exists "anon_select_customers" on customers;
create policy "anon_select_customers"
  on customers for select to anon using (true);

-- Needed for self-registration at checkout
drop policy if exists "anon_insert_customers" on customers;
create policy "anon_insert_customers"
  on customers for insert to anon with check (true);

-- Needed for profile updates, favourites, saved addresses
drop policy if exists "anon_update_customers" on customers;
create policy "anon_update_customers"
  on customers for update to anon using (true) with check (true);

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

-- No policies at all for anon → complete deny
-- All driver access goes through /api/admin/drivers and /api/auth/driver
-- which use the service role key server-side
