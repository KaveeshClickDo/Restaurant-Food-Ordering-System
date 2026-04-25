-- ─────────────────────────────────────────────────────────────────────────────
-- V2 Features Migration
-- Run in Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Safe to re-run: all changes use IF NOT EXISTS / DEFAULT guards.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Source attribution ────────────────────────────────────────────────────────
-- Tracks where each reservation originated: online widget, walk-in, phone, etc.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'online';

-- ── Guest self-service cancel token ──────────────────────────────────────────
-- A unique UUID sent in the confirmation email so guests can cancel without login.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancel_token text UNIQUE DEFAULT gen_random_uuid()::text;

-- Backfill any pre-existing rows that have a NULL cancel_token.
UPDATE reservations SET cancel_token = gen_random_uuid()::text WHERE cancel_token IS NULL;

-- ── waitlist table ────────────────────────────────────────────────────────────
-- Stores email sign-ups when no tables are available for a given slot.
CREATE TABLE IF NOT EXISTS reservation_waitlist (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date        text        NOT NULL,   -- "YYYY-MM-DD"
  time        text        NOT NULL,   -- "HH:MM"
  party_size  integer     NOT NULL,
  name        text        NOT NULL,
  email       text        NOT NULL,
  phone       text        NOT NULL DEFAULT '',
  notified_at timestamptz,           -- set when we email them a table opened up
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reservation_waitlist ENABLE ROW LEVEL SECURITY;

-- Guests can add themselves; all reads/updates go through service role API routes.
DROP POLICY IF EXISTS "anon_insert_waitlist" ON reservation_waitlist;
CREATE POLICY "anon_insert_waitlist"
  ON reservation_waitlist FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "deny_anon_select_waitlist" ON reservation_waitlist;
CREATE POLICY "deny_anon_select_waitlist"
  ON reservation_waitlist FOR SELECT TO anon USING (false);
