# 09 · Decisions log

Append-only. Every non-obvious decision made during implementation goes
here with date + reason. Future-you (and future-me in another session)
reads this to understand *why* something is the way it is when the code
no longer makes it obvious.

Format: dated `## YYYY-MM-DD § short title` headings. Older entries
stay where they are; newer ones go on top.

---

## 2026-05-28 § Phase 1 schema patch — applied directly to supabase/schema.sql (no separate migration file)

**Decision:** The Phase 1 schema changes (new table `pos_terminals` and
three new columns on `pos_sales`) were appended directly to
`supabase/schema.sql` rather than created as a separate migration file
like `migrations/0001_pos_terminals.sql`.

**Why:** The project does not use a versioned migration system. There
is no `supabase/migrations/` directory; `schema.sql` is run idempotently
via `node migrate.mjs` ([app/package.json:10](../../app/package.json#L10)).
Every change uses `if not exists` / `add column if not exists`, so
re-running the file against an existing DB is a no-op for unchanged
blocks. A separate migration file would set a precedent that doesn't
match the repo's actual workflow.

**How to apply:** verify the additions render correctly with
`psql -f supabase/schema.sql` against a staging DB, or run
`npm run db:migrate` from `app/` if `.env.local` points at a sandbox.

## 2026-05-28 § `pos_terminals.prefix` format enforced application-side, not in DB CHECK

**Decision:** The `pos_terminals.prefix` column is plain `text` with
**no** `CHECK (prefix ~ '^[A-Z0-9]{1,4}$')` constraint at the DB level.
The format `1–4 chars [A-Z0-9]` is validated by the
`POST /api/pos/terminals` route handler (to be written in Phase 1.1
after this commit).

**Why:** A DB-level CHECK would force every future change to the prefix
rules through a migration. Real-world POS terminals sometimes need
exceptions (a customer wants `BAR-2` or wants lowercase), and the route
handler is the right place for that flexibility. The DB still enforces
the only invariant that matters for correctness: uniqueness among
active terminals (`uniq_pos_terminals_prefix_active`).

## 2026-05-28 § `pos_terminals.id` uses `gen_random_uuid()::text`, not `bigserial`

**Decision:** Primary key is a text UUID, matching `pos_staff`,
`pos_sales`, `pos_clock_entries`. Not a numeric `bigserial`.

**Why:** Consistency with the rest of the POS subsystem. The `id` is
used in FK lookups, not in human-facing labels (that's what `prefix`
is for), so the surrogate UUID is invisible in the UI. Numeric ids would
leak terminal count to anyone who can guess sequential ids.

## 2026-05-28 § `pos_sales.terminal_id` uses `ON DELETE SET NULL`, not `CASCADE`

**Decision:** The foreign key from `pos_sales.terminal_id` to
`pos_terminals.id` is `ON DELETE SET NULL`.

**Why:** Sale records are an audit and tax artifact. Deleting a
terminal must not destroy the sales it produced. `SET NULL` preserves
the row and severs the link; the admin "POS Reports" panel will show
"(deleted terminal)" for these rows — same pattern as
`orders.customer_id` ([schema.sql:147](../../supabase/schema.sql#L147)
*"ON DELETE SET NULL"* with the comment *"when admin deletes a customer
we must preserve the order row ... for financial audit."*).

## 2026-05-28 § `pos_sales.synced_at` defaults to `now()` rather than NULL

**Decision:** New column `pos_sales.synced_at timestamptz default now()`.

**Why:** Online web POS sales insert without touching this column; the
default fires and `synced_at = created_at` semantically. Existing reads
that don't know about the column continue working. Offline-synced rows
get the timestamp at sync time, which is the moment they hit the server
— exactly what "synced_at" should mean.

**Alternative considered:** NULL default with the sync route stamping
`synced_at` explicitly. Rejected because it would force every existing
sale row to be NULL forever, breaking any future "show terminals with
sync lag > N hours" query that assumes the column is populated.

## 2026-05-28 § `pos_sales.client_created_at` left nullable

**Decision:** No default. Column is NULL for online web POS sales;
populated for offline tablet sales.

**Why:** Online sales don't have a meaningful "client time" distinct
from `created_at`. Backfilling them with `created_at` would be lying
about provenance. NULL means "this was an online sale, the canonical
time is `created_at`"; non-NULL means "this was a tablet sale, the
canonical time for tax/reporting is `client_created_at`."

## 2026-05-28 § RLS for `pos_terminals` follows the existing pos_* convention

**Decision:** `pos_terminals` gets `enable row level security` in the
upper RLS block (line 880-ish) and a single `deny_anon_all` policy in
the lower policies block (line 950-ish). No nuanced policies.

**Why:** Same posture as `pos_staff`, `pos_sales`, `pos_clock_entries`.
service_role bypasses RLS automatically; anon/authenticated are denied.
Every read goes through service-role API routes. Future per-role
policies (admin can edit terminal, cashier cannot) are enforced in the
route handlers, not at RLS.
