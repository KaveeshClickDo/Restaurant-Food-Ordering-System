# Phase 0 — Proof of life · Results

Action log for the Phase 0 verifications described in `03-audit-android.md`
§ "Verified: what's untested". Five questions; I can answer two without
hardware, three need a real tablet + printer.

## Outcomes

| # | Question | Result | Verified by |
|---|---|---|---|
| 1 | `npm run build` succeeds from current state | ✅ PASS — exit code 0, all routes compile | Background build, [see output below](#verification-1-nextjs-build) |
| 2 | `/pos` is statically renderable (Capacitor-bundleable) | ✅ PASS — Next.js marks it `○ (Static)`, prerenders `pos.html` | Build output + `.next/server/app/pos.html` exists |
| 3 | TCP printer plugin prints to a real printer | ⏸ **DEFERRED to Phase 6** — no hardware available now. Checklist preserved below for when hardware arrives. | n/a |
| 4 | Bluetooth printer plugin discovers + sends | ⏸ **DEFERRED to Phase 6** — no hardware available now. Checklist preserved below. | n/a |
| 5 | USB printer plugin acquires host permission | ⏸ **DEFERRED to Phase 6** — no hardware available now. Checklist preserved below. | n/a |

## Decision — hardware-gated work moves to Phase 6

Recorded 2026-05-28. The user has no printer hardware available right
now. The Phases 1–5 offline core does not depend on the native printer
plugins:

- **Web printing** continues to work today via `/api/print` (TCP proxy)
  and the browser print path. Existing customers are not affected.
- **Online printing** in Capacitor mode falls back to `/api/print` if
  the native plugins are unavailable or untested — same path as web.
- **Offline printing** is the one place native plugins are required
  (server-proxy can't reach the server when offline). We **defer
  offline paper receipts**: in offline mode the cashier sees the receipt
  on screen, and the receipt is emailed / printed when the device
  reconnects. Documented in `07-phases.md` under Phase 1 acceptance
  criteria.

When printer hardware does arrive, Phase 6 picks up exactly this
verification checklist and any plugin patches needed. Phase 6 is
self-contained — no Phase 1–5 work has to be redone to enable it.

## Bonus findings (not in the original Phase 0 plan)

### Finding A — Service worker exists but is never registered

[app/public/sw.js](../../app/public/sw.js) is a complete 82-line offline-shell
service worker with sensible strategy:
- Cache-first for `/_next/static/`
- Network-first with cache fallback for HTML navigations
- Network-only for `/api/*` (correctly, since the outbox is supposed to handle offline data)

Pre-caches `/pos` and `/` on install. **But no code registers it.** A grep
for `navigator.serviceWorker` across `app/src/` returns zero matches.
The header in sw.js says *"registered by /pos/page.tsx on mount"* — that
registration line was apparently removed alongside the `posOutbox.ts`
deletion in commit `242be44`.

[next.config.ts:31, 37-40](../../app/next.config.ts#L31) explicitly
configures `Service-Worker-Allowed` and `no-cache` headers for `sw.js` —
so the infrastructure expects the SW to exist and update reliably. It's
just missing the registration call.

### Finding B — manifest.json exists but isn't linked from layout

[app/public/manifest.json](../../app/public/manifest.json) is a complete
PWA manifest (start_url `/pos`, display standalone, landscape, theme
color, icons). [app/src/app/layout.tsx](../../app/src/app/layout.tsx)
does not emit a `<link rel="manifest">` — verified by grep
(`manifest.json|webmanifest` across `app/src/` returns nothing).

Together with Finding A, the PWA path was set up but never wired up.
Adding ~10 lines (registration + manifest link) gives the web `/pos` a
free Chrome-installable offline mode independent of Capacitor.

### Finding C — `/pos` and `/pos/login` are already statically prerendered

The production build marks both routes `○ (Static)`:
- `/pos` = 56.2 kB chunk, prerendered to `.next/server/app/pos.html`
- `/pos/login` = 6.04 kB chunk, prerendered to `.next/server/app/pos/login.html`

This is the key feasibility datapoint for the Capacitor bundled-mode
question. The static HTML *exists* in the build output. Switching to
`output: "export"` for an Android-only build is mechanically feasible —
the constraint is the root layout's server-side `getDbSettings()` call
that would have to be moved client-side or accept stale build-baked
values.

### Finding D — All POS API routes are correctly dynamic

The build output lists every `/api/pos/*` route as `ƒ` (Dynamic =
server-rendered on demand). This is the right shape — these routes must
stay on the production server. Capacitor calls them via remote URL when
online. No change needed.

## Architectural implication — revised Phase 1 strategy

The Phase 0 findings change the optimal Phase 1 path. Previously I
assumed we'd switch Capacitor to bundled-asset mode immediately. With
Findings A–C, there's a cheaper interim path:

**Path 1 (cheap, recommended for Phase 1):** Keep Capacitor in
server-URL mode. Re-register the service worker. The SW pre-caches `/pos`
on first online visit; subsequent launches (online or offline) load
from the SW cache. Add `posOutbox.ts` writing to IndexedDB. This works
for both PWA-installed browser users *and* Capacitor WebView users.

**Path 2 (more robust, Phase 2 or later):** Switch Capacitor to
bundled-asset mode. Requires a separate `next.config.capacitor.ts` with
`output: "export"`, hoisting `getDbSettings()` to a client-side call, and
the Capacitor build step copying `.next/server/app/pos*.html` into
Android assets. Eliminates the "first launch needs internet" requirement
of Path 1.

> **Caveat for Path 1**: search results show that Capacitor's Android
> WebView supports service workers but with documented reliability
> caveats — the offical Capacitor guidance is "bundle assets, don't rely
> on the SW for offline." We start with Path 1 because it's cheap, but
> commit to Path 2 if real-world testing shows SW caching is unreliable
> in the Capacitor WebView. See [Capacitor PWA docs](https://capacitorjs.com/docs/web/progressive-web-apps).

I'll record this as a decision in `09-decisions.md` once we start
writing the plan docs.

## What's NOT done — needs hardware (preserved for Phase 6)

When hardware arrives, run these checklists. You need a real Android
tablet (any model running Android 8.0+ / API 26+) and a real ESC/POS
receipt printer. The three deferred verifications:

### Verification 3 — TCP printer plugin

Tests whether `TcpPrinterPlugin.kt` actually delivers receipt bytes to
a LAN printer.

**Setup:**
1. Plug printer into the LAN; assign it a static IP (e.g. `192.168.1.100`).
2. Confirm printer responds: from any machine on the LAN, `telnet 192.168.1.100 9100` should connect. Send Ctrl+] then `quit`.
3. Install the Restaurant POS app on the tablet (see "Build the APK" below).

**Test:**
1. In the POS app go to `/pos` → Settings → Printer.
2. Set Mode = "Native TCP", IP = `192.168.1.100`, Port = `9100`.
3. Tap "Print Test Receipt".

**Pass criteria:**
- Printer prints a receipt within 5 seconds.
- No error toast in the POS UI.

**Fail mode to investigate:**
- "Connection refused" → printer is reachable but not on port 9100. Some printers use 6101 or 8000.
- "Timeout" → printer IP wrong, or the tablet is on a different subnet.
- "Network security policy violation" → the `network_security_config.xml` cleartext rule isn't matching the printer's IP range. Edit the `<domain>` list in [network_security_config.xml](../../app/android-src/app/src/main/res/xml/network_security_config.xml).

### Verification 4 — Bluetooth printer plugin

Tests `BluetoothPrinterPlugin.kt` device discovery + byte transmission.

**Setup:**
1. Pair a Bluetooth ESC/POS printer with the tablet via Android Settings → Bluetooth.
2. Note the printer's name (e.g. "RPP02N").

**Test:**
1. In the POS app go to `/pos` → Settings → Printer.
2. Set Mode = "Bluetooth".
3. Confirm the paired printer appears in the "Paired Devices" dropdown. If not, the BT permission prompt didn't fire — see fail mode below.
4. Select it; tap "Print Test Receipt".

**Pass criteria:**
- Paired printer appears in dropdown.
- Test print succeeds within 5 seconds.

**Fail mode to investigate:**
- Empty paired-devices dropdown → `BLUETOOTH_CONNECT` runtime permission was not requested. The audit found `MainActivity.kt` doesn't request runtime permissions; this needs a fix.
- Permission denied silently → some Android 12+ devices need an explicit `requestPermissions` call before any BT operation.

### Verification 5 — USB printer plugin

Tests `UsbPrinterPlugin.kt` device enumeration + send.

**Setup:**
1. Plug a USB receipt printer into the tablet via USB-OTG cable.
2. The Android system should show a permission dialog: *"Open Restaurant POS to handle USB Printer?"*

**Test:**
1. Tap "OK" on the system dialog; tick "Use by default".
2. In the POS app go to `/pos` → Settings → Printer.
3. Set Mode = "USB". Printer should appear in dropdown.
4. Tap "Print Test Receipt".

**Pass criteria:**
- System permission dialog appears on plug-in.
- Printer enumerates in the dropdown.
- Test print succeeds.

**Fail mode to investigate:**
- No system dialog → `<uses-feature android:hardware.usb.host>` is in the manifest (verified), but some tablets don't actually have USB-host hardware. Check tablet specs.
- Dialog appears but plugin reports "no devices" → USB descriptor parsing in the Kotlin plugin failed — common for non-standard printers. Plugin code may need tweaks for the specific printer model.

## Build the APK

The fastest path to a testable APK, assuming a fresh Windows dev machine:

**Pre-requisites:**
- Android Studio (Hedgehog or later). Download: [developer.android.com/studio](https://developer.android.com/studio).
- Java 17+ — Android Studio bundles this.
- Set `ANDROID_HOME` env var to the SDK path (Android Studio shows it under Settings → SDK Manager).

**Build:**
1. `cd app`
2. Set `CAPACITOR_SERVER_URL` to the production URL (e.g. `https://your-app.vercel.app`).
3. `npm run android:build` — runs `npm run build` + `npx cap sync android`.
4. Open Android Studio → File → Open → select `app/android/`.
5. Wait for Gradle sync. (~3-5 min first time.)
6. Click ▶ Run. Choose a connected device or emulator.

**Important caveat:** the `android-setup.sh` script that copied custom
Kotlin files into `android/` runs only on a fresh `cap add android`. The
audit found `app/android/.../MainActivity.kt` is stale — missing the
WorkManager scheduling. Before testing, manually re-copy:

```
cp app/android-src/app/src/main/java/com/restaurant/pos/MainActivity.kt \
   app/android/app/src/main/java/com/restaurant/pos/MainActivity.kt
```

This is one of the bugs `07-phases.md` will track.

## Summary for next step

**Things I confirmed:**
- Codebase builds cleanly. No Phase-1 blockers from a build-config standpoint.
- `/pos` is already statically prerenderable — bundled Capacitor mode is mechanically possible.
- A service worker + manifest are already written but never wired in — small bonus to enable.
- Capacitor + SQLite stack is well-supported (the recommended plugin is `@capacitor-community/sqlite` v8.1.0).

**Deferred to Phase 6 (hardware-gated):**
- TCP printer test.
- Bluetooth printer test.
- USB printer test.

**Deferred to Phase 1 acceptance testing on whatever Android device is available:**
- Whether the SW actually caches and serves `/pos` reliably inside the Capacitor WebView (not just in Chrome). Can be tested with any Android tablet — no printer needed.

**Phases 1–5 proceed on the verified-passing software baseline.** See
`07-phases.md` for the work plan.

---

### Verification 1 — Next.js build

Background build at exit code 0. Excerpt from the final route table:

```
○ /pos                   56.2 kB    253 kB    1m    1y
○ /pos/login              6.04 kB   195 kB    1m    1y
ƒ /api/pos/sales           423 B    103 kB
ƒ /api/pos/auth            423 B    103 kB
... [all other /api/pos/* dynamic]
○ (Static)   prerendered as static content
ƒ (Dynamic)  server-rendered on demand
```

The `○` markers on `/pos` and `/pos/login` confirm finding C. The build
artifact `app/.next/server/app/pos.html` is on disk and is the static
shell that Capacitor could bundle for Path 2 above.

## Sources used

- [Building Progressive Web Apps — Capacitor Documentation](https://capacitorjs.com/docs/web/progressive-web-apps)
- [@capacitor-community/sqlite (GitHub)](https://github.com/capacitor-community/sqlite)
- [@capacitor-community/sqlite (npm v8.1.0)](https://www.npmjs.com/package/@capacitor-community/sqlite)
- [Capacitor Database Guide — RxDB](https://rxdb.info/capacitor-database.html)
- [Mobile Application: Should You Choose Capacitor? — edana.ch](https://edana.ch/en/2025/07/31/should-you-still-choose-capacitor-today-for-which-types-of-mobile-projects-does-it-remain-relevant/)
- [How Capacitor Works — Ionic Blog](https://ionic.io/blog/how-capacitor-works-2)
- [Web-Based Mobile Apps: The Practical Guide — siimplelab](https://siimplelab.com/en/blog/web-based-mobile-apps)
