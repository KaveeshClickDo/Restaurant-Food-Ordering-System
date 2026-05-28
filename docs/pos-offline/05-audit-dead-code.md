# 05 · Audit — Dead code candidates (POS-touching)

Code present in the repo today that is **either unreferenced or
mismatched with its only consumer**. Cleared in the "cleanup PR" that
precedes Phase 1 — but only after we confirm each item is actually
dead. Do NOT delete from this list without verifying once more at
cleanup time.

> Scope: only POS-relevant leftovers. There is a parallel `clean-up/`
> folder in the repo root with broader audits from a prior cycle —
> those are reference material, not the source of truth for this list.

## A. Confirmed dead — safe to delete

### A1. Legacy localStorage key purges for `pos_session`, `pos_products`, `pos_categories`

[POSContext.tsx:758-768](../../app/src/context/POSContext.tsx#L758-L768):

```ts
useEffect(() => {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("pos_session");
      localStorage.removeItem("pos_products");
      localStorage.removeItem("pos_categories");
    } catch { /* ignore */ }
  }
}, []);
```

Defensive cleanup for keys written by older POS builds. These keys are
not written *anywhere* in the current codebase (verified by grep). The
removal calls are "fire once on mount" — cheap but unnecessary on a
fresh install.

**Verdict**: keep for one more release cycle to clean up production
devices that still carry the legacy keys, then delete. Track in
`09-decisions.md` once we set a removal date.

> **Caveat for offline plan**: if Phase 1 introduces SQLite-based caching,
> these keys are guaranteed gone (different store). Removal becomes a
> simple cleanup at that point.

### A2. Legacy localStorage key purge for `pos_customers`

[POSContext.tsx:843-848](../../app/src/context/POSContext.tsx#L843-L848):

Same shape as A1, runs on logout. Same verdict.

### A3. Android `OutboxSyncWorker.kt` doc references to `posOutbox.ts`

[OutboxSyncWorker.kt:19, 37](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/OutboxSyncWorker.kt#L19):

```kotlin
/**
 * Mirrors the outbox drain logic in posOutbox.ts ...
 * The worker reads the same localStorage key ("pos_outbox") that the WebView
 * writes to, via the Android WebView's evaluateJavascript() bridge.
 */
```

The comments describe a system the code does not currently implement.
The code reads `pos_outbox` from **SharedPreferences**, not WebView
localStorage. And `posOutbox.ts` no longer exists. Either:
- (a) the worker gets rewritten to read from SQLite during Phase 1, in
  which case both the comment and the code change together, or
- (b) the worker gets deleted entirely if Phase 1 picks a different
  background sync mechanism (e.g. drain on app foreground only).

**Verdict**: hold until Phase 1 picks a strategy. Document the decision
in `09-decisions.md` before touching this file. **Do not delete in the
cleanup PR** — it's part of a half-built feature, and we may want to
keep / repurpose it.

### A4. Android `MenuSyncWorker.kt` cache that is never read

[MenuSyncWorker.kt:59-65](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/MenuSyncWorker.kt#L59-L65):

Writes `pos_menu_cache` to SharedPreferences. POSContext does not read
that key — verified by grepping the entire codebase for `pos_menu_cache`
(zero hits outside this file).

**Verdict**: same as A3 — hold for Phase 1 decision.

### A5. `android/.../MainActivity.kt` missing WorkManager scheduling

The deployed MainActivity in `app/android/` lacks the `scheduleBackgroundSync()`
method present in `app/android-src/`. The deployed file is **stale**, not dead —
but the discrepancy itself is a dead seam: even if the workers were
correctly producing/consuming data, the deployed app never schedules them.

**Verdict**: not "code to delete" — code to re-sync. Tracked as a fix
in `07-phases.md`, not the cleanup PR.

## B. Comments / docs that contradict the code

These aren't code to delete but are *false signals* in the codebase that
mislead anyone reading it. Update or remove as part of the relevant
phase.

### B1. `/api/pos/sales/route.ts` idempotency comment

[route.ts:151-154](../../app/src/app/api/pos/sales/route.ts#L151-L154):

> *"The POS outbox replays sales after transient failures. If a previous
> attempt successfully inserted the sale, returning early here avoids a
> double stock decrement..."*

Accurate as future intent, false as current state — no outbox today.
**Verdict**: keep as-is; the design *is* outbox-ready and Phase 1 will
make this true. No edit needed unless we abandon the outbox model.

### B2. `capacitor.config.ts` storage comment

[capacitor.config.ts:31](../../app/capacitor.config.ts#L31):

> *"All POS data (sales, outbox, settings) lives in localStorage — unchanged
> from the browser version."*

Code says: sales are server-side (no localStorage). Outbox doesn't exist.
Settings *are* in localStorage. So this comment is 2/3 wrong.

**Verdict**: update during Phase 1 when capacitor.config.ts changes
anyway (server-URL → bundled mode).

### B3. Android plugin `JS API` examples reference `/api/pos/orders`

Spot-checked in plugin headers, e.g. [BluetoothPrinterPlugin.kt header
comment / similar]. Not blocking but worth updating when we touch those
files.

**Verdict**: incidental. Fix as we go.

## C. Files we considered, decided NOT dead

Listed for transparency so a future audit doesn't re-flag them:

| File | Looks suspicious because | Why it's not dead |
|---|---|---|
| [lib/connectivity.ts](../../app/src/lib/connectivity.ts) | Looks unused after offline outbox removal | Still used by `app/pos/page.tsx`, `admin/RefundsPanel.tsx`, `admin/IntegrationsPanel.tsx` — drives "card payments unavailable" offline banner and printer-status hint. |
| [api/ping/route.ts](../../app/src/app/api/ping/route.ts) | Looks vestigial | Used by `useConnectivity` for the probe. Keep. |
| [lib/capacitorBridge.ts](../../app/src/lib/capacitorBridge.ts) | Only matters on Android | Used by `POSPrinterPanel`, `escpos.ts`, `IntegrationsPanel`. Active on web (returns native-unavailable in browsers). Keep — *this is the foundation for Phase 1*. |
| [components/pos/POSPrinterPanel.tsx](../../app/src/components/pos/POSPrinterPanel.tsx) | Touches Android-only code paths | Already gracefully degrades on web ("BT printing is only available in the Android app"). Keep. |
| [lib/posOutbox.ts](../../app/src/lib/posOutbox.ts) | Already deleted in commit 242be44 | Confirmed `git show 242be44:app/src/lib/posOutbox.ts` → `does not exist`. Nothing to clean — we'll re-create it in Phase 1. |
| `load()` / `save()` helpers in POSContext.tsx:172-194 | Settings is the only POS data still hitting them | Still actively used for `pos_settings`. Keep. |

## D. Pre-existing audit folder (informational only)

[clean-up/](../../clean-up/) contains a prior round of audit files
(`01-folder-structure.md` through `10-xss-injection.md` and more).
Several touch POS:

- `03-dead-code-duplicates.md`
- `04-localstorage-audit.md`
- `05-context-bloat.md`

**Verdict**: read at audit-review time, but do **not** trust as ground
truth. They predate the `pos_sales` migration and the `posOutbox.ts`
deletion, so their POS-specific findings may be stale. Anything actually
applicable should be re-derived against the current code.

## Cleanup PR summary (proposed)

A single PR that only touches items in section A, with no behavioral
changes:

1. Add a one-line code comment to A3 / A4 documenting "intentionally
   half-implemented — see `docs/pos-offline/03-audit-android.md`" so
   future readers don't waste time decoding.
2. Update the misleading comment in B2.

**That's the whole cleanup PR.** Sections A1/A2 stay for the localStorage
removal-cycle; A5 is a Phase-1 fix, not a cleanup; B1 is correct as
future intent.

The cleanup PR is tiny on purpose. Most of what looked like dead code on
first inspection (legacy localStorage purges) is actively serving a
purpose, and the truly half-built items (Android workers) belong to the
half-broken feature we're about to finish — not a separate cleanup.
