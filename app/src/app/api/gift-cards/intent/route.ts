/**
 * POST /api/gift-cards/intent — buy a gift card.
 *
 * Mirrors the order-checkout flow at /api/payments/intent:
 *   1. Validate the amount + recipient details.
 *   2. Create a Stripe PaymentIntent with metadata.kind = "gift_card".
 *   3. Stash the recipient payload in `payment_sessions` with kind='gift_card'.
 *   4. Return the client_secret so the browser can confirm the charge.
 *
 * The gift_cards row is NOT inserted here — that happens in
 * /api/webhooks/stripe when payment_intent.succeeded fires, guaranteeing no
 * orphan codes get minted if the customer abandons the 3DS challenge.
 *
 * Anonymous purchase is allowed (bearer model). If a customer session is
 * present we capture them as `issuedByCustomerId` so the gifter can see the
 * card under "Cards I've bought" on /account.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession } from "@/lib/auth";
import { getStripe, toStripeAmount } from "@/lib/stripeServer";
import { parseBody } from "@/lib/apiValidation";
import { GiftCardPurchaseSchema } from "@/lib/schemas/giftCard";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, GiftCardPurchaseSchema);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  }
  const { amount, recipientEmail, recipientName, personalMessage, purchaserEmail } = parsed.data;

  // Capture the buyer's customer id if they're signed in. Anonymous purchase
  // is fine — we never trust the browser to pick this field, only the cookie.
  const session = await getCustomerSession();
  const issuedByCustomerId = session?.id ?? null;

  // Currency comes from admin settings (single-currency project — see
  // settings.currency). Fall back to GBP if the settings row is missing on a
  // very fresh install.
  const { data: settingsRow } = await supabaseAdmin
    .from("app_settings").select("data").eq("id", 1).maybeSingle();
  const currencyCode = (settingsRow?.data?.currency?.code as string | undefined)?.toUpperCase() || "GBP";

  // ── Optional: also let admin gate gift cards behind a setting flag ────────
  // settings.giftCardSettings.enabled defaults to true; falsy disables sales.
  const giftCardSettings = settingsRow?.data?.giftCardSettings;
  if (giftCardSettings && giftCardSettings.enabled === false) {
    return NextResponse.json(
      { ok: false, error: "Gift cards are not available at the moment." },
      { status: 503 },
    );
  }

  // ── Create the PaymentIntent ──────────────────────────────────────────────
  let intent;
  try {
    intent = await getStripe().paymentIntents.create({
      amount:   toStripeAmount(amount, currencyCode),
      currency: currencyCode.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      receipt_email: recipientEmail,
      // The metadata.kind discriminator is what the webhook reads to route
      // the success event to the gift-card handler instead of the order one.
      metadata: {
        kind:            "gift_card",
        amount:          String(amount),
        recipient_email: recipientEmail,
        issued_by:       issuedByCustomerId ?? "",
      },
    });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : "Failed to create payment.";
    console.error("[gift-cards/intent] Stripe error:", rawMessage);
    const friendly = /at least|minimum|too small|below/i.test(rawMessage)
      ? "This amount is too small for card payment. Please choose a higher value."
      : rawMessage;
    return NextResponse.json({ ok: false, error: friendly }, { status: 502 });
  }

  // ── Stash the verified purchase payload ───────────────────────────────────
  // The webhook reads this back and uses it as the gift_cards insert source
  // of truth, so we never re-trust the browser after this point.
  // customer_id on payment_sessions is NOT NULL — use the buyer's id when
  // logged in, otherwise the "guest" sentinel (which we treat as anonymous
  // throughout the codebase).
  const giftCardPayload = {
    amount,
    recipient_email:  recipientEmail,
    recipient_name:   recipientName,
    personal_message: personalMessage ?? null,
    issued_by_customer_id: issuedByCustomerId,
    // Anonymous buyer's own email — the webhook captures it as a marketing
    // contact. Signed-in buyers are resolved from issued_by_customer_id.
    purchaser_email:  purchaserEmail ?? null,
  };

  const { error: sessionErr } = await supabaseAdmin
    .from("payment_sessions")
    .insert({
      stripe_payment_intent_id: intent.id,
      customer_id:              issuedByCustomerId ?? "guest",
      amount:                   amount,
      currency:                 currencyCode,
      // order_payload is now nullable; for gift card kind we put the data
      // in gift_card_payload so the webhook can disambiguate cleanly.
      order_payload:            null,
      gift_card_payload:        giftCardPayload,
      kind:                     "gift_card",
      status:                   "pending",
    });

  if (sessionErr) {
    // Roll back the PaymentIntent so the buyer can't pay for a session that
    // doesn't exist on our side. Best-effort — Stripe will expire it anyway.
    getStripe().paymentIntents.cancel(intent.id).catch(() => {});
    console.error("[gift-cards/intent] session insert:", sessionErr.message);
    return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    clientSecret:    intent.client_secret,
    paymentIntentId: intent.id,
    amount:          amount,
    currency:        currencyCode,
  });
}
