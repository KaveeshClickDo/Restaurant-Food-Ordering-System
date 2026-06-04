# Phase 1 — Android APK build session, 2026-06-02

Session log so the next session (or a fresh context) can resume.
Read `pos_offline_android_project` memory + this file together.

## Current status

| Item | State |
|---|---|
| Phase 1 code (schema, routes, posOutbox, posLocalDb, POSContext, banner) | ✅ Committed before session |
| APK builds on Android (Pixel-style phone) | ✅ Verified |
| Test 1 (online sale, expects `R<seq>` receipt) | ⚠️ FAILED with `OFF-` initially → fix applied → **needs re-test** |
| Test 2 (offline cash + card) | ✅ PASSED |
| Test 3 (reconnect drain) | ✅ PASSED |
| Merge of `kaveesh` branch | ⚠️ Staged (auto-merged, build passes), **not yet committed** |
| Mirror MainActivity/build.gradle/network-security to `android-src/` | ❌ TODO |
| Decision log entries for session fixes | ❌ TODO |

## Bugs hit + fixes (in chronological order)

| # | Problem | Root cause | Fix |
|---|---|---|---|
| 1 | APK install rejected by phone (Xiaomi) | "Install via USB" toggle off | User flipped toggle in Developer options |
| 2 | App crashes on launch — `ClassNotFoundException: MainActivity` | Gradle wasn't compiling Kotlin files (no kotlin plugin) | Added `apply plugin: 'kotlin-android'` to `app/android/app/build.gradle` and `classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25'` to `app/android/build.gradle` |
| 3 | WebView shows "page not available" | Capacitor config had `cleartext: false` and `androidScheme: "https"` for an HTTP dev URL | Updated `app/capacitor.config.ts` to auto-detect HTTP URL and set cleartext/scheme accordingly |
| 4 | Still blocked — `network_security_config.xml` denied cleartext to LAN IP (192.168.1.16 not in 192.168.1.0 exact match) | Android `<domain>` does exact-host matching, not CIDR | Replaced strict allowlist with `<base-config cleartextTrafficPermitted="true">` in `app/android/app/src/main/res/xml/network_security_config.xml` |
| 5 | App opens website root instead of /pos | `CAPACITOR_SERVER_URL` had no path | Set `$env:CAPACITOR_SERVER_URL = "http://192.168.1.16:3000/pos"` |
| 6 | `crypto.randomUUID is not a function` on phone | `crypto.randomUUID` only works in secure contexts (HTTPS or localhost) — HTTP LAN fails | Created `app/src/lib/uuid.ts` with Math.random fallback; swept 16 client-side files |
| 7 | Cart panel content cut off / scrolled off screen on phone landscape | Phone landscape CSS viewport = 854×384, too short | (Several iterations of CSS zoom + OrderPanel responsive fixes, all reverted) — final fix below |
| 8 | Viewport meta `width=1920` ignored by WebView | Android WebView `useWideViewPort` defaults to false | Added `bridge.webView.settings.useWideViewPort = true` + `loadWithOverviewMode = true` to `app/android/app/src/main/java/com/restaurant/pos/MainActivity.kt` |
| 9 | `initial-scale=1` clamping back to device width even with `width=1920` | Next.js auto-fills `initialScale: 1` default if not specified | Explicitly returned `initialScale: 0.6` from `generateViewport` in `app/src/app/layout.tsx` |
| 10 | Page wider than screen, horizontal scroll | `width=1920` + `initial-scale=0.6` = 1152 visual width > 854 device width | Dropped `width` entirely from the Capacitor return; using `initialScale: 0.6` only auto-fits |
| 11 | Test 1 failed: online Capacitor sales got `OFF-` receipts | POSContext was pre-minting `OFF-` before the network POST, sending it in payload, server stored it instead of allocating R-` | Moved the `OFF-` mint INSIDE the offline-fallback branch in `app/src/context/POSContext.tsx`; online attempts now send no `receiptNo`, server allocates from `pos_receipt_seq` |

## Key files modified this session

- `app/android/build.gradle` — Kotlin plugin classpath
- `app/android/app/build.gradle` — apply Kotlin plugin
- `app/android/app/src/main/java/com/restaurant/pos/MainActivity.kt` — useWideViewPort + loadWithOverviewMode
- `app/android/app/src/main/res/xml/network_security_config.xml` — permissive cleartext
- `app/capacitor.config.ts` — auto-detect HTTP for cleartext; `appendUserAgent: "RestaurantPOS"`
- `app/src/app/layout.tsx` — `generateViewport()` UA-detection returning `initialScale: 0.6` for Capacitor only
- `app/src/lib/uuid.ts` — new helper with Math.random fallback
- 16 files swept to use the new `uuid()` helper (see git diff for list)
- `app/src/context/POSContext.tsx` — fixed receipt-mint timing in `completeSale`

## kaveesh merge — staged, not committed

User asked to merge `kaveesh` branch. Did dry-run merge — auto-resolved 4 overlap files:
- `app/package.json`
- `app/src/components/CheckoutModal.tsx`
- `app/src/components/admin/CustomersPanel.tsx`
- `app/src/context/AppContext.tsx`

Build passes after merge. Awaiting user "go commit" / "abort" decision when session resumes.

## TODO after compact / new session

1. **User runs Test 1 retry** on phone — verify `R<seq>` (not OFF-) on online Capacitor sale
2. **Confirm or abort kaveesh merge** — currently staged
3. **Mirror Android fixes to `app/android-src/`** so `android-setup.sh` re-runs don't lose them:
   - MainActivity.kt (useWideViewPort)
   - build.gradle (kotlin plugin)
   - network_security_config.xml (permissive cleartext)
4. **Write decision log entries** in `docs/pos-offline/09-decisions.md`:
   - Bundled-mode vs server-url (already documented earlier) — supplement with viewport quirks discovered
   - Receipt mint timing (online vs offline branches)
   - 0.6 initial-scale tuned for phone testing; tablet deployment should bump to 0.8-0.9
5. **Begin Phase 1.5** (cold-start offline UI — bundled assets) when Phase 1 fully verified
