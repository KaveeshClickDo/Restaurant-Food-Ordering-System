# Kitchen Display System (KDS)

Route: `/kitchen`

A full-screen dark Kanban board designed to run permanently on a kitchen monitor. No login is required — the KDS is a trusted in-restaurant display.

---

## Architecture

The KDS is **completely self-contained** — it does not depend on `AppContext` or its customer state array. This eliminates a class of bugs where orders were silently dropped if their `customer_id` was not already loaded into the global customer list.

### Data fetching

On mount, the KDS runs a direct Supabase query with an embedded customer JOIN:

```typescript
supabase
  .from("orders")
  .select("id, items, total, note, status, fulfillment, date, address, scheduled_time, customer:customers(name)")
  .in("status", ["pending", "confirmed", "preparing", "ready"])
  .order("date", { ascending: true })
```

This returns all active orders in a single round-trip, with the customer name resolved via the FK relationship.

### Real-time updates

The KDS subscribes to the `orders` table on a dedicated channel (`"kds-orders-live"`):

```typescript
supabase.channel("kds-orders-live")
  .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, handler)
  .subscribe()
```

On each Realtime event:
- **Non-kitchen status** (`delivered`, `cancelled`, `refunded`, `partially_refunded`) → remove card from state
- **INSERT or UPDATE** → re-fetch the full row with the customer JOIN (Realtime payloads don't carry embedded data), then upsert into state
- **DELETE** → filter card out of state

This approach means the KDS is always accurate regardless of the order source (online, POS, or waiter) and regardless of whether the customer was previously loaded.

---

## Columns

| Column | Statuses | Action button |
|---|---|---|
| **New Orders** | `pending`, `confirmed` | Start Preparing |
| **Preparing** | `preparing` | Mark Ready |
| **Ready** | `ready` | Mark as Collected (POS/walk-in only) |

The Ready column is display-only for dine-in and delivery orders — kitchen's responsibility ends at `ready`. For POS (collection) orders, "Mark as Collected" calls `PUT /api/pos/orders/[id]/collected` which advances the order to `delivered`.

---

## Display Name Resolution

Each order card shows a `displayName` derived from the order's `note` field and fulfillment type:

| Source | Note pattern | `displayName` |
|---|---|---|
| Waiter (dine-in) | `[WAITER] Table T4 · 2 covers · Staff: Alex` | `"Table T4"` |
| POS walk-in | `[POS] \| Customer: John \| Staff: Sarah \| Receipt: R1005` | `"John"` (or `"Walk-in"` if no customer) |
| Online order | *(no prefix)* | Customer name from `customer:customers(name)` JOIN |

### Kitchen note stripping

POS metadata (`[POS] | ...`) is never shown in the kitchen note box.

For waiter orders, the note after `Staff: <name> · ` is extracted — e.g. `"No onions"` — and shown in the amber Special Note box. If there is no instruction after the metadata, the box is hidden.

For online orders, the full `note` field is shown as-is (it is free-form customer text).

---

## Status Advancement

All kitchen status changes go through `PUT /api/kds/orders/[id]/status`. This endpoint:

- Requires **no admin session cookie** (kitchen screens don't log in)
- Only permits kitchen-valid statuses: `pending`, `confirmed`, `preparing`, `ready`
- Blocks admin-only statuses (`delivered`, `cancelled`, `refunded`, `partially_refunded`)

### Optimistic UI

The KDS updates card state immediately on button click, then calls the API. If the API call fails, the card is rolled back to its previous status and an error message is shown on the card.

---

## Urgency Indicators

| Age | Indicator |
|---|---|
| < 15 min | Normal |
| 15–29 min | Amber time badge |
| ≥ 30 min | Red time badge + pulse animation on card border |

Urgency is recalculated every 30 seconds automatically.

---

## Order Card Content

Each card shows:

- **Display name** (table, customer, or walk-in)
- **Fulfillment badge**: Dine-In / Delivery / Collection / Scheduled
- **Item list**: quantity × name for each line
- **Special Note** (amber box) — only when a kitchen instruction exists
- **Delivery address** — for delivery orders
- **Scheduled time** — for scheduled orders
- **Elapsed time** with urgency colouring
- **Action button** (not shown on Ready column unless collection order)

---

## Header Bar

- Restaurant name (from `AppContext` settings — the single source of truth for branding; the only thing KDS reads from global state)
- Completed-today count (orders that left the active columns since page load)
- Live clock (updated every second)
- Fullscreen toggle (browser Fullscreen API)
- Link back to admin dashboard

No authentication is required to access `/kitchen` — the KDS is designed to run permanently on a dedicated kitchen monitor without staff interaction.

---

## API Routes Used by KDS

| Method | Endpoint | Purpose |
|---|---|---|
| `PUT` | `/api/kds/orders/[id]/status` | Advance through kitchen stages |
| `PUT` | `/api/pos/orders/[id]/collected` | Mark POS order collected (delivered) |
