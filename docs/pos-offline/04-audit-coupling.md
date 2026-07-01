# 04 · Audit — Cross-system coupling

Everywhere outside `/pos` that reads, writes, or filters on POS data.
These are the **regression risks** — if the offline-mode schema changes
break any of these consumers, things break silently across the app.

## `pos_sales` consumers

Files that touch the `pos_sales` table directly (`from("pos_sales")`).
26 hits across the codebase; the ones that read for *reporting* are the
ones offline changes must not regress.

| File | What it does | Regression risk |
|---|---|---|
| [app/src/app/api/pos/sales/route.ts](../../app/src/app/api/pos/sales/route.ts) | The POS sale POST + GET. | Owner — changes here are scoped. |
| [app/src/app/api/pos/sales/[id]/route.ts](../../app/src/app/api/pos/sales/[id]/route.ts) | Void + refund. | Owner — needs the offline ID convention to keep working. |
| [app/src/app/api/admin/pos/route.ts](../../app/src/app/api/admin/pos/route.ts) | Admin POS staff list / create. Touches `pos_staff` only — name match is coincidence. | Low — doesn't read `pos_sales` directly (verified by grep). |
| [app/src/app/api/admin/pos/[id]/route.ts](../../app/src/app/api/admin/pos/[id]/route.ts) | Admin POS staff edit / delete. Touches `pos_staff` only. | Low. |
| [app/src/components/admin/POSReportsPanel.tsx](../../app/src/components/admin/POSReportsPanel.tsx) | Admin → POS Reports panel. Loads sales via GET /api/pos/sales. | **HIGH** — the schema-change "add columns" approach has to preserve every field this panel reads. |
| [app/src/app/api/admin/customers/list/route.ts:146](../../app/src/app/api/admin/customers/list/route.ts#L146) | Joins pos_sales to compute per-customer totalSpend / visitCount / lastVisit. | **HIGH** — touches the same `pos_sales.total / date / customer_id / voided` fields that exist today. Additive schema is safe. |
| [app/src/app/api/gift-cards/[code]/redeem/route.ts](../../app/src/app/api/gift-cards/[code]/redeem/route.ts) | Reads/writes pos_sale_id stamp on gift_card_transactions. | Low — uses `pos_sales.id` only, which doesn't change. |
| [app/src/context/POSContext.tsx](../../app/src/context/POSContext.tsx) | Web POS sales list (via GET). | Owner. |
| [app/src/components/pos/SettingsView.tsx, CustomersView.tsx](../../app/src/components/pos/) | UI display only, indirect via POSContext. | Owner. |
| [app/src/lib/schemas/pos.ts](../../app/src/lib/schemas/pos.ts) | Zod schema for create/void payloads. | Owner — must add optional `terminalId`, `clientCreatedAt` fields. |
| [app/src/middleware.ts](../../app/src/middleware.ts) | Mentions pos for route gating only. | Low — string match. |
| [app/src/types/index.ts](../../app/src/types/index.ts) | TypeScript types referencing pos_sales shape. | Low — adding optional fields is non-breaking. |

### Specific consumer test: admin `POSReportsPanel`

This is the most exposed surface — it shows sales across all terminals
to the admin. Any offline-mode change must keep it rendering correctly
for **both** old (no `terminal_id`) and new (with `terminal_id`) rows.

Acceptance test (recorded for `10-test-plan.md`):
- Before any offline-mode code lands: snapshot the report for a known
  date range as a fixture.
- After Phase 2 (per-terminal receipt scheme): re-run the same query.
  Totals, counts, and per-cashier breakdowns must match exactly.

### Specific consumer test: customer list `totalSpend`

[admin/customers/list/route.ts:146](../../app/src/app/api/admin/customers/list/route.ts#L146)
sums `pos_sales.total` per `customer_id` to compute customer lifetime
spend (combined with `orders.total`). Same acceptance test — snapshot
before, verify match after.

## `orders` consumers (POS writes via `pushToKDS`)

POS only ever **inserts** into `orders` (never updates / deletes). The
35+ files that read from `orders` are downstream consumers — they read
what POS produced and don't care which producer wrote it.

The convention POS uses ([api/pos/sales/route.ts:394-406](../../app/src/app/api/pos/sales/route.ts#L394-L406)):

| Field | POS value |
|---|---|
| `id` | Same as `pos_sales.id` |
| `customer_id` | `'pos-walk-in'` sentinel |
| `fulfillment` | `'collection'` |
| `status` | `'pending'` |
| `note` | `"[POS] | Customer: ... | Staff: ... | Receipt: R1042 | ..."` |

Downstream filters that depend on these markers:

### Kitchen page

[app/src/app/kitchen/page.tsx:140, 166-167, 178](../../app/src/app/kitchen/page.tsx#L140):
```
if (n.startsWith("[POS]")) { ... }
```
Used to render POS tickets differently from delivery / online / dine-in.

**Offline implication**: the offline POS still writes `[POS]` in the note
when it eventually syncs (the KDS push happens on the server at sync
time, so the note format is *generated server-side* by the existing
`pushToKDS`). No change required — the kitchen UI sees the same shape.

### Admin reports

| File | Reads from `orders` | Relevant filter |
|---|---|---|
| [components/admin/OnlineReportsPanel.tsx](../../app/src/components/admin/OnlineReportsPanel.tsx) | Yes | Filters out `[POS]` notes? Need verification. |
| [components/admin/RefundsPanel.tsx](../../app/src/components/admin/RefundsPanel.tsx) | Yes | Shows all refunds — POS refunds live on `pos_sales`, not `orders`, so no double-count today. |
| [app/api/admin/orders/route.ts](../../app/src/app/api/admin/orders/route.ts) | Yes | Lists every order including POS sale shadow rows. |
| [app/api/admin/payments/route.ts](../../app/src/app/api/admin/payments/route.ts) | Yes | Payment audit; POS sales surface as `[POS]`-tagged orders. |

### Waiter / driver

Waiter and driver routes read `orders` for table service and delivery
respectively. POS-shadow rows have `fulfillment = 'collection'` so they
don't appear in waiter's dine-in list or driver's delivery list. **No
regression risk** — the existing filter ignores them.

## `pos_staff` consumers

| File | Use |
|---|---|
| [api/admin/pos/route.ts](../../app/src/app/api/admin/pos/route.ts), [api/admin/pos/[id]/route.ts](../../app/src/app/api/admin/pos/[id]/route.ts) | Admin CRUD for POS staff. |
| [api/pos/staff/route.ts](../../app/src/app/api/pos/staff/route.ts), [api/pos/staff/[id]/route.ts](../../app/src/app/api/pos/staff/[id]/route.ts) | POS-internal CRUD (admin POS user can add cashiers from inside the POS). |
| [api/pos/auth/route.ts](../../app/src/app/api/pos/auth/route.ts) | POST = PIN login. GET = hydrate session. |
| [lib/posPermissions.ts](../../app/src/lib/posPermissions.ts) | Server-side permission gate. |
| [app/api/admin/users/[id]/set-password/route.ts](../../app/src/app/api/admin/users/[id]/set-password/route.ts) | Admin reset PIN — bumps `session_version`. |

**Offline implication**: the new `/api/pos/staff/credentials` endpoint
(see `02-audit-schema.md`) is the only addition. None of the existing
consumers change.

## `pos_clock_entries` consumers

| File | Use |
|---|---|
| [api/pos/clock/route.ts](../../app/src/app/api/pos/clock/route.ts) | GET / POST clock-in/out. |
| Admin payroll views (need to grep) | Likely consume via `/api/admin/...` |

**Offline implication**: if we choose to disable offline clock-in/out
(recommended), no schema change is needed and no consumer changes either.

## `gift_cards` + `gift_card_transactions`

`pos_sales.gift_card_id` and `pos_sales.gift_card_used` link a sale to
the card it consumed. `gift_card_transactions.pos_sale_id` is the audit
trail. If offline mode disables gift card tender (recommended), this
linkage isn't exercised offline and stays correct.

## `menu_items` consumers

The atomic stock decrement happens via `decrement_stock_atomic` RPC,
called from:
- [api/pos/sales/route.ts:234](../../app/src/app/api/pos/sales/route.ts#L234) — POS
- [api/orders/route.ts](../../app/src/app/api/orders/route.ts) — customer online orders
- [api/waiter/orders/route.ts](../../app/src/app/api/waiter/orders/route.ts) — waiter dine-in
- (Webhook handlers for paid orders also call it.)

**Offline implication**: when an offline POS sale syncs and hits this RPC,
it might fail because another channel has consumed stock in the meantime.
Policy decision deferred to `07-phases.md` Phase 3 (recommended: accept
the sale and stamp `oversold = true`).

## `realtime` subscriptions (POSContext)

POSContext subscribes to `menu_items` realtime so the on-screen stock
counter ticks down when other terminals or channels decrement
([POSContext.tsx menu_items realtime, ~line 677 area](../../app/src/context/POSContext.tsx#L677-L685)).

**Offline implication**: when offline, the WebSocket dies. No live stock
updates. Local sales decrement the local cache. On reconnect, the snapshot
refresh re-syncs to server truth. Acceptable.

## Coupling-related risks summary

| Risk | Where surfaces | Mitigation |
|---|---|---|
| Admin POS Reports breaks on schema add | POSReportsPanel | Additive columns only; before/after snapshot test |
| Admin customer-list totalSpend broken | api/admin/customers/list | Test ditto |
| Kitchen `[POS]` filter breaks on note format change | kitchen/page.tsx | Don't change the note format — server-side `pushToKDS` keeps writing it |
| Stock decrement race fails at sync | menu_items consumers | Phase 3 oversell policy |
| Receipt number duplicates between offline+online | pos_sales UNIQUE | Per-terminal namespace (`T1-1042` vs `R1042`) so the spaces don't overlap |
| Refund pulls back the wrong sale row | api/pos/sales/[id] PATCH | sale.id is the key; no terminal_id ambiguity |

## What is *not* coupled and therefore safe

- POS receipt printing (escpos + Capacitor plugins) — purely client-side.
- Waiter app — touches `orders`, never `pos_sales`.
- Driver app — touches `orders`, never `pos_sales`.
- Online ordering / customer login — touches `orders`, `customers`, never `pos_sales`.
- Reservations — separate table.
- Email / Stripe / PayPal — payment surface for online; POS uses its own payment dialog.
