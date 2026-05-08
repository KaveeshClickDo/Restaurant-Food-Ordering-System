# Order Flow

End-to-end lifecycle of every order type in the system.

---

## Order Types

| Fulfillment | Source | `customer_id` | `fulfillment` | Initial status |
|---|---|---|---|---|
| Online delivery | Customer portal | Real customer UUID | `"delivery"` | `"pending"` |
| Online collection | Customer portal | Real customer UUID | `"collection"` | `"pending"` |
| POS sale | POS terminal | `"pos-walk-in"` | `"collection"` | `"pending"` |
| Dine-in | Waiter app | `"pos-walk-in"` | `"dine-in"` | `"pending"` |

---

## Online Order Flow

```
Customer (guest or signed-in) adds items → cart → selects Delivery or Collection
  → CheckoutModal opens
  → POST /api/orders (server validates payload, inserts with status="pending")
  → Supabase Realtime fires INSERT event
  → AppContext patches customer.orders in state
  → Admin panel DeliveryPanel shows new order with toast notification
  → Kitchen display shows order in "New Orders" column
  → Customer "My Orders" screen shows active order card with Live badge

  [fire-and-forget, non-blocking]
  → POST /api/guest-profile { name, email, phone, orderTotal }
  → Upserts reservation_customers record for CRM use
```

### Status progression

```
pending
  → confirmed   [admin acknowledges]
  → preparing   [admin or kitchen]
  → ready       [kitchen marks food ready]
    ├─ (delivery)   → driver picks up → on_the_way → delivered
    └─ (collection) → admin/KDS marks collected → delivered
```

### Admin route guard

The admin cannot move a delivery order to `delivered` — the status API checks whether the order is a delivery type. Only the driver portal can set `deliveryStatus = "delivered"`, which then auto-sets `status = "delivered"`.

### Guest profile capture

After every successful checkout (including guest checkouts with no account), a fire-and-forget `POST /api/guest-profile` call captures the customer's name, email, phone, and order total into `reservation_customers`. This is:

- **Non-blocking** — a failure has no effect on the order confirmation
- **Idempotent** — uses the email address as the unique key; subsequent orders increment `order_count` and `total_spend`
- **Unified with reservations** — the same table stores both reservation guests and online orderers, giving admin a single CRM view

---

## POS Order Flow

```
Staff adds items → cart → complete sale (payment selected)
  │
  ▼
POSContext.completeSale()
  ├─ Builds POSSale record
  ├─ Appends to pos_sales in localStorage  ← committed first, never lost
  ├─ Updates customer loyalty points if assigned
  ├─ Deducts stock (locally)
  └─ Attempts POST /api/pos/orders (fire-and-forget)
       ├─ Success → KDS receives INSERT via Realtime → shows in "New Orders"
       └─ Failure (offline or error) → outboxEnqueue(sale)
              └─ Entry stored in pos_outbox (localStorage)
              └─ Retried when connectivity restores → drainOutbox()
```

### Offline sale handling

If the POST to `/api/pos/orders` fails (network down, timeout, or server error), the sale is placed in the **outbox queue** (`lib/posOutbox.ts`):

```
outboxEnqueue(sale):
  - Adds OutboxEntry { id, payload, addedAt, attempts: 0, status: "pending" }
  - Persists to localStorage["pos_outbox"]

drainOutbox() — triggered when isOnline flips true:
  - Iterates pending entries
  - Retries POST /api/pos/orders for each
  - 409 Conflict → already exists on server → dequeue (idempotent)
  - HTTP error → increment attempts; mark "failed" after 5 attempts
  - Success → dequeue

Back-off schedule: 2 s → 4 s → 8 s → 16 s → 32 s
```

The POS UI shows an **amber offline banner** while disconnected and a **blue syncing indicator** while draining the outbox. A `beforeunload` handler warns staff before closing the browser if unsynced entries remain.

### KDS note format

```
[POS] | Customer: John Smith | Staff: Sarah | Receipt: R1005
```

The KDS `deriveDisplayName()` extracts `"John Smith"` (or `"Walk-in"` if no customer). `deriveKitchenNote()` returns `undefined` for POS orders — no special note box is shown.

### Collection completion

When kitchen marks food ready:
- KDS shows "Mark as Collected" button (collection orders only)
- Calls `PUT /api/pos/orders/[id]/collected`
- Route validates `status = "ready"` before setting `"delivered"`

---

## Waiter (Dine-In) Order Flow

```
Waiter logs in (PIN) → selects table → builds order
  → POST /api/waiter/orders
    → inserts with customer_id = "pos-walk-in", fulfillment = "dine-in"
    → note: "[WAITER] Table T4 · 2 covers · Staff: Alex · No onions"
  → KDS receives INSERT via Realtime → shows in "New Orders"
  → Waiter selects another round of items → another POST → another card on KDS

[later]
Waiter views bill → aggregated total across all rounds
  → POST /api/waiter/settle (orderIds[], paymentMethod)
  → All orders → status = "delivered"
  → Table clears from grid
```

### Void flow (before settlement)

```
Senior waiter taps "Void Table" → enters reason → confirms
  → POST /api/waiter/void
  → All active orders → status = "cancelled", void_reason, voided_by, voided_at set
  → KDS removes cards (non-kitchen status event)
  → Table clears from grid
```

### Refund flow (after settlement)

```
Senior waiter opens receipt → taps "Refund" → selects full/partial + method + reason
  → POST /api/waiter/refund
  → Each order gets proportional share of refund amount
  → status = "refunded" or "partially_refunded"
  → RefundRecord appended to orders.refunds[]
```

---

## Driver Delivery Flow

```
Admin assigns driver → order.driverId set, deliveryStatus = "assigned"
  → Driver app shows order in "Available Orders" (status: preparing or ready)
  → Driver accepts → picks up food → "Picked Up" → on the way → "Delivered"
  → PUT /api/admin/orders/[id]/driver { delivery_status: "delivered", status: "delivered" }
  → Customer account tracker updates in real time
```

---

## Status Reference

| Status | Meaning | Who sets it |
|---|---|---|
| `pending` | Just placed | Checkout / POS / Waiter app |
| `confirmed` | Acknowledged by restaurant | Admin panel |
| `preparing` | Kitchen is cooking | Admin panel or KDS |
| `ready` | Food ready to go | KDS |
| `delivered` | Completed | Admin (collection), Waiter (settle), Driver (delivery) |
| `cancelled` | Voided / cancelled | Admin or Waiter void |
| `refunded` | Full refund processed | Admin or Waiter (senior) |
| `partially_refunded` | Partial refund processed | Admin or Waiter (senior) |

---

## AppContext Realtime Handler

`AppContext` subscribes to `postgres_changes` on the `orders` table. When an INSERT or UPDATE event arrives for an order whose `customer_id` is not yet in the customers state (e.g. `pos-walk-in` on first load, or a race condition on a new customer registration), the handler:

1. Checks `customersRef.current` (a ref kept in sync with customer state to avoid closure staleness)
2. If the customer is missing, fetches the full customer row with nested orders from Supabase
3. Adds the customer to state, carrying the new order along

This ensures orders are never silently dropped in the admin panel or customer account, regardless of the order in which Realtime events arrive.

---

## Void & Refund (POS Dashboard — Dine-In)

Admin / Manager can also void or refund dine-in (waiter-placed) orders from the POS Dashboard → Dine-In tab:

- **Void** (role: Manager or Admin): calls `POST /api/waiter/void`
- **Refund** (role: Admin): calls `POST /api/waiter/refund`

The POS Dashboard refreshes its dine-in list from Supabase after each action.
