# 00 · Architecture — the dual-mode contract

The single architectural decision the rest of this project flows from.

## The decision

**One Next.js codebase. Two runtime modes, gated at runtime by
`Capacitor.isNativePlatform()`.**

```
              app/src/app/pos/  +  app/src/components/pos/  (one set of files)
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
        Web mode (browser)                          Android mode (Capacitor)
        ────────────────────                        ────────────────────────
        isNativePlatform() = false                  isNativePlatform() = true
        Used by: admin desktop,                     Used by: in-store POS
          fallback if tablet dies                     terminals (tablets)
        Storage: Supabase (live)                    Storage: SQLite (local)
                                                                + Supabase (synced)
        Sale flow: POST /api/pos/sales              Sale flow:
          synchronously, await response               • online: same as web
          (current behavior, unchanged)               • offline: write to local
                                                        SQLite + outbox queue
        Printers: /api/print proxy                  Printers: native Kotlin
                                                      plugins (BT / USB / TCP)
        Auth: bcrypt PIN compared                   Auth:
          server-side every login                     • online: same as web
                                                      • offline: bcrypt compare
                                                        against cached pin_hash
        Receipt #: server allocates from            Receipt #: per-terminal
          pos_receipt_seq                             prefix + local sequence
                                                      (e.g. "T1-1042")
```

## What this decision protects

1. **Web `/pos` does not change behaviorally.** Every new code path is
   behind `isNativePlatform()`. On web that branch is dead. A regression
   in web `/pos` cannot come from an offline-mode feature because the
   offline-mode code never runs.

2. **Schema changes are additive.** New columns default to NULL, new
   tables are isolated. Existing queries (admin POS Reports, kitchen
   feed, waiter dine-in summary) continue working unchanged because the
   columns they read still exist with their old semantics.

3. **One UI, one business logic codebase.** All 40 `components/pos/*`
   files run unchanged in both modes. Cart math, modifiers, payments,
   gift cards, loyalty, reservations, dine-in — none of it gets
   duplicated in Kotlin.

4. **Hardware access where it matters.** The web cannot reach a USB or
   Bluetooth thermal printer; browsers don't expose those APIs reliably.
   The Android mode goes through the existing native plugins
   ([app/android-src/.../plugins/](../../app/android-src/app/src/main/java/com/restaurant/pos/plugins/))
   via [capacitorBridge.ts](../../app/src/lib/capacitorBridge.ts).

## Why Capacitor (and not the alternatives)

| Option | Verdict | Reason |
|--------|---------|--------|
| **Capacitor** (chosen) | ✓ | Already in `package.json` (`@capacitor/android` 7.6.2). Already scaffolded. Printer plugins already written. WebView renders the existing Next.js code with zero rewrite. |
| Separate Kotlin/Compose native app | ✗ | Would require rewriting ~10,000 lines of POS UI in Kotlin. Every feature lands twice forever. |
| React Native | ✗ | Rewrites the UI layer in RN primitives. Less work than Kotlin but still a full UI port. |
| PWA + Service Worker | ✗ | Can't reach USB/Bluetooth printers reliably. Offline storage via IndexedDB is workable but has quota limits and weaker durability guarantees than SQLite. |
| Electron / Tauri | ✗ | Targets desktop, not tablets. POS terminals are tablets. |

## Runtime detection — the one toggle

[app/src/lib/capacitorBridge.ts:32-36](../../app/src/lib/capacitorBridge.ts#L32-L36):

```ts
export function isCapacitorAndroid(): boolean {
  if (typeof window === "undefined") return false;
  const cap = window.Capacitor;
  return Boolean(cap?.isNativePlatform() && cap.getPlatform() === "android");
}
```

Every new offline-mode branch wraps in `if (isCapacitorAndroid()) { ... }`.
On web, the branch is dead. On Android, it activates.

`window.Capacitor` is injected by the native shell at runtime — when the
WebView loads the page, the Kotlin side has already attached the global.
No Capacitor import is needed in the JS, which keeps the Next.js build
unaffected.

## What WebView delivery mode we use

Capacitor's WebView can load the web app two ways:

1. **Server mode** — WebView fetches the URL from a remote server
   (`capacitor.config.ts → server.url`). What this repo does **today**.
   Page can't render offline. Useless for the offline goal.
2. **Bundled mode** — Capacitor's build step copies the static export of
   the Next.js app into the APK. WebView loads files from inside the
   device. Works fully offline. **This is what we need.**

The change is one configuration update in
[app/capacitor.config.ts](../../app/capacitor.config.ts) (remove the
`server.url` block) plus making the Next.js app produce a static export
that Capacitor can bundle.

> **Caveat to verify in audit 03**: the existing `/pos` UI uses Next.js
> dynamic routes and server-side data fetching. Whether it can produce
> a static export *without functional regression* is a question the
> audit must answer. If not, we either remove the dynamic parts the
> Android target needs, or look at a different bundling strategy.

## What "offline" means here (honest scope)

**In scope:**
- Cash and card-via-external-terminal sales work fully offline.
- Local printer access works fully offline (BT / USB / TCP-on-LAN).
- Menu / staff / customer data is cached after first online session and
  remains usable for a bounded window (proposed 7 days, configurable).
- PIN login works offline against cached `pin_hash`.

**Out of scope (offline):**
- Stripe / PayPal online payments — these require live API calls. UI
  must surface this as disabled when offline.
- Gift card validation against live balance — partial offline support is
  possible (last-known balance) but full validation requires online.
- Online-channel order ingestion (website orders, delivery) — those
  arrive through Supabase realtime and are out of POS terminal scope.

**Time bound:**
- 24–72 hours of expected offline window. After 72h of disconnection
  without a successful sync, the terminal shows a hard warning and
  optionally locks new sales. Beyond a week, cached data is stale enough
  that we'd rather fail than silently misrepresent stock or prices.

## The three correctness problems the old POS got wrong

Documented here because the architecture exists to solve them, not just
to be "more layers":

1. **Receipt number collisions across tills.** Old POS minted receipt
   numbers from a per-device counter — two tablets generated colliding
   `R47` simultaneously. Fix: per-terminal prefix (`T<id>-<seq>`) where
   the terminal ID is allocated server-side at terminal registration.
2. **Stock oversells.** Old POS did not decrement stock server-side at
   all, so two cashiers could sell the last item simultaneously. Fix:
   server-side atomic decrement on sync, with policy to accept the sale
   (cash already taken) but flag it for admin review.
3. **No real auth for offline.** Old POS stored PINs in cleartext JSON
   and had a "if no POS staff configured, skip auth" fallback. Fix:
   bcrypt hash cached locally (per the new server model), validated
   locally for offline login; revalidated on every reconnect.

These are the three problems the offline implementation must actively
solve. Everything else (cart math, payment routing, receipt printing)
is the same code that works today.
