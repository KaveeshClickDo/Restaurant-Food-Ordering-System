# 13 · Conflict resolution — case by case

For every conflict the offline POS can produce, what we do about it.
No "options" — opinionated policies. If you disagree with one, push
back and we change it here BEFORE shipping the code that depends on it.

Read with [11-offline-scope.md](./11-offline-scope.md) (what's even
allowed) and [12-sync-protocol.md](./12-sync-protocol.md) (how data
moves). Each case below names the data type from those docs.

## Resolution mechanics primer

Three building blocks every case uses:

| Mechanic | Definition |
|---|---|
| **LWW (last-write-wins)** | The mutation with the latest `client_created_at` (or `updated_at`) overwrites earlier ones |
| **SUM** | Both mutations apply additively; final value = sum |
| **REJECT** | Later mutation is refused at the server; client sees a clear error |
| **ACCEPT-AND-FLAG** | Mutation lands but a flag column is set so admin can review |
| **DERIVED** | Field is computed server-side from a different source-of-truth column; client mutations are ignored |

## Case 1 — Customer concurrent edits (two cashiers bump loyalty for the same customer)

**Scenario.** Cashier A on Tablet 1 (offline) rings a £20 sale for
Jane Smith → bumps her loyalty by 20 pts locally. Cashier B on Tablet 2
(online) rings a £15 sale for Jane → loyalty bumped by 15 pts server-side.
Tablet 1 syncs an hour later.

**Conflict-causing fields.** `customers.loyalty_points`, `customers.totalSpend`,
`customers.visit_count`, `customers.last_visit`.

**Resolution policy.**

- `loyalty_points`, `totalSpend`, `visit_count`, `last_visit` are
  **DERIVED**: computed server-side from a SUM aggregate over
  `pos_sales + orders` rows belonging to the customer. Every sync
  triggers a recompute on touched customer rows.
- The optimistic local bump in
  [POSContext](../../app/src/context/POSContext.tsx) stays — it's
  for UI feedback only. The server recomputation is the truth.
- **No conflict possible** because no client write to these columns
  is trusted. The sales rows themselves are the source.

**Customer profile fields (name, email, phone, notes, tags)** are not
derived — they're directly mutable. Policy for those:

- **LWW by `client_created_at`** on the patch. Server stamps
  `customers.updated_at` from the patch's `client_created_at` when
  provided, else `now()`.
- If two patches land out of order (offline patch syncs after a
  newer online patch), the older one is rejected with 409 →
  client surfaces "another change happened first, refresh and try
  again." Cashier acknowledges.
- Acceptable risk: a minor revert in name/phone is annoying but
  not financially destructive.

**Implementation.** Phase 1.6 schema add: `customers.updated_at` column.
Phase 1.6 route change: `PATCH /api/pos/customers/[id]` accepts optional
`clientCreatedAt`, rejects 409 if server `updated_at` is newer.

**Admin visibility.** None for the loyalty case (silent recompute).
For the 409 case, the rejected sync stays in the outbox as `failed`
with the reason — admin sees it in the "Stuck sales" list.

## Case 2 — Cashier deactivated while offline mid-shift

**Scenario.** Cashier A is offline, ringing sales since 10am. At 11am
admin deactivates Cashier A in the admin panel
(`pos_staff.active = false`, `session_version` bumped). Cashier A's
tablet doesn't know — heartbeat fails silently. At 2pm Cashier A's
tablet reconnects with 8 offline sales in the outbox.

**Conflict-causing fields.** `pos_staff.active` (server) vs.
`pos_sales.staff_id` (client claim).

**Resolution policy.**

- **ACCEPT-AND-FLAG.** The 8 queued sales sync normally — server stamps
  `staff_id` = cashier's id from the session cookie, which is still
  the same person. The sales count as real revenue (they happened —
  cash was taken, food was served).
- On the **next online heartbeat** (`/api/pos/auth` GET) the server
  detects `session_version` mismatch and 401s. The tablet immediately
  shows the PIN screen. Cashier A is locked out.
- The sales rows get a new column **`pos_sales.staff_was_active = false`**
  flagged at sync time when server detects `pos_staff.active` is now
  false. Admin sees these in POS Reports with a small badge.

**Why this policy.** The cash is real. Refusing the sales would leave
an inventory and cash-drawer mismatch that's much harder to reconcile
than "X was sold by a now-deactivated cashier — investigate." If the
deactivation was disciplinary, the admin gets the audit trail anyway.

**Implementation.** Phase 1.6 schema add: `pos_sales.staff_was_active boolean
default true`. Phase 1.6 route change: `POST /api/pos/sales` stamps the
column from a re-lookup of `pos_staff.active` at insert time.

**Admin visibility.** Badge on the sale row. "Sales by deactivated
staff" filter in POS Reports.

## Case 3 — Stock oversold across channels

**Scenario.** Tablet 1 cached "5 burgers in stock" at 9am. Web POS
sells 5 burgers between 10am and 11am. Tablet 1 offline at 11:30am
rings a burger. At 12pm Tablet 1 syncs — `decrement_stock_atomic`
raises `INSUFFICIENT_STOCK`.

**Conflict-causing fields.** `menu_items.stock_qty`.

**Resolution policy.**

- **ACCEPT-AND-FLAG.** Per [07 § Phase 3](./07-phases.md#phase-3--offline-stock--oversell-policy):
  - When the calling sale has a non-NULL `terminal_id` AND
    `decrement_stock_atomic` returns `INSUFFICIENT_STOCK`, the route
    **commits the sale anyway** with `pos_sales.oversold = true`.
  - Per affected line, a row goes into `pos_oversell_events`
    (already designed in [06 § Phase 3](./06-schema-changes.md#phase-3--offline-stock--oversell-policy)).
  - `menu_items.stock_qty` may go negative as a consequence — admin
    sees the shortfall, reconciles real inventory.
- For **online web POS** (no `terminal_id`), the rule is **REJECT** as
  today: hard 409, customer-facing flow refunds the line item.

**Why this asymmetry.** Online sales can be stopped mid-checkout. The
customer hasn't paid yet. Offline sales already happened — cash is
real, food was served. We can't unring.

**Admin visibility.** Per-item "oversold today" panel in POS Reports.

## Case 4 — Two tablets at the same physical till location

**Scenario.** Cashier A's tablet dies at 11am during service. Admin
swaps in a backup tablet (Tablet B). Both tablets had been used during
the same shift. Both have offline sales queued.

**Conflict-causing fields.** Receipt-number uniqueness — but solved
by per-terminal prefixes. The real question: do reports group both
tablets as "Front Counter" or list them separately?

**Resolution policy.**

- Each tablet has its **own `pos_terminals.id` and `prefix`** (e.g.
  T1A and T1B). Receipt numbers never collide.
- POS Reports show **per-terminal breakdown** with admin grouping
  optionally by `label` (so "Front Counter T1A" and "Front Counter
  T1B (replacement)" can sum together visually if labeled the same).
- Each tablet's `pos_terminals.last_seen_at` tells admin which is
  active.
- **No data loss, no conflict** — the per-terminal namespace was
  designed for exactly this case.

**Recommended operational pattern.** When swapping in a backup
tablet, admin renames the dead tablet's `label` to e.g. "Front
Counter T1A (broken)" and sets `active = false` AFTER all its
queued sales sync. Cleanup, not conflict.

**Implementation.** Already covered by Phase 2 schema + routes.
No additional work.

## Case 5 — Tablet clock drift

**Scenario.** Tablet's system clock is set 2 hours behind (battery
died, came back wrong). Cashier rings a sale at "real" 1pm, tablet
records `client_created_at` as 11am. Sale syncs at real 1:05pm,
`synced_at` = 1:05pm. Report for "9am-12pm" includes the sale; report
for "12pm-3pm" excludes it.

**Resolution policy.**

- Stamp **both** `client_created_at` (from the tablet) and
  `synced_at` (from the server, default `now()`).
- If `synced_at - client_created_at > 1 hour`, flag the sale with
  a new column **`pos_sales.clock_drift_seconds integer`** = the
  signed delta in seconds. Admin sees a small badge.
- **Reports default to `client_created_at`** for "when was this rung
  up" semantics (matches receipt time), but the dashboard has a
  toggle to switch to `synced_at` for "when did the cash hit the
  system" semantics.
- Admin can manually correct `pos_sales.date` via the existing
  void+re-record flow if drift caused a tax-period mismatch.

**Why not auto-correct.** Auto-rewriting client time is wrong — if
the tablet's clock IS correct and the network was just slow, we'd be
back-dating real sales. Surface the drift, let admin decide.

**Implementation.** Phase 1.6 schema add: `pos_sales.clock_drift_seconds`.
Phase 1.6 route change: route computes drift at insert.

## Case 6 — Long offline tablet (>72h, then >7d)

**Scenario.** Tablet is off / network-disconnected for 5 days. Reopens.
Local cache is 5 days old.

**Resolution policy.**

- **0-24 hours:** business as usual. Banner: "Last menu refresh: X
  hours ago" hidden by default.
- **24-72 hours (soft stale):** sales still ring up, banner visible
  on Sale tab: "Menu may be out of date — reconnect when possible."
- **72h - 7 days (hard stale for menu):** Sale tab disabled. Banner:
  "Menu has not refreshed for X days. Reconnect to continue selling."
  Outbox drain still runs in the background.
- **>7 days (hard stale for credentials):** Offline PIN login refused.
  Cashier must come online.

**Implementation.** Phase 1.6 reads cache age from `kv_cache.updated_at`
and gates the UI accordingly. Cache age check runs on Sale tab mount
and every 5 minutes thereafter.

**Operational pattern.** A tablet that's been offline 7+ days is
either lost, broken, or being deliberately rolled back. Either way,
forcing a manual sync before more sales is correct.

## Case 7 — End-of-day report run while a tablet is still offline

**Scenario.** Manager runs "Today's totals" at 11pm close. Tablet 2
has been offline since 7pm with 23 sales queued.

**Resolution policy.**

- Dashboard polls `/api/pos/terminals` to get **all active terminals**.
- For each terminal, server returns `last_sync_at`. If any terminal
  has `last_sync_at < midnight-today + reporting-window` AND has had
  any activity today, dashboard shows a **persistent yellow banner**:

  > "⚠ Reports may be incomplete: Terminal T2 last synced at 6:47pm —
  > sales after that aren't in this view. [Wait for sync] [Show
  > anyway]"

- A **"Show anyway"** button records an `admin_acknowledged_partial`
  flag in the report metadata so the printed report carries
  "(partial — N tablets pending sync at 23:00)" in the footer.
- A **"Wait for sync"** button polls every 30s until the terminal
  reports in OR a 10-minute window expires.

**Why this matters.** A manager making a banking decision based on
incomplete totals could double-deposit or short-deposit. The banner
makes the gap unmistakable.

**Implementation.** Phase 1.6 dashboard banner + status read of
`pos_terminals.last_sync_at`.

## Case 8 — Mid-sync interruption (drain killed half-way)

**Scenario.** Outbox has 10 entries. Drain syncs 5. Process killed.
Entries 6-10 marked `pending`; entry 5 is `syncing` because it was
in-flight when killed; entries 1-4 are gone (dequeued).

**Resolution policy.**

- Any entry stuck in `syncing` status with
  `now() - last_attempt_at > 2 minutes` is **auto-reset to `pending`**
  on the next drain pass.
- The 2-minute window is comfortably longer than any reasonable
  request timeout (the route has a 15-second timeout in
  [posOutbox.ts](../../app/src/lib/posOutbox.ts) — well under 2 min).
- This handles browser-closed, OS-killed-process, device-asleep, and
  WebView-crashed scenarios uniformly.
- The drain function's module-level latch prevents two drains from
  fighting over the same row.

**Implementation.** Phase 1.5 — add the 2-min auto-reset to
`drainOutbox()`. Currently TODO.

## Case 9 — Server-side schema migration during an offline period

**Scenario.** Phase 3 adds `pos_sales.oversold` column. A tablet was
offline for the deploy. Comes back online. Its queued sales don't
include `oversold` in the payload.

**Resolution policy.**

- All new columns are **additive with safe defaults** — see
  [06-schema-changes.md "Phase 1 — Offline outbox plumbing"](./06-schema-changes.md#phase-1--offline-outbox-plumbing).
  A missing `oversold` in the payload simply means the DB default
  (`false`) fires.
- Zod schemas treat new fields as **optional** in the create payload.
- This is policy: **every offline-relevant schema change in this
  project is additive.** Destructive migrations (drop column, rename
  column, change type) are coordinated with a forced-update of all
  tablets first.

**Implementation.** Already a discipline rule in
[06-schema-changes.md "Discipline rule"](./06-schema-changes.md). This
case re-asserts it as a conflict policy.

## What this doc does NOT promise

- **Two cashiers offline create the same new customer** → both rows
  land. De-duplication is a manual admin tool (Phase 6).
- **Two tablets offline edit the same customer** → LWW per case 1.
  The "losing" edit shows up as a failed outbox entry the cashier sees.
- **Recovering from a corrupted SQLite database** → out of scope.
  If the local DB is corrupted, the tablet must go online, log out,
  log in (cache repopulates), and re-pair with the terminal. Any
  unsynced sales in the corrupted DB are lost. Mitigation: WAL
  journaling (a SQLite default) and the small 2-min sync auto-reset
  window keep the exposure window tiny.
- **Network partition that splits tablets but keeps cloud reachable**
  — handled identically to a normal offline period, no special case.

## Summary

The plan handles every concrete conflict scenario named so far with
a documented policy. The unsolved class is "two offline mutations of
the same record without an external truth to resolve from" — for
loyalty/sales/stock we have external truth (the sales rows
themselves). For customer profile mutations the policy is LWW with a
409 surface, which is honest about losing some data but never silent.

If a real-world conflict surfaces that isn't covered here, add a
section to this doc before shipping the code that resolves it. That
discipline is the whole point.
