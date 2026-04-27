-- ─────────────────────────────────────────────────────────────────────────────
-- Auth migration: secure password storage for customers
--
-- Run in: Supabase dashboard → SQL Editor → New query → Paste → Run
-- Safe to re-run: all statements are idempotent.
--
-- What this does:
--   • Adds password_hash (bcrypt) column to customers — replaces plaintext password
--   • Adds reset_token and reset_token_expires for password reset flow
--   • Revokes all three sensitive columns from the anon role
-- ─────────────────────────────────────────────────────────────────────────────

alter table customers add column if not exists password_hash                 text;
alter table customers add column if not exists reset_token                   text;
alter table customers add column if not exists reset_token_expires           timestamptz;
alter table customers add column if not exists email_verified                boolean     not null default false;
alter table customers add column if not exists email_verification_token      text;
alter table customers add column if not exists email_verification_expires    timestamptz;

-- Strip sensitive auth columns from anon reads.
-- The service role (used in API routes) retains full column access.
-- These are safe to re-run even if already revoked.
revoke select (password_hash)              on customers from anon;
revoke select (reset_token)               on customers from anon;
revoke select (reset_token_expires)       on customers from anon;
revoke select (email_verification_token)  on customers from anon;
revoke select (email_verification_expires) on customers from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Progressive migration: hash any existing plaintext passwords
--
-- This back-fills password_hash for existing customers who have a plaintext
-- password stored. Requires the pgcrypto extension to be enabled.
-- If you prefer to force all users to reset their password instead, skip this.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pgcrypto if not already enabled (needed for crypt/gen_salt)
create extension if not exists pgcrypto;

-- Back-fill password_hash from plaintext password column
update customers
set password_hash = crypt(password, gen_salt('bf', 10))
where password is not null
  and password <> ''
  and password_hash is null;
