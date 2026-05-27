/**
 * POST /api/webhooks/paypal — single endpoint for all PayPal webhook events.
 *
 * Authenticity is verified by POSTing the headers + body back to PayPal's
 * /v1/notifications/verify-webhook-signature endpoint with our configured
 * PAYPAL_WEBHOOK_ID. PayPal does not give merchants a static signing secret
 * the way Stripe does — every delivery must be re-verified against PayPal.
 *
 * Events handled:
 *   • PAYMENT.CAPTURE.COMPLETED
 *       Promote the corresponding payment_session into a real `orders` row,
 *       mark payment_status='paid', increment coupon usage, send the
 *       confirmation email. This is the only place orders for PayPal are
 *       created — the browser hitting /capture is just a UI hint.
 *   • PAYMENT.CAPTURE.DENIED
 *       Mark the session as failed so the browser can show a clean error.
 *   • PAYMENT.CAPTURE.REFUNDED / PAYMENT.CAPTURE.REVERSED
 *       Update the order's refunds[] / refunded_amount / payment_status to
 *       reflect a refund processed either via our admin panel or directly
 *       in the PayPal dashboard.
 *   • CHECKOUT.ORDER.APPROVED
 *       Logged but ignored — the capture flow is initiated by our own
 *       /capture route, not by reacting to this event.
 *
 * Other events are acknowledged with 200 and ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendOrderConfirmationEmail } from "@/lib/emailServer";
import {
  fromPaypalAmount,
  getPaypalWebhookId,
  paypalIsConfigured,
  verifyPaypalWebhook,
} from "@/lib/paypalServer";
import { incrementCouponUsage } from "@/lib/orderValidation";
import { decrementStock, restoreStock, type StockItem } from "@/lib/stockMutation";
import { completeReservationFromSession } from "@/lib/reservations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal shapes of the PayPal payloads we care about — keeps strict TS happy
// without dragging in the whole PayPal type universe.
interface PaypalCapture {
  id?:        string;
  status?:    string;
  custom_id?: string;
  amount?:    { currency_code?: string; value?: string };
  supplementary_data?: {
    related_ids?: { order_id?: string };
  };
}

interface PaypalRefund {
  id?:        string;
  status?:    string;
  custom_id?: string;
  amount?:    { currency_code?: string; value?: string };
  links?:     Array<{ rel?: string; href?: string }>;
}

interface PaypalEvent {
  id?:           string;
  event_type?:   string;
  resource_type?: string;
  resource?:     PaypalCapture & PaypalRefund;
}

export async function POST(req: NextRequest) {
  if (!paypalIsConfigured()) {
    // Misconfigured server — still return 200 so PayPal stops retrying
    // forever. Operator will see the warning in the logs.
    console.warn("[webhooks/paypal] received delivery but PayPal is not configured.");
    return NextResponse.json({ received: true });
  }

  const rawBody = await req.text();

  // Build a lowercased-key view of headers — PayPal sends them in mixed case
  // but Next.js exposes them lowercased.
  const headers: Record<string, string | null> = {
    "paypal-auth-algo":         req.headers.get("paypal-auth-algo"),
    "paypal-cert-url":          req.headers.get("paypal-cert-url"),
    "paypal-transmission-id":   req.headers.get("paypal-transmission-id"),
    "paypal-transmission-sig":  req.headers.get("paypal-transmission-sig"),
    "paypal-transmission-time": req.headers.get("paypal-transmission-time"),
  };

  let webhookId: string;
  try { webhookId = getPaypalWebhookId(); }
  catch (err) {
    const message = err instanceof Error ? err.message : "Missing PAYPAL_WEBHOOK_ID.";
    console.error("[webhooks/paypal]:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const isAuthentic = await verifyPaypalWebhook({ headers, rawBody, webhookId });
  if (!isAuthentic) {
    return NextResponse.json(
      { ok: false, error: "PayPal webhook signature verification failed." },
      { status: 400 },
    );
  }

  let event: PaypalEvent;
  try { event = JSON.parse(rawBody); }
  catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    switch (event.event_type) {
      case "PAYMENT.CAPTURE.COMPLETED":
        await handleCaptureCompleted(event.resource ?? {});
        break;
      case "PAYMENT.CAPTURE.DENIED":
        await handleCaptureDenied(event.resource ?? {});
        break;
      case "PAYMENT.CAPTURE.REFUNDED":
      case "PAYMENT.CAPTURE.REVERSED":
        await handleCaptureRefunded(event.resource ?? {});
        break;
      case "CHECKOUT.ORDER.APPROVED":
      default:
        // Acknowledge and move on. Add cases here when we start caring about
        // disputes, payouts, etc.
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unhandled webhook error.";
    console.error(`[webhooks/paypal] ${event.event_type}:`, message);
    // Return 500 so PayPal retries — typically a DB blip.
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Look up the originating payment_session for a capture / refund event.
 *
 * PayPal's PAYMENT.CAPTURE.* resources include the parent order id under
 * supplementary_data.related_ids.order_id — that's how we tie the capture
 * back to the row we wrote in /api/payments/paypal. Falls back to custom_id
 * (which we set to the order id at create time) if supplementary_data is
 * missing on older API versions.
 */
async function findPaypalOrderId(resource: PaypalCapture | PaypalRefund): Promise<string | null> {
  const supplied = (resource as PaypalCapture).supplementary_data?.related_ids?.order_id;
  if (supplied) return supplied;
  // Last-resort: a refund webhook may not include the parent order id. The
  // caller can still search by custom_id in the order table later.
  return null;
}

async function handleCaptureCompleted(resource: PaypalCapture): Promise<void> {
  const paypalOrderId = await findPaypalOrderId(resource);
  if (!paypalOrderId) {
    console.warn("[webhooks/paypal] CAPTURE.COMPLETED without related order_id — skipping");
    return;
  }
  const captureId = resource.id ?? null;

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("payment_sessions")
    .select("*")
    .eq("paypal_order_id", paypalOrderId)
    .maybeSingle();

  if (sessionErr) throw new Error(`payment_sessions lookup: ${sessionErr.message}`);
  if (!session) {
    console.warn(`[webhooks/paypal] no session for PayPal order ${paypalOrderId} — likely duplicate event`);
    return;
  }
  if (session.status === "succeeded" && session.completed_order_id) {
    // Idempotent — order already created.
    return;
  }

  // VIP booking-fee payments create a reservation instead of an order.
  if (session.kind === "reservation") {
    await completeReservationFromSession(session, "paypal", captureId ?? paypalOrderId);
    return;
  }

  const orderRow = session.order_payload as Record<string, unknown>;

  // Idempotency pre-check: same reasoning as the Stripe webhook — a previous
  // retry might already have inserted the order. Probe first so we don't
  // double-decrement stock.
  const { data: existingOrder } = await supabaseAdmin
    .from("orders").select("id").eq("id", orderRow.id as string).maybeSingle();
  if (existingOrder) {
    await supabaseAdmin
      .from("payment_sessions")
      .update({ status: "succeeded", completed_order_id: orderRow.id as string })
      .eq("id", session.id);
    return;
  }

  // Stock decrement. Oversold paid orders proceed (we keep the money, admin
  // reconciles); other DB errors restore stock and re-raise so PayPal retries.
  // The order is stamped `oversold = true` so void/refund knows not to call
  // restore_stock (the original decrement never ran) and admin sees the flag.
  const orderItems = Array.isArray(orderRow.items) ? (orderRow.items as Array<Record<string, unknown>>) : [];
  const stockItems: StockItem[] = orderItems
    .map((i) => ({ id: String(i.menuItemId ?? ""), qty: Number(i.qty ?? 0) }))
    .filter((i) => i.id);
  const stock = await decrementStock(stockItems);
  const oversold = !stock.ok;
  if (oversold) {
    console.error(
      `[webhooks/paypal] OVERSOLD on paid order ${orderRow.id}: ${stock.message}. Inserting flagged order — admin must reconcile.`,
    );
  }

  const insertRow = {
    ...orderRow,
    payment_status:    "paid",
    paypal_order_id:   paypalOrderId,
    paypal_capture_id: captureId,
    oversold,
  };

  const { error: insertErr } = await supabaseAdmin
    .from("orders")
    .insert(insertRow);

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Concurrent webhook delivery won the race — restore the duplicate
      // decrement so the counter doesn't double-deduct.
      if (stock.ok) {
        restoreStock(stockItems).catch((err) =>
          console.error("[webhooks/paypal] restore after dup-insert:", err instanceof Error ? err.message : err),
        );
      }
      await supabaseAdmin
        .from("payment_sessions")
        .update({ status: "succeeded", completed_order_id: orderRow.id as string })
        .eq("id", session.id);
      return;
    }
    if (stock.ok) {
      restoreStock(stockItems).catch((err) =>
        console.error("[webhooks/paypal] restore after insert error:", err instanceof Error ? err.message : err),
      );
    }
    throw new Error(`orders insert: ${insertErr.message}`);
  }

  await supabaseAdmin
    .from("payment_sessions")
    .update({ status: "succeeded", completed_order_id: orderRow.id as string })
    .eq("id", session.id);

  // Store credit deduction — order row carries store_credit_used from the
  // browser; the customer's balance must be deducted server-side here because
  // the client has no working window (its spend-credit POST would race the
  // order insert). Idempotent through the 23505 early-return on retries.
  const storeCreditUsed = Number(orderRow.store_credit_used ?? 0);
  const orderCustomerId = orderRow.customer_id as string | null;
  if (orderCustomerId && storeCreditUsed > 0) {
    try {
      const { data: cust } = await supabaseAdmin
        .from("customers")
        .select("store_credit")
        .eq("id", orderCustomerId)
        .maybeSingle();
      if (cust) {
        const current    = Number(cust.store_credit ?? 0);
        const newBalance = Math.max(0, parseFloat((current - storeCreditUsed).toFixed(2)));
        await supabaseAdmin
          .from("customers")
          .update({ store_credit: newBalance })
          .eq("id", orderCustomerId);
      }
    } catch (err) {
      console.error("[webhooks/paypal] store credit deduct:", err instanceof Error ? err.message : err);
    }
  }

  // Coupon usage — fire-and-forget; order is already committed.
  const couponCode = orderRow.coupon_code as string | null;
  if (couponCode) {
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();
    const coupons: Array<{ id: string; code: string }> = settingsRow?.data?.coupons ?? [];
    const coupon = coupons.find((c) => c.code?.toUpperCase() === couponCode.toUpperCase());
    if (coupon) {
      incrementCouponUsage(coupon.id).catch((err) =>
        console.error("[webhooks/paypal] coupon increment:", err instanceof Error ? err.message : err),
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
    console.error("[webhooks/paypal] confirmation email:", err instanceof Error ? err.message : err),
  );
}

async function handleCaptureDenied(resource: PaypalCapture): Promise<void> {
  const paypalOrderId = await findPaypalOrderId(resource);
  if (!paypalOrderId) return;
  await supabaseAdmin
    .from("payment_sessions")
    .update({ status: "failed", last_error: "PayPal denied the capture." })
    .eq("paypal_order_id", paypalOrderId);
}

async function handleCaptureRefunded(resource: PaypalRefund): Promise<void> {
  // We match on the capture id (not order id) because a single order may have
  // several captures over time — though in our flow it's always one.
  // Try resource.links[rel='up'] first — PayPal puts the capture URL there.
  let parentCaptureId: string | null = null;
  const links = resource.links ?? [];
  for (const link of links) {
    if (link.rel === "up" && link.href) {
      const m = /\/captures\/([^/?#]+)/.exec(link.href);
      if (m) { parentCaptureId = m[1]; break; }
    }
  }
  // Fall back to custom_id (set to our order id at create time).
  const customId = resource.custom_id ?? null;

  if (!parentCaptureId && !customId) {
    console.warn("[webhooks/paypal] refund event without parent capture id or custom_id — skipping");
    return;
  }

  // Find the order. captureId is the primary key into the gateway; customId
  // is a useful fallback when the link payload is missing.
  let orderQuery = supabaseAdmin
    .from("orders")
    .select("id, total, refunds, refunded_amount, payment_status, paypal_capture_id");

  if (parentCaptureId) orderQuery = orderQuery.eq("paypal_capture_id", parentCaptureId);
  else                 orderQuery = orderQuery.eq("id", customId!);

  const { data: order, error: orderErr } = await orderQuery.maybeSingle();
  if (orderErr) throw new Error(`orders lookup: ${orderErr.message}`);
  if (!order) {
    console.warn(`[webhooks/paypal] refund: no order for capture ${parentCaptureId ?? customId}`);
    return;
  }

  // Compute the cumulative refunded amount as reported by PayPal. PayPal
  // doesn't include a running total in the refund payload, so we sum what we
  // already have locally plus this refund's value.
  const refundValue = fromPaypalAmount(resource.amount?.value ?? "0");
  const localRefunded = Number(order.refunded_amount ?? 0);
  const refundedFromPaypal = localRefunded + refundValue;

  // Skip if we've already recorded at least this much locally — the admin
  // panel already updated the row before the webhook arrived. This webhook
  // is the safety net for refunds initiated outside our UI.
  const existingRefunds = Array.isArray(order.refunds) ? order.refunds : [];
  const alreadyRecorded = existingRefunds.some(
    (r) => typeof r === "object" && r && (r as { paypalRefundId?: string }).paypalRefundId === resource.id,
  );
  if (alreadyRecorded) return;

  const newRefund = {
    id:              `rf-${Date.now()}`,
    orderId:         order.id,
    amount:          Math.round(refundValue * 100) / 100,
    type:            refundedFromPaypal >= Number(order.total) - 0.01 ? "full" : "partial",
    reason:          "Refunded via PayPal dashboard",
    method:          "original_payment",
    processedAt:     new Date().toISOString(),
    processedBy:     "PayPal",
    paypalRefundId:  resource.id ?? null,
  };

  const newPaymentStatus = refundedFromPaypal >= Number(order.total) - 0.01
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
      refunded_amount: refundedFromPaypal,
      payment_status:  newPaymentStatus,
    })
    .eq("id", order.id);

  if (updateErr) throw new Error(`orders refund update: ${updateErr.message}`);
}
