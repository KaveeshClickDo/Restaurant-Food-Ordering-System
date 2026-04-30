-- ─────────────────────────────────────────────────────────────────────────────
-- Enable Supabase Realtime for all tables that need live updates.
--
-- Without this, the postgres_changes subscriptions in AppContext and the Kitchen
-- Display page receive no events — new orders, status changes, and menu edits
-- won't propagate across tabs or devices without a full page refresh.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Safe to re-run: skips tables already in the publication.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['orders','customers','menu_items','categories','app_settings','drivers','reservations']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end;
$$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm all tables appear here:
--
--   select tablename
--   from pg_publication_tables
--   where pubname = 'supabase_realtime'
--   order by tablename;
--
-- Expected output (minimum):
--   app_settings
--   categories
--   customers
--   drivers
--   menu_items
--   orders
--   reservations
-- ─────────────────────────────────────────────────────────────────────────────
