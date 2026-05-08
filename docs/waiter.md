# Waiter App

Route: `/waiter`

A mobile-first table-service companion for front-of-house staff. Staff authenticate with a 4-digit PIN — no separate login credentials or admin access required. All order data flows directly to the Kitchen Display System via Supabase Realtime.

---

## Authentication

Staff are managed in **Admin → Settings → Staff & Tables**.

1. Waiter selects their name from the staff list
2. Enters their 4-digit PIN on the animated keypad
3. PIN is validated server-side by `POST /api/waiter/auth` — the client never sees stored PINs
4. On success, the staff record (without PIN) is held in component state for the session

### Roles

| Role | Place orders | View bill | Settle bill | Void table | Refund |
|---|---|---|---|---|---|
| `waiter` | Yes | Yes | Yes | No | No |
| `senior` | Yes | Yes | Yes | Yes | Yes |

---

## Table Grid

After login, staff see a colour-coded table grid organised by section:

| Colour | Meaning |
|---|---|
| Dark card (muted) | Table is free |
| Amber ring | Table has open orders |

Sections are configurable in **Admin → Staff & Tables** (default: Main Hall, Terrace, Bar).

Table occupancy is determined by querying `orders` for active (`pending`, `confirmed`, `preparing`, `ready`) dine-in orders with the relevant table identifier in their `note` field.

---

## Placing Orders

1. Tap a table → opens the menu screen
2. Menu is grouped by category tabs (fetched from Supabase categories + menu_items)
3. Tap an item → add directly to cart (or via a note modal for special instructions)
4. Quantity controls on each cart line
5. Optional per-line kitchen note
6. "Send to Kitchen" posts the cart to `POST /api/waiter/orders`

### What happens on send

The API route builds a structured note:

```
[WAITER] Table T4 · 2 covers · Staff: Alex · No onions
```

And inserts an order row:

```json
{
  "customer_id": "pos-walk-in",
  "fulfillment": "dine-in",
  "status": "pending",
  "payment_method": "table-service",
  "note": "[WAITER] Table T4 · 2 covers · Staff: Alex · No onions"
}
```

The KDS picks up the INSERT event via Supabase Realtime and displays it in the **New Orders** column within milliseconds. The kitchen note box on the KDS card shows only the instruction after the metadata prefix — e.g. `"No onions"`.

Multiple order rounds per table are supported. Each "Send to Kitchen" creates a new order row.

---

## Bill View

Tap a table with open orders → "View Bill" button → bill screen:

- Lists all order rounds for the table, aggregated into a single itemised view
- Shows the combined total across all rounds
- "Settle" button opens the payment method selector (Cash or Card)

### Settlement

Calls `POST /api/waiter/settle` with the array of order IDs and the payment method. All orders are updated to `status = "delivered"`. The table clears from the occupied list.

---

## Void & Refund (Senior staff only)

Non-senior staff who attempt void or refund see an access-denied screen. The server-side API routes do not re-check role — the waiter app is treated as a trusted in-restaurant terminal.

### Void (before settlement)

Available via the "Void Table" button in the bill view, or the menu screen.

- Cancels all active orders for the table
- Requires a mandatory reason (free text)
- Sets `status = "cancelled"`, `void_reason`, `voided_by`, `voided_at` on each order
- The `.not("status", "in", '("delivered","cancelled","refunded","partially_refunded")')` filter means settled orders are never accidentally voided

API: `POST /api/waiter/void`

```json
{
  "orderIds": ["uuid-1", "uuid-2"],
  "reason": "Customer left",
  "voidedBy": "Head Waiter"
}
```

### Refund (after settlement)

Available from the receipt modal via the "Refund" button — replaces the normal Close/Print/Reprint footer when order IDs are present.

- **Full refund**: refunds the entire table total
- **Partial refund**: enter a custom amount (must be ≤ total)
- **Refund method**: Cash or Card
- Refund amount is distributed proportionally across all order rounds
- Each order gets a `RefundRecord` appended to its `refunds` JSON array
- Status is set to `"refunded"` (full) or `"partially_refunded"` (partial)

API: `POST /api/waiter/refund`

```json
{
  "orderIds": ["uuid-1", "uuid-2"],
  "refundAmount": 25.50,
  "refundMethod": "cash",
  "reason": "Wrong dish delivered",
  "refundedBy": "Head Waiter"
}
```

---

## Receipt

After settling, a receipt modal opens showing:

- Restaurant name, phone, website (from admin receipt / branding settings — single source of truth)
- VAT number (if configured)
- Table number, served-by name, date/time
- Itemised list with quantities and prices
- Total and payment method

Options:
- **Print** — sends the receipt HTML to the browser print dialog
- **Email** — sends via `POST /api/email` using the configured SMTP settings

---

## Managing Staff & Tables

Go to **Admin → Settings → Staff & Tables**:

- **Staff tab**: Add, edit, or delete waiter accounts. Fields: name, PIN (4 digits), role (`senior` or `waiter`), avatar colour, active toggle.
- **Tables tab**: Add, edit, or delete dining tables. Fields: label (e.g. T4, B1), seats, section, active toggle.

Changes take effect immediately — the waiter app fetches config from `/api/waiter/config` on each login.

---

## API Summary

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/waiter/config` | None | Active staff (no PINs) + active tables |
| `POST` | `/api/waiter/auth` | None | PIN validation; returns staff record |
| `POST` | `/api/waiter/orders` | None | Insert a dine-in order |
| `POST` | `/api/waiter/settle` | None | Mark orders as delivered + record payment |
| `POST` | `/api/waiter/void` | None | Cancel active orders with reason |
| `POST` | `/api/waiter/refund` | None | Proportional refund on settled orders |
| `POST` | `/api/waiter/logout` | None | Clear waiter session state |

All waiter routes use the **service role key** server-side. "None" means no admin session cookie is required — the waiter app is a trusted in-restaurant screen.
