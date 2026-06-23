# POS Offline — CURRENT STATUS & PLAN  (single source of "where are we")

_Last updated: 2026-06-23. Branch: `feat/pos-offline`._
Detailed roadmap: [07-phases.md](./07-phases.md) · Decisions: [09-decisions.md](./09-decisions.md)

## TL;DR
A **single-tablet, offline-capable Android POS** is **built and device-verified**:
install → cold-start with no internet → offline PIN login → cached menu+images →
ring cash/card sale → reconnect → sync. DB encrypted at rest. `main` has been
merged in. Remaining work is multi-tablet (optional), printing (needs hardware),
and the operational steps (merge to main, deploy a backend).

## Per-tab offline plan
**Wave 1 — DONE (2026-06-23, easy, no conflicts):**
- Nav: Collection / Table Service / Reservations greyed + non-tappable offline (bounce to Sale).
- Staff: read-only offline (Add disabled + banner). Settings General/Receipt: read-only (Save disabled + guarded). Customers: Add disabled + banner (view + assign still work).

**Wave 2 — TODO (hard / has conflicts):**
1. **Offline VOID** (Dashboard) — outbox must become an op-queue (insert+void) with ordering+conflicts. Start with voiding *current-session unsynced* sales only; block voiding already-synced sales offline.
2. **Dashboard offline view** — cache the sales list + merge with outbox to show local sales offline (banner: "may be incomplete"). Moderate; low conflict.
3. **Settings·Menu offline editing** — doable via existing menu-sync, but **last-write-wins can clobber web/admin menu edits**. Safe only if the tablet is the sole menu editor.
4. **Settings·Hardware** — config offline+sync (moderate); the actual printing is **Phase 6** (device-local, needs a physical printer).
5. **Loyalty** — earning auto-syncs on sale insert (no work). **Redemption offline = block** (stale-balance/double-spend risk).
6. **Finer read-only polish** — visually disable the remaining edit/delete/toggle buttons in Staff/Customers detail panels (today they fail safely but aren't greyed).

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
| **Phase 3 — offline stock / oversell** | Only if you track inventory. |
| **Phase 6 — offline printing** | Needs a physical thermal printer (BT/USB/TCP). |
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
