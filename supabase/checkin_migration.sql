-- ─────────────────────────────────────────────────────────────────────────────
-- Check-in / Check-out + Reservation Customers migration
-- Run this in: Supabase dashboard → SQL Editor → New query → Paste → Run
-- Safe to re-run (all statements are idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add check-in / check-out timestamp columns to reservations ─────────────

alter table reservations
  add column if not exists checked_in_at  timestamptz,
  add column if not exists checked_out_at timestamptz;

-- ── 2. Create reservation_customers table (email-keyed CRM profiles) ──────────

create table if not exists reservation_customers (
  id               text        primary key default gen_random_uuid()::text,
  email            text        not null unique,
  name             text        not null default '',
  phone            text        not null default '',
  visit_count      integer     not null default 0,
  first_visit_at   timestamptz,
  last_visit_at    timestamptz,
  tags             text[]      not null default '{}',
  notes            text        not null default '',
  marketing_opt_in boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 3. RLS for reservation_customers ─────────────────────────────────────────

alter table reservation_customers enable row level security;

-- Admin (service role) has full access — no RLS policy needed for service role.
-- Anon users get no access — reservation_customers is internal admin data only.

-- ── 4. Add reservation_customers to Realtime publication ─────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'reservation_customers'
  ) then
    alter publication supabase_realtime add table reservation_customers;
  end if;
end $$;

-- ── Done ──────────────────────────────────────────────────────────────────────
