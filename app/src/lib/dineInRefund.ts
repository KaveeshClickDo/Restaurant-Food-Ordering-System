/**
 * Refund settled (delivered) dine-in orders: shared by the waiter app
 * (POST /api/waiter/refund) and the POS Dine-In tab
 * (POST /api/pos/orders/dine-in/refund), which check their own permissions
 * first. SERVER-SIDE ONLY. Uses the service-role key: anon can't UPDATE orders.
 *
 * Refundable money: what the orders took in cash or card (their totals are
 * stored net of any gift card, which is prepaid and never refundable), less
 * earlier refunds, plus any tip the customer added on the card machine and
 * hasn't had back. A refund comes out of the orders first; anything above that
 * is the tip, kept in card_tip_refunded so refunded_amount stays within the
 * totals and reports stay right.
 *
 * A card refund of a bill paid on the Dojo card machine goes to Dojo FIRST,
 * with the screen's idempotency key: if Dojo refuses, nothing is recorded. A
 * bill paid any other way is recorded only, as before.
 *
 * `status` is never touched: the food was served, and payment_status is the
 * source of truth for refunds (as in the admin refund route).
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refundDojoPayment } from "@/lib/dojo/refund";

interface RefundRecord {
  id: string;
  orderId: string;
  /** Out of the order's total. */
  amount: number;
  type: "full" | "partial";
  reason: string;
  method: string;
  processedAt: string;
  processedBy: string;
  /** The part of the card machine tip given back with this refund. */
  cardTip?: number;
  /** Sent back to the card through Dojo. */
  viaDojo?: boolean;
  dojoRefundId?: string | null;
}

interface OrderRow {
  id: string;
  total: number | string | null;
  refunds: unknown;
  refunded_amount: number | string | null;
  card_tip_amount: number | string | null;
  card_tip_refunded: number | string | null;
  dojo_payment_intent_id: string | null;
}

export type DineInRefundResult =
  | { ok: true; refunded: number; totalRefunded: number; type: "refunded" | "partially_refunded"; toCard: number }
  | { ok: false; status: number; error: string }
  /** Dojo refused the card refund (or didn't answer): nothing was recorded. */
  | { ok: false; dojoError: unknown };

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const tipLeftOf = (o: OrderRow) => Math.max(0, round2(num(o.card_tip_amount) - num(o.card_tip_refunded)));

export async function refundDineInOrders(args: {
  orderIds: string[];
  refundAmount: number;
  refundMethod: "cash" | "card";
  reason: string;
  actorName: string;
  /** POS staff id for the Dojo refund record; null for waiters and admin. */
  staffId?: string | null;
  /** One per refund screen, the same on its retries: Dojo's idempotency key. */
  refundRequestId?: string;
  logTag: string;
}): Promise<DineInRefundResult> {
  const { orderIds, refundAmount, refundMethod, reason, actorName, logTag } = args;

  const { data, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("id, total, refunds, refunded_amount, card_tip_amount, card_tip_refunded, dojo_payment_intent_id")
    .in("id", orderIds)
    .eq("fulfillment", "dine-in")
    .eq("status", "delivered");
  if (fetchErr) {
    console.error(`${logTag} fetch:`, fetchErr.message);
    return { ok: false, status: 500, error: fetchErr.message };
  }
  const orders = (data ?? []) as OrderRow[];
  if (orders.length === 0) {
    return { ok: false, status: 404, error: "No delivered orders found for these IDs." };
  }

  // The cap is load-bearing: status stays "delivered" after a refund, so the
  // fetch above doesn't filter out refunded orders.
  const moneyCap      = round2(orders.reduce((s, o) => s + num(o.total), 0));
  const priorRefunded = round2(orders.reduce((s, o) => s + num(o.refunded_amount), 0));
  const remaining     = Math.max(0, round2(moneyCap - priorRefunded));
  const tipLeft       = round2(orders.reduce((s, o) => s + tipLeftOf(o), 0));
  const refundable    = round2(remaining + tipLeft);
  if (refundAmount > refundable + 0.001) {
    return {
      ok: false,
      status: 400,
      error: `Refund (${refundAmount.toFixed(2)}) cannot exceed the ${refundable.toFixed(2)} refundable`
        + `${tipLeft > 0 ? " (including the tip on the card machine)" : ""}. The gift-card portion is non-refundable.`,
    };
  }
  const salePart = round2(Math.min(refundAmount, remaining));
  const tipPart  = round2(Math.min(tipLeft, refundAmount - salePart));

  // A bill paid on the card machine: refund the card through Dojo first.
  let toCard = 0;
  let dojoRefundId: string | null = null;
  if (refundMethod === "card") {
    const paymentIntentId = await billPaymentIntent(orders);
    if (paymentIntentId) {
      // Without a key from the screen: stable for a retry of this same refund,
      // new once it's recorded (the earlier refunds then differ).
      const requestId = args.refundRequestId
        ?? `dine-in-${[...orderIds].sort().join(".").slice(0, 24)}-${Math.round(refundAmount * 100)}-${Math.round(priorRefunded * 100)}`;
      try {
        const outcome = await refundDojoPayment({
          paymentIntentId,
          amount: refundAmount,
          requestId,
          reason,
          sourceType: "dine_in",
          sourceId: orders[0].id,
          staffId: args.staffId ?? null,
        });
        toCard = refundAmount;
        dojoRefundId = outcome.refundId;
      } catch (err) {
        return { ok: false, dojoError: err };
      }
    }
  }

  // "refunded" = the customer has ALL their money back, cumulatively: a second
  // partial refund that clears the balance still counts as full.
  const isFullRefund     = priorRefunded + salePart >= moneyCap - 0.001;
  const newPaymentStatus = isFullRefund ? "refunded" : "partially_refunded";
  const processedAt      = new Date().toISOString();

  // The order part splits by each order's money, the tip part by each order's
  // tip (it sits on the bill's anchor order), so a multi-order bill splits fairly.
  const updates = orders.map((o) => {
    const share    = moneyCap > 0 ? round2((num(o.total) / moneyCap) * salePart) : 0;
    const tipShare = tipLeft > 0 ? round2((tipLeftOf(o) / tipLeft) * tipPart) : 0;
    const existing: RefundRecord[] = Array.isArray(o.refunds) ? o.refunds as RefundRecord[] : [];
    const record: RefundRecord = {
      id:          crypto.randomUUID(),
      orderId:     o.id,
      amount:      share,
      type:        isFullRefund ? "full" : "partial",
      reason,
      method:      refundMethod,
      processedAt,
      processedBy: actorName,
      ...(tipShare > 0 ? { cardTip: tipShare } : {}),
      ...(toCard > 0 ? { viaDojo: true, dojoRefundId } : {}),
    };
    return {
      id: o.id,
      patch: {
        payment_status:  newPaymentStatus,
        refunds:         [...existing, record],
        refunded_amount: round2(num(o.refunded_amount) + share),
        ...(tipShare > 0 ? { card_tip_refunded: round2(num(o.card_tip_refunded) + tipShare) } : {}),
      },
    };
  });

  const errors: string[] = [];
  await Promise.all(updates.map(async ({ id, patch }) => {
    const { error } = await supabaseAdmin.from("orders").update(patch).eq("id", id);
    if (error) errors.push(`${id}: ${error.message}`);
  }));
  if (errors.length > 0) {
    console.error(`${logTag} update:`, errors, toCard > 0 ? `(the card refund of ${toCard} went through at Dojo)` : "");
    return {
      ok: false,
      status: 500,
      error: toCard > 0
        ? `The money went back to the card, but saving the refund failed: ${errors.join("; ")}`
        : errors.join("; "),
    };
  }

  return { ok: true, refunded: orders.length, totalRefunded: refundAmount, type: newPaymentStatus, toCard };
}

/** The card machine payment behind these orders: the link stamped on every
 *  order at settle, or (bills settled before that) the anchor in dojo_payments. */
async function billPaymentIntent(orders: OrderRow[]): Promise<string | null> {
  const linked = orders.find((o) => o.dojo_payment_intent_id)?.dojo_payment_intent_id;
  if (linked) return linked;
  const { data } = await supabaseAdmin
    .from("dojo_payments")
    .select("payment_intent_id")
    .eq("source_type", "dine_in")
    .in("source_id", orders.map((o) => o.id))
    .limit(1)
    .maybeSingle();
  return data?.payment_intent_id ?? null;
}
