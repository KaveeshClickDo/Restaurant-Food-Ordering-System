/**
 * recordDojoPayment — the single write path for a completed Dojo card payment,
 * used by EVERY surface (POS sale, collection/dine-in settle, gift-card sale,
 * reservation deposit). Writes one row to the central `dojo_payments` table,
 * linked polymorphically to whatever it paid for. SERVER-SIDE ONLY.
 *
 * Idempotent on the payment intent id, so an outbox/webhook replay can't
 * double-insert.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  status?: string | null;
}

export async function recordDojoPayment(args: {
  result: DojoResultInput;
  sourceType: DojoSource;
  sourceId?: string | null;
  /** Amount in MAJOR units (e.g. 12.50). */
  amount?: number | null;
  currency?: string | null;
  staffId?: string | null;
}): Promise<void> {
  const { result, sourceType, sourceId, amount, currency, staffId } = args;
  if (!result?.paymentIntentId) return;

  const { error } = await supabaseAdmin.from("dojo_payments").upsert(
    {
      payment_intent_id:   result.paymentIntentId,
      terminal_session_id: result.terminalSessionId ?? null,
      transaction_id:      result.transactionId ?? null,
      auth_code:           result.authCode ?? null,
      card_scheme:         result.cardScheme ?? null,
      card_last4:          result.cardLast4 ?? null,
      status:              result.status ?? null,
      amount:              amount ?? null,
      currency:            currency ?? null,
      source_type:         sourceType,
      source_id:           sourceId ?? null,
      staff_id:            staffId ?? null,
    },
    { onConflict: "payment_intent_id", ignoreDuplicates: true },
  );
  if (error) console.error("[dojo] recordDojoPayment:", error.message);
}
