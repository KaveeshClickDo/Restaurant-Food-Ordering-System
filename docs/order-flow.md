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
Customer adds items → cart → checkout modal
  → POST /api/orders (server validates payload, inserts with status="pending")
  → Supabase Realtime fires INSERT event
  → AppContext patches customer.orders in state
  → Admin panel DeliveryPanel shows new order with toast notification
  → Kitchen display shows order in "New Orders" column
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

The admin cannot move a delivery order to `delivered` — the status API checks whether there is a driver assigned and whether the order is delivery type. Only the driver portal can set `deliveryStatus = "delivered"` which then auto-sets `status = "delivered"`.

---

## POS Order Flow

```
Staff adds items → cart → complete sale (payment)
  → POSContext.completeSale() saves sale to localStorage
  → POST /api/pos/orders (fire-and-forget, logs errors to console)
    → maps POSSale → orders row (customer_id = "pos-walk-in", fulfillment = "collection")
    → inserts into Supabase
  → KDS receives INSERT via Realtime → shows in "New Orders"
```

### KDS note format

```
[POS] | Customer: John Smith | Staff: Sarah | Receipt: R1005
```

The KDS `deriveDisplayName()` extracts `"John Smith"` (or `"Walk-in"` if no customer). The `deriveKitchenNote()` returns `undefined` for POS orders — no amber special note box is shown.

### Collection completion

When kitchen marks food ready:
- KDS shows "Mark as Collected" button (collection orders only)
- Calls `PUT /api/pos/orders/[id]/collected`
- Route validates order is `status = "ready"` before setting `"delivered"`

### Offline resilience

The POS sale is committed to `localStorage` before the API call. If the network is down, the sale is never lost — it simply won't appear on the KDS until the network recovers and the sale is re-sent (manual re-send is not currently implemented; failed syncs are logged to console).

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

## Driver Delivery Flow

```
Admin assigns driver → order.driverId set, deliveryStatus = "assigned"
  → Driver app shows order in "Available Orders" (status: preparing or ready)
  → Driver accepts → picks up food → "Picked Up" → on the way → "Delivered"
  → PUT /api/admin/orders/[id]/driver { delivery_status: "delivered", status: "delivered" }
  → Customer account tracker updates in real time
```

---

## Void & Refund (POS Dashboard — Dine-In)

Admin / Manager can also void or refund dine-in (waiter-placed) orders from the POS Dashboard → Dine-In tab:

- **Void** (role: Manager or Admin): calls `POST /api/waiter/void`
- **Refund** (role: Admin): calls `POST /api/waiter/refund`

The POS Dashboard refreshes its dine-in list from Supabase after each action.
