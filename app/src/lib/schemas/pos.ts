import { z } from "zod";
import { NonEmptyString, Money, PositiveMoney } from "./primitives";

// ── POS sale ─────────────────────────────────────────────────────────────────
// The POS cart item shape is rich + flexible — let it pass through and let the
// existing rowToSale mapping handle field-by-field defensiveness.
const PosCartItem = z.object({
  name:     z.string(),
  quantity: z.number().positive(),
}).passthrough();

const PaymentRecord = z.object({
  method: z.enum(["cash", "card"]),
  amount: Money,
});

export const PosSaleCreateSchema = z.object({
  id:             NonEmptyString,
  date:           z.string().optional(),
  staffId:        z.string().optional(),
  staffName:      z.string().optional(),
  customerId:     z.string().optional(),
  customerName:   z.string().optional(),
  tableNumber:    z.number().int().optional(),
  items:          z.array(PosCartItem).min(1, "Cart cannot be empty."),
  subtotal:       Money.optional(),
  discountAmount: Money.optional(),
  discountNote:   z.string().optional(),
  // Cart-wide kitchen note (mirrors the waiter's per-order note). Folded into
  // the KDS ticket header so chefs see one combined instruction string. Not
  // persisted on pos_sales separately — see /api/pos/sales/route.ts.
  kitchenNote:    z.string().max(300).optional(),
  taxAmount:      Money.optional(),
  taxRate:        z.number().nonnegative().optional(),
  taxInclusive:   z.boolean().optional(),
  tipAmount:      Money.optional(),
  serviceFeeAmount: Money.optional(),
  total:          Money.optional(),
  // 'gift_card' is allowed for the case where a gift card fully covers the
  // sale (no cash/card remainder). Partial coverage keeps cash/card/split and
  // records the gift portion via giftCardUsed below.
  paymentMethod:  z.enum(["cash", "card", "split", "gift_card"]).optional(),
  payments:       z.array(PaymentRecord).optional(),
  cashTendered:   Money.optional(),
  changeGiven:    Money.optional(),
  // Gift card tender — code + amount the cashier applied. Server looks up the
  // card, clamps the amount to its balance, stamps the sale row, and redeems.
  giftCardCode:   z.string().optional(),
  giftCardUsed:   Money.optional(),
  // ── Offline-tablet fields (Phase 1 pass-through; strict per-terminal
  // validation lands in Phase 2) ────────────────────────────────────────────
  // Set ONLY by the Capacitor Android client when running offline. Web POS
  // sales leave these undefined and continue to use the server-side defaults
  // (receipt_no via pos_receipt_seq, client_created_at NULL, terminal_id NULL).
  receiptNo:        z.string().max(32).optional(),
  terminalId:       z.string().max(64).optional(),
  clientCreatedAt:  z.string().optional(),
}).passthrough();

export const PosSaleVoidSchema = z.object({
  voidReason:   NonEmptyString,
  refundMethod: z.enum(["cash", "card", "none"]).optional(),
  refundAmount: Money.optional(),
});

// ── POS dine-in void / refund ────────────────────────────────────────────────
// The POS dashboard's Dine-In tab voids/refunds dine-in orders (orders table,
// fulfillment = "dine-in"). These are POS-native endpoints gated by the POS
// permissions canVoidSale / canIssueRefund — the dashboard runs on the POS
// staff session, NOT the waiter session, so it must NOT call /api/waiter/*.
const NonEmptyIdArray = z.array(NonEmptyString).min(1, "At least one orderId is required.");

export const PosDineInVoidSchema = z.object({
  orderIds: NonEmptyIdArray,
  reason:   NonEmptyString,
});

export const PosDineInRefundSchema = z.object({
  orderIds:     NonEmptyIdArray,
  refundAmount: PositiveMoney,
  refundMethod: z.enum(["cash", "card"]).optional(),
  reason:       NonEmptyString,
});

export const PosClockSchema = z.object({
  action:    z.enum(["in", "out"]),
  staffId:   NonEmptyString,
  staffName: NonEmptyString,
  notes:     z.string().optional(),
});

// ── POS terminals (offline-capable Android tablets) ──────────────────────────
// `prefix` is the receipt-number namespace for sales rung up on this terminal
// (e.g. T1 → 'T1-1042'). 1–4 chars [A-Z0-9]; uniqueness among active terminals
// is enforced by the partial unique index on pos_terminals.prefix.
const TerminalPrefix = z.string().regex(
  /^[A-Z0-9]{1,4}$/,
  "Prefix must be 1-4 uppercase letters or digits (e.g. T1, BAR1).",
);

export const PosTerminalCreateSchema = z.object({
  label:             NonEmptyString.max(40, "Label is too long."),
  prefix:            TerminalPrefix,
  // Optional device fingerprint hash supplied by the tablet at first
  // registration. Admin-created terminals leave this blank until a device binds.
  deviceFingerprint: z.string().max(128).optional(),
}).strict();

export const PosTerminalUpdateSchema = z.object({
  label:             NonEmptyString.max(40).optional(),
  prefix:            TerminalPrefix.optional(),
  active:            z.boolean().optional(),
  deviceFingerprint: z.string().max(128).optional(),
}).strict().refine(
  (v) => Object.keys(v).length > 0,
  { message: "At least one field is required." },
);

// ── Order status / driver ────────────────────────────────────────────────────
export const OrderStatusUpdateSchema = z.object({
  status: NonEmptyString,
});

export const KdsOrderStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "ready"]),
});

// Collection-order settle (POS pickup payment). Cash / card / split only —
// gift card, coupon, and store credit are all applied at online checkout and
// already baked into `order.total`, so the POS just records how the
// outstanding balance was tendered and flips the order to paid + delivered.
export const PosCollectionSettleSchema = z.object({
  paymentMethod: z.enum(["cash", "card", "split"]),
});

export const OrderDriverAssignSchema = z.object({
  driver_id:       NonEmptyString,
  driver_name:     NonEmptyString,
  delivery_status: NonEmptyString,
  status:          z.string().optional(),
  delivery_code:   z.string().optional(),
});

// ── Waiter dine-in order ─────────────────────────────────────────────────────
// `menuItemId` ties the line back to menu_items so the server can decrement
// stock atomically. Optional for backward-compat with ad-hoc / hand-typed
// lines that aren't a catalogued menu item.
const WaiterItem = z.object({
  menuItemId: z.string().optional(),
  name:       NonEmptyString,
  qty:        z.number().int().positive(),
  price:      Money,
}).passthrough();

export const WaiterOrderCreateSchema = z.object({
  tableLabel:  NonEmptyString,
  // Structural table link, set so occupancy/availability can join orders↔tables
  // without parsing the note. Optional for back-compat with older clients.
  tableId:     z.string().optional(),
  covers:      z.number().int().positive().optional(),
  staffName:   z.string().optional(),
  items:       z.array(WaiterItem).min(1, "At least one item required."),
  total:       Money.optional(),
  kitchenNote: z.string().optional(),
});

// ── Misc ─────────────────────────────────────────────────────────────────────
export const EmailRelaySchema = z.object({
  to:       z.string().email("Recipient must be a valid email."),
  subject:  NonEmptyString,
  html:     NonEmptyString,
  fromName: z.string().optional(),
  /** Marketing checkbox next to the e-bill email field (default ticked).
   *  false → the captured contact starts/stays unsubscribed. */
  marketingOptIn: z.boolean().optional().default(true),
}).strict();  // reject extra fields (especially the `smtp` injection vector)

export const PrintSchema = z.object({
  ip:    NonEmptyString,
  port:  z.number().int().min(1).max(65535),
  bytes: z.array(z.number().int().min(0).max(255)).min(1, "bytes required.").max(65_536, "Payload too large."),
});

// ── POS-scoped settings patch ────────────────────────────────────────────────
// The POS Settings screen persists only this slice of the global settings blob
// (tax rate/inclusive, receipt-printer config) via PATCH /api/pos/settings, so
// a POS-only device doesn't need an admin cookie. `.strict()` on both sub-
// objects rejects unknown keys — POS can never widen its write surface beyond
// taxSettings + printer (the route ignores everything else regardless).
export const PosSettingsPatchSchema = z
  .object({
    taxSettings: z
      .object({
        enabled:       z.boolean().optional(),
        rate:          z.number().min(0).max(100).optional(),
        inclusive:     z.boolean().optional(),
        showBreakdown: z.boolean().optional(),
      })
      .strict()
      .optional(),
    printer: z
      .object({
        enabled:          z.boolean().optional(),
        name:             z.string().optional(),
        connection:       z.enum(["network", "usb", "bluetooth", "browser"]).optional(),
        ip:               z.string().optional(),
        port:             z.number().int().min(1).max(65535).optional(),
        bluetoothAddress: z.string().optional(),
        bluetoothName:    z.string().optional(),
        autoPrint:        z.boolean().optional(),
        paperWidth:       z.number().int().optional(),
        allowedIps:       z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    // Receipt header/footer content — the single source of truth shared with
    // Admin → Receipt (app_settings.data.receiptSettings). All optional so POS
    // can send a partial patch; the route sub-object-merges it.
    receiptSettings: z
      .object({
        showLogo:        z.boolean().optional(),
        logoUrl:         z.string().optional(),
        logoDither:      z.boolean().optional(),
        restaurantName:  z.string().optional(),
        address:         z.string().optional(),
        phone:           z.string().optional(),
        website:         z.string().optional(),
        email:           z.string().optional(),
        vatNumber:       z.string().optional(),
        thankYouMessage: z.string().optional(),
        customMessage:   z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (d) => d.taxSettings !== undefined || d.printer !== undefined || d.receiptSettings !== undefined,
    { message: "Provide taxSettings, printer and/or receiptSettings to update." },
  );
