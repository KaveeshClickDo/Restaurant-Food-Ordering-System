/**
 * recordDojoPayment — the single write path for a completed Dojo card payment,
 * used by EVERY surface (POS sale, collection/dine-in settle, gift-card sale,
 * reservation deposit). Writes one row to the central `dojo_payments` table,
 * linked polymorphically to whatever it paid for. SERVER-SIDE ONLY.
 *
 * The result comes from the till, so it is checked against Dojo before it is
 * stored: the row holds what Dojo reports for the payment intent (status, card,
 * tip, total). A payment Dojo doesn't show as taken, or a charge that differs
 * from what the sale says, is logged. If Dojo can't be read, the till's copy is
 * stored rather than losing the record.
 *
 * Idempotent on the payment intent id, so an outbox/webhook replay can't
 * double-insert.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFundsTaken, saleResultFrom } from "./gateway";
import { getDojoGateway } from "./select";
import type { DojoPaymentIntent } from "./types";

export type DojoSource = "pos_sale" | "collection" | "dine_in" | "reservation" | "gift_card";

/**
 * Accepted result shape — looser than DojoSaleResult so it also accepts the
 * zod-parsed body of a settle request (where the detail fields are optional).
 * DojoSaleResult is assignable to this.
 */
export interface DojoResultInput {
  paymentIntentId: string;
  terminalSessionId: string;
  transactionId?: string | null;
  authCode?: string | null;
  cardScheme?: string | null;
  cardLast4?: string | null;
  /** Tip added on the card machine and Dojo's total, MAJOR units. */
  tipAmount?: number | null;
  totalAmount?: number | null;
  status?: string | null;
}

export async function recordDojoPayment(args: {
  result: DojoResultInput;
  sourceType: DojoSource;
  sourceId?: string | null;
  /** What the sale says was charged, in MAJOR units (e.g. 12.50). */
  amount?: number | null;
  currency?: string | null;
  staffId?: string | null;
}): Promise<void> {
  const { result, sourceType, sourceId, amount, currency, staffId } = args;
  if (!result?.paymentIntentId) return;

  const intent = await readIntent(result.paymentIntentId);
  const stored: DojoResultInput = intent
    ? saleResultFrom(result.paymentIntentId, result.terminalSessionId, intent, intent.status)
    : result;
  if (intent) {
    const where = `${sourceType} ${sourceId ?? "?"}`;
    if (!isFundsTaken(intent.status)) {
      console.error(`[dojo] recordDojoPayment: ${intent.id} is ${intent.status} at Dojo, not paid (${where})`);
    }
    if (typeof amount === "number" && intent.amount.value !== Math.round(amount * 100)) {
      console.error(
        `[dojo] recordDojoPayment: ${intent.id} charged ${intent.amount.value} but the ${where} is ${Math.round(amount * 100)} (minor units)`,
      );
    }
  }

  const { error } = await supabaseAdmin.from("dojo_payments").upsert(
    {
      payment_intent_id:   result.paymentIntentId,
      terminal_session_id: stored.terminalSessionId || null,
      transaction_id:      stored.transactionId ?? null,
      auth_code:           stored.authCode ?? null,
      card_scheme:         stored.cardScheme ?? null,
      card_last4:          stored.cardLast4 ?? null,
      tip_amount:          stored.tipAmount ?? null,
      total_amount:        stored.totalAmount ?? null,
      status:              stored.status ?? null,
      amount:              amount ?? null,
      currency:            currency ?? intent?.amount.currencyCode ?? null,
      source_type:         sourceType,
      source_id:           sourceId ?? null,
      staff_id:            staffId ?? null,
    },
    { onConflict: "payment_intent_id", ignoreDuplicates: true },
  );
  if (error) console.error("[dojo] recordDojoPayment:", error.message);
}

/** The intent as Dojo reports it, or null if it can't be read (Dojo down, or
 *  switched off since the payment), in which case the till's copy is kept. */
async function readIntent(id: string): Promise<DojoPaymentIntent | null> {
  try {
    return await getDojoGateway().getPaymentIntent(id);
  } catch (err) {
    console.error(
      `[dojo] recordDojoPayment: couldn't read ${id} from Dojo, storing the till's copy:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
