-- ─────────────────────────────────────────────────────────────────────────────
-- Reservations table migration
-- Run this in: Supabase dashboard → SQL Editor → New query → Paste → Run
-- Safe to re-run (all statements are idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- Create the reservations table
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

-- Enable Row Level Security
alter table reservations enable row level security;

-- Allow anon to read reservations (required for Supabase Realtime in the admin panel)
drop policy if exists "anon_select_reservations" on reservations;
create policy "anon_select_reservations"
  on reservations for select to anon using (true);

-- All writes go through server-side API routes using the service role key.
-- No anon INSERT / UPDATE / DELETE policies — absence of policy = deny.

-- Add to Realtime publication so the admin panel receives live updates
-- (skip if already a member to avoid duplicate error)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'reservations'
  ) then
    alter publication supabase_realtime add table reservations;
  end if;
end $$;
