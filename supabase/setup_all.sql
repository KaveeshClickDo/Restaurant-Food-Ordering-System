-- ─────────────────────────────────────────────────────────────────────────────
-- COMPLETE SETUP — run this once to create all tables and columns.
-- Safe to re-run: every statement uses IF NOT EXISTS / DO $$ guards.
-- Supabase Dashboard → SQL Editor → New query → Paste → Run
-- ─────────────────────────────────────────────────────────────────────────────


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. RESERVATIONS TABLE
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists reservations (
  id             text        primary key,
  table_id       text        not null,
  table_label    text        not null,
  table_seats    integer     not null,
  section        text        not null default '',
  customer_name  text        not null,
  customer_email text        not null,
  customer_phone text        not null default '',
  date           text        not null,
  time           text        not null,
  party_size     integer     not null,
  status         text        not null default 'pending',
  note           text,
  created_at     timestamptz not null default now()
);

alter table reservations enable row level security;

drop policy if exists "anon_select_reservations" on reservations;
create policy "anon_select_reservations"
  on reservations for select to anon using (true);


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CHECK-IN / CHECK-OUT COLUMNS
-- ══════════════════════════════════════════════════════════════════════════════

alter table reservations
  add column if not exists checked_in_at  timestamptz,
  add column if not exists checked_out_at timestamptz;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. V2 COLUMNS (source attribution + cancel token)
-- ══════════════════════════════════════════════════════════════════════════════

-- Add columns without constraints first (nullable, no default) so they can be backfilled safely
alter table reservations add column if not exists source       text;
alter table reservations add column if not exists cancel_token text;

-- Backfill BEFORE adding any unique constraint
update reservations set source       = 'online'                where source is null;
update reservations set cancel_token = gen_random_uuid()::text where cancel_token is null or cancel_token = 'online';

-- Ensure every row now has unique tokens (re-run safe: duplicates get a fresh UUID)
update reservations r
set cancel_token = gen_random_uuid()::text
where exists (
  select 1 from reservations r2
  where r2.cancel_token = r.cancel_token and r2.id < r.id
);

-- Drop any stale bad unique constraint on source if it exists
alter table reservations drop constraint if exists reservations_source_key;

-- Now it is safe to set defaults, NOT NULL, and the unique constraint
alter table reservations alter column source       set default 'online';
alter table reservations alter column source       set not null;
alter table reservations alter column cancel_token set default gen_random_uuid()::text;
alter table reservations alter column cancel_token set not null;

-- Add unique constraint only if not already present
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_cancel_token_key' and conrelid = 'reservations'::regclass
  ) then
    alter table reservations add constraint reservations_cancel_token_key unique (cancel_token);
  end if;
end $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. RESERVATION_CUSTOMERS TABLE (Guest Profiles)
-- ══════════════════════════════════════════════════════════════════════════════

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

-- Online order tracking columns (added after initial release — safe to re-run)
alter table reservation_customers
  add column if not exists order_count   integer     not null default 0,
  add column if not exists total_spend   numeric(10,2) not null default 0,
  add column if not exists last_order_at timestamptz;

alter table reservation_customers enable row level security;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. RESERVATION WAITLIST TABLE
-- ══════════════════════════════════════════════════════════════════════════════

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

alter table reservation_waitlist enable row level security;

drop policy if exists "anon_insert_waitlist" on reservation_waitlist;
create policy "anon_insert_waitlist"
  on reservation_waitlist for insert to anon with check (true);

drop policy if exists "deny_anon_select_waitlist" on reservation_waitlist;
create policy "deny_anon_select_waitlist"
  on reservation_waitlist for select to anon using (false);


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. REALTIME PUBLICATIONS (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
begin
  foreach t in array array['reservations', 'reservation_customers'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
