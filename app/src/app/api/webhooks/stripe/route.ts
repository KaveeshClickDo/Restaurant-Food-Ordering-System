/**
 * POST /api/webhooks/stripe — single endpoint for all Stripe webhook events.
 *
 * Authenticity is verified using the Stripe signature header + shared
 * STRIPE_WEBHOOK_SECRET. The endpoint MUST receive the raw request body
 * (not the parsed JSON), which is why we use req.text() rather than
 * req.json(). Next.js App Router gives us the raw stream by default.
 *
 * Events handled:
 *   • payment_intent.succeeded
 *       Promote the corresponding payment_session into a real `orders` row,
 *       mark `payment_status='paid'`, increment coupon usage, send the
 *       confirmation email. This is the only place orders for card payments
 *       are created — the browser confirming payment is just a UI hint.
 *   • payment_intent.payment_failed
 *       Mark the session as failed so the browser can show a clean error.
 *   • charge.refunded
 *       Update the order's refunds[] / refunded_amount / payment_status to
 *       reflect a refund that was processed (either via our admin panel or
 *       directly in the Stripe dashboard).
 *
 * Other events are acknowledged with 200 and ignored. Returning anything
 * other than 2xx makes Stripe retry — only do so for events we *want* to
 * retry on (i.e. transient DB errors we couldn't handle).
 */

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendOrderConfirmationEmail } from "@/lib/emailServer";
import { getStripe, getWebhookSecret, fromStripeAmount } from "@/lib/stripeServer";
import { incrementCouponUsage } from "@/lib/orderValidation";
import { decrementStock, restoreStock, type StockItem } from "@/lib/stockMutation";

// Tell Next.js this route handler should NOT parse the body — Stripe needs
// the raw bytes for signature verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ ok: false, error: "Missing stripe-signature header." }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, getWebhookSecret());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signature verification failed.";
    console.error("[webhooks/stripe] signature verification:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      default:
        // Acknowledge so Stripe doesn't retry. Add cases here when we start
        // caring about disputes, payouts, etc.
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unhandled webhook error.";
    console.error(`[webhooks/stripe] ${event.type}:`, message);
    // Return 500 so Stripe retries — typically DB blip.
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ──────────────────────────────────────────────────────────────────────────────

async function handlePaymentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  // Look up the session by payment intent ID.
  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("payment_sessions")
    .select("*")
    .eq("stripe_payment_intent_id", intent.id)
    .maybeSingle();

  if (sessionErr) throw new Error(`payment_sessions lookup: ${sessionErr.message}`);
  if (!session) {
    // Could be a duplicate event (succeeded fires twice on retries) — silent OK.
    console.warn(`[webhooks/stripe] no session for PI ${intent.id} — likely duplicate event`);
    return;
  }
  if (session.status === "succeeded" && session.completed_order_id) {
    // Idempotent — order already created. Acknowledge silently.
    return;
  }

  const orderRow = session.order_payload as Record<string, unknown>;
  const chargeId = typeof intent.latest_charge === "string"
    ? intent.latest_charge
    : intent.latest_charge?.id ?? null;

  // Idempotency pre-check: webhook delivery can retry, and if a previous
  // attempt inserted the order but failed to mark the session 'succeeded'
  // we'd otherwise double-decrement stock here. Probe orders first.
  const { data: existingOrder } = await supabaseAdmin
    .from("orders").select("id").eq("id", orderRow.id as string).maybeSingle();
  if (existingOrder) {
    await supabaseAdmin
      .from("payment_sessions")
      .update({ status: "succeeded", completed_order_id: orderRow.id as string })
      .eq("id", session.id);
    return;
  }

  // Decrement stock for this paid order. If the items are oversold (somebody
  // else bought the last unit while this customer was paying) we still insert
  // the order — Stripe already collected the money, refusing here would lose
  // it. Admin reconciles via the kitchen / customer-service workflow.
  const orderItems = Array.isArray(orderRow.items) ? (orderRow.items as Array<Record<string, unknown>>) : [];
  const stockItems: StockItem[] = orderItems
    .map((i) => ({ id: String(i.menuItemId ?? ""), qty: Number(i.qty ?? 0) }))
    .filter((i) => i.id);
  const stock = await decrementStock(stockItems);
  if (!stock.ok) {
    console.error(
      `[webhooks/stripe] OVERSOLD on paid order ${orderRow.id}: ${stock.message}. Inserting order anyway — admin must reconcile.`,
    );
  }

  const insertRow = {
    ...orderRow,
    payment_status:           "paid",
    stripe_payment_intent_id: intent.id,
    stripe_charge_id:         chargeId,
  };

  const { error: insertErr } = await supabaseAdmin
    .from("orders")
    .insert(insertRow);

  if (insertErr) {
    // 23505 = a concurrent webhook attempt won the race to insert. Treat as
    // idempotent success but undo this attempt's stock decrement so the
    // counter doesn't double-deduct.
    if (insertErr.code === "23505") {
      if (stock.ok) {
        restoreStock(stockItems).catch((err) =>
          console.error("[webhooks/stripe] restore after dup-insert:", err instanceof Error ? err.message : err),
        );
      }
      await supabaseAdmin
        .from("payment_sessions")
        .update({ status: "succeeded", completed_order_id: orderRow.id as string })
        .eq("id", session.id);
      return;
    }
    // Any other DB error: undo the decrement before bubbling so Stripe retries
    // cleanly. The next retry will pre-check, find no order, decrement again.
    if (stock.ok) {
      restoreStock(stockItems).catch((err) =>
        console.error("[webhooks/stripe] restore after insert error:", err instanceof Error ? err.message : err),
      );
    }
    throw new Error(`orders insert: ${insertErr.message}`);
  }

  await supabaseAdmin
    .from("payment_sessions")
    .update({ status: "succeeded", completed_order_id: orderRow.id as string })
    .eq("id", session.id);

  // Coupon increment — fire-and-forget; order is already committed.
  const couponCode = orderRow.coupon_code as string | null;
  if (couponCode) {
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();
    const coupons: Array<{ id: string; code: string }> = settingsRow?.data?.coupons ?? [];
    const coupon = coupons.find((c) => c.code?.toUpperCase() === couponCode.toUpperCase());
    if (coupon) {
      incrementCouponUsage(coupon.id).catch((err) =>
        console.error("[webhooks/stripe] coupon increment:", err instanceof Error ? err.message : err),
      );
    }
  }

  // Confirmation email.
  sendOrderConfirmationEmail({
    id:              orderRow.id as string,
    customer_id:     orderRow.customer_id as string,
    fulfillment:     orderRow.fulfillment as string,
    total:           orderRow.total as number,
    items:           orderRow.items as Array<{ name: string; qty: number; price: number }>,
    payment_method:  orderRow.payment_method as string,
    address:         (orderRow.address as string | null) ?? undefined,
    delivery_fee:    (orderRow.delivery_fee as number) > 0 ? (orderRow.delivery_fee as number) : undefined,
    service_fee:     (orderRow.service_fee  as number) > 0 ? (orderRow.service_fee  as number) : undefined,
    vat_amount:      (orderRow.vat_amount as number | null) ?? undefined,
    vat_inclusive:   (orderRow.vat_inclusive as boolean | null) ?? undefined,
    coupon_code:     (orderRow.coupon_code as string | null) ?? undefined,
    coupon_discount: orderRow.coupon_code ? (orderRow.coupon_discount as number) : undefined,
    delivery_code:   (orderRow.delivery_code as string | null) ?? undefined,
    date:            orderRow.date as string,
  }).catch((err: unknown) =>
    console.error("[webhooks/stripe] confirmation email:", err instanceof Error ? err.message : err),
  );
}

async function handlePaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const lastErr = intent.last_payment_error?.message ?? "Payment failed.";
  await supabaseAdmin
    .from("payment_sessions")
    .update({ status: "failed", last_error: lastErr })
    .eq("stripe_payment_intent_id", intent.id);
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  // Find the order this charge belongs to. The charge may carry the
  // payment_intent ID, which we matched to the order at insert time.
  const intentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!intentId) {
    console.warn("[webhooks/stripe] charge.refunded without payment_intent — ignoring");
    return;
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("id, total, refunds, refunded_amount, payment_status")
    .eq("stripe_payment_intent_id", intentId)
    .maybeSingle();

  if (orderErr) throw new Error(`orders lookup: ${orderErr.message}`);
  if (!order) {
    console.warn(`[webhooks/stripe] charge.refunded: no order for PI ${intentId}`);
    return;
  }

  // Total refunded (across all refunds on this charge) as reported by Stripe.
  const refundedFromStripe = fromStripeAmount(charge.amount_refunded, charge.currency);

  // Skip if we've already recorded at least this much locally — admin panel
  // already updated the row before the webhook arrived. The webhook is the
  // safety net for refunds initiated outside our UI (Stripe dashboard).
  const localRefunded = Number(order.refunded_amount ?? 0);
  if (localRefunded >= refundedFromStripe - 0.01) {
    return;
  }

  const delta = Math.max(0, refundedFromStripe - localRefunded);
  const existingRefunds = Array.isArray(order.refunds) ? order.refunds : [];

  const newRefund = {
    id:           `rf-${Date.now()}`,
    orderId:      order.id,
    amount:       Math.round(delta * 100) / 100,
    type:         refundedFromStripe >= Number(order.total) - 0.01 ? "full" : "partial",
    reason:       "Refunded via Stripe dashboard",
    method:       "original_payment",
    processedAt:  new Date().toISOString(),
    processedBy:  "Stripe",
    stripeRefundId: charge.refunds?.data?.[0]?.id ?? null,
  };

  const newPaymentStatus = refundedFromStripe >= Number(order.total) - 0.01
    ? "refunded"
    : "partially_refunded";

  // A refund only changes payment state — the order keeps its fulfillment
  // status. payment_status is the source of truth for refunds (see the admin
  // refund route); overwriting status here would hide the order from the
  // Delivered tab and mislabel its fulfillment.
  const { error: updateErr } = await supabaseAdmin
    .from("orders")
    .update({
      refunds:         [...existingRefunds, newRefund],
      refunded_amount: refundedFromStripe,
      payment_status:  newPaymentStatus,
    })
    .eq("id", order.id);

  if (updateErr) throw new Error(`orders refund update: ${updateErr.message}`);
}
