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
import { parseBody }                            from "@/lib/apiValidation";
import { AdminRefundSchema }                    from "@/lib/schemas/waiter";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, AdminRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  // F-AD-3: server-side recompute + ownership check.
  // Fetch the authoritative order row up-front; we use it for:
  //   - capping the new refund at (order.total - prior_refunded_amount)
  //   - asserting body.customerId === order.customer_id before store-credit mutation
  //   - replacing body.refundedAmount with the sum of all refund entries
  const { data: orderRow, error: lookupErr } = await supabaseAdmin
    .from("orders")
    .select("stripe_payment_intent_id, total, customer_id, refunds, refunded_amount")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr || !orderRow) {
    return NextResponse.json(
      { ok: false, error: lookupErr?.message ?? "Order not found." },
      { status: 404 },
    );
  }

  const orderTotal = Number(orderRow.total);
  const priorRefunds = Array.isArray(orderRow.refunds) ? orderRow.refunds.length : 0;
  const submittedRefunds = body.refunds ?? [];
  if (submittedRefunds.length < priorRefunds) {
    return NextResponse.json(
      { ok: false, error: "Cannot drop existing refund records." },
      { status: 400 },
    );
  }

  // Sum up the submitted refunds — this is the new authoritative `refunded_amount`.
  // The body's `refundedAmount` field is ignored.
  const refundedAmountServer = parseFloat(
    submittedRefunds.reduce((s, r) => s + Number(r.amount ?? 0), 0).toFixed(2),
  );

  if (refundedAmountServer > orderTotal + 0.001) {
    return NextResponse.json(
      { ok: false, error: `Total refunded (${refundedAmountServer}) cannot exceed order total (${orderTotal}).` },
      { status: 400 },
    );
  }

  // The "newest" refund is the only one we may call Stripe for. Its amount
  // must fit within the remaining refundable budget.
  const newest = submittedRefunds[submittedRefunds.length - 1];
  if (newest) {
    const remainingBudget = parseFloat((orderTotal - Number(orderRow.refunded_amount ?? 0)).toFixed(2));
    if (Number(newest.amount) > remainingBudget + 0.001) {
      return NextResponse.json(
        { ok: false, error: `Refund (${newest.amount}) exceeds remaining refundable (${remainingBudget}).` },
        { status: 400 },
      );
    }
  }

  // ── Stripe gateway refund (only when applicable) ─────────────────────────
  if (newest && newest.method === "original_payment") {
    if (!orderRow.stripe_payment_intent_id) {
      // Cash / non-Stripe — record-only, no gateway call.
    } else {
      const { data: settingsRow } = await supabaseAdmin
        .from("app_settings").select("data").eq("id", 1).single();
      const currencyCode = (settingsRow?.data?.currency?.code as string | undefined) ?? "GBP";

      try {
        const stripeRefund = await getStripe().refunds.create({
          payment_intent: orderRow.stripe_payment_intent_id,
          amount:         toStripeAmount(newest.amount, currencyCode),
          reason: stripeReason(newest.reason),
          metadata: {
            order_id:    id,
            refund_id:   newest.id,
            processed_by: newest.processedBy,
          },
        });
        newest.stripeRefundId = stripeRefund.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stripe refund failed.";
        console.error("admin/orders/[id]/refund POST (stripe):", message);
        return NextResponse.json({ ok: false, error: message }, { status: 502 });
      }
    }
  }

  // ── Derive payment_status server-side from refundedAmountServer ─────────
  let newPaymentStatus: "refunded" | "partially_refunded" | undefined;
  if (refundedAmountServer >= orderTotal - 0.001) newPaymentStatus = "refunded";
  else if (refundedAmountServer > 0)              newPaymentStatus = "partially_refunded";

  const newOrderStatus =
    newPaymentStatus === "refunded"           ? "refunded"
    : newPaymentStatus === "partially_refunded" ? "partially_refunded"
    : body.newStatus;

  const { error: orderErr } = await supabaseAdmin
    .from("orders")
    .update({
      status:           newOrderStatus,
      refunds:          submittedRefunds,
      refunded_amount:  refundedAmountServer,
      ...(newPaymentStatus ? { payment_status: newPaymentStatus } : {}),
    })
    .eq("id", id);

  if (orderErr) {
    console.error("admin/orders/[id]/refund POST (order):", orderErr.message);
    return NextResponse.json({ ok: false, error: orderErr.message }, { status: 500 });
  }

  // Store-credit mutation: only allowed for the order's own customer.
  if (body.customerId !== undefined && body.newStoreCredit !== undefined) {
    if (body.customerId !== orderRow.customer_id) {
      return NextResponse.json(
        { ok: false, error: "Refund customerId does not match the order's customer." },
        { status: 400 },
      );
    }
    const { error: custErr } = await supabaseAdmin
      .from("customers")
      .update({ store_credit: body.newStoreCredit })
      .eq("id", body.customerId);
    if (custErr) {
      console.error("admin/orders/[id]/refund POST (store_credit):", custErr.message);
    }
  }

  return NextResponse.json({
    ok: true,
    stripeRefundId:  newest?.stripeRefundId ?? null,
    refundedAmount:  refundedAmountServer,
  });
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
