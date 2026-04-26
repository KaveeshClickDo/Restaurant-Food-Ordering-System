# Real-Time Sync

The system uses **Supabase Realtime** (`postgres_changes`) to propagate database mutations to all connected clients within milliseconds. This page explains which components subscribe, what they listen to, and how they handle events.

---

## Supabase Realtime Setup

Realtime must be enabled on each table. Run these statements once in the Supabase SQL Editor (or include them in the setup script):

```sql
alter publication supabase_realtime add table app_settings;
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table menu_items;
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table orders;
```

The `drivers` and `reservation_customers` tables are intentionally **not** added to the Realtime publication — their data is fetched on demand via admin API routes and does not require live push.

---

## AppContext — `"restaurant-realtime"` channel

`AppContext` maintains a single Supabase Realtime channel that covers all tables relevant to the customer-facing app and admin panel.

### `app_settings` (UPDATE)

Deep-merges the incoming row's `data` JSONB with `DEFAULT_SETTINGS` to ensure all nested objects have their default structure. This prevents "cannot read property of undefined" crashes when new fields are added to the default that don't yet exist in stored snapshots.

The updated settings object is the **single source of truth** for restaurant branding — the POS, receipt panel, and KDS all read from `appSettings.restaurant` and reflect changes instantly across all connected sessions.

### `categories` (INSERT / UPDATE / DELETE)

- DELETE → filter out by `id`
- INSERT / UPDATE → upsert into the categories array by `id`

### `menu_items` (INSERT / UPDATE / DELETE)

Same upsert/filter pattern as categories.

### `orders` (INSERT / UPDATE / DELETE)

- DELETE → remove the order from the matching customer's `orders` array
- INSERT / UPDATE → patch the order into the matching customer's `orders` array

**Missing customer handling**: If `order.customerId` is not in the current customers state (e.g. the `pos-walk-in` sentinel on first load, or a customer INSERT/order INSERT race), the handler:

1. Reads `customersRef.current` (a `useRef` kept in sync via `useEffect`) to avoid closure staleness
2. Fetches the missing customer with `supabase.from("customers").select("*, orders(*)").eq("id", order.customerId).single()`
3. Adds the customer to state with the new order already included

This prevents orders from being silently dropped.

### `customers` (INSERT / UPDATE / DELETE)

- DELETE → filter out
- INSERT → fetch the full customer row with nested orders (`*, orders(*)`), then append
- UPDATE → patch scalar fields in-place while keeping the in-memory orders array intact (avoids an extra fetch for every field change)

---

## KDS — `"kds-orders-live"` channel

The Kitchen Display System uses its **own dedicated Realtime channel**, independent of AppContext. This is by design:

- KDS must work even when `AppContext` isn't mounted (e.g. on a dedicated kitchen tablet)
- KDS needs the `customer:customers(name)` JOIN data, which Realtime payloads don't carry
- Decoupling prevents the KDS from being affected by AppContext subscriber count or lifecycle

### Event handling

| Event | Condition | Action |
|---|---|---|
| Any event | New status is not a kitchen status (`pending/confirmed/preparing/ready`) | Remove card from state |
| INSERT or UPDATE | Kitchen status | Re-fetch full order row with customer JOIN, then upsert into state |
| DELETE | — | Filter card out of state |

The re-fetch on INSERT/UPDATE is intentional — Supabase Realtime payloads contain the raw row data but not embedded/joined data. Re-fetching ensures `displayName` and `kitchenNote` are derived from complete data.

---

## POS — Connectivity Probe (not Realtime)

The POS uses a separate mechanism for its offline detection — a periodic probe to `HEAD /api/ping` rather than a Supabase Realtime subscription. This is intentional:

- The POS operates fully from `localStorage` and doesn't need live DB sync for its own data
- The probe detects true connectivity (not just navigator.onLine) to determine whether card payments should be enabled
- When the probe transitions from offline → online, the outbox queue is drained automatically

See `lib/connectivity.ts` and `lib/posOutbox.ts` for the implementation.

---

## Race Conditions

### Customer INSERT before order INSERT

When a new customer registers and immediately places an order, two Realtime events fire in rapid succession:

1. `customers` INSERT
2. `orders` INSERT

If event 2 arrives before event 1 is processed, `customersRef.current` will not yet contain the new customer. The `orders` handler detects this and fetches the customer on demand (see "Missing customer handling" above).

### POS walk-in sentinel

POS and waiter orders use `customer_id = "pos-walk-in"`. This sentinel row is seeded by `rls_policies.sql` and by each waiter/POS API route (`ensureWalkInCustomer()`). On the first order event from these sources, AppContext fetches and adds the sentinel customer automatically — subsequent events find it in `customersRef.current` and skip the fetch.

---

## Summary

| Component | Channel | Tables | Purpose |
|---|---|---|---|
| `AppContext` | `"restaurant-realtime"` | `app_settings`, `categories`, `menu_items`, `customers`, `orders` | Global app state — admin, customer portal, account |
| `kitchen/page.tsx` | `"kds-orders-live"` | `orders` | Self-contained KDS — does not depend on AppContext |
| POS (`pos/page.tsx`) | none (probe-based) | n/a | Connectivity detection via `HEAD /api/ping` |
