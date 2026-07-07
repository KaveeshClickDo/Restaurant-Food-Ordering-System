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
  paypalFetch,
  verifyPaypalWebhook,
} from "@/lib/paypalServer";
import { redeemGiftCardForRow } from "@/lib/giftCardValidation";
import { spendStoreCredit, refundStoreCredit, claimCouponUsage } from "@/lib/storeCredit";
import { decrementStock, restoreStock, type StockItem } from "@/lib/stockMutation";
import { completeReservationFromSession } from "@/lib/reservations";
import { rewardLoyaltyPoints, redeemLoyaltyPointsForOrder } from "@/lib/loyaltyUtils";
import { captureCustomerOrderContact } from "@/lib/marketingContacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal shapes of the PayPal payloads we care about — keeps strict TS happy
// without dragging in the whole PayPal type universe.
interface PaypalCapture {
  id?: string;
  status?: string;
  custom_id?: string;
  amount?: { currency_code?: string; value?: string };
  supplementary_data?: {
    related_ids?: { order_id?: string };
  };
}

interface PaypalRefund {
  id?: string;
  status?: string;
  custom_id?: string;
  amount?: { currency_code?: string; value?: string };
  links?: Array<{ rel?: string; href?: string }>;
}

interface PaypalEvent {
  id?: string;
  event_type?: string;
  resource_type?: string;
  resource?: PaypalCapture & PaypalRefund;
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
    "paypal-auth-algo": req.headers.get("paypal-auth-algo"),
    "paypal-cert-url": req.headers.get("paypal-cert-url"),
    "paypal-transmission-id": req.headers.get("paypal-transmission-id"),
    "paypal-transmission-sig": req.headers.get("paypal-transmission-sig"),
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

  // ── Resource gates — debit prepaid balances BEFORE inserting the order ────
  // Mirrors the Stripe webhook. Store credit AND the gift card were subtracted
  // from this order's total at checkout, so the order must NOT exist unless each
  // one actually backs its share. (Previously the gift card was NEVER debited on
  // PayPal — the discount was applied for free.) On a genuine shortfall we
  // auto-refund the PayPal capture and skip the order; transient DB errors throw
  // so PayPal retries (debits are idempotent on the order id ⇒ debited once).
  const storeCreditUsed = Number(orderRow.store_credit_used ?? 0);
  const orderCustomerId = orderRow.customer_id as string | null;
  const realCustomer    = !!orderCustomerId && orderCustomerId !== "guest" && orderCustomerId !== "pos-walk-in";

  // Helper: undo stock, refund the full PayPal capture (idempotent via
  // PayPal-Request-Id), mark the session, and stop. Shared by both shortfalls.
  const refundAndMarkShortfall = async (key: string, reason: string): Promise<void> => {
    if (stock.ok) {
      restoreStock(stockItems).catch((err) =>
        console.error("[webhooks/paypal] restore after shortfall:", err instanceof Error ? err.message : err),
      );
    }
    if (captureId) {
      try {
        // No amount body ⇒ refunds the full captured amount.
        const { status } = await paypalFetch(
          `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
          { method: "POST", headers: { "PayPal-Request-Id": key }, body: {} },
        );
        if (status !== 201 && status !== 200) {
          console.error(`[webhooks/paypal] shortfall auto-refund returned HTTP ${status}`);
        }
      } catch (err) {
        console.error("[webhooks/paypal] shortfall auto-refund failed:", err instanceof Error ? err.message : err);
      }
    } else {
      console.error(`[webhooks/paypal] shortfall on order ${orderRow.id} but no captureId to refund — manual reconcile needed`);
    }
    await supabaseAdmin
      .from("payment_sessions")
      .update({ status: "refunded_shortfall", last_error: reason })
      .eq("id", session.id);
  };

  const shortfallKeyBase = captureId ?? paypalOrderId;

  let storeCreditSpent = false;
  if (realCustomer && storeCreditUsed > 0) {
    const sc = await spendStoreCredit(orderCustomerId as string, storeCreditUsed);
    if (!sc.ok && sc.reason === "insufficient") {
      console.error(`[webhooks/paypal] store credit shortfall on paid order ${orderRow.id} — auto-refunding, not creating order.`);
      await refundAndMarkShortfall(`sc-shortfall-${shortfallKeyBase}`, "Store credit insufficient at capture — auto-refunded.");
      return;
    }
    if (!sc.ok) {
      if (stock.ok) {
        restoreStock(stockItems).catch((err) =>
          console.error("[webhooks/paypal] restore after store-credit db error:", err instanceof Error ? err.message : err),
        );
      }
      throw new Error(`store credit spend: ${sc.error}`);
    }
    storeCreditSpent = true;
  }

  const giftCardId   = orderRow.gift_card_id as string | null;
  const giftCardUsed = Number(orderRow.gift_card_used ?? 0);
  if (giftCardId && giftCardUsed > 0) {
    const redeem = await redeemGiftCardForRow({
      giftCardId,
      amount:      giftCardUsed,
      orderId:     orderRow.id as string,
      performedBy: `customer:${orderRow.customer_id}`,
    });
    if (!redeem.ok && redeem.reason === "insufficient") {
      console.error(`[webhooks/paypal] gift card shortfall on paid order ${orderRow.id} — auto-refunding, not creating order.`);
      if (storeCreditSpent) {
        const back = await refundStoreCredit(orderCustomerId as string, storeCreditUsed);
        if (!back.ok) console.error("[webhooks/paypal] store credit compensation failed:", back.error);
      }
      await refundAndMarkShortfall(`gc-shortfall-${shortfallKeyBase}`, "Gift card balance insufficient at capture — auto-refunded.");
      return;
    }
    if (!redeem.ok) {
      if (storeCreditSpent) {
        const back = await refundStoreCredit(orderCustomerId as string, storeCreditUsed);
        if (!back.ok) console.error("[webhooks/paypal] store credit compensation failed:", back.error);
      }
      if (stock.ok) {
        restoreStock(stockItems).catch((err) =>
          console.error("[webhooks/paypal] restore after redeem db error:", err instanceof Error ? err.message : err),
        );
      }
      throw new Error(`gift card redeem: ${redeem.error}`);
    }
  }

  // Loyalty reward gate — debit the points behind the free reward item
  // (atomic, enforced, idempotent per order id). A points shortfall must NOT
  // void the whole paid order: degrade by dropping the reward line, zeroing
  // the stamp, and giving its unit back to stock. Mirrors the Stripe webhook.
  const loyaltyRewardId = orderRow.loyalty_reward_id as string | null;
  const loyaltyPoints   = Number(orderRow.loyalty_points_spent ?? 0);
  if (realCustomer && loyaltyRewardId && loyaltyPoints > 0) {
    const redeem = await redeemLoyaltyPointsForOrder({
      customerId: orderCustomerId as string,
      points:     loyaltyPoints,
      orderId:    orderRow.id as string,
      rewardId:   loyaltyRewardId,
    });
    if (!redeem.ok) {
      console.error(`[webhooks/paypal] loyalty redeem failed on order ${orderRow.id} (${redeem.reason}) — dropping the reward line.`);
      const rawItems    = Array.isArray(orderRow.items) ? (orderRow.items as Array<Record<string, unknown>>) : [];
      const rewardLine  = rawItems.find((i) => i.loyaltyRewardId === loyaltyRewardId);
      orderRow.items                = rawItems.filter((i) => i.loyaltyRewardId !== loyaltyRewardId);
      orderRow.loyalty_reward_id    = null;
      orderRow.loyalty_points_spent = 0;
      if (stock.ok && rewardLine?.menuItemId) {
        restoreStock([{ id: String(rewardLine.menuItemId), qty: 1 }]).catch((err) =>
          console.error("[webhooks/paypal] reward stock restore:", err instanceof Error ? err.message : err),
        );
      }
    }
  }

  const insertRow = {
    ...orderRow,
    payment_status: "paid",
    paypal_order_id: paypalOrderId,
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

  // AWARD LOYALTY POINTS FOR PAYPAL PAYMENTS
  if (orderRow.customer_id && orderRow.customer_id !== "pos-walk-in" && orderRow.customer_id !== "guest") {
    // Net money total; idempotent per order id (PayPal retries award once).
    await rewardLoyaltyPoints(orderRow.customer_id as string, Number(orderRow.total), { orderId: orderRow.id as string });
  }

  // Marketing contact — signed-in PayPal orders are captured server-side (guest
  // checkouts go through /api/guest-profile). Fire-and-forget.
  captureCustomerOrderContact(orderRow.customer_id as string | null, Number(orderRow.total)).catch(() => {});

  // (Store credit + gift card were already debited as gates above, before the
  // insert — the order only exists because both balances backed the discount.)

  // Coupon usage — atomic + limit-aware claim; order is already committed.
  const couponCode = orderRow.coupon_code as string | null;
  if (couponCode) {
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();
    const coupons: Array<{ id: string; code: string }> = settingsRow?.data?.coupons ?? [];
    const coupon = coupons.find((c) => c.code?.toUpperCase() === couponCode.toUpperCase());
    if (coupon) {
      await claimCouponUsage(coupon.id);
    }
  }

  // Confirmation email.
  sendOrderConfirmationEmail({
    id: orderRow.id as string,
    customer_id: orderRow.customer_id as string,
    fulfillment: orderRow.fulfillment as string,
    total: orderRow.total as number,
    items: orderRow.items as Array<{ name: string; qty: number; price: number }>,
    payment_method: orderRow.payment_method as string,
    address: (orderRow.address as string | null) ?? undefined,
    delivery_fee: (orderRow.delivery_fee as number) > 0 ? (orderRow.delivery_fee as number) : undefined,
    service_fee: (orderRow.service_fee as number) > 0 ? (orderRow.service_fee as number) : undefined,
    vat_amount: (orderRow.vat_amount as number | null) ?? undefined,
    vat_inclusive: (orderRow.vat_inclusive as boolean | null) ?? undefined,
    coupon_code: (orderRow.coupon_code as string | null) ?? undefined,
    coupon_discount: orderRow.coupon_code ? (orderRow.coupon_discount as number) : undefined,
    delivery_code: (orderRow.delivery_code as string | null) ?? undefined,
    date: orderRow.date as string,
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
  else orderQuery = orderQuery.eq("id", customId!);

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
    id: `rf-${Date.now()}`,
    orderId: order.id,
    amount: Math.round(refundValue * 100) / 100,
    type: refundedFromPaypal >= Number(order.total) - 0.01 ? "full" : "partial",
    reason: "Refunded via PayPal dashboard",
    method: "original_payment",
    processedAt: new Date().toISOString(),
    processedBy: "PayPal",
    paypalRefundId: resource.id ?? null,
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
      refunds: [...existingRefunds, newRefund],
      refunded_amount: refundedFromPaypal,
      payment_status: newPaymentStatus,
    })
    .eq("id", order.id);

  if (updateErr) throw new Error(`orders refund update: ${updateErr.message}`);
}
