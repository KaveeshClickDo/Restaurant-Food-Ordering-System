import { z } from "zod";
import { NonEmptyString, Money } from "./primitives";

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
  taxAmount:      Money.optional(),
  taxRate:        z.number().nonnegative().optional(),
  taxInclusive:   z.boolean().optional(),
  tipAmount:      Money.optional(),
  total:          Money.optional(),
  paymentMethod:  z.enum(["cash", "card", "split"]).optional(),
  payments:       z.array(PaymentRecord).optional(),
  cashTendered:   Money.optional(),
  changeGiven:    Money.optional(),
}).passthrough();

export const PosSaleVoidSchema = z.object({
  voidReason:   NonEmptyString,
  refundMethod: z.enum(["cash", "card", "none"]).optional(),
  refundAmount: Money.optional(),
});

export const PosClockSchema = z.object({
  action:    z.enum(["in", "out"]),
  staffId:   NonEmptyString,
  staffName: NonEmptyString,
  notes:     z.string().optional(),
});

// ── Order status / driver ────────────────────────────────────────────────────
export const OrderStatusUpdateSchema = z.object({
  status: NonEmptyString,
});

export const KdsOrderStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "ready"]),
});

export const OrderDriverAssignSchema = z.object({
  driver_id:       NonEmptyString,
  driver_name:     NonEmptyString,
  delivery_status: NonEmptyString,
  status:          z.string().optional(),
  delivery_code:   z.string().optional(),
});

// ── Waiter dine-in order ─────────────────────────────────────────────────────
const WaiterItem = z.object({
  name:  NonEmptyString,
  qty:   z.number().int().positive(),
  price: Money,
}).passthrough();

export const WaiterOrderCreateSchema = z.object({
  tableLabel:  NonEmptyString,
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
}).strict();  // reject extra fields (especially the `smtp` injection vector)

export const PrintSchema = z.object({
  ip:    NonEmptyString,
  port:  z.number().int().min(1).max(65535),
  bytes: z.array(z.number().int().min(0).max(255)).min(1, "bytes required.").max(65_536, "Payload too large."),
});
