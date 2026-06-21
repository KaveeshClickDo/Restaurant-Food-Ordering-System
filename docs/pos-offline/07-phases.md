# 07 · Phases — work plan

Six phases. Each is shippable on its own. Phases land in order; each
gates the next via acceptance criteria. Web `/pos` continues working
across every phase boundary — that's the hard constraint, see
`00-architecture.md`.

## Phase summary

| Phase | Name | Effort | Depends on | Ships value |
|---|---|---|---|---|
| 0 | Proof of life | done (software) | — | Sets baseline; hardware checks deferred to Phase 6 |
| 1 | Offline outbox + native shell | ~~3–5 days~~ done | Phase 0 | Sales survive outages on Android |
| **1.5** | **Bundled assets — cold-start UI offline** | **1 day** | **Phase 1** | **Cold-boot tablet renders POS UI without internet** |
| **1.6** | **Data cache hydration — cold-start data offline** | **2 days** | **Phase 1.5** | **Menu / customers / settings load from cache offline; conflict-policy columns shipped** |
| 2 | Per-terminal receipt numbering | 2–3 days | Phase 1 | Multi-tablet deployment safe |
| 3 | Offline stock + oversell policy | 2 days | Phase 1 | Admin can reconcile stock after outages |
| 4 | Offline PIN auth | 1–2 days | Phase 1.6 | Cashier can log in offline |
| 5 | Service worker + manifest re-enable | 1 day | — (can land anywhere) | Browser/PWA gains offline shell too |
| 6 | Hardware verification + offline printing | 2–4 days | Hardware availability | Offline paper receipts |

**Total: 12–18 working days.** Phase 1 already complete. Phases 1.5 +
1.6 are inserted as a result of the scale-thinking review (see
[09-decisions.md](./09-decisions.md) entries from 2026-05-29) — they
close the cold-start offline gap that Phase 1 alone leaves open.

---

## Phase 1 — Offline outbox + native shell

Restore the half-built offline path. After this phase, an Android
tablet running the Capacitor build of the POS can ring up cash sales
without internet, queue them locally, and sync when reconnected.

### 1.1 Files touched

**Schema** (see [06-schema-changes.md § Phase 1](./06-schema-changes.md#phase-1--offline-outbox-plumbing)):
- `supabase/schema.sql` — add `pos_terminals` table + columns on `pos_sales`

**New files:**
- `app/src/lib/posOutbox.ts` — IndexedDB-backed outbox (replacement for the deleted version, now targeting `/api/pos/sales` and the new payload shape)
- `app/src/lib/posLocalDb.ts` — Capacitor SQLite wrapper for menu/customer cache (used only when `isCapacitorAndroid()`)
- `app/src/app/api/pos/terminals/route.ts` — POST: register a terminal (returns `id` + `prefix`); GET: list registered terminals
- `app/src/app/api/pos/terminals/[id]/route.ts` — PATCH: rename / deactivate

**Edited files:**
- `app/src/context/POSContext.tsx` — `completeSale` gains a fallback: when the POST fetch fails AND `isCapacitorAndroid()`, enqueue to the outbox + return optimistically with a locally-minted receipt placeholder. New `useEffect` to drain the outbox on reconnect (mirrors the deleted pre-`242be44` pattern).
- `app/src/app/pos/page.tsx` — add the `outboxCount` indicator + the "syncing N offline sales" banner above the existing offline banner. (The current page only shows the "no internet" banner; the pending-sync indicator needs to be added.)
- `app/capacitor.config.ts` — comment update; no behaviour change.
- `app/src/app/api/pos/sales/route.ts` — accept optional `receiptNo` + `terminalId` + `clientCreatedAt`. Server-side validation that the prefix matches the calling session's terminal. **The schema for these is finalised in Phase 2; in Phase 1 the route accepts them as opaque pass-throughs only when present.**

**Verified already in place (no edit needed):**
- `PaymentModal.tsx` already accepts `isOffline` (line 12). Card / Split stay **enabled** offline (the standalone terminal authorises independently); only the gift card input is disabled and the banner shows "confirm card on terminal before tapping Payment Received." See [09-decisions.md § 2026-05-29](./09-decisions.md). Phase 1 changes nothing here.
- `SaleView.tsx` already passes `isOffline` through to PaymentModal (line 96). No change.
- `pos/page.tsx` already wires `useConnectivity()` and passes `isOffline={!isOnline}` to SaleView (lines 65, 215). The existing offline banner (lines 197-209) stays; we add a sibling "pending sync" banner.
- The 7-tab nav, permission gating, `?tab=` deep-linking, dining-tables polling — all stay untouched.

**Android files:**
- `app/android-src/app/src/main/java/com/restaurant/pos/MainActivity.kt` — re-copy into `app/android/.../MainActivity.kt` (it's stale — see [03-audit-android.md § Seam 1](./03-audit-android.md))
- `app/android-src/app/src/main/java/com/restaurant/pos/sync/OutboxSyncWorker.kt` — rewrite to read from Capacitor SQLite (or invoke a `evaluateJavascript` drain) instead of SharedPreferences
- `app/android-src/app/src/main/java/com/restaurant/pos/sync/MenuSyncWorker.kt` — same, or delete if menu caching moves entirely to JS-side
- Re-run `android-setup.sh` (with the fix to actually re-copy MainActivity even on re-runs)

**Capacitor dependency:**
- `npm install @capacitor-community/sqlite` — adds the SQLite plugin

### 1.2 Acceptance criteria

A reasonable person could run these checks manually on any Android
tablet (Android 8.0+, no printer needed).

1. ✅ Web `/pos` works identically to today. Take a screenshot of a
   successful sale on web before merging; repeat after merging; UI and
   API responses identical.
2. ✅ Capacitor build of `/pos` loads successfully on Android with
   internet enabled. Cashier can ring up + complete a sale exactly like
   web. Sale appears in admin POS Reports immediately.
3. ✅ With airplane mode on the tablet, cashier can still log in
   (cached session cookie carries over from the prior online session
   — Phase 4 adds first-time-offline login), add items to cart, and
   complete a **cash or card** sale. Card / Split stay enabled (the
   standalone terminal authorises on its own); only gift card is
   disabled with a clear "unavailable offline" label.
4. ✅ Offline-completed sale appears in the on-screen sales history
   immediately, marked with a "Pending sync" badge.
5. ✅ Bottom of `/pos` shows "1 sale pending sync" indicator. Indicator
   updates as more sales are completed offline.
6. ✅ When airplane mode turns off, within ~30 seconds the outbox
   drains. The admin POS Reports panel shows the previously-offline
   sale with correct totals.
7. ✅ Each offline sale's `pos_sales.client_created_at` is the time it
   was rung up; `pos_sales.synced_at` is the time it landed on the
   server. Times differ by the offline duration.
8. ✅ Admin POSReportsPanel + admin customer-list `totalSpend`
   regression test: snapshot a known sales total before merging Phase
   1; after merging, totals match exactly (the additive schema change
   doesn't shift any read).

### 1.3 Out of scope (deferred to later phases)

- Offline PIN login (Phase 4)
- Receipt numbers respecting the terminal prefix at the server (Phase 2)
- Oversold-stock policy on sync (Phase 3 — Phase 1 server just rejects on stock conflict and the sale stays in retry)
- Paper receipt printing for offline sales (Phase 6)
- Service worker for browser PWA (Phase 5)

### 1.4 Known risks (recorded for `08-risk-register.md`)

| Risk | Mitigation |
|---|---|
| IndexedDB quota exhaustion on a busy day | Retention pruning every 100 outbox entries: failed entries older than 7 days move to a "stuck" table the admin can inspect |
| Capacitor SQLite plugin version drift | Pin exact version in `package.json`. Wait one minor version before updating in production |
| Service worker double-registration when both PWA and Capacitor present | Phase 5 registers SW only when `!isCapacitorAndroid()` |

---

## Phase 1.5 — Bundled assets · cold-start UI offline

> **Status (2026-06-22):** static export + API wiring working.
> `npm run build:capacitor` exports `/pos` + `/pos/login` to
> `out/pos/index.html` etc. (both `○ Static`); the web build is
> unaffected. `apiBase()` ([lib/apiBase.ts](../../app/src/lib/apiBase.ts))
> now prefixes all 47 POS-tree `/api/*` fetches — empty on web, the baked
> `CAPACITOR_SERVER_URL` in the Capacitor build (verified inlined).
> As-built mechanism (route quarantine + single env-gated
> `next.config.ts`) is in [09-decisions.md § 2026-06-22](./09-decisions.md).
> `capacitor.config.ts` is now **dual-mode**: `CAPACITOR_SERVER_URL` set →
> server mode (dev); unset → bundled mode (`webDir:"out"`, offline).
> **Remaining (needs Android toolchain, off this machine):**
> `CAPACITOR_API_URL=… npm run build:capacitor` → `npx cap sync` →
> `npx cap open android`, then the **first on-device rebuild/test** since
> the merge. (The `getDbSettings()` hoist 1.5.1/1.5.5 proposed is **not
> needed** and would mildly regress offline first-paint — see
> [09-decisions.md § 2026-06-22](./09-decisions.md). Real offline settings
> are Phase 1.6's SQLite cache.)

After Phase 1, the Android tablet still needs internet on **first
launch** to load the `/pos` page over HTTPS. Phase 1.5 closes this gap
by bundling the static export of the POS routes into the APK itself.
After this phase, opening the app with no internet renders the UI from
device storage — only API calls fail (which Phase 1.6 then mitigates by
hydrating from local cache).

This phase also lands the 2-minute auto-recovery in `posOutbox.ts` for
entries stuck in `syncing` status — per
[13 § Case 8](./13-conflict-resolution.md#case-8--mid-sync-interruption-drain-killed-half-way).

### 1.5.1 Files touched

**New files:**
- `app/next.config.capacitor.ts` — Next.js config variant with
  `output: "export"`, scoped via path-rewrites or build-time route
  filtering so only `/pos` and `/pos/login` end up in `out/`.
- `app/src/lib/apiBase.ts` — module exporting `apiBase()`. Returns `""`
  on web (relative URLs work) and the baked-in server URL when running
  inside Capacitor bundled mode.

**Edited files:**
- `app/capacitor.config.ts` — remove the `server.url` block. Add
  `appendUserAgent: "RestaurantPOS"` so server routes can log Capacitor
  hits separately if useful.
- `app/package.json` — new script `build:capacitor` that sets
  `NEXT_CONFIG=capacitor` and runs `next build`, then `npx cap sync
  android` to copy the export into the Android assets directory.
- `app/src/context/POSContext.tsx` — every `fetch("/api/...")` becomes
  `fetch(apiBase() + "/api/...")`. Roughly a dozen call sites.
- `app/src/lib/posOutbox.ts` — drain logic gains 2-minute auto-recovery
  for rows stuck `syncing` (per [13 § Case 8](./13-conflict-resolution.md)).
- Every API call in `app/src/components/pos/**.tsx` — same `apiBase()`
  wrapping. Roughly 30-50 call sites; can be done with a codemod or
  search-and-replace.

**Hoisted off the server side (for export compatibility):**
- `app/src/app/layout.tsx` — `getDbSettings()` currently runs at request
  time via Supabase REST fetch. For Capacitor's static export this
  call must be hoisted client-side (POSContext can fetch on mount when
  online). Keep the server-side path for the **web** build by using a
  conditional in the layout: only `getDbSettings()` when not exporting.

### 1.5.2 Acceptance criteria

1. ✅ Web `/pos` still works byte-identically. `apiBase()` returns `""`
   on web, so existing fetch calls are unchanged.
2. ✅ `npm run build` (web) succeeds; `npm run build:capacitor` (Android)
   also succeeds with a populated `out/` directory containing
   `out/pos/index.html` and `out/pos/login/index.html`.
3. ✅ APK built from `npm run android:build` opens in airplane mode on
   a tablet that has never seen the internet, and the `/pos/login`
   PIN-picker screen renders.
4. ✅ Once online, PIN login completes, POS hydrates from server
   normally. Online flow unchanged from Phase 1.
5. ✅ `drainOutbox()` resets a `syncing` entry whose `last_attempt_at`
   is > 2 minutes ago back to `pending` on the next drain pass.

### 1.5.3 Out of scope

- Offline login (Phase 4 — cached `pin_hash`).
- Menu / customer / settings hydration when cold-start offline
  (Phase 1.6).
- iOS support (Kotlin printer plugins are Android-only).

### 1.5.4 Conflict policies resolved

| Conflict | Policy doc | Resolved how |
|---|---|---|
| Mid-sync interruption | [13 § Case 8](./13-conflict-resolution.md#case-8--mid-sync-interruption-drain-killed-half-way) | 2-min auto-reset in `drainOutbox()` |

### 1.5.5 Known risks

| Risk | Mitigation |
|---|---|
| Static export fails because of root-layout server fetch | Hoist the fetch to client-side conditional; verified in Phase 0 that `/pos` is `○ Static`. |
| Two build configs drift apart | Single `next.config.capacitor.ts` extends the main config (uses `...require("./next.config")`), only overriding `output`. |
| WebView can't resolve `apiBase()` URL (mixed-scheme issue) | The URL is baked in at build time as HTTPS; matches network_security_config.xml's existing whitelist. |
| Static export skips a needed route | Verify via `out/` directory inspection in CI. |

---

## Phase 1.6 — Data cache hydration · cold-start data offline

After Phase 1.5 the UI renders offline; this phase makes the UI
**usable** offline by populating menu / customer / settings caches and
serving them when the server is unreachable. Also lands the schema +
route changes required by the conflict-resolution policies in
[13-conflict-resolution.md](./13-conflict-resolution.md).

### 1.6.1 Schema additions

Append to [06-schema-changes.md](./06-schema-changes.md) — additive,
nullable / defaulted, no migration of existing rows:

```sql
-- For LWW on customer profile fields ([13 § Case 1](./13-conflict-resolution.md#case-1))
alter table customers add column if not exists updated_at timestamptz default now();

-- For deactivated-cashier audit ([13 § Case 2](./13-conflict-resolution.md#case-2))
alter table pos_sales add column if not exists staff_was_active boolean not null default true;

-- For clock-drift surface ([13 § Case 5](./13-conflict-resolution.md#case-5))
alter table pos_sales add column if not exists clock_drift_seconds integer;
```

### 1.6.2 Files touched

**New files:** None (extending existing modules).

**Edited files:**
- `app/src/lib/posLocalDb.ts` — already has `kv_cache`; this phase
  defines the keys per [12-sync-protocol.md](./12-sync-protocol.md):
  `menu_snapshot`, `customers_snapshot`, `settings_snapshot`,
  `staff_picker_snapshot`, `reservations_today`, `dining_tables_snapshot`,
  `terminal_self`.
- `app/src/context/POSContext.tsx`:
  - On hydration: try server first; on network failure, fall back to
    SQLite cache. Show stale banner if cache age > soft threshold.
  - On successful server response: write fresh snapshot to cache with
    timestamp.
  - Stale-cache UI gates (refuse Sale tab if menu cache > 24h hard).
- `app/src/app/api/pos/customers/[id]/route.ts` — PATCH accepts
  optional `clientCreatedAt`. Returns 409 if `customers.updated_at` is
  newer than the incoming `clientCreatedAt` (LWW collision).
- `app/src/app/api/pos/sales/route.ts`:
  - On insert: re-lookup `pos_staff.active` and stamp
    `staff_was_active`.
  - On insert: compute `clock_drift_seconds = (synced_at -
    client_created_at) | epoch_seconds` and stamp.
- `app/src/components/admin/POSReportsPanel.tsx` — new badge column for
  `staff_was_active = false` and `clock_drift_seconds > 3600`. New
  filter "Sales by deactivated staff" and "Drift > 1h".

### 1.6.3 Acceptance criteria

1. ✅ Web `/pos` unchanged. All hydration tries server first; cache is
   only consulted on failure.
2. ✅ Tablet cold-start offline (Phase 1.5 + 1.6): UI renders, last-
   known menu snapshot loads, last-known customer list loads. Sale tab
   functional. Cashier can ring sales.
3. ✅ Cache age banner shows when soft-stale (per
   [13 § Case 6](./13-conflict-resolution.md#case-6) thresholds).
4. ✅ Sale tab disabled when hard-stale (menu > 24h).
5. ✅ Customer PATCH with older `clientCreatedAt` returns 409. Outbox
   surfaces the rejected change to the cashier.
6. ✅ Offline sale by a cashier deactivated mid-shift syncs with
   `staff_was_active = false`. Admin POSReportsPanel shows the badge.
7. ✅ Clock-drift sale (test by setting tablet clock 2 hours back)
   syncs with `clock_drift_seconds` populated. Admin sees the badge.
8. ✅ **Local stock decrement for UI feedback:** when an offline sale
   completes, the on-screen "X in stock" counter on the Sale tab ticks
   down by the sold quantity immediately. This is purely a UI hint —
   the server is still the truth (no client write to `menu_items`).
   When the tablet syncs and a new menu pull happens, the on-screen
   count snaps to the server value (which may differ if other channels
   sold the same item — see [13 § Case 3](./13-conflict-resolution.md#case-3)).
   Cart guard: if local cached `stock_qty` reaches 0 AND
   `track_stock = true`, the "Add to cart" button is disabled with
   "Out of stock" copy. Override permission may force-add (Phase 3).

### 1.6.4 Out of scope

- Offline customer create (deferred to Phase 6 — minor risk of
  duplicate creates needs admin de-dup tool).
- Offline reservations / dine-in / table management (Phase 6+).
- Settings edits offline (always blocked — see
  [11 § Settings](./11-offline-scope.md)).

### 1.6.5 Conflict policies resolved

| Conflict | Policy doc | Resolved how |
|---|---|---|
| Customer profile concurrent edits | [13 § Case 1](./13-conflict-resolution.md#case-1) | LWW via `updated_at` + 409 on out-of-order patch |
| Deactivated cashier mid-shift | [13 § Case 2](./13-conflict-resolution.md#case-2) | `staff_was_active` stamp + admin badge |
| Clock drift | [13 § Case 5](./13-conflict-resolution.md#case-5) | `clock_drift_seconds` stamp + admin badge |
| Long-offline stale data | [13 § Case 6](./13-conflict-resolution.md#case-6) | Tiered banner/refusal per cache age |

### 1.6.6 Known risks

| Risk | Mitigation |
|---|---|
| LWW false-409 from clock-drifted clients | Server clamps incoming `clientCreatedAt` if drift > 1h; uses `now()` instead and logs the divergence. |
| Cache size grows unbounded | Limit `customers_snapshot` to 5000 most-recent rows; trim on each refresh. Same for `pos_sales` local mirror if added. |
| Stale-cache UI banner annoys cashiers during normal flaky-internet | Soft threshold is 4h for menu; not triggered by short outages. |

---

## Phase 2 — Per-terminal receipt numbering

After this phase, two tablets ringing up offline sales at the same time
produce non-colliding receipt numbers like `T1-1042` and `T2-1042`,
and the server validates the prefix matches the calling terminal.

### 2.1 Files touched

**Schema:** No new columns. The `pos_terminals.next_seq_no` from Phase 1
gains its server-side advance logic.

**Edited files:**
- `app/src/app/api/pos/sales/route.ts` — server-side validation of
  client-supplied `receiptNo` (matches caller's terminal prefix, seq_no
  is monotonic). Transactional `update pos_terminals set next_seq_no = greatest(...)`
  in the same DB call as the sale insert.
- `app/src/lib/posOutbox.ts` — the outbox already supplies `receiptNo`
  from Phase 1; Phase 2 adds the per-terminal mint logic at sale time.
- `app/src/context/POSContext.tsx` — local receipt counter for the
  registered terminal; bootstrap from `pos_terminals.next_seq_no` on
  first online login.
- `app/src/components/pos/SaleView.tsx`, `ReceiptModal.tsx` — the
  receipt number rendering already takes a string, no UI work.

**New files:** None.

### 2.2 Acceptance criteria

1. ✅ Online web POS receipt numbers continue to look like `R1042`,
   `R1043`, etc. (the `pos_receipt_seq` default fires when no
   `receiptNo` is supplied).
2. ✅ Two tablets ringing offline sales in parallel produce receipts
   `T1-N` and `T2-N` for distinct `N`; no collision in `pos_sales`.
3. ✅ Server rejects a sale where `receiptNo` prefix doesn't match the
   calling terminal: `T1-1042` from a session bound to terminal `T2` is
   400'd.
4. ✅ Server rejects a `receiptNo` whose `seq_no` is below
   `pos_terminals.next_seq_no`: prevents re-use of an already-committed
   seq.
5. ✅ Idempotent replay still works: the same offline sale re-sent
   twice returns 200 with `duplicate: true` on the second attempt.

### 2.3 Out of scope

- Pre-allocated receipt ranges (not needed; the per-terminal scheme
  removes the global allocator).
- Receipt re-numbering after a terminal is removed (the receipt strings
  are immutable history).

---

## Phase 3 — Offline stock + oversell policy

After this phase, an offline sale whose stock has been consumed by
another channel between sale time and sync time *still completes*; the
inventory shortfall is flagged for admin reconciliation.

### 3.1 Files touched

**Schema:** see [06-schema-changes.md § Phase 3](./06-schema-changes.md#phase-3--offline-stock--oversell-policy):
add `pos_sales.oversold` + `pos_oversell_events` table.

**Edited files:**
- `app/src/app/api/pos/sales/route.ts` — when `terminal_id` is non-NULL
  AND `decrement_stock_atomic` returns `INSUFFICIENT_STOCK`, the route
  no longer hard-rejects. It commits the sale with `oversold = true`,
  inserts a row per affected line into `pos_oversell_events`, and
  records the shortfall in the response so the client can show a
  "this sale oversold" UI badge.
- `app/src/context/POSContext.tsx` — local stock cache decrement and
  graceful UI when the live cache says "0 in stock".
- `app/src/lib/posLocalDb.ts` — menu snapshot includes `stock_qty` at
  sync time.
- `app/src/components/pos/SaleView.tsx` — refuse to add an item to the
  cart when local cache shows `0` AND the operator does NOT have an
  override permission flag. (Keeps the cashier from accidentally
  oversold scenarios — though if the operator presses through with
  permission, the sale still goes.)

**New admin work:**
- `app/src/components/admin/POSReportsPanel.tsx` — new filter "Oversold
  only"; per-row badge for oversold sales; oversold totals card.

### 3.2 Acceptance criteria

1. ✅ Online web POS continues to receive a hard 409 on stock shortfall
   (no `terminal_id` ⇒ no oversell exception). Unchanged behaviour.
2. ✅ Offline tablet sells an item whose local cache shows 3 remaining,
   while online channels sell out the same item. On sync, the offline
   sale commits with `oversold = true`. `pos_oversell_events` has a row
   recording `requested = 1, available = 0`.
3. ✅ Admin POS Reports shows the oversold sale with a badge; the
   "Oversold only" filter surfaces it; the count totals card includes
   it.
4. ✅ Inventory shortfall is visible to the manager: a per-item summary
   ("Burger: 2 units oversold today") appears in the same panel.
5. ✅ Refund / void flows for an oversold sale do **not** call
   `restore_stock` (would create false inventory).

### 3.3 Out of scope

- Automatic stock reorder triggers — admin reconciles manually.
- Per-customer oversell notifications — out of scope; this is an admin
  view only.

---

## Phase 4 — Offline PIN auth

After this phase, a cashier can log into the POS from a fresh terminal
boot with no internet. The bcrypt PIN check happens locally against a
cached `pin_hash`, with server-side revalidation on every reconnect.

### 4.1 Files touched

**Schema:** No changes.

**New files:**
- `app/src/app/api/pos/staff/credentials/route.ts` — GET endpoint
  returning the caller's own `pin_hash` + `permissions` +
  `session_version`. Gated by an active POS session; returns only the
  session-owner's row.

**Edited files:**
- `app/src/lib/posLocalDb.ts` — cache table for staff credentials.
- `app/src/context/POSContext.tsx` — on successful online login, fetch
  `/api/pos/staff/credentials` and persist to the local cache. On
  offline login attempt, compare PIN against cached `pin_hash` via
  `bcrypt.compare`. On reconnect, refetch; if `session_version` differs
  from cache, invalidate the cache and force re-auth online.
- `app/src/app/pos/login/page.tsx` — wires the offline login path. UI
  identical to online; banner "Logging in offline — limited features
  until reconnected" when used.

**Library addition:**
- `bcryptjs` is already in `package.json` ([package.json:22](../../app/package.json#L22)).
  Already runs in the browser (pure-JS implementation, not the native
  `bcrypt` binding). No new dependency.

### 4.2 Acceptance criteria

1. ✅ Web `/pos/login` continues to work identically — the offline
   branch is gated by `isCapacitorAndroid() && !isOnline`.
2. ✅ First-time login on an Android tablet requires internet (the
   credentials cache doesn't exist yet). Standard PIN flow.
3. ✅ After successful online login, the cache is populated. Verify
   via SQLite browser on the device.
4. ✅ Reboot tablet, enable airplane mode, open POS app. Cashier can
   log in offline with the correct PIN. Incorrect PIN shows the same
   "Incorrect PIN" error as online.
5. ✅ Admin resets a cashier's PIN online (which bumps
   `pos_staff.session_version` per [auth.ts](../../app/src/lib/auth.ts)).
   When the tablet reconnects, the cached credentials are invalidated.
   On next login attempt the cashier is forced to enter the new PIN
   online.
6. ✅ Deactivating a cashier in admin (`active = false`) invalidates
   the cache on reconnect the same way.
7. ✅ Offline-login session expires after the same configured idle
   timeout as online (currently 30 min — `IDLE_TIMEOUT_MS` in
   POSContext).

### 4.3 Security notes

- `pin_hash` lives in SQLite on the device, **not** in localStorage or
  IndexedDB. SQLite via `@capacitor-community/sqlite` can be encrypted
  with a device-bound key (Android Keystore). Use this for the
  credentials table.
- The `/api/pos/staff/credentials` endpoint must enforce `where id =
  session.id`. An attacker with a stolen session cookie should not be
  able to read another cashier's hash.
- The endpoint must be rate-limited to a small N per minute per
  session, to prevent it being used as an oracle.
- After successful offline login, the next online connection MUST
  revalidate before the cashier is granted full permissions for
  destructive actions (void, refund, manager-only screens). A small
  helper gates these UI surfaces behind a `pendingRevalidation` flag.

---

## Phase 5 — Service worker + manifest re-enable

Independent of the Capacitor work. Lands whenever convenient. Gives
browser users a PWA-installable, offline-shell-capable POS.

### 5.1 Files touched

**New files:** None.

**Edited files:**
- `app/src/app/layout.tsx` — add `<link rel="manifest" href="/manifest.json" />`.
- `app/src/app/pos/page.tsx` — on mount in browser only (`!isCapacitorAndroid()`),
  call `navigator.serviceWorker.register('/sw.js', { scope: '/' })`.
  Wrapped in feature-detect (`if ('serviceWorker' in navigator)`).
- `app/public/sw.js` — no edit; existing strategy is correct. Bump
  `CACHE_NAME` from `pos-shell-v1` to `pos-shell-v2` when first
  deploying so old caches are wiped.

### 5.2 Acceptance criteria

1. ✅ Browser at `/pos` shows the PWA install prompt (Chrome's
   "Install" button in the URL bar) after the first visit.
2. ✅ After installing the PWA, second visit with airplane mode on
   loads `/pos` from the SW cache — the page renders.
3. ✅ With SW cache present, opening `/pos` works offline; API calls
   fail (as expected) and trigger the same "no internet" UI that
   Phase 1 added.
4. ✅ In the Capacitor build, the SW is **not** registered (verified
   by `isCapacitorAndroid()` gate). No double-registration confusion.
5. ✅ Web `/pos` page-load metrics on a hard-refresh remain within
   ±10% of current (SW registration overhead is negligible).

---

## Phase 6 — Hardware verification + offline printing

Self-contained. Starts when printer hardware is available.

### 6.1 Files touched

**Edited files (only if plugins need patches):**
- `app/android-src/app/src/main/java/com/restaurant/pos/plugins/*.kt`
- `app/src/lib/escpos.ts` — the offline branch: when offline, route
  print through the native plugin (`sendBluetooth` / `sendUsb` /
  `sendTcpNative`); when online, current logic (server proxy) still
  works.
- `app/src/components/pos/SaleView.tsx` — receipt modal: when offline,
  swap "Email receipt" for "Print receipt now" using the native plugin.

### 6.2 Acceptance criteria

The checklist from [phase-0-results.md § "What's NOT done"](./phase-0-results.md#whats-not-done--needs-hardware-preserved-for-phase-6).
Plus:

1. ✅ Offline tablet rings up a sale and prints a paper receipt via
   the configured printer mode (TCP / BT / USB).
2. ✅ Print failure (no printer reachable, etc.) shows a clear error
   but doesn't roll back the sale.
3. ✅ The kitchen ticket printer (if separate from the receipt
   printer) prints offline too — uses the same native plugin path.

### 6.3 If plugin patches are needed

Estimated max 2 days of Kotlin work per plugin. The current 472 lines
of plugin Kotlin look reasonable on inspection but are unverified.
Common failure modes and the fix size:

- BT permission prompt not appearing on Android 12+ → add 20 lines of
  runtime permission request in MainActivity. Small.
- USB descriptor parsing differs on a specific printer model → ~50
  lines of device-specific handling. Small.
- TCP plugin works but the printer is on a non-standard port → config
  surface only; no Kotlin change. Trivial.

---

## What happens between phases

Each phase ends with a **merge to main**. Web `/pos` deploys
unchanged behavior. Android build is **not** released between phases —
it ships only after Phase 4 minimum (offline PIN required for a
multi-cashier deployment). Phases 2 and 3 are required for
multi-terminal correctness; Phase 5 ships when ready; Phase 6 ships
when hardware is verified.

Decisions per phase get appended to `09-decisions.md` (to be created
when the first non-obvious choice arises in implementation).

## What we ship at each phase boundary

| After phase | What customers see |
|---|---|
| 1 | Internal: Android POS that survives **mid-session** outages. Cold-start still requires internet. |
| **1.5** | Internal: Android POS that **renders** offline from cold-start. Login + data still require internet. |
| **1.6** | Internal: Android POS that's **usable** offline from cold-start. Menu / customers / settings hydrate from cache. Login still online-only. |
| 2 | Internal: multi-tablet correctness — per-terminal receipt namespace. |
| 3 | Internal: oversell handling + admin reconciliation panel. |
| 4 | **First customer release of the Android POS.** Single- or multi-tablet, fully cold-start offline-tolerant including PIN login. Receipts via screen + email-on-sync. |
| 5 | Web `/pos` becomes a PWA. Browser users can install + use offline. Independent value, no Android coordination. |
| 6 | Offline paper receipts via native printer plugins. Closes the last UX gap. |
