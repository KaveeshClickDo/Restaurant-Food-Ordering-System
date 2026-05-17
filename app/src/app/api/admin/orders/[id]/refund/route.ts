/**
 * POST /api/admin/orders/[id]/refund — record a refund on an order.
 *
 * If the latest refund.method === "original_payment" AND the order has a
 * stripe_payment_intent_id, we call stripe.refunds.create() to actually
 * reverse the charge through the gateway before persisting. The Stripe
 * refund id is stored on the refund entry so we can reconcile with the
 * Stripe dashboard later.
 *
 * For "store_credit" and "cash" refund methods, no gateway call is made —
 * the cash is handed back in person, or the customer's store_credit balance
 * is increased by the caller (AppContext.addRefund passes newStoreCredit).
 *
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { getStripe, toStripeAmount }            from "@/lib/stripeServer";

interface RefundEntry {
  id: string;
  orderId: string;
  amount: number;
  type: "full" | "partial";
  reason: string;
  method: "original_payment" | "store_credit" | "cash";
  note?: string;
  processedAt: string;
  processedBy: string;
  stripeRefundId?: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  let body: {
    newStatus: string;
    refunds: RefundEntry[];
    refundedAmount: number;
    customerId?: string;
    newStoreCredit?: number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  // ── Stripe gateway refund (only when applicable) ─────────────────────────
  // The last refund in the array is the new one being processed; older entries
  // are already-recorded refunds.
  const newest = body.refunds?.[body.refunds.length - 1];

  if (newest && newest.method === "original_payment") {
    // Look up the order's Stripe payment intent + currency.
    const { data: orderRow, error: lookupErr } = await supabaseAdmin
      .from("orders")
      .select("stripe_payment_intent_id, total")
      .eq("id", id)
      .maybeSingle();

    if (lookupErr) {
      console.error("admin/orders/[id]/refund POST (lookup):", lookupErr.message);
      return NextResponse.json({ ok: false, error: lookupErr.message }, { status: 500 });
    }

    if (!orderRow?.stripe_payment_intent_id) {
      // This order was paid in cash or by a non-Stripe method. We can still
      // record an "original_payment" refund (someone handed the card back at
      // the counter), but no gateway call is possible. Continue without calling
      // Stripe — refund is recorded as-is.
    } else {
      // Read currency from settings so zero-decimal currencies stay correct.
      const { data: settingsRow } = await supabaseAdmin
        .from("app_settings").select("data").eq("id", 1).single();
      const currencyCode = (settingsRow?.data?.currency?.code as string | undefined) ?? "GBP";

      try {
        const stripeRefund = await getStripe().refunds.create({
          payment_intent: orderRow.stripe_payment_intent_id,
          amount:         toStripeAmount(newest.amount, currencyCode),
          // reason must be one of Stripe's enum values; we only pass it for
          // those, and store the human-readable reason in our own DB.
          reason: stripeReason(newest.reason),
          metadata: {
            order_id:    id,
            refund_id:   newest.id,
            processed_by: newest.processedBy,
          },
        });

        // Stamp the Stripe refund id onto our refund entry so future audits
        // can trace it. The webhook charge.refunded event will also fire and
        // run through `handleChargeRefunded`, which is a no-op once we've
        // already updated refunded_amount to match.
        newest.stripeRefundId = stripeRefund.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stripe refund failed.";
        console.error("admin/orders/[id]/refund POST (stripe):", message);
        return NextResponse.json({ ok: false, error: message }, { status: 502 });
      }
    }
  }

  // ── Update the order ──────────────────────────────────────────────────────
  const newPaymentStatus = body.newStatus === "refunded"
    ? "refunded"
    : body.newStatus === "partially_refunded"
      ? "partially_refunded"
      : undefined;

  const { error: orderErr } = await supabaseAdmin
    .from("orders")
    .update({
      status:           body.newStatus,
      refunds:          body.refunds,
      refunded_amount:  body.refundedAmount,
      ...(newPaymentStatus ? { payment_status: newPaymentStatus } : {}),
    })
    .eq("id", id);

  if (orderErr) {
    console.error("admin/orders/[id]/refund POST (order):", orderErr.message);
    return NextResponse.json({ ok: false, error: orderErr.message }, { status: 500 });
  }

  if (body.customerId !== undefined && body.newStoreCredit !== undefined) {
    const { error: custErr } = await supabaseAdmin
      .from("customers")
      .update({ store_credit: body.newStoreCredit })
      .eq("id", body.customerId);
    if (custErr) {
      console.error("admin/orders/[id]/refund POST (store_credit):", custErr.message);
    }
  }

  return NextResponse.json({ ok: true, stripeRefundId: newest?.stripeRefundId ?? null });
}

/**
 * Translate our free-text refund reasons into one of Stripe's allowed enum
 * values (`duplicate`, `fraudulent`, `requested_by_customer`). Everything we
 * don't recognise becomes `requested_by_customer`, which is also Stripe's
 * default when no reason is provided.
 */
function stripeReason(reason: string): "duplicate" | "fraudulent" | "requested_by_customer" {
  const r = reason.toLowerCase();
  if (r.includes("duplicate")) return "duplicate";
  if (r.includes("fraud"))     return "fraudulent";
  return "requested_by_customer";
}
