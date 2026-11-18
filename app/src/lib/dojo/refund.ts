/**
 * Refunding a Dojo card payment: a payment intent refund, Dojo's recommended
 * method (no card needed). SERVER-SIDE ONLY. Used by POST /api/pos/dojo/refunds
 * and by the till's Void & Refund (PATCH /api/pos/sales/[id]).
 *
 * The caller has already checked the permission (canIssueRefund or admin).
 * This sends the refund with the request's idempotency key, records it in
 * dojo_refunds with who issued it, reads the intent back (as Dojo's checklist
 * asks) and updates the payment's status in dojo_payments.
 *
 * A request already recorded is not sent again: the first one went through and
 * only its reply was lost. On the sandbox, refunds of card machine payments
 * fail at Dojo's end (a known sandbox limitation, see docs/dojo/README.md).
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDojoGateway } from "./select";
import { toMinorUnits } from "./respond";

export interface DojoRefundOutcome {
  refundId: string | null;
  /** The intent's status afterwards: "Refunded", or "Captured" when partial.
   *  Null when it couldn't be read back. */
  status: string | null;
  /** Total refunded on the intent so far, major units, when read back. */
  refundedAmount: number | null;
  /** True when this request had been recorded already (a retry). */
  repeated: boolean;
}

export async function refundDojoPayment(args: {
  paymentIntentId: string;
  /** Major units, e.g. 12.50. */
  amount: number;
  /** One per refund, the same on every retry of it: Dojo's idempotency key. */
  requestId: string;
  reason?: string;
  notes?: string;
  /** What was refunded. Looked up from dojo_payments when not given. */
  sourceType?: string;
  sourceId?: string | null;
  /** Who issued it; null for the website admin. */
  staffId?: string | null;
}): Promise<DojoRefundOutcome> {
  const { paymentIntentId, amount, requestId } = args;

  const { data: earlier } = await supabaseAdmin
    .from("dojo_refunds")
    .select("refund_id, intent_status")
    .eq("request_id", requestId)
    .maybeSingle();
  if (earlier) {
    return { refundId: earlier.refund_id ?? null, status: earlier.intent_status ?? null, refundedAmount: null, repeated: true };
  }

  const gateway = getDojoGateway();
  // Throws DojoApiError when Dojo refuses; the caller maps it for staff.
  const result = await gateway.createRefund({
    paymentIntentId,
    amount: toMinorUnits(amount),
    refundReason: args.reason?.slice(0, 255),
    notes: args.notes?.slice(0, 255),
    idempotencyKey: requestId,
  });

  // The refund went through: from here on nothing may fail the request.
  let status: string | null = null;
  let refundedAmount: number | null = null;
  try {
    const intent = await gateway.getPaymentIntent(paymentIntentId);
    status = intent.status;
    refundedAmount = typeof intent.refundedAmount === "number" ? intent.refundedAmount / 100 : null;
  } catch (err) {
    console.error("[dojo/refund] reading the intent back:", err instanceof Error ? err.message : err);
  }

  let sourceType = args.sourceType;
  let sourceId = args.sourceId ?? null;
  if (!sourceType) {
    const { data: payment } = await supabaseAdmin
      .from("dojo_payments").select("source_type, source_id").eq("payment_intent_id", paymentIntentId).maybeSingle();
    sourceType = payment?.source_type ?? "unknown";
    sourceId = payment?.source_id ?? null;
  }

  const { error: insErr } = await supabaseAdmin.from("dojo_refunds").insert({
    payment_intent_id: paymentIntentId,
    refund_id:         result.refundId ?? null,
    request_id:        requestId,
    amount,
    reason:            args.reason ?? null,
    source_type:       sourceType,
    source_id:         sourceId,
    staff_id:          args.staffId ?? null,
    intent_status:     status,
  });
  if (insErr) console.error("[dojo/refund] recording the refund:", insErr.message);

  if (status) {
    const { error: updErr } = await supabaseAdmin
      .from("dojo_payments").update({ status }).eq("payment_intent_id", paymentIntentId);
    if (updErr) console.error("[dojo/refund] dojo_payments status update:", updErr.message);
  }

  return { refundId: result.refundId ?? null, status, refundedAmount, repeated: false };
}

/** The Dojo card payment behind a record (e.g. a till sale), if it was paid on the card machine. */
export async function findDojoPayment(sourceType: string, sourceId: string): Promise<{
  paymentIntentId: string;
  amount: number | null;
  totalAmount: number | null;
  cardScheme: string | null;
  cardLast4: string | null;
  status: string | null;
} | null> {
  const { data } = await supabaseAdmin
    .from("dojo_payments")
    .select("payment_intent_id, amount, total_amount, card_scheme, card_last4, status")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    paymentIntentId: data.payment_intent_id,
    amount: data.amount === null ? null : Number(data.amount),
    totalAmount: data.total_amount === null ? null : Number(data.total_amount),
    cardScheme: data.card_scheme ?? null,
    cardLast4: data.card_last4 ?? null,
    status: data.status ?? null,
  };
}

/** Has a record already been refunded through Dojo (by any request)? */
export async function hasDojoRefund(sourceType: string, sourceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("dojo_refunds").select("id").eq("source_type", sourceType).eq("source_id", sourceId).limit(1).maybeSingle();
  return !!data;
}
