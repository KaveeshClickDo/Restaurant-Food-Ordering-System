/**
 * POST /api/payments/paypal/capture — capture a PayPal order after the
 * buyer approves it in the Smart Buttons popup.
 *
 * This endpoint exists so the browser can show a "thank you" screen without
 * waiting for the asynchronous webhook delivery. The orders row is still
 * created by /api/webhooks/paypal on PAYMENT.CAPTURE.COMPLETED — capturing
 * here just confirms PayPal has actually moved the money.
 *
 * The route is idempotent: a second POST for the same already-captured order
 * returns ok=true rather than erroring, so a double-click or retry on the
 * browser side does not break the flow.
 *
 * Body: { paypalOrderId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { paypalFetch, paypalIsConfigured } from "@/lib/paypalServer";

interface CaptureResponse {
  id?:      string;
  status?:  string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{ id?: string; status?: string }>;
    };
  }>;
  details?: Array<{ description?: string; issue?: string }>;
  message?: string;
}

export async function POST(req: NextRequest) {
  if (!paypalIsConfigured()) {
    return NextResponse.json(
      { ok: false, error: "PayPal is not configured on this server." },
      { status: 503 },
    );
  }

  let body: { paypalOrderId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const paypalOrderId = body.paypalOrderId;
  if (!paypalOrderId || typeof paypalOrderId !== "string") {
    return NextResponse.json({ ok: false, error: "'paypalOrderId' is required." }, { status: 400 });
  }

  // Verify we created this session — prevents an attacker from capturing
  // arbitrary PayPal orders they didn't make through our site.
  const { data: sessionRow, error: sessionErr } = await supabaseAdmin
    .from("payment_sessions")
    .select("id, status, completed_order_id")
    .eq("paypal_order_id", paypalOrderId)
    .maybeSingle();

  if (sessionErr) {
    console.error("[payments/paypal/capture] session lookup:", sessionErr.message);
    return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 });
  }
  if (!sessionRow) {
    return NextResponse.json({ ok: false, error: "Unknown PayPal order." }, { status: 404 });
  }
  if (sessionRow.status === "succeeded") {
    // Webhook already processed this — return success silently.
    return NextResponse.json({ ok: true, alreadyCaptured: true });
  }

  // ── Call PayPal capture ───────────────────────────────────────────────
  try {
    const { status, data } = await paypalFetch<CaptureResponse>(
      `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        // Re-using the order id as the request id keeps a retry from
        // producing a second capture — PayPal returns the original result.
        headers: { "PayPal-Request-Id": `cap-${paypalOrderId}` },
        body: {},
      },
    );

    // 201 = freshly captured. 422 + ORDER_ALREADY_CAPTURED = idempotent replay.
    const alreadyCaptured = status === 422
      && (data?.details?.some((d) => d.issue === "ORDER_ALREADY_CAPTURED") ?? false);

    if (status !== 201 && !alreadyCaptured) {
      const message = data?.details?.[0]?.description
        ?? data?.message
        ?? `PayPal capture failed (HTTP ${status}).`;
      console.error("[payments/paypal/capture]:", message);
      // Mark the session failed so the customer can retry from a clean state.
      await supabaseAdmin
        .from("payment_sessions")
        .update({ status: "failed", last_error: message })
        .eq("paypal_order_id", paypalOrderId);
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }

    return NextResponse.json({ ok: true, alreadyCaptured });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PayPal capture exception.";
    console.error("[payments/paypal/capture] exception:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
