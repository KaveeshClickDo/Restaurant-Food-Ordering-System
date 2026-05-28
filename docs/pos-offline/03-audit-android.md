# 03 · Audit — Android scaffolding (Capacitor + Kotlin)

What's actually in the repo for the Android build, what works, and what
is broken. Verified by reading actual files — not by trusting the
`*-additions` or `system_architecture.md` documentation.

## Two directories — what they each are

```
app/
├── android-src/                              ← source of custom files
│   ├── app/build-additions.gradle
│   └── app/src/main/
│       ├── AndroidManifest-additions.xml     ← snippets to merge
│       ├── res/xml/network_security_config.xml
│       └── java/com/restaurant/pos/
│           ├── MainActivity.kt
│           ├── plugins/{BluetoothPrinterPlugin,UsbPrinterPlugin,TcpPrinterPlugin}.kt
│           └── sync/{OutboxSyncWorker,MenuSyncWorker}.kt
│
└── android/                                  ← generated Capacitor project
    └── app/src/main/
        ├── AndroidManifest.xml               ← merged (by setup script)
        ├── res/xml/network_security_config.xml (copied)
        └── java/com/restaurant/pos/
            ├── MainActivity.kt               ← **OUT OF SYNC with android-src**
            ├── plugins/*.kt                  (copied — in sync)
            └── sync/*.kt                     (copied — in sync)
```

The `android-src/` folder holds the **hand-written** Kotlin and gradle
additions. The `android-setup.sh` script runs `npx cap add android` to
generate `android/`, then copies/merges the `android-src/` files into it.

## Files inventory

| File | Lines | Purpose | Status |
|---|---|---|---|
| [capacitor.config.ts](../../app/capacitor.config.ts) | 84 | Capacitor entry config | Live — **uses `server.url` (remote mode), needs change to bundled mode** |
| [android-setup.sh](../../android-setup.sh) | 276 | One-shot scaffolder | Bash script. Mac-flavoured `sed -i ''`; will need adjustment for Windows/Linux dev environments. |
| [MainActivity.kt (android-src)](../../app/android-src/app/src/main/java/com/restaurant/pos/MainActivity.kt) | 68 | Registers plugins + schedules WorkManager | Current intent |
| [MainActivity.kt (android/)](../../app/android/app/src/main/java/com/restaurant/pos/MainActivity.kt) | 28 | Same in deployed copy | **OUT OF SYNC — missing WorkManager scheduling** |
| [BluetoothPrinterPlugin.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/plugins/BluetoothPrinterPlugin.kt) | 233 | BT printer access | In sync with `android/` |
| [UsbPrinterPlugin.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/plugins/UsbPrinterPlugin.kt) | 141 | USB printer access | In sync with `android/` |
| [TcpPrinterPlugin.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/plugins/TcpPrinterPlugin.kt) | 98 | TCP socket print to LAN printer | In sync with `android/` |
| [OutboxSyncWorker.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/OutboxSyncWorker.kt) | 139 | Periodic outbox drain | **References `pos_outbox` SharedPreferences key that no client code writes** |
| [MenuSyncWorker.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/MenuSyncWorker.kt) | 72 | Periodic menu cache refresh | **Writes `pos_menu_cache` SharedPreferences key that no client code reads** |
| [build-additions.gradle](../../app/android-src/app/build-additions.gradle) | 42 | Dependency additions | `compileSdkVersion 34`, `minSdkVersion 26`, kotlinx-coroutines, WorkManager, OkHttp, core-ktx |
| [AndroidManifest-additions.xml](../../app/android-src/app/src/main/AndroidManifest-additions.xml) | 71 | Permission + feature merges | BT + USB + WAKE_LOCK + RECEIVE_BOOT_COMPLETED + ACCESS_NETWORK_STATE |
| [network_security_config.xml](../../app/android-src/app/src/main/res/xml/network_security_config.xml) | 35 | HTTPS default + cleartext to LAN | Allows cleartext to `192.168.x.x`, `10.x.x.x`, `172.16.x.x`, `localhost`. |
| [package.json](../../app/package.json) | 55 | npm deps | `@capacitor/android` 7.6.2 in `devDependencies`, `@capacitor/core` in `optionalDependencies`. `android` + `android:build` scripts present. |

## Half-broken seams

### Seam 1 — MainActivity sync drift

The custom [MainActivity.kt in android-src](../../app/android-src/app/src/main/java/com/restaurant/pos/MainActivity.kt#L44-L67)
calls `scheduleBackgroundSync()` which enqueues two `PeriodicWorkRequest` jobs.
The deployed copy at [android/.../MainActivity.kt](../../app/android/app/src/main/java/com/restaurant/pos/MainActivity.kt)
**lacks both the imports and the call**:

```diff
< import androidx.work.Constraints
< import androidx.work.ExistingPeriodicWorkPolicy
< import androidx.work.NetworkType
< import androidx.work.PeriodicWorkRequestBuilder
< import androidx.work.WorkManager
< import com.restaurant.pos.sync.MenuSyncWorker
< import com.restaurant.pos.sync.OutboxSyncWorker
< import java.util.concurrent.TimeUnit
[...]
<         scheduleBackgroundSync()
[...]
<     private fun scheduleBackgroundSync() { ... }
```

**Effect**: even if the workers themselves were correct, **they would
never be scheduled** because the only place that schedules them is the
android-src copy that's never compiled.

**Root cause**: `android-setup.sh` copies `MainActivity.kt` with `cp` only
when first generating the android project (it has an "already patched"
short-circuit on line 121 for build.gradle and similar for the manifest).
If MainActivity.kt was updated *after* the initial scaffold and the script
re-run, the copy was probably skipped or overwritten. Either way, the
ground truth is: the deployed file is stale.

### Seam 2 — Outbox worker reads a key nothing writes

[OutboxSyncWorker.kt:67-68](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/OutboxSyncWorker.kt#L67-L68):

```kotlin
val prefs   = applicationContext.getSharedPreferences("pos_native_cache", Context.MODE_PRIVATE)
val rawJson = prefs.getString("pos_outbox", "[]") ?: "[]"
```

Reads `pos_outbox` from Android **SharedPreferences**, NOT from WebView
localStorage. There is no bridge code anywhere that writes WebView
localStorage *into* SharedPreferences. The WebView localStorage and
SharedPreferences are completely separate stores.

Additionally, the JavaScript side has no outbox at all — `posOutbox.ts`
was deleted in commit `242be44`. So:
- WebView's localStorage: nothing writes to `pos_outbox`.
- Native SharedPreferences: nothing writes to `pos_outbox`.
- The worker drains an empty queue every 15 minutes, forever.

The endpoint the worker targets is correct
([OutboxSyncWorker.kt:94](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/OutboxSyncWorker.kt#L94):
`/api/pos/sales`) — someone updated the URL after the route move from
`/api/pos/orders` → `/api/pos/sales`, but didn't restore the producer.

### Seam 3 — Menu worker writes a key nothing reads

[MenuSyncWorker.kt:60-64](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/MenuSyncWorker.kt#L60-L64)
writes `pos_menu_cache` to SharedPreferences. The WebView's POSContext
fetches `/api/pos/menu` and uses the server response directly
([POSContext.tsx:399 comment](../../app/src/context/POSContext.tsx#L399):
*"products + categories are NOT cached in localStorage. The DB is the
single source of truth"*). It never reads `pos_menu_cache`. The cache
goes nowhere.

### Seam 4 — Capacitor in server-URL mode

[capacitor.config.ts:47-55](../../app/capacitor.config.ts#L47-L55):

```ts
server: {
  url: (() => {
    const u = process.env.CAPACITOR_SERVER_URL;
    if (!u) throw new Error("CAPACITOR_SERVER_URL env var must be set ...");
    return u;
  })(),
  cleartext: false,
  androidScheme: "https",
},
```

WebView loads the **remote** URL on every app start. When the device is
offline, the WebView cannot load the page at all — the cashier sees a
network error, not a degraded POS. **This is the single biggest blocker
to offline mode** and the change is small (remove `server` block, switch
Next.js to produce a static export that Capacitor bundles).

### Seam 5 — `capacitorBridge.ts` consumers exist but are printer-only

[capacitorBridge.ts:32-178](../../app/src/lib/capacitorBridge.ts) is
well-formed and consumed by:
- [POSPrinterPanel.tsx:36-43, 73](../../app/src/components/pos/POSPrinterPanel.tsx#L36-L43)
  — BT device list + send (admin/POS Settings panel).
- [escpos.ts:319, 625](../../app/src/lib/escpos.ts#L319) — BT + TCP send
  used by the receipt-print path.
- [IntegrationsPanel.tsx](../../app/src/components/admin/IntegrationsPanel.tsx)
  — admin printer setup UI.

This is the **only** offline-related JS plumbing that actually works
end-to-end today. The printer path *is* designed correctly: it detects
native and routes through the native plugin, falls back to `/api/print`
on web. So when offline mode is restored, the printers stay working.

## What works today (verified)

- ✓ Capacitor 7.6.2 is in `package.json`. `@capacitor/core`, `@capacitor/android`,
  `@capacitor/cli`, `@capacitor/splash-screen` all installed.
- ✓ `npm run android` and `npm run android:build` scripts wired.
- ✓ All three Kotlin printer plugins compile (they're identical between
  android-src and android/).
- ✓ AndroidManifest in android/ has the required BT/USB/network/wake-lock
  permissions and `keepScreenOn=true` + `landscape` on MainActivity.
- ✓ `network_security_config.xml` is in `android/.../res/xml/` and
  whitelists RFC 1918 LAN ranges for cleartext (printers on port 9100).
- ✓ `capacitorBridge.ts` exposes `isCapacitorAndroid()` — the runtime
  toggle the architecture relies on.
- ✓ The Next.js + Supabase code itself runs unchanged inside the WebView
  in server-URL mode — when the URL is reachable.

## What doesn't work today (verified)

- ✗ **Offline page render** — WebView is in server-URL mode; no internet ⇒ no app.
- ✗ **WorkManager scheduling** — `MainActivity` in `android/` doesn't enqueue
  the workers. They're never scheduled, never run, even when the app is open.
- ✗ **OutboxSyncWorker** — reads a SharedPreferences key nothing writes.
- ✗ **MenuSyncWorker** — writes a SharedPreferences key nothing reads.
- ✗ **`posOutbox.ts`** — deleted. The JS outbox layer the server expects.
- ✗ **Local SQLite / persistent native storage** — no Capacitor SQLite plugin
  installed.  WebView localStorage is the only durable JS-side store.
- ✗ **Offline auth** — `pin_hash` is not exposed by `/api/pos/auth` GET, so
  the JS layer has no way to cache it for offline PIN validation.

## Verified: what's untested

I have not run any of the following — they are *plausible* based on the
code but need explicit verification in the proof-of-life step before we
commit to the plan:

1. **APK build succeeds** end-to-end on a clean checkout via
   `npm run android:build` followed by Android Studio "Build APK".
2. **TCP printer plugin** actually prints to a real ESC/POS printer on
   port 9100.
3. **Bluetooth printer plugin** discovers a paired device and sends bytes
   (requires runtime BT permission request — I don't see one in
   MainActivity, which means the permission prompt may not appear on
   Android 12+).
4. **USB printer plugin** acquires USB host permission via the system
   intent dialog.
5. **Capacitor static-export mode** — whether the Next.js app *as it is
   today* will export successfully with `output: "export"`. The `/pos`
   page is `"use client"` and uses `useSearchParams()` inside a Suspense
   boundary — those are export-compatible. But other routes (API routes
   esp.) are *not* statically exportable, so the export config has to be
   path-scoped or the bundle has to ship only the POS routes.

These five items are the gating questions for Phase 0 / proof-of-life.

## What the offline plan needs to add or change

| Change | Where | Type |
|---|---|---|
| Switch Capacitor to bundled mode | `capacitor.config.ts` | Config delete |
| Make `/pos` statically exportable (or ship a hybrid) | `next.config.ts`, possibly per-route | Investigation + small change |
| Add Capacitor SQLite plugin | `package.json`, MainActivity | Dependency |
| Resync MainActivity.kt → android/ + ensure setup script handles updates | `android-setup.sh`, MainActivity | Bash script bug + re-run |
| Re-implement `posOutbox.ts` targeting `/api/pos/sales` | `app/src/lib/posOutbox.ts` (new) | New file |
| Wire JS outbox to Capacitor SQLite (not localStorage) so OutboxSyncWorker can read it | New SQLite helper module | New file |
| Fix OutboxSyncWorker to read from SQLite, not SharedPreferences | `OutboxSyncWorker.kt` | Kotlin edit |
| Make MenuSyncWorker cache findable by JS at boot | `MenuSyncWorker.kt` + POSContext hydration | Kotlin + JS edit |
| Add `/api/pos/staff/credentials` endpoint returning `pin_hash` + version | new route | New file |
| Cache `pin_hash` + permissions locally on first online login | POSContext | New code path |
| Per-terminal receipt numbering | Schema + route.ts + JS receipt minter | Multi-touch |
| Capacitor runtime BT permission request | MainActivity | Kotlin edit |

This list is the source for `07-phases.md`.
