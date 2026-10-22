import { z } from "zod";

/**
 * Zod schemas for the /api/pos/dojo/* route bodies.
 *
 * Amounts here are in MAJOR units (pounds, e.g. 12.50) — the same units the POS
 * cart uses. The routes convert to Dojo's minor units (pence) before calling the
 * Dojo API. Keeping the POS-facing contract in major units avoids scattering
 * ×100 conversions through the client.
 */

const MajorAmount = z.number().positive().max(1_000_000);

/**
 * Starting a card-present SALE. Deliberately no `sessionType` or `captureMode`:
 * refund sessions pay money out (they'd need a canIssueRefund-gated route) and
 * nothing captures a pre-authorisation, so the routes only ever take sales with
 * automatic capture. Unknown keys are stripped, so sending them does nothing.
 */
export const DojoCreateSessionSchema = z.object({
  /** Amount to charge, in major units (e.g. 12.50). */
  amount: MajorAmount,
  currencyCode: z.string().length(3).optional(),
  /** What the payment is for. The server cuts it to Dojo's 60 characters, or
   *  sends "Card sale" when it's missing (lib/dojo/flow.ts). */
  reference: z.string().max(120).optional(),
  description: z.string().max(255).optional(),
  /** Optional explicit terminal (a Dojo id "tm_…" or a TID); when omitted the
   *  server uses DOJO_TERMINAL_ID, then auto-discovers one. */
  terminalId: z.string().max(80).optional(),
  /** The earlier attempt's intent, reused on retry. */
  paymentIntentId: z.string().max(120).optional(),
});

export const DojoSignatureSchema = z.object({
  accepted: z.boolean(),
});

export const DojoRefundSchema = z.object({
  paymentIntentId: z.string().min(1).max(120),
  /** Refund amount in major units. */
  amount: MajorAmount,
  refundReason: z.string().max(255).optional(),
  notes: z.string().max(255).optional(),
  /** One id per refund, made by the screen and resent on every retry: Dojo's
   *  idempotency key, so a repeated request can't refund twice. Required,
   *  because a key made on the server would differ on each retry. */
  requestId: z.string().min(8).max(64),
});

/**
 * The card-terminal result a surface attaches to its settle/sale request when a
 * payment was taken on a Dojo terminal. Shared by every settle schema (POS sale,
 * collection, waiter, gift card, reservation). Matches DojoSaleResult.
 */
export const DojoResultSchema = z.object({
  paymentIntentId:   z.string().max(120),
  terminalSessionId: z.string().max(120),
  transactionId:     z.string().max(120).nullable().optional(),
  authCode:          z.string().max(32).nullable().optional(),
  cardScheme:        z.string().max(32).nullable().optional(),
  cardLast4:         z.string().max(4).nullable().optional(),
  /** Tip added on the card machine and Dojo's total, MAJOR units. */
  tipAmount:         z.number().nonnegative().max(1_000_000).nullable().optional(),
  totalAmount:       z.number().nonnegative().max(1_000_000).nullable().optional(),
  status:            z.string().max(48).nullable().optional(),
});
