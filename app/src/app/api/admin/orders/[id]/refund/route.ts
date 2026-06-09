/**
 * POST /api/admin/orders/[id]/refund — record a refund on an order.
 *
 * If the latest refund.method === "original_payment" we route to the
 * matching gateway:
 *   • Stripe: order has stripe_payment_intent_id → stripe.refunds.create()
 *   • PayPal: order has paypal_capture_id        → /v2/payments/captures/{id}/refund
 *
 * The gateway refund id (stripeRefundId / paypalRefundId) is stored on the
 * refund entry so we can reconcile with the dashboard later.
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
import { paypalFetch, paypalIsConfigured, toPaypalAmount } from "@/lib/paypalServer";
import { parseBody }                            from "@/lib/apiValidation";
import { AdminRefundSchema }                    from "@/lib/schemas/waiter";
import { restoreStock, type StockItem }         from "@/lib/stockMutation";
import { moneyPaidGross }                       from "@/lib/giftCardMoney";
import { deductLoyaltyPoints }                  from "@/lib/loyaltyUtils";
import { sendOrderStatusEmail }                 from "@/lib/emailServer";

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
    .select("stripe_payment_intent_id, paypal_capture_id, total, fulfillment, customer_id, refunds, refunded_amount, gift_card_id, gift_card_used, items, oversold, payment_status, status")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr || !orderRow) {
    return NextResponse.json(
      { ok: false, error: lookupErr?.message ?? "Order not found." },
      { status: 404 },
    );
  }

  const round2 = (n: number) => parseFloat(n.toFixed(2));
  const orderTotal = Number(orderRow.total);
  // Refundable money = what the customer actually paid in cash / card / gateway.
  // Online orders store the NET total (gift card already excluded); dine-in/POS
  // store GROSS, so net the gift card out. The gift-card-covered portion is
  // never refundable — a gift card is prepaid money (see the gift card model).
  const moneyCap = orderRow.fulfillment === "dine-in"
    ? moneyPaidGross(orderTotal, orderRow.gift_card_used)
    : orderTotal;
  const priorRefunds = Array.isArray(orderRow.refunds) ? orderRow.refunds.length : 0;
  const submittedRefunds = body.refunds ?? [];
  if (submittedRefunds.length < priorRefunds) {
    return NextResponse.json(
      { ok: false, error: "Cannot drop existing refund records." },
      { status: 400 },
    );
  }

  // Only MONEY refunds exist now (original_payment / cash / store_credit) —
  // gift-card refunds were removed. They return real money to the customer,
  // capped at moneyCap (what was actually charged), and drive refunded_amount
  // + payment_status.
  const moneyRefundedTotal = round2(
    submittedRefunds.reduce((s, r) => s + Number(r.amount ?? 0), 0),
  );

  if (moneyRefundedTotal > moneyCap + 0.001) {
    return NextResponse.json(
      { ok: false, error: `Refunds (${moneyRefundedTotal}) cannot exceed the amount actually paid (${moneyCap}).` },
      { status: 400 },
    );
  }

  // The "newest" refund is the only one we act on (the gateway call). Validate
  // its budget against the remaining money refundable.
  const newest = submittedRefunds[submittedRefunds.length - 1];
  if (newest) {
    const remainingBudget = round2(moneyCap - Number(orderRow.refunded_amount ?? 0));
    if (Number(newest.amount) > remainingBudget + 0.001) {
      return NextResponse.json(
        { ok: false, error: `Refund (${newest.amount}) exceeds remaining refundable (${remainingBudget}).` },
        { status: 400 },
      );
    }
  }

  // ── Gateway refund (only when applicable) ────────────────────────────────
  // The refund is routed to whichever gateway captured the original payment.
  // Cash and orders with no gateway id are record-only.
  if (newest && newest.method === "original_payment") {
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();
    const currencyCode = (settingsRow?.data?.currency?.code as string | undefined) ?? "GBP";

    if (orderRow.stripe_payment_intent_id) {
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
    } else if (orderRow.paypal_capture_id) {
      if (!paypalIsConfigured()) {
        return NextResponse.json(
          { ok: false, error: "PayPal credentials are not configured on the server." },
          { status: 500 },
        );
      }
      try {
        const { status, data } = await paypalFetch<{
          id?:      string;
          status?:  string;
          details?: Array<{ description?: string; issue?: string }>;
          message?: string;
        }>(
          `/v2/payments/captures/${encodeURIComponent(orderRow.paypal_capture_id)}/refund`,
          {
            method: "POST",
            // PayPal-Request-Id keys idempotency on the refund record — a
            // retry returns the same refund rather than reversing the
            // capture twice.
            headers: { "PayPal-Request-Id": newest.id },
            body: {
              amount: {
                value:         toPaypalAmount(newest.amount, currencyCode),
                currency_code: currencyCode.toUpperCase(),
              },
              note_to_payer: newest.reason,
              custom_id:     id,
            },
          },
        );
        // 201 = freshly created. 200 + COMPLETED status also acceptable.
        const refundOk = (status === 201 || status === 200) && Boolean(data?.id);
        if (!refundOk) {
          const message = data?.details?.[0]?.description
            ?? data?.message
            ?? `PayPal refund failed (HTTP ${status}).`;
          console.error("admin/orders/[id]/refund POST (paypal):", message);
          return NextResponse.json({ ok: false, error: message }, { status: 502 });
        }
        newest.paypalRefundId = data!.id!;
      } catch (err) {
        const message = err instanceof Error ? err.message : "PayPal refund failed.";
        console.error("admin/orders/[id]/refund POST (paypal):", message);
        return NextResponse.json({ ok: false, error: message }, { status: 502 });
      }
    }
    // Else: cash / no gateway — record-only, no API call.
  }

  // ── Derive payment_status server-side ───────────────────────────────────
  // "refunded" = the customer has all their MONEY back (moneyCap). An order
  // fully covered by a gift card has moneyCap == 0 and no money to return, so
  // it can never reach "refunded" here — the gift-card portion is non-refundable.
  let newPaymentStatus: "refunded" | "partially_refunded" | undefined;
  if (moneyCap > 0.001 && moneyRefundedTotal >= moneyCap - 0.001) {
    newPaymentStatus = "refunded";
  } else if (moneyRefundedTotal > 0) {
    newPaymentStatus = "partially_refunded";
  }

  // ── Auto-cancel a full refund on an un-fulfilled order ──────────────────
  // A full money refund on an order that was never delivered kills the order:
  // the customer won't receive the food. Flip it to "cancelled" so it leaves
  // every surface that keys off `status` — the kitchen display, the driver's
  // queue, and the admin delivery board — instead of lingering as
  // "preparing"/"ready" with the money already returned. Partial refunds are
  // NOT auto-cancelled: the rest of the order still ships. The Delivery panel's
  // "refund & cancel" path already passes newStatus "cancelled"; this makes a
  // refund issued from the standalone Refunds panel behave the same.
  const wasAlreadyRefunded = existingPaymentStatusIsTerminal(String(orderRow.payment_status ?? ""));
  const tippingToRefunded  = newPaymentStatus === "refunded" && !wasAlreadyRefunded;
  const requestedStatus    = String(body.newStatus ?? "");
  const existingStatus     = String(orderRow.status ?? "");
  const foodWasDelivered   = requestedStatus === "delivered" || existingStatus === "delivered";
  const alreadyCancelled   = existingStatus === "cancelled";
  const autoCancel         = tippingToRefunded && !foodWasDelivered && !alreadyCancelled;

  // `refunded_amount` tracks MONEY returned to the customer (card / cash /
  // store credit). Keeping it money-only means the Refunds panel's "remaining
  // refundable" (moneyCap − refunded_amount) stays correct.
  // A refund changes the *payment* state; the fulfillment `status` is preserved
  // unless this is a full refund on an un-fulfilled order, which cancels it.
  const { error: orderErr } = await supabaseAdmin
    .from("orders")
    .update({
      status:           autoCancel ? "cancelled" : body.newStatus,
      refunds:          submittedRefunds,
      refunded_amount:  moneyRefundedTotal,
      ...(newPaymentStatus ? { payment_status: newPaymentStatus } : {}),
    })
    .eq("id", id);

  if (orderErr) {
    console.error("admin/orders/[id]/refund POST (order):", orderErr.message);
    return NextResponse.json({ ok: false, error: orderErr.message }, { status: 500 });
  }

  // The full refund just cancelled this order — tell the customer, mirroring the
  // KDS/admin status routes. Fire-and-forget: an email failure must never fail
  // the refund. No-op for guests / POS / when no cancellation template is on.
  // Skipped when the caller already requested "cancelled" (the Delivery panel's
  // "refund & cancel" owns that email via updateOrderStatus) — avoids a double-send.
  if (autoCancel && requestedStatus !== "cancelled") {
    sendOrderStatusEmail(id, "cancelled").catch((err) =>
      console.error("[admin/orders refund] cancellation email:", err instanceof Error ? err.message : err),
    );
  }

  // ─── Deduct loyalty points for the refund (Ahinsa) ──────────────────
  // Loyalty is earned on money paid, so a money refund deducts the matching
  // points. Every refund is a money refund now (gift-card refunds were removed),
  // so all of them deduct — and it's naturally bounded because newest.amount is
  // itself capped at the money actually paid (moneyCap) above.
  if (
    newest &&
    orderRow.customer_id &&
    orderRow.customer_id !== "guest" &&
    orderRow.customer_id !== "pos-walk-in"
  ) {
    await deductLoyaltyPoints(orderRow.customer_id, Number(newest.amount));
  }

  // Restore stock when a full refund covers an order whose food was never
  // delivered to the customer. Skipped when:
  //   • Partial refund — customer kept some of the goods.
  //   • Already-refunded — idempotent (admin editing refunds array twice).
  //   • Already-cancelled — POS void / waiter void / admin cancel already
  //     restored at the moment of cancellation. Restoring again here would
  //     double-credit inventory.
  //   • Delivered / picked-up — food was made and consumed; money refund
  //     doesn't put units back on the shelf.
  //   • Oversold-flagged webhook orders — the decrement never ran, so
  //     restoring would create false positive inventory.
  // `autoCancel` already encodes "full refund on an un-fulfilled, non-cancelled
  // order" (the first four bullets); only the oversold guard is added here.
  if (autoCancel && orderRow.oversold !== true) {
    const rawItems = Array.isArray(orderRow.items) ? (orderRow.items as Array<Record<string, unknown>>) : [];
    const stockItems: StockItem[] = rawItems
      .map((i) => ({ id: String(i.menuItemId ?? ""), qty: Number(i.qty ?? 0) }))
      .filter((i) => i.id);
    if (stockItems.length > 0) {
      restoreStock(stockItems).catch((err) =>
        console.error("[admin/orders refund] stock restore on full refund:", err instanceof Error ? err.message : err),
      );
    }
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
    paypalRefundId:  newest?.paypalRefundId ?? null,
    refundedAmount:  moneyRefundedTotal,
  });
}

/**
 * True when the order had already reached a terminal refund state before this
 * call. Used to skip stock-restore on repeated refund edits — admin updating
 * the refunds array for an already-refunded order must not re-restore.
 */
function existingPaymentStatusIsTerminal(status: string): boolean {
  return status === "refunded" || status === "partially_refunded";
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
