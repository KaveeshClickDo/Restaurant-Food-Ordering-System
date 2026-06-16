/**
 * Shared types for the /waiter surface (app/waiter/page.tsx + components/waiter/*).
 * Pure type module — no runtime code.
 */

import type { MenuItemOffer } from "@/types";

export interface WaiterCartItem {
  lineId: string;
  menuItemId: string;
  name: string;       // includes variation/add-on labels
  unitPrice: number;  // base + variations + add-ons. Per-unit offers already
  // applied to the base; cart-level offers are NOT — see
  // `offer` below.
  quantity: number;
  note?: string;
  /** Cart-level offer snapshot (bogo / multibuy / qty_discount) taken at
   *  add-to-cart time so a mid-cart admin change doesn't retroactively
   *  rewrite a line. Per-unit offers are baked into unitPrice — for those
   *  this field stays undefined. */
  offer?: MenuItemOffer;
}

export type View = "login" | "tables" | "menu" | "success" | "bill";

export interface BillOrder {
  id: string;
  items: { name: string; qty: number; price: number }[];
  total: number;
  note: string;
}

export interface WaiterReceipt {
  tableLabel: string;
  waiterName: string;
  date: string;                // ISO
  items: { name: string; qty: number; price: number }[];
  /** Pre-discount/tip/service fee sum of items. Optional — when absent the receipt has no
   *  discount/tip/service fee and `total` is shown alone (back-compat). */
  subtotal?: number;
  /** Bill-level manual discount (money) and its reason. */
  discountAmount?: number;
  discountNote?: string;
  /** VAT on the (post-discount) bill, synced from the admin Tax & VAT setting.
   *  inclusive = VAT already inside the prices (informational line); exclusive
   *  = VAT added on top. rate is the % for the label. */
  vatAmount?: number;
  vatInclusive?: boolean;
  vatRate?: number;
  /** Table-service tip (money). */
  tipAmount?: number;
  /** Service fee (money). */
  serviceFeeAmount?: number;
  /** Final amount owed = subtotal − discount + (exclusive VAT) + tip + serviceFee */
  total: number;
  /** Amount paid by gift card. The cash/card amount collected is
   *  total − giftCardUsed. */
  giftCardUsed?: number;
  paymentMethod?: "cash" | "card" | "pending";
  orderIds: string[];
}

// Today's reservations the waiter grid overlays on the table tiles. Shape
// matches GET /api/waiter/reservations (camelCase). Read-only awareness; the
// only writes are seat (checked_in) and check-out (checked_out).
export interface WaiterReservation {
  id: string;
  tableLabel: string;
  section: string;
  customerName: string;
  partySize: number;
  date: string;     // "YYYY-MM-DD"
  time: string;     // "HH:MM"
  status: string;   // pending | confirmed | checked_in
  note: string | null;
  source: string | null;
}

// Derived per-tile reservation state used to render badges + drive the seat sheet.
export interface TileReservation {
  /** The reservation currently seated at this table (status checked_in), if any. */
  seated: WaiterReservation | null;
  /** The next not-yet-seated booking worth surfacing, if any. */
  next: WaiterReservation | null;
  /** Minutes from now until `next` (negative = the booking time has passed). */
  minutesUntil: number | null;
  /** `next` is arriving soon — prompt the waiter to seat it. */
  isDue: boolean;
  /** `next`'s time has passed and nobody has been seated (awaiting / likely no-show). */
  isOverdue: boolean;
  /** How many active bookings this table has today (seated + upcoming). */
  count: number;
  /** Upcoming (not-yet-seated) bookings — drives the "+N more" badge. */
  upcomingCount: number;
}

// An active dine-in order as the tables view needs it. One poll of the
// waiter's own /api/waiter/orders feeds three consumers: which tables are
// occupied, which occupied tables have actually ordered (vs just seated),
// and the foldable kitchen-status panel.
export interface WaiterActiveOrder {
  id: string;
  tableLabel: string;
  /** Kitchen lifecycle: pending | confirmed | preparing | ready.
   *  (delivered/cancelled rows are filtered out — they free the table.) */
  status: string;
  items: { name: string; qty: number; price: number }[];
  date: string; // ISO — placed time, drives the elapsed badge
}
