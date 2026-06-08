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
// "Issue manually" for goodwill / refund-as-gift-card / promotions. No
// payment is processed — admin is creating value directly. Recipient details
// optional because admin might just want to print a code and hand it over.
export const AdminGiftCardCreateSchema = z.object({
  amount: Money
    .refine((n) => n >= 1, "Amount must be at least £1.")
    .refine((n) => n <= 1000, "Amount must be £1,000 or less."),
  recipientEmail: Email.optional(),
  recipientName:  z.string().trim().max(120).optional(),
  personalMessage: z.string().trim().max(500).optional(),
  /** Free-form reason (e.g. "Goodwill — complaint #42"). Stored on the
   *  initial gift_card_transactions row as the `notes` field. */
  notes: z.string().trim().max(500).optional(),
  /** If true, sends the delivery email after issuing. If false, admin just
   *  gets the code in the response and hand-delivers it. */
  sendEmail: z.boolean().optional().default(true),
});

export const AdminGiftCardVoidSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required for the audit log.").max(500),
});

// ── Refund routing into a gift card ──────────────────────────────────────────
// The shape that gets posted to /api/admin/orders/[id]/refund when the chosen
// method is "gift_card". The route resolves which gift card to credit from
// order.gift_card_id (stamped at the original redemption).
// (No new schema needed — the existing AdminRefundSchema already accepts
// `method` as a string; we just add 'gift_card' to the accepted values in
// lib/schemas/waiter.ts where AdminRefundSchema lives.)
