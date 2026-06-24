# POS Offline — CURRENT STATUS & PLAN  (single source of "where are we")

_Last updated: 2026-06-23. Branch: `feat/pos-offline`._
Detailed roadmap: [07-phases.md](./07-phases.md) · Decisions: [09-decisions.md](./09-decisions.md)

## TL;DR
A **single-tablet, offline-capable Android POS** is **built and device-verified**:
install → cold-start with no internet → offline PIN login → cached menu+images →
ring cash/card sale → reconnect → sync. DB encrypted at rest. `main` has been
merged in. Offline thermal printing (BT/USB/TCP, native) and offline void +
cached dashboard are now built. Remaining work is multi-tablet (optional),
**verifying printing on the physical printer**, and the operational steps
(merge to main, deploy a backend).

## Per-tab offline plan
**Wave 1 — DONE (2026-06-23, easy, no conflicts):**
- Nav: Collection / Table Service / Reservations greyed + non-tappable offline (bounce to Sale).
- Staff: read-only offline (Add disabled + banner). Settings General/Receipt: read-only (Save disabled + guarded). Customers: Add disabled + banner (view + assign still work).

**Wave 2 — mostly DONE (only printing left):**
1. ✅ **Offline VOID** (Dashboard) — DONE (2026-06-23, Option A = full cancel only). Voiding a *current-session unsynced* sale drops its outbox entry (`cancelQueuedSale`); no refund/loyalty reversal (the sale never reached the server). Voiding an *already-synced* sale is blocked offline with a "needs internet" message. The void modal collapses to a single "Cancel Sale (offline)" action when offline. Bypasses the `pendingRevalidation` gate (undoing your own unsynced sale is benign).
2. ✅ **Dashboard offline view** — DONE (2026-06-23). `fetchSales` writes a `sales_snapshot` on every success; offline it rebuilds the list from snapshot + outbox (precedence cached < outbox < current state, so nothing on screen is lost). Amber "Offline — showing cached sales / may be incomplete" banner on the dashboard.
3. ✅ **Settings·Menu offline editing** — DONE as **read-only** (2026-06-23, commit f548ccb). No offline menu editing (avoids last-write-wins clobbering web/admin edits); "menu editing needs internet" panel.
4. ✅ **Offline thermal printing** — DONE in code (2026-06-24); **needs the physical printer to verify**. POS sales now print ESC/POS to the configured printer via a **native-first dispatcher** (`src/lib/posPrint.ts`): Bluetooth (SPP), USB (native host), and Network (direct device→printer TCP) — all work **with no server (offline)** on the Android app; web falls back to the `/api/print` proxy / Web USB. New `buildPOSReceiptBytes` (POSSale→ESC/POS, width-aware, "OFFLINE SALE" label). Wired into the POS receipt modal (Print button + **auto-print on sale** when `printer.autoPrint`), and the Settings·Hardware test print now exercises the exact same path + has an **80/58 mm** selector. Native plugins (`BluetoothPrinterPlugin`/`UsbPrinterPlugin`/`TcpPrinterPlugin`) are real implementations, registered in `MainActivity`, with BT/USB-host permissions in the manifest. **No admin creds needed** — `/api/print` + `/api/email` already accept POS sessions.
5. ✅ **Loyalty** — DONE (no-op, 2026-06-23). Earning auto-syncs on sale insert; there is **no POS-side redemption UI**, so nothing to block. Full-cancel void needs no loyalty reversal.
6. ✅ **Finer read-only polish** — DONE (2026-06-23, commit f548ccb). Staff Edit/Delete + toggle handlers and Customers Edit are disabled offline.

_Known v1 limitations:_ offline-cancelling a queued sale at the exact instant a reconnect-drain is POSTing it is a narrow race (sale may land on the server yet show cancelled locally until the next login re-fetch); the dashboard doesn't re-`fetchSales` on reconnect (refreshes on next login) — both acceptable for single-terminal v1.

Bigger separate phases: Phase 2 per-terminal receipts (optional), Phase 3 stock/oversell, Phase 6 printer hardware, merge→main, deploy backend.

## ✅ DONE & device-verified
- **Phase 1** — offline outbox + sync (sale offline → reconnect → drains to server; idempotent on UUID `id`; stuck-`syncing` auto-recovery).
- **Phase 1.5** — bundled static export (`npm run build:capacitor` → `out/`), `apiBase()` prefixes all `/api` calls, `CapacitorHttp` for cross-origin, dual-mode `capacitor.config.ts`, root `index.html` redirect.
- **Phase 1.6** — caches in encrypted SQLite (`kv_cache`): menu, item images (base64, self-invalidating), staff picker, settings (offline tax/currency = last-known), customers. Stale-cache "menu last updated N ago" banner.
- **Phase 4** — offline PIN login (cached bcrypt, reuse session cookie, reconnect revalidation via existing 15s poll), **DB encrypted at rest** (Keystore-backed), void/refund blocked until revalidation (`pendingRevalidation`).
- **Offline receipt numbers** — `OFF<seq>` from 1000 (readable, mirrors `R<seq>`); every receipt view shows **"OFFLINE SALE"**; admin reports + dashboard show an OFFLINE badge.

## 🔢 Receipt numbering (decided)
- **Online** → `R<seq>` (server, atomic, from 1000). **Offline** → `OFF<seq>` (device-local counter from 1000). Different by design — standard POS pattern.
- **Single terminal for now.** Multi-terminal `T<prefix>-<seq>` is **deferred & optional** (no live collision today). If ever added, the prefix must **NOT be "T"** (dine-in tables are T1, T2…) — use `POS1`, `TILL1`, etc.

## ⬜ REMAINING
| Item | Status / when needed |
|---|---|
| **Merge `feat/pos-offline` → main** | Operational. **Also the permanent fix** for the recurring `client_created_at` DB error (see Gotchas). Do when ready. |
| **Deploy a real HTTPS backend** | So the APK uses a cloud server, not the laptop. Ends the WiFi/USB/firewall hassle. |
| **Phase 2 — per-terminal receipts** | **Optional** (readability/robustness for multi-tablet). Not a bug today. |
| **Phase 3 — offline stock / oversell** | **Reconciliation DONE (2026-06-24).** An offline sale ('OFF…' receipt) replayed by the outbox is now **never stranded** on a stock conflict: the sale route skips the hard availability rejections and force-decrements (`decrement_stock_atomic(p_items, p_force)` → oversell allowed, `stock_qty` may go **negative** as the visible "oversold offline" flag a manager reconciles). Online sales keep the hard limit. _Optional remainder:_ a best-effort **at-the-till** offline oversell guard (warn the cashier using cached counts) — not built; oversell is recorded + flagged, just not prevented live. Needs `npm run db:migrate` (done). |
| **Phase 6 — offline printing** | **Built (2026-06-24).** Code complete (native BT/USB/TCP, offline). Pending: verify on the physical thermal printer + confirm 80/58 mm layout. |
| Background sync worker | Limitation: offline sales sync only while the **app is open** (no background sync). |
| Deferred 1.6 audit columns | `customers.updated_at`, `staff_was_active`, `clock_drift_seconds` + admin badges. Reporting polish. |
| Encrypt-cache hardening note | bcrypt hashes are in the (now encrypted) DB — good. |

## ⚠️ GOTCHAS (these bit us — keep in mind)
- **Recurring `Could not find 'client_created_at' column`**: the offline columns live only in *this branch's* `supabase/schema.sql`. Running `npm run db:migrate` while on **main** (or resetting the DB) drops them. **Fix:** run `npm run db:migrate` while on **`feat/pos-offline`**. **Permanent fix:** merge to main. (Dev `.env.local` = the **live** Supabase DB — they're shared.)
- **Every POS-bundle `/api` fetch must use `apiBase()`** (incl. variable URLs like the connectivity probe + printer). Relative `/api` 404s in the bundled APK.
- **`build:capacitor` needs `npm run dev` STOPPED** (Next locks `src/app` on Windows → route-quarantine fails).

## 🧪 DEV / TESTING SETUP (laptop ↔ device)
- **Emulator (recommended, avoids network issues):** build with `CAPACITOR_API_URL=http://10.0.2.2:3000` → `npx cap sync android` → Android Studio Run ▶. `10.0.2.2` = the host laptop from inside the emulator.
- **Physical phone over USB:** build with `CAPACITOR_API_URL=http://localhost:3000`, then `adb reverse tcp:3000 tcp:3000`, run via Android Studio. Re-run `adb reverse` after replug.
- **Physical phone over WiFi:** build with `CAPACITOR_API_URL=http://<laptop-LAN-ip>:3000`; needs a Windows Firewall inbound allow rule for port 3000 (LAN-only) + same WiFi. Dev-server-in-phone-browser is slow (use `npm run build && npm run start` for speed).
- CLI `npx cap run android` needs `JAVA_HOME` (= `C:\Program Files\Android\Android Studio\jbr`); Android Studio's Run ▶ doesn't.

## Honest "is it done?"
- **Single tablet, screen/email receipts, app stays open, with a deployed backend:** yes, functionally complete.
- **Multiple tablets:** works today (receipts don't collide); Phase 2 only for prettier per-till numbers, Phase 3 for stock.
- **Printed receipts:** need Phase 6 (hardware).
