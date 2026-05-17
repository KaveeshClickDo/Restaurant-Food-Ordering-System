/**
 * POST /api/payments/intent — entry point for the card-payment flow.
 *
 * Runs every server-side validation `/api/orders` does, but does NOT insert
 * the order. Instead it:
 *   1. Stashes the verified row in payment_sessions.
 *   2. Creates a Stripe PaymentIntent for the verified total + currency.
 *   3. Returns the PaymentIntent client_secret so the browser can render
 *      <PaymentElement /> and confirm the charge.
 *
 * The order is created later, by /api/webhooks/stripe on the
 * `payment_intent.succeeded` event. That guarantees the order only exists
 * if the money was actually collected — no orphan unpaid orders sitting
 * in the kitchen while a 3-D-Secure challenge is open in another tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { validateAndNormaliseOrder } from "@/lib/orderValidation";
import { getStripe, toStripeAmount } from "@/lib/stripeServer";

export async function POST(req: NextRequest) {
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

  // Same session check as /api/orders — POS sentinel never appears on the
  // public endpoint; "guest" is the documented anonymous value; anything
  // else must match the logged-in session.
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

  // Refuse zero-total checkouts — Stripe rejects them anyway and the error
  // message is friendlier from here.
  if (row.total <= 0) {
    return NextResponse.json(
      { ok: false, error: "Order total is zero — nothing to charge. Place the order without payment." },
      { status: 400 },
    );
  }

  // Optional customer email — used for Stripe receipts. Falls back to the
  // session's email when the user is signed in. Stripe will send a receipt
  // to this address automatically when receipt_email is set.
  const customerEmail = typeof body.customer_email === "string" && body.customer_email.trim()
    ? body.customer_email.trim()
    : null;

  // ── Create PaymentIntent ────────────────────────────────────────────────
  let intent;
  try {
    intent = await getStripe().paymentIntents.create({
      amount:   toStripeAmount(row.total, currency.code),
      currency: currency.code.toLowerCase(),
      // `automatic_payment_methods` lets Stripe enable card, Apple Pay,
      // Google Pay, Link, and any other method enabled in the dashboard —
      // no per-method code needed here. allow_redirects:'never' would block
      // redirect-based methods (Klarna etc.); we leave it on by default.
      automatic_payment_methods: { enabled: true },
      receipt_email: customerEmail ?? undefined,
      metadata: {
        order_id:        row.id,
        customer_id:     row.customer_id,
        fulfillment:     row.fulfillment,
        total:           String(row.total),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create payment.";
    console.error("[payments/intent] Stripe error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // ── Stash the verified order payload ────────────────────────────────────
  // The webhook will read this back and use it as the orders insert row,
  // so we never re-trust the cart from the browser after this point.
  const { error: sessionErr } = await supabaseAdmin
    .from("payment_sessions")
    .insert({
      stripe_payment_intent_id: intent.id,
      customer_id:              row.customer_id,
      amount:                   row.total,
      currency:                 currency.code,
      order_payload:            row,
      status:                   "pending",
    });

  if (sessionErr) {
    // Cancel the PaymentIntent so the customer can't pay for a session
    // that doesn't exist on our side. Best-effort — Stripe will eventually
    // expire it anyway.
    getStripe().paymentIntents.cancel(intent.id).catch(() => {});
    console.error("[payments/intent] session insert:", sessionErr.message);
    return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    clientSecret:    intent.client_secret,
    paymentIntentId: intent.id,
    amount:          row.total,
    currency:        currency.code,
  });
}
