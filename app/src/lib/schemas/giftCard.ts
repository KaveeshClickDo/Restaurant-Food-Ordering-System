/**
 * Zod schemas for the gift-card flows. Mirrors the patterns used in
 * lib/schemas/customer.ts and lib/schemas/staff.ts so error shapes are
 * consistent across the API surface.
 */

import { z } from "zod";
import { Email, Money } from "./primitives";

// Min / max purchase amounts. The settings panel can override these later;
// for Phase 1 we hard-code a reasonable band so the front-door is sane.
const GIFT_CARD_MIN = 5;
const GIFT_CARD_MAX = 500;

// ── Purchase (customer-side) ─────────────────────────────────────────────────
// Anyone can buy — login is optional. If the customer is logged in, the
// session id is captured server-side as `issuedByCustomerId` (we don't trust
// the browser to pick its own). recipient_email is required so the system
// always has somewhere to send the code; recipient_name is for personalisation.
export const GiftCardPurchaseSchema = z.object({
  amount: Money
    .refine((n) => n >= GIFT_CARD_MIN, `Amount must be at least £${GIFT_CARD_MIN}.`)
    .refine((n) => n <= GIFT_CARD_MAX, `Amount must be £${GIFT_CARD_MAX} or less.`),
  recipientEmail: Email,
  recipientName:  z.string().trim().min(1, "Recipient name is required.").max(120),
  personalMessage: z.string().trim().max(500).optional(),
  /** Anonymous buyer's own email (optional). Signed-in buyers are identified
   *  by their session instead; this exists so a guest purchase still leaves
   *  the buyer reachable (payment receipt + marketing contact). */
  purchaserEmail: Email.optional(),
});

export type GiftCardPurchaseInput = z.infer<typeof GiftCardPurchaseSchema>;

// ── Lookup (no auth — bearer model) ──────────────────────────────────────────
// Used by online checkout, POS, waiter to validate a code and read the
// remaining balance. The code is normalised server-side (strip dashes,
// uppercase) so we accept "GC-7K9X-..." or "gc7k9x..." interchangeably.
export const GiftCardLookupSchema = z.object({
  code: z.string().trim().min(4, "Enter a gift card code.").max(64),
});

// ── Redeem ───────────────────────────────────────────────────────────────────
// Called AFTER the consuming order/sale row exists. The order/sale must
// already carry gift_card_id + gift_card_used (stamped at insert time) — the
// stamp is the idempotency guard. Exactly one of orderId / posSaleId is set.
export const GiftCardRedeemSchema = z.object({
  code: z.string().trim().min(4).max(64),
}).and(
  z.union([
    z.object({ orderId:   z.string().min(1), posSaleId: z.never().optional() }),
    z.object({ posSaleId: z.string().min(1), orderId:   z.never().optional() }),
  ]),
);

// ── Admin manual issue ───────────────────────────────────────────────────────
// Admin sells a gift card at the counter / over the phone. We never give cards
// away free, so a payment method (cash or card) is REQUIRED — the sale is booked
// as income on the Admin finance tab (payment_ref 'admin:cash' | 'admin:card').
// Recipient details optional because admin might just print a code and hand it
// over.
export const AdminGiftCardCreateSchema = z.object({
  amount: Money
    .refine((n) => n >= 1, "Amount must be at least £1.")
    .refine((n) => n <= 1000, "Amount must be £1,000 or less."),
  /** How the customer paid for the card. Required — no free/comp cards. */
  paymentMethod: z.enum(["cash", "card"]),
  recipientEmail: Email.optional(),
  recipientName:  z.string().trim().max(120).optional(),
  personalMessage: z.string().trim().max(500).optional(),
  /** Free-form reason / note. Stored on the initial gift_card_transactions
   *  row as the `notes` field. */
  notes: z.string().trim().max(500).optional(),
  /** If true, sends the delivery email after issuing. If false, admin just
   *  gets the code in the response and hand-delivers it. */
  sendEmail: z.boolean().optional().default(true),
});

export const AdminGiftCardVoidSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required for the audit log.").max(500),
});

// ── Pre-issue an INACTIVE card ───────────────────────────────────────────────
// Mints a card with a value + code but NO payment, NO recipient. It cannot be
// redeemed and is NOT booked as income until an admin activates it at the point
// of physical sale. The whole point: a code copied off a physical card on the
// counter is worthless until that activation happens.
export const AdminGiftCardInactiveCreateSchema = z.object({
  amount: Money
    .refine((n) => n >= 1, "Amount must be at least £1.")
    .refine((n) => n <= 1000, "Amount must be £1,000 or less."),
  /** Free-form note stored on the initial 'issue' ledger row. */
  notes: z.string().trim().max(500).optional(),
});

// ── Activate a pre-issued (inactive) card ────────────────────────────────────
// The sale moment. Recipient email + payment method are REQUIRED here (the card
// is being sold for money) — this is when finance recognises the income, the
// expiry clock starts, and the delivery email goes out, exactly like a normal
// admin counter sale.
export const AdminGiftCardActivateSchema = z.object({
  paymentMethod: z.enum(["cash", "card"]),
  recipientEmail: Email,
  recipientName:  z.string().trim().max(120).optional(),
  personalMessage: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
  /** If true, sends the delivery email after activating. */
  sendEmail: z.boolean().optional().default(true),
});

// ── Refund routing into a gift card ──────────────────────────────────────────
// The shape that gets posted to /api/admin/orders/[id]/refund when the chosen
// method is "gift_card". The route resolves which gift card to credit from
// order.gift_card_id (stamped at the original redemption).
// (No new schema needed — the existing AdminRefundSchema already accepts
// `method` as a string; we just add 'gift_card' to the accepted values in
// lib/schemas/waiter.ts where AdminRefundSchema lives.)
