# 12 · Sync protocol — per data type

Defines exactly how data flows between the Supabase database and the
on-device SQLite cache for each data type the POS touches. Read with
[11-offline-scope.md](./11-offline-scope.md) (what features each cache
supports) and [13-conflict-resolution.md](./13-conflict-resolution.md)
(what happens on conflict).

## Direction primer

| Direction | Means |
|---|---|
| **PULL** | Server is the source of truth; client refreshes a cache for offline read |
| **PUSH** | Client mutation is queued locally, then sent to server (single source of write truth) |
| **BOTH** | Mutable both sides; conflict resolution required |
| **LIVE-ONLY** | No cache. Operations require online; offline blocked. |

## Per data type

### Sales (`pos_sales`) — PUSH only

| Aspect | Value |
|---|---|
| Direction | **PUSH** — server is the system of record; sales never come BACK to the tablet |
| Cache used | `outbox` table in [posLocalDb.ts](../../app/src/lib/posLocalDb.ts) |
| Created where | Locally minted on Capacitor Android with `OFF-…` (Phase 1) or `T<prefix>-<seq>` (Phase 2) receipt |
| Trigger to push | (1) `completeSale()` first attempt is direct POST; (2) on failure, queued. (3) `drainOutbox()` runs on every reconnect (Phase 1) + every app foreground (Phase 4) |
| Frequency | Reactive — drain runs as fast as connectivity returns |
| Failure recovery | Exponential back-off per entry (2s, 4s, 8s, 16s, 32s, then `failed`). 4xx never retried (see decision log) |
| Idempotency key | `pos_sales.id` (client UUID). Server returns 200 with `duplicate: true` on replay |
| Server fields stamped on sync | `synced_at` = now(), `staff_id` = session, `staff_name` = session |
| Stale-tolerance | n/a — pending sales have no freshness concept |
| Realtime subscription | None — push-only |

### Clock entries (`pos_clock_entries`) — LIVE-ONLY (Phase 1)

| Aspect | Value |
|---|---|
| Direction | **LIVE-ONLY** for Phase 1 |
| Reason | Offline clock-in is doable but the partial unique index
`uniq_pos_clock_open` ([schema.sql:525](../../supabase/schema.sql#L525))
rejects a second open entry per staff at the DB level. Offline reconciliation
gets messy. Phase 1 sidesteps by refusing offline clock-in/out. |
| Phase 6+ | Could add offline clock queue with same outbox pattern |

### Menu items (`menu_items`) + categories — PULL only

| Aspect | Value |
|---|---|
| Direction | **PULL** — admin owns menu, POS never edits |
| Cache used | `kv_cache` key `menu_snapshot` (Phase 1.6) |
| Trigger | (1) On every successful login; (2) on app foreground if last refresh > 30 min; (3) on every Supabase realtime `menu_items` event when online |
| Frequency | Reactive (realtime) when online; on foreground when not |
| Failure recovery | Keep last known snapshot; bump retry timer to 30s, 60s, 120s |
| Stale-tolerance (soft) | 4 hours — show "menu may be stale" toast on grid |
| Stale-tolerance (hard) | 24 hours — disable Sale tab with "Reconnect to refresh menu" |
| Conflict | None possible — pull-only |
| Realtime subscription | Yes (`menu_items`, `categories`) when online — keeps the on-screen stock counter live |

### Customers (`customers`) — BOTH

| Aspect | Value |
|---|---|
| Direction | **BOTH** — POS can create/edit/assign customers offline |
| Cache used | `kv_cache` key `customers_snapshot` (read) + `outbox` for writes (Phase 1.6) |
| Trigger to pull | (1) On every successful login; (2) every 30 min while app foreground + online |
| Trigger to push | Edit/create immediately → outbox if offline, direct POST if online |
| Conflict resolution | See [13-conflict-resolution.md](./13-conflict-resolution.md) §1 "Customer concurrent edits" |
| Idempotency | `customers.id` (client UUID for offline-created rows) |
| Stale-tolerance (soft) | 24 hours |
| Stale-tolerance (hard) | 7 days — customer search returns empty + banner |
| Realtime subscription | Yes (`customers`) when online — picks up admin edits |

### Staff list (`pos_staff` — display only) — PULL only

| Aspect | Value |
|---|---|
| Direction | **PULL** for the picker — staff editing is admin-only and online-only |
| Cache used | `kv_cache` key `staff_picker_snapshot` (Phase 4) |
| Trigger | On every successful login + every 30 min |
| Stale-tolerance | 24 hours soft, 7 days hard |
| Conflict | None — display-only |

### Staff credentials (`pos_staff.pin_hash + permissions + session_version`) — PULL only, encrypted

| Aspect | Value |
|---|---|
| Direction | **PULL** — never pushed |
| Source endpoint | `GET /api/pos/staff/credentials` (new in Phase 4 — POS-session gated, returns ONLY caller's own row) |
| Cache used | Dedicated `staff_credentials` SQLite table, encrypted via Android Keystore (Phase 4) |
| Trigger | On every successful online login → cache caller's credentials |
| Validation | On reconnect, GET runs; if returned `session_version` differs from cached → invalidate cache, force online login |
| Stale-tolerance (soft) | 24 hours — heartbeat continues to recheck |
| Stale-tolerance (hard) | 7 days — offline login refused |
| Conflict | None — pull-only. Admin changes invalidate via `session_version`. |

### Settings (`app_settings`) — PULL only

| Aspect | Value |
|---|---|
| Direction | **PULL** — settings changes are admin-only and online-only |
| Cache used | `kv_cache` key `app_settings_snapshot` |
| Trigger | On login + on app foreground if > 24 hours since last refresh |
| Stale-tolerance | 7 days soft (currency/tax don't change daily), 30 days hard |
| Conflict | None |
| Realtime subscription | Yes (`app_settings`) when online |

### Gift cards (`gift_cards`) — LIVE-ONLY

| Aspect | Value |
|---|---|
| Direction | **LIVE-ONLY** for all phases |
| Reason | Balance is mutable by every channel (POS, web, admin). Cached balance becomes a lying liability. |
| Offline | Refused — see [11 § Sale ring-up](./11-offline-scope.md) |

### Reservations + dining_tables — PULL only (display-only offline)

| Aspect | Value |
|---|---|
| Direction | **PULL** — offline view is display-only; create/edit blocked |
| Cache used | `kv_cache` keys `reservations_today`, `dining_tables_snapshot` |
| Trigger | (1) On tab open (View pulls); (2) every 15 sec poll while tab is visible (matches current dining_tables polling) |
| Stale-tolerance | 5 minutes — reservation lists go stale fast |
| Conflict | None — read-only offline |

### Terminal state (`pos_terminals`) — PULL on mount + BOTH later

| Aspect | Value |
|---|---|
| Direction | **PULL** on mount (registered terminals list); **BOTH** for `last_seen_at`, `next_seq_no` (Phase 2 sync stamps) |
| Cache used | `kv_cache` key `terminal_self` (Phase 2 — the bound terminal for THIS tablet) |
| Trigger | On every successful login → which terminal this device is bound to |
| Conflict | `next_seq_no` is server-authoritative; client may diverge offline, server clamps on sync via `update ... set next_seq_no = greatest(next_seq_no, $client + 1)` |

## Summary table

| Type | Direction | Trigger | Stale soft | Stale hard | Conflict doc |
|---|---|---|---|---|---|
| Sales | PUSH | completeSale + reconnect | n/a | n/a | [13 §3](./13-conflict-resolution.md) |
| Clock entries | LIVE-ONLY (Phase 1) | n/a | n/a | n/a | n/a |
| Menu items | PULL | login + 30m + realtime | 4h | 24h | n/a |
| Customers | BOTH | login + 30m + edit | 24h | 7d | [13 §1](./13-conflict-resolution.md) |
| Staff list | PULL | login + 30m | 24h | 7d | n/a |
| Staff credentials | PULL (encrypted) | login + reconnect heartbeat | 24h | 7d | [13 §2](./13-conflict-resolution.md) |
| Settings | PULL | login + 24h | 7d | 30d | n/a |
| Gift cards | LIVE-ONLY | n/a | n/a | n/a | n/a |
| Reservations | PULL | tab open + 15s poll | 5m | 15m | n/a |
| Terminal state | PULL + BOTH | login | n/a | n/a | [13 §4](./13-conflict-resolution.md) |

## Mid-sync interruption recovery

If `drainOutbox()` is interrupted mid-pass (browser closed, OS killed
the WebView, device sleeps mid-fetch):

- Entries already POSTed and dequeued: durably synced, no recovery needed
- Entries marked `syncing` but never updated: detected on next drain by
  `lastAttemptAt` being > 2 minutes old → reset to `pending`, retried
- Entries that returned 5xx: stay `pending` with bumped `attempts`, normal
  back-off applies
- Entries that returned 4xx: stay `failed`, surfaced in Settings → Sync
  → "Stuck sales" list

Implementation note: Phase 1 doesn't yet have the 2-minute auto-recovery.
Add to Phase 1.5 alongside bundled-mode work.

## What this protocol does NOT cover (Phase 6+)

- **Push notifications** of "your offline sale synced" to the cashier
- **Cross-terminal broadcast** ("Terminal 2 just sold the last burger")
  — kept out of scope; we rely on next-poll to discover it
- **Background sync while app is closed** — explicitly deferred per
  [09 § "WorkManager background workers deferred"](./09-decisions.md)
- **Multi-device merge of offline-created customers** — if Cashier A
  offline creates "Jane Smith (555-1234)" and Cashier B offline creates
  "Jane Smith (555-1234)" too, both rows land on sync. De-duplication
  is a Phase 6 admin tool, not automatic.
