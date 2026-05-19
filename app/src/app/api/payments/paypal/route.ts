/**
 * POST /api/payments/paypal — entry point for the PayPal checkout flow.
 *
 * Mirrors /api/payments/intent (Stripe): runs every server-side validation
 * `/api/orders` does, but does NOT insert the order. Instead it:
 *   1. Stashes the verified row in payment_sessions (gateway='paypal').
 *   2. Creates a PayPal order (intent=CAPTURE) for the verified total.
 *   3. Returns the PayPal order id so the browser can render the PayPal
 *      Smart Buttons popup and approve the payment.
 *
 * The orders row is created later, by /api/webhooks/paypal on the
 * PAYMENT.CAPTURE.COMPLETED event. This guarantees the order only exists
 * if the money was actually captured — no orphan unpaid orders sitting in
 * the kitchen while the buyer abandons the PayPal popup.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { validateAndNormaliseOrder } from "@/lib/orderValidation";
import { paypalFetch, paypalIsConfigured, toPaypalAmount } from "@/lib/paypalServer";

// PayPal's per-currency minimum order value. PayPal doesn't publish a strict
// floor the way Stripe does, but very low totals are rejected as
// AMOUNT_NOT_SUPPORTED by some funding sources. A £1-equivalent floor keeps
// the friendly error here instead of a cryptic PayPal failure mid-popup.
const PAYPAL_MIN_CHARGE_BY_CURRENCY: Record<string, number> = {
  GBP: 1.00,
  USD: 1.00,
  EUR: 1.00,
};
const PAYPAL_MIN_CHARGE_FALLBACK = 1.00;

export async function POST(req: NextRequest) {
  if (!paypalIsConfigured()) {
    return NextResponse.json(
      { ok: false, error: "PayPal is not configured on this server." },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { customer_id } = body;
  if (!customer_id || typeof customer_id !== "string") {
    return NextResponse.json({ ok: false, error: "'customer_id' is required." }, { status: 400 });
  }

  // Same session check as /api/orders and /api/payments/intent — POS sentinel
  // never appears on the public endpoint; "guest" is the documented anonymous
  // value; anything else must match the logged-in session.
  if (customer_id === "pos-walk-in") return unauthorizedJson();
  const session = await getCustomerSession();
  if (session) {
    if (session.id !== customer_id) return unauthorizedJson();
  } else if (customer_id !== "guest") {
    return unauthorizedJson();
  }

  const validation = await validateAndNormaliseOrder(body, String(customer_id));
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: validation.status });
  }

  const { row, currency } = validation.data;

  if (row.total <= 0) {
    return NextResponse.json(
      { ok: false, error: "Order total is zero — nothing to charge. Place the order without payment." },
      { status: 400 },
    );
  }

  const min = PAYPAL_MIN_CHARGE_BY_CURRENCY[currency.code.toUpperCase()] ?? PAYPAL_MIN_CHARGE_FALLBACK;
  if (row.total < min) {
    return NextResponse.json(
      { ok: false, error: `Order total must be at least ${currency.symbol}${min.toFixed(2)} to pay with PayPal. Please pay by cash or increase your order.` },
      { status: 400 },
    );
  }

  // ── Create PayPal order ────────────────────────────────────────────────
  const amountValue = toPaypalAmount(row.total, currency.code);
  let paypalOrderId: string;
  try {
    const { status, data } = await paypalFetch<{
      id?:     string;
      status?: string;
      details?: Array<{ description?: string; issue?: string }>;
      message?: string;
    }>("/v2/checkout/orders", {
      method: "POST",
      // PayPal-Request-Id makes the call idempotent: a retry with the same
      // header returns the same order rather than creating a duplicate.
      headers: { "PayPal-Request-Id": row.id },
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            // custom_id is echoed back on the capture and webhook payloads —
            // we use it to find the payment_session for this order.
            custom_id:   row.id,
            description: `Order ${row.id}`,
            amount: {
              currency_code: currency.code.toUpperCase(),
              value:         amountValue,
            },
          },
        ],
        // Disable the shipping-address collector — we collect address in our
        // own form and don't want PayPal to overwrite it.
        application_context: {
          shipping_preference: "NO_SHIPPING",
          user_action:         "PAY_NOW",
          brand_name:          process.env.NEXT_PUBLIC_SITE_NAME || "Restaurant",
        },
      },
    });

    if (status !== 201 || !data?.id) {
      const message = data?.details?.[0]?.description
        ?? data?.message
        ?? `PayPal create-order failed (HTTP ${status}).`;
      console.error("[payments/paypal] create order:", message);
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
    paypalOrderId = data.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create PayPal order.";
    console.error("[payments/paypal] create order exception:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // ── Stash the verified order payload ───────────────────────────────────
  // The webhook reads this back and uses it as the orders insert row, so we
  // never re-trust the cart from the browser after this point.
  const { error: sessionErr } = await supabaseAdmin
    .from("payment_sessions")
    .insert({
      gateway:         "paypal",
      paypal_order_id: paypalOrderId,
      customer_id:     row.customer_id,
      amount:          row.total,
      currency:        currency.code,
      order_payload:   row,
      status:          "pending",
    });

  if (sessionErr) {
    console.error("[payments/paypal] session insert:", sessionErr.message);
    return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    paypalOrderId,
    amount:   row.total,
    currency: currency.code,
  });
}
