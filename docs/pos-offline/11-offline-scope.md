# 11 · Offline scope — Allowed / Degraded / Blocked matrix

The single reference for "what does the POS let me do right now?" across
every connectivity state. Read this before adding any new POS feature —
the matrix tells you which column applies and what policy follows.

## Connectivity states (the columns)

| State | Definition | Trigger |
|---|---|---|
| **A · Online** | Page loaded, server reachable, `/api/ping` passes | Baseline |
| **B · Mid-session offline** | Page already loaded in memory, server unreachable | Connectivity drops while app is open |
| **C · Warm-cache offline** | First load uses WebView/SW cache; server unreachable | Cold start, internet down, but cache hit |
| **D · Cold-start offline** | First load with empty cache; server unreachable | Cold start, internet down, no prior visit |
| **E · Stale cache** | Online, but cached data was last refreshed > stale-threshold | Returns from long offline period |

State D becomes "the UI doesn't load at all" until **Phase 1.5 (bundled
assets)** lands. State C is reliable only after **Phase 5 (Service
Worker registration)**. State E is governed by **stale-cache policy
below**.

## Stale-cache thresholds

| Cache | Stale at | Hard refuse at |
|---|---|---|
| Menu items (`menu_items`) | > 4 hours | > 24 hours — show "Refreshing menu required" banner; offline-mode refuses sales |
| Customers | > 24 hours | > 7 days — customer search returns no results offline beyond 7 days |
| Staff credentials (`pin_hash`) | > 24 hours | > 7 days — offline PIN login refused; cashier must come back online |
| Settings (currency, tax, restaurant info) | > 7 days | > 30 days |
| Gift cards | Never cached | n/a — always live |

The hard-refuse thresholds are not legal limits; they're "the data is
genuinely too old to trust for a real cash transaction." Configurable
per-deployment in a future phase.

## Feature matrix

**Legend:** ✅ Allowed · ⚠️ Degraded (allowed but with reduced
guarantees, see notes) · ❌ Blocked (UI greyed out, button disabled,
clear message shown)

### Authentication

| Feature | A Online | B Mid-session | C Warm-cache | D Cold-start | E Stale (>cred refuse) |
|---|---|---|---|---|---|
| PIN login | ✅ | n/a (already in) | ⚠️ (Phase 4) | ⚠️ (Phase 4 + 1.5) | ❌ |
| Logout | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session refresh / `/api/pos/auth` heartbeat | ✅ | ⚠️ — heartbeat fails silently, session stays valid against cached `session_version` | ⚠️ same | ⚠️ same | ❌ — heartbeat success required |
| Permission gating (canApplyDiscount etc.) | ✅ (live row) | ⚠️ (cached `permissions`) | ⚠️ | ⚠️ | ❌ |

### Sale ring-up (the core POS loop)

| Feature | A Online | B Mid-session | C Warm-cache | D Cold-start | E Stale-menu refuse |
|---|---|---|---|---|---|
| Browse menu / categories | ✅ | ⚠️ — local cache | ⚠️ | ⚠️ | ❌ |
| Add item to cart | ✅ | ✅ | ✅ | ✅ | ❌ |
| Modifier picker | ✅ | ✅ | ✅ | ✅ | ❌ |
| Discount (percentage / fixed) | ✅ (requires `canApplyDiscount`) | ✅ same | ✅ | ✅ | ❌ |
| Tip | ✅ | ✅ | ✅ | ✅ | ❌ |
| Customer assignment | ✅ (live search) | ⚠️ (local cache) | ⚠️ | ⚠️ | ❌ |
| **Payment: Cash** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Payment: Card (standalone terminal)** | ✅ | ✅ — POS just records; the terminal handles auth on its own connection | ✅ | ✅ | ❌ |
| **Payment: Split (cash + card)** | ✅ | ✅ — both halves are bookkeeping | ✅ | ✅ | ❌ |
| **Payment: Gift card** | ✅ | ❌ — POS-internal balance check requires live `gift_cards` lookup | ❌ | ❌ | ❌ |
| Receipt print: TCP / BT / USB native | ✅ | ✅ | ✅ | ✅ | ❌ (no sale happens) |
| Receipt print: server proxy `/api/print` | ✅ | ❌ — server unreachable | ❌ | ❌ | n/a |
| Receipt email to customer | ✅ | ❌ — email server unreachable; queued for sync | ❌ same | ❌ same | n/a |

**Why card payments ARE allowed offline.** Verified by reading the code
2026-05-29: the POS has no card-reader integration. It accepts
`payment_method: "card"` as a string and records it. The cashier hands
a standalone card terminal to the customer; that terminal handles
authorisation over its own cellular/WiFi connection. The POS never
talked to the card terminal, so the POS being offline is irrelevant to
the card transaction. **Operational rule:** the cashier must confirm
the standalone terminal beeped approved BEFORE tapping "Payment
Received" on the POS — same as online behaviour, the POS trusts the
cashier's observation either way.

**Why gift cards are blocked offline.** The card balance is a live
value modified by every redemption. Accepting an offline redemption
would mean: (a) trusting last-known balance, (b) hoping nobody else
redeems concurrently, (c) accepting potential negative balance on
sync. Pragmatic call: refuse offline. Phase 4+ may relax this with a
"last-known balance + small reserve" policy if real-world demand
shows up.

### Receipts

| Feature | A Online | B / C / D | E |
|---|---|---|---|
| Print right now (TCP/BT/USB) | ✅ | ✅ | ❌ (no sale) |
| Print via server proxy | ✅ | ❌ | n/a |
| Email to customer | ✅ | ⚠️ — queued in outbox payload; emailed on sync | n/a |
| Display on screen | ✅ | ✅ | n/a |
| Save as PDF | ✅ | ✅ | n/a |

### Customers

| Feature | A | B / C / D | E |
|---|---|---|---|
| Search by name / phone / email | ✅ (live) | ⚠️ (cached list) | ⚠️ |
| Create new customer | ✅ | ⚠️ — local SQLite cache + outbox; pushed on sync | ⚠️ |
| Edit existing customer | ✅ | ⚠️ — local edit + outbox; last-write-wins on sync per [13-conflict-resolution.md](./13-conflict-resolution.md) | ⚠️ |
| Loyalty points bump | ✅ | ⚠️ — server recomputes from `pos_sales` on sync (see [13](./13-conflict-resolution.md)) | ⚠️ |
| Delete customer | ✅ | ❌ — irreversible, blocked offline | ❌ |

### Staff (admin operations on POS staff)

| Feature | A | B / C / D | E |
|---|---|---|---|
| List staff (picker) | ✅ | ✅ (cached) | ✅ |
| Add staff | ✅ | ❌ — requires PIN bcrypt server-side | ❌ |
| Edit staff (name, permissions) | ✅ | ❌ — requires elevated server check | ❌ |
| Deactivate staff | ✅ | ❌ | ❌ |
| Clock in / out | ✅ | ❌ Phase 1 (no offline clock) | ❌ |

### Dashboard / Reports

| Feature | A | B / C / D | E |
|---|---|---|---|
| Today's sales totals | ✅ | ⚠️ — shows only sales the tablet has seen (local + cached). Banner: "X tablets offline, totals may be incomplete." | ⚠️ |
| Per-cashier breakdown | ✅ | ⚠️ same | ⚠️ |
| Voided sales report | ✅ | ❌ — voids are online-only | ❌ |
| Export CSV | ✅ | ❌ — would export stale snapshot | ❌ |
| Refund a sale | ✅ | ❌ — refund is financial, online-only | ❌ |
| Void a sale | ✅ | ❌ — same | ❌ |

### Reservations / dine-in

| Feature | A | B / C / D | E |
|---|---|---|---|
| View today's reservations | ✅ | ⚠️ — cached snapshot | ⚠️ |
| Create walk-in reservation | ✅ | ❌ — out of scope for Phase 1 offline; revisit Phase 6+ | ❌ |
| Check in a reservation | ✅ | ❌ | ❌ |
| Table-status grid | ✅ | ⚠️ — cached snapshot, may not reflect concurrent waiter actions | ⚠️ |
| Open / close table | ✅ | ❌ | ❌ |
| Dine-in order ring-up | ✅ | ❌ — Phase 1 scope is collection-style sales only | ❌ |

### Settings

| Feature | A | B / C / D | E |
|---|---|---|---|
| View settings | ✅ | ✅ (cached) | ✅ |
| Edit settings | ✅ | ❌ — settings push to server; blocked offline | ❌ |
| Add / remove terminal | ✅ | ❌ — admin-only, online-only | ❌ |
| Manual "Sync now" | ⚠️ no-op when online (drain runs anyway) | ✅ — triggers drainOutbox | ✅ | ✅ |
| View pending-sync count | ✅ | ✅ | ✅ | ✅ |

## How the matrix is enforced in code

Each ❌ in the matrix maps to one of three enforcement points:

1. **Server gate** — the API route refuses (401/403/409). The UI just
   handles the error. The route is the truth.
2. **`isOnline` UI gate** — the button is disabled, the page shows a
   clear "Requires internet" message. Driven by `useConnectivity()`
   in [pos/page.tsx](../../app/src/app/pos/page.tsx).
3. **`isCapacitorAndroid()` UI gate** — feature only exists on native
   shell (e.g. native printer). On web `!isCapacitorAndroid()` shows a
   fallback (server proxy print).

Every ❌ row in the matrix above must trace to at least one of these
three gates in the code. Phase 1.5 / 1.6 / 4 PRs add gates for the
rows currently marked "❌ (Phase X)".

## Sync status surfaces — what the cashier sees

These are the UI affordances that report sync state. None of them are
hidden — the cashier always knows whether the tablet is online,
whether sales are queued, and how fresh the cached data is.

### Top-bar indicators (persistent)

| Indicator | Shown when | Visual |
|---|---|---|
| Cloud icon, solid | Online + outbox empty | Subtle, in the header next to the time |
| Cloud icon, pulsing | Online + drain in progress | Same icon, animated pulse for the drain duration |
| Cloud-strike icon | Offline | Replaces the solid cloud; same position |

### Banners (top of POS page, below header)

| Banner | Shown when | Colour | Source |
|---|---|---|---|
| "No internet — cash and card sales will queue and sync when you reconnect. Card requires terminal confirmation. Gift cards unavailable." | `!isOnline` AND `isCapacitorAndroid()` | Amber | Phase 1 (built) |
| "No internet — sales cannot be completed until you reconnect." | `!isOnline` AND `!isCapacitorAndroid()` (web) | Amber | Phase 1 (built) |
| "N sales pending sync — will upload when reconnected." | `outboxCount > 0` AND `!isOnline` | Blue | Phase 1 (built) |
| "Syncing N offline sales…" | `outboxCount > 0` AND `isOnline` (drain in progress) | Blue with pulsing cloud icon | Phase 1 (built) |
| "Menu last refreshed X hours ago — reconnect to refresh." | Menu cache > 4h stale | Orange (soft) | Phase 1.6 |
| "Menu has not refreshed for N days. Reconnect to continue selling." | Menu cache > 24h stale | Red, blocks Sale tab | Phase 1.6 |
| "Reports may be incomplete — Terminal T2 last synced at 6:47pm." | Dashboard load detects unsynced terminal | Yellow, dashboard only | Phase 1.6 |

### Transient toasts (bottom-right, ~3 sec)

| Toast | Trigger | Phase |
|---|---|---|
| "✓ N sales synced" | After `drainOutbox()` completes successfully | Phase 1.5 (small addition) |
| "⚠ N sale stuck — review in Settings" | A drain pass marks any entries as `failed` | Phase 1.5 (small addition) |
| "Menu refreshed" | A pull replaces the cached menu snapshot | Phase 1.6 |

### Settings → Sync page (`/pos` Settings tab, new section)

A dedicated screen the cashier can open at any time. Shows last-sync
timestamps per data type, pending and failed sale counts, and a
"Sync now" button. Sketch:

```
┌────────────────────────────────────────────────┐
│  Sync status                                    │
│                                                  │
│   Menu              synced 8 min ago      ✓     │
│   Customers         synced 12 min ago     ✓     │
│   Settings          synced 2 hours ago    ✓     │
│   Staff credentials synced 5 min ago      ✓     │
│                                                  │
│   Pending sales     3                            │
│   Failed sales      1   [Review]                 │
│                                                  │
│   Last successful drain: today 11:54am          │
│                                                  │
│   [ Sync now ]                                  │
└────────────────────────────────────────────────┘
```

The **Sync now** button runs, in this order:
1. Refresh menu / customers / settings (pull).
2. Drain pending sales (push).
3. Retry failed sales (mark `failed → pending`, then drain).

The **Review** button opens a list of failed sales with their stored
error message, the cashier name, and the receipt number. Each entry
has actions: "Retry" (back to pending) and "Discard with note"
(removes from outbox; appends an admin-visible note explaining the
reason).

Implementation lands in Phase 1.5 (the toasts + a minimal Settings →
Sync page) and Phase 1.6 (the per-data-type timestamps + stale-cache
banners). The top-bar cloud icon is part of Phase 1.5.

## Scope statements summary

- **Phase 1 offline mode is for cash sales only.** Card, split-with-card,
  and gift card are blocked offline by deliberate design.
- **Receipt printing offline requires Phase 6** (native plugins
  verified on hardware). Until then, offline sales display on screen
  and email on sync.
- **End-of-day reports are not authoritative if any tablet is offline.**
  The dashboard shows a clear banner; reconciliation happens after all
  tablets sync.
- **Hard cap on long-offline use: 7 days.** Beyond that, the tablet
  refuses new sales until it comes online. Cached data is stale enough
  that we'd rather fail than silently misrepresent.
