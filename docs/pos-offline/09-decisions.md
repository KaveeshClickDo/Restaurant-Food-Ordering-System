# 09 · Decisions log

Append-only. Every non-obvious decision made during implementation goes
here with date + reason. Future-you (and future-me in another session)
reads this to understand *why* something is the way it is when the code
no longer makes it obvious.

Format: dated `## YYYY-MM-DD § short title` headings. Older entries
stay where they are; newer ones go on top.

---

## 2026-05-29 § Card payment offline ALLOWED — POS is bookkeeping only, terminal is standalone

**Decision:** Card and split (cash + card) payments are now ✅ allowed
in every offline state. Gift card stays ❌ blocked offline.

**Why:** A grep audit of the entire `app/src/` tree on 2026-05-29
returned zero matches for any card-reader integration vendor
(`stripe.terminal`, `cardReader`, `ingenico`, `verifone`, `sumup`,
`paymentTerminal`). [api/pos/sales/route.ts:285](../../app/src/app/api/pos/sales/route.ts#L285)
stores `payment_method: body.paymentMethod ?? "cash"` as a plain string
— no Stripe SDK call, no authorisation step. The Card screen in
[PaymentModal.tsx:280-291](../../app/src/components/pos/PaymentModal.tsx#L280-L291)
literally says *"Present card to terminal"* with a "Payment Received"
confirmation button — confirming the architecture: the cashier hands a
**standalone card terminal** to the customer, the terminal authorises
on its own connection, the cashier records the result on the POS.
Nothing in this flow requires POS-side internet.

The previous "card requires internet" stance (in PaymentModal +
[earlier 11-offline-scope.md](./11-offline-scope.md) + the Android
offline banner) was based on conflating the POS-card flow with the
website checkout's Stripe-card flow. Two completely different paths;
only the website needs Stripe online.

**How to apply:**
- `PaymentModal.tsx`: card + split buttons no longer carry
  `disabled={isOffline}`. Top banner copy updated to "confirm card on
  terminal before tapping Payment Received." Gift card input now gated
  on `isOffline`.
- `pos/page.tsx`: Android offline banner copy updated to "cash and
  card sales will queue."
- [11-offline-scope.md](./11-offline-scope.md): Card and Split rows
  flipped from ❌ to ✅ across columns B/C/D. Gift card stays ❌.
- **Operational rule** (in receipt training / cashier handbook): in
  offline mode, the cashier MUST verify the standalone terminal beeped
  approved before tapping "Payment Received" — same expectation as
  online, but worth calling out for offline because no automated
  retry/refund path exists if a card is incorrectly marked as paid.

**Caveat for the future:** if the restaurant ever upgrades to an
integrated card terminal (Stripe Terminal SDK, Square Reader SDK,
etc.) that the POS commands directly, the offline scope flips back —
because then a POS-side call is required to authorise. That is a
schema / route change at that time; documented here so we don't forget
the assumption.

## 2026-05-29 § Scale-thinking docs 11/12/13 added before Phase 1.5 lands

**Decision:** Three new planning docs ship before any more code:
[11-offline-scope.md](./11-offline-scope.md),
[12-sync-protocol.md](./12-sync-protocol.md), and
[13-conflict-resolution.md](./13-conflict-resolution.md).

**Why:** The user pushed back on the Phase 1 + bundled-mode (1.5)
direction with three valid questions — "what's allowed offline, how do
we sync, how do we resolve conflicts." The plan had partial answers
spread across multiple docs but no consolidated authoritative source.
Several real conflict cases (customer concurrent edits, deactivated
cashier mid-shift, clock drift, multi-tablet swaps, partial-sync
reports) had no documented policy.

**How to apply:** Every new offline-touching feature must trace to a
row in 11 (is it allowed?), a section in 12 (how does it sync?), and —
if it can collide with another mutation — a case in 13 (what wins?).
PR reviewers reject changes that introduce offline behaviour not
grounded in 11-13.

## 2026-05-29 § Customer profile fields use LWW; loyalty + spend are DERIVED

**Decision:** Customer name/email/phone/notes/tags use Last-Write-Wins
keyed on `client_created_at`, with the server rejecting out-of-order
patches with 409 (per [13 § Case 1](./13-conflict-resolution.md)).
`loyalty_points`, `totalSpend`, `visit_count`, `last_visit` are computed
server-side from the `pos_sales + orders` aggregate — no client write
to these is trusted.

**Why:** Derived columns make the "two cashiers offline bump loyalty"
case unconflict-able by construction. LWW for profile fields is honest
about losing data sometimes but matches user expectation ("the most
recent edit wins") and never silently merges.

## 2026-05-29 § Offline sales by a deactivated cashier ACCEPT-AND-FLAG

**Decision:** Sales queued by a cashier who was deactivated by admin
during the offline window sync normally on reconnect, but get
`pos_sales.staff_was_active = false` stamped server-side at insert
time. Per [13 § Case 2](./13-conflict-resolution.md).

**Why:** The cash was real, the food was served. Rejecting the sales
creates a worse inventory/cash mismatch than admin auditing the
deactivated cashier's last shift. The flag column gives full audit
visibility without losing money.

## 2026-05-29 § Long-offline tablet hard caps: 24h soft, 7d hard

**Decision:** Tiered stale-cache policy per
[13 § Case 6](./13-conflict-resolution.md). 0-24h business-as-usual.
24-72h soft banner. 72h-7d hard menu refusal. >7d offline PIN
refusal.

**Why:** "Tablet works offline forever" is a worse failure than
"tablet refuses to ring sales until it reconnects." Hard caps force a
fresh sync at a reasonable cadence and prevent admin from accidentally
deploying a tablet that's silently been running on week-old prices.

## 2026-05-29 § Partial-coverage reports show a banner, don't silently lie

**Decision:** Dashboard / POS Reports detects unsynced terminals and
shows a persistent banner naming each by label and `last_sync_at`. Per
[13 § Case 7](./13-conflict-resolution.md). Admin can override with a
recorded `admin_acknowledged_partial` flag that lands in any printed
report's footer.

**Why:** A manager making a banking decision on incomplete totals is
the kind of operational mistake offline POS has historically caused.
The banner makes the gap unmistakable. The override-with-record
pattern lets admin proceed without losing the audit trail.

## 2026-05-29 § Capacitor stays in server-URL mode for Phase 1 (not bundled assets)

**Decision:** [capacitor.config.ts](../../app/capacitor.config.ts) keeps
its `server.url` block pointing at the deployed Next.js URL. We are NOT
switching to bundled-asset mode (which would require `output: "export"`
and copying `app/.next/server/app/pos*.html` into Android assets).

**Why:** Phase 0 confirmed bundled mode is *mechanically possible* — the
`/pos` routes prerender as static HTML. But the switch carries non-zero
risk (root layout's server-side `getDbSettings()` becomes a build-time
fetch; static export is a project-wide flag that affects every other
route; a second `next.config.capacitor.ts` plus a separate build step
would be needed). Phase 1's first goal is "offline sales work on
Android"; bundled assets only matter for "tablet survives a cold start
with no internet." The service worker registered in Phase 5 covers most
of the cold-start case for browser PWA users; Capacitor's webview is
expected to cache the URL via its own webview cache after first load.

**How to apply:** Phase 1's APK requires internet on first launch to
load the `/pos` page. After first launch the Android WebView caches
HTML/CSS/JS automatically. If real-world testing shows the cache is
unreliable inside the Capacitor WebView, the bundled-mode switch is the
next move (still additive — the JS-side outbox / SQLite / per-terminal
work in Phase 1 all carry forward unchanged).

## 2026-05-29 § WorkManager background workers deferred from Phase 1

**Decision:** [OutboxSyncWorker.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/OutboxSyncWorker.kt) and
[MenuSyncWorker.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/MenuSyncWorker.kt) stay
in the repo but are NOT scheduled by `MainActivity.kt`. The new
`MainActivity.kt` registers the three printer plugins and immediately
calls `super.onCreate(savedInstanceState)` — no `scheduleBackgroundSync()`.

**Why:**
1. The dominant offline scenario is "cashier rings up offline sales,
   reconnects, drain runs." The JS-side `drainOutbox()` in
   [pos/page.tsx](../../app/src/app/pos/page.tsx) handles this every
   time `isOnline` flips true. Phase 1 ships a working offline POS
   without a background worker.
2. The existing worker code reads `pos_outbox` from
   `SharedPreferences`, which is a different store from the Capacitor
   SQLite database. Wiring it correctly requires the worker to either
   open the SQLite file directly (path is plugin-version-specific and
   fragile) or trigger a JS-side drain via `evaluateJavascript` (only
   works when the WebView is alive — defeats the purpose).
3. Rather than ship broken-or-half-broken background sync, we ship no
   background sync and revisit in a later phase with a clean
   implementation.

**How to apply:** Closed-app sync (WebView dead, sales queued in SQLite,
network restored) doesn't happen in Phase 1. Worst case is sync delay —
the queue drains the moment the app is reopened. Documented as a known
limitation; not a data-loss path.

## 2026-05-29 § Provisional `OFF-…` receipt format for Phase 1 offline sales

**Decision:** Offline-minted receipts in Phase 1 use
`OFF-<base36-timestamp>-<2-char-random>` (e.g. `OFF-LJZ8K2-A7`). The
client mints this in
[POSContext.completeSale](../../app/src/context/POSContext.tsx) when
`isCapacitorAndroid()` returns true, before the network POST.

**Why:** Phase 1 doesn't yet have terminal registration on the tablet
(the routes exist from step 1 but the tablet doesn't bind to a terminal
on first launch — that's Phase 2). Without a terminal `prefix`, we
can't produce a `T1-1042`-style number. The `OFF-…` format is:
- Visually distinguishable on a receipt — admin can spot Phase-1
  offline rows immediately
- Globally unique with overwhelming probability (timestamp ms + random
  suffix) so two tablets can't collide
- Replaced wholesale by Phase 2's `T<prefix>-<seq>` scheme without
  any data migration (old rows keep their `OFF-…` numbers in history)

**How to apply:** Phase 2 swaps the mint logic for per-terminal seq.
Old Phase-1 rows in `pos_sales` keep their `OFF-…` receipts forever as
audit history — this is fine, they're a tiny set during the pilot.

## 2026-05-29 § 4xx server responses are NOT queued by the outbox

**Decision:** [posOutbox.drainOutbox](../../app/src/lib/posOutbox.ts)
marks any 4xx response (400/401/403/etc.) as `failed` rather than
`pending`. The
[POSContext.completeSale](../../app/src/context/POSContext.tsx) fallback
only enqueues when there's no `serverError` (i.e. only on network /
5xx failures).

**Why:** 4xx means the request will fail the same way on every retry
— bad payload, no permission, validation gate. Queuing it would burn
attempts and surface a "Sync stuck" UI to a cashier who can't actually
fix the underlying problem. Surfacing the error immediately to the
cashier matches existing online behaviour.

**How to apply:** When a cashier sees the alert *"'Burger' is no
longer available on the menu"* offline, the sale is NOT queued. The
cashier removes the item from the cart and rings up the rest. Phase 3
(oversell policy) may relax this for the specific "stock conflict at
sync time" case.

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
