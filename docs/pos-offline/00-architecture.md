# 00 · Architecture — the dual-mode contract

The single architectural decision the rest of this project flows from.

## Mental model — Supabase is truth, SQLite is buffer

**Supabase is always the source of truth.** It is the database for
every surface of this project: the customer website, admin panel,
kitchen display, waiter app, driver app, and the POS — online and
offline alike.

**On-device SQLite is a temporary buffer**, not a parallel database.
It exists only inside the Capacitor Android shell and holds two things:

1. **`outbox` table** — sales the cashier rang up while the network was
   unreachable, waiting to be POSTed to Supabase on reconnect.
2. **`kv_cache` table** — snapshots of menu / customers / settings
   downloaded the last time the device was online, used to render the
   POS UI when the network is unreachable.

A useful analogy: SQLite is the **mailbox** for outgoing letters and a
**photocopy** of recent incoming data. The post office (Supabase)
remains the system of record. Once a letter is delivered the mailbox is
emptied; once new mail arrives the photocopy is replaced.

> **What SQLite is NOT:** it is not the system of record. It is not
> permanent storage. It does not contain rows that don't exist in
> Supabase. The Capacitor app does not "sync two databases" — it talks
> to Supabase first, falls back to SQLite only when Supabase is
> unreachable.

### Three runtime scenarios

The same `/pos` code runs in three places. The behaviour differs only
because of the `isCapacitorAndroid()` runtime check.

| Where `/pos` runs | Online behaviour | Offline behaviour | SQLite used? |
|---|---|---|---|
| **Chrome browser on desktop** | Reads / writes Supabase | Hard-fails (no fallback) | No |
| **Chrome browser on tablet** | Reads / writes Supabase | Hard-fails (no fallback) | No |
| **Capacitor APK on tablet** | Reads / writes Supabase, plus side-effect writes a snapshot to SQLite | Reads from SQLite cache, writes to SQLite outbox | Yes — outbox + cache |

The web POS is unchanged by any work in this project. SQLite **only
ever activates inside the Capacitor APK.** A browser session — even on
the same tablet, in the device's Chrome — uses Supabase only, and has
no offline support.

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

The bullet list that used to live here has been replaced by three
dedicated docs that go deeper:

- **[11-offline-scope.md](./11-offline-scope.md)** — full
  Allowed / Degraded / Blocked matrix. Every POS feature × every
  connectivity state. The single source of truth for "is X allowed
  offline?"
- **[12-sync-protocol.md](./12-sync-protocol.md)** — for each data
  type (sales, menu, customers, staff credentials, settings,
  reservations, terminals), the sync direction, trigger, frequency,
  stale-tolerance, and failure-recovery rules.
- **[13-conflict-resolution.md](./13-conflict-resolution.md)** — every
  conflict case (concurrent customer edits, deactivated cashier mid-
  shift, stock oversells, mid-sync interruption, clock drift, long-
  offline tablets, partial-coverage reports, schema migration during
  offline period) with a concrete resolution policy.

Read those three before designing any feature that touches offline
state. Headline scope, for quick reference:

**Cash sales work offline. Card and gift card payments do not.**
Receipt printing offline depends on Phase 6 hardware verification.
Reports during a partial-sync state show a clear "may be incomplete"
banner. Hard time-bound: tablet refuses new sales beyond 7 days
offline.

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
