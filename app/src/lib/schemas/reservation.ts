import { z } from "zod";
import { Email, OptionalPhone, Phone, NonEmptyString, IsoDate, IsoTime } from "./primitives";

const PartySize = z.number().int().min(1, "Party size must be at least 1.").max(50, "Party size is too large.");

// Public booking — guest must supply contact details.
export const ReservationPublicSchema = z.object({
  tableId:       NonEmptyString,
  date:          IsoDate,
  time:          IsoTime,
  partySize:     PartySize,
  customerName:  NonEmptyString,
  customerEmail: Email,
  customerPhone: OptionalPhone,
  note:          z.string().optional(),
  source:        z.string().optional(),
});

// How a VIP booking fee was collected at a POS till or by an admin. There is no
// payment gateway on these surfaces (cash drawer / card terminal), so the method
// is recorded for the receipt but no charge is taken through Stripe/PayPal.
const ManualPaymentMethod = z.enum(["cash", "card"]);

// Admin walk-in / phone — email optional, but phone required for "phone" bookings.
export const ReservationAdminSchema = z.object({
  tableId:       NonEmptyString,
  date:          IsoDate,
  time:          IsoTime,
  partySize:     PartySize,
  customerName:  NonEmptyString,
  customerEmail: z.string().email().optional().or(z.literal("")),
  customerPhone: OptionalPhone,
  note:          z.string().optional(),
  source:        z.enum(["walk-in", "phone"]).default("walk-in"),
  // Required by the route only when the chosen table is VIP — validated there
  // against the live table record rather than trusted from the client.
  paymentMethod: ManualPaymentMethod.optional(),
}).refine(
  (data) => data.source !== "phone" || (data.customerPhone && data.customerPhone.length > 0),
  { message: "Phone number is required for phone bookings.", path: ["customerPhone"] },
);

// POS — staff already has the table object cached client-side, so the body
// carries denormalised label/seats/section as well as tableId.
export const ReservationPosSchema = z.object({
  tableId:       NonEmptyString,
  tableLabel:    NonEmptyString,
  tableSeats:    z.number().int().nonnegative().optional(),
  section:       z.string().optional(),
  date:          IsoDate,
  time:          IsoTime,
  partySize:     PartySize,
  customerName:  NonEmptyString,
  customerEmail: z.string().email().optional().or(z.literal("")),
  customerPhone: OptionalPhone,
  note:          z.string().optional(),
  source:        z.enum(["walk-in", "phone"]).default("walk-in"),
  paymentMethod: ManualPaymentMethod.optional(),
}).refine(
  (data) => data.source !== "phone" || (data.customerPhone && data.customerPhone.length > 0),
  { message: "Phone number is required for phone bookings.", path: ["customerPhone"] },
);

// Online VIP booking-fee payment intent. Same fields as the public booking, plus
// the gateway the guest chose. The reservation row itself is created later by
// the Stripe/PayPal webhook once the fee is captured — never here.
export const ReservationIntentSchema = ReservationPublicSchema.extend({
  gateway: z.enum(["stripe", "paypal"]),
});

export const ReservationStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled", "no_show"]),
});

// Public token-based status update (cancel link in email)
export const ReservationTokenStatusSchema = z.object({
  status:       z.enum(["cancelled", "checked_in"]),
  checkedInAt:  z.string().optional(),
});

// Client-side form schema for booking flows. Phone is required in the UI.
export const ReservationFormSchema = z.object({
  customerName:  NonEmptyString,
  customerEmail: Email,
  customerPhone: Phone,
  partySize:     PartySize,
  note:          z.string().optional(),
});
