/**
 * POST /api/reservations/intent — pay the booking fee for a VIP table.
 *
 * Online reservations for a VIP table can only be created after the
 * (non-refundable) booking fee is paid. This endpoint mirrors the order/gift-
 * card "create-after-webhook" flow:
 *   1. Re-validate the table (must be active + VIP) and the slot availability.
 *   2. Stash the full reservation payload in payment_sessions (kind='reservation').
 *   3. Create a Stripe PaymentIntent OR a PayPal order for the fee.
 *   4. Return the client secret / PayPal order id.
 *
 * The reservation row itself is NOT inserted here — it's created by
 * /api/webhooks/{stripe,paypal} once the fee is actually captured, so an
 * abandoned payment never leaves a phantom booking. Public (no auth): the
 * booking widget has no login, same bearer model as gift-card purchase.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { rateLimit }                 from "@/lib/rateLimit";
import { parseBody }                 from "@/lib/apiValidation";
import { ReservationIntentSchema }   from "@/lib/schemas/reservation";
import { getStripe, toStripeAmount } from "@/lib/stripeServer";
import { paypalFetch, paypalIsConfigured, toPaypalAmount } from "@/lib/paypalServer";
import { getOrderOccupiedTableIds }  from "@/lib/tableOccupancy";
import type { ReservationSystem }    from "@/types";

function toMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export async function POST(req: NextRequest) {
  // Same per-IP limit as the free booking route — this is an unauthenticated
  // public endpoint that mints payment intents, so cap abuse.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`reservation-intent:${ip}`, 5, 60_000);
  if (limited) {
    return NextResponse.json(
      { ok: false, error: "Too many booking requests. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  const parsed = await parseBody(req, ReservationIntentSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { tableId, date, time, partySize, customerName, customerEmail, customerPhone, note, gateway } = parsed.data;

  // Reject past slots — 5-minute grace for slow submissions.
  if (new Date(`${date}T${time}`).getTime() < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: "This time slot has already passed. Please select a future time." },
      { status: 400 },
    );
  }

  const [{ data: settingsRow }, { data: tableRow }] = await Promise.all([
    supabaseAdmin.from("app_settings").select("data").limit(1).single(),
    supabaseAdmin
      .from("dining_tables")
      .select("id, label, seats, section, active, is_vip, vip_price")
      .eq("id", tableId)
      .maybeSingle(),
  ]);

  const rs: ReservationSystem = settingsRow?.data?.reservationSystem ?? {} as ReservationSystem;
  const slotDuration: number  = rs.slotDurationMinutes ?? 90;
  const currencyCode = (settingsRow?.data?.currency?.code as string | undefined)?.toUpperCase() || "GBP";

  if (!tableRow || !tableRow.active) {
    return NextResponse.json({ ok: false, error: "Table not found or inactive." }, { status: 400 });
  }
  if (tableRow.seats < partySize) {
    return NextResponse.json({ ok: false, error: "Party size exceeds table capacity." }, { status: 400 });
  }
  const vipPrice = Number(tableRow.vip_price ?? 0);
  if (!tableRow.is_vip || vipPrice <= 0) {
    // Non-VIP tables don't take a fee — the caller should use the free
    // /api/reservations route. This guards against a tampered client.
    return NextResponse.json(
      { ok: false, error: "This table does not require a booking fee. Please book it without payment." },
      { status: 400 },
    );
  }

  // Re-check availability before charging — the webhook does a final check too.
  const { data: conflicts } = await supabaseAdmin
    .from("reservations")
    .select("id, time, status")
    .eq("date", date)
    .eq("table_id", tableId)
    .in("status", ["pending", "confirmed", "checked_in"]);
  const requestedMins = toMins(time);
  // Every status (incl. checked_in) blocks only its own sitting window.
  const reservationConflict = (conflicts ?? []).some((r) =>
    Math.abs(toMins(r.time as string) - requestedMins) < slotDuration,
  );
  // Also block if an active dine-in order physically occupies this table for an
  // overlapping sitting (seated walk-in, no reservation row). Best-effort.
  let orderConflict = false;
  if (!reservationConflict) {
    const occ = await getOrderOccupiedTableIds({
      date, requestedMins, slotDurationMinutes: slotDuration,
      slotIntervalMinutes: rs.slotIntervalMinutes, openTime: rs.openTime,
      tablesByLabel: new Map([[tableRow.label as string, tableRow.id as string]]),
    });
    orderConflict = occ.ids.has(tableRow.id as string);
  }
  if (reservationConflict || orderConflict) {
    return NextResponse.json(
      { ok: false, error: "This table is no longer available at the selected time. Please choose another slot." },
      { status: 409 },
    );
  }

  // The reservation id + cancel token are minted here and carried in the
  // payload so the webhook insert is idempotent on retries (it probes by id).
  const reservationId = crypto.randomUUID();
  const cancelToken   = crypto.randomUUID();
  const reservationPayload = {
    id:           reservationId,
    cancelToken,
    tableId:      tableRow.id,
    tableLabel:   tableRow.label,
    tableSeats:   tableRow.seats,
    section:      tableRow.section ?? "",
    customerName: customerName.trim(),
    customerEmail: customerEmail.trim().toLowerCase(),
    customerPhone: customerPhone?.trim() ?? "",
    date, time, partySize,
    status:       "pending" as const,
    note:         note?.trim() ?? null,
    source:       "online",
    vipFee:       vipPrice,
  };

  // ── PayPal branch ──────────────────────────────────────────────────────────
  if (gateway === "paypal") {
    if (!paypalIsConfigured()) {
      return NextResponse.json({ ok: false, error: "PayPal is not available right now." }, { status: 503 });
    }
    let paypalOrderId: string;
    try {
      const { status, data } = await paypalFetch<{ id?: string; message?: string; details?: Array<{ description?: string }> }>(
        "/v2/checkout/orders",
        {
          method: "POST",
          headers: { "PayPal-Request-Id": reservationId },
          body: {
            intent: "CAPTURE",
            purchase_units: [{
              custom_id:   reservationId,
              description: `Booking fee — Table ${tableRow.label}`,
              amount: { currency_code: currencyCode, value: toPaypalAmount(vipPrice, currencyCode) },
            }],
            application_context: {
              shipping_preference: "NO_SHIPPING",
              user_action:         "PAY_NOW",
              brand_name:          process.env.NEXT_PUBLIC_SITE_NAME || "Restaurant",
            },
          },
        },
      );
      if (status !== 201 || !data?.id) {
        const message = data?.details?.[0]?.description ?? data?.message ?? `PayPal create-order failed (HTTP ${status}).`;
        return NextResponse.json({ ok: false, error: message }, { status: 502 });
      }
      paypalOrderId = data.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create PayPal order.";
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }

    const { error: sessionErr } = await supabaseAdmin.from("payment_sessions").insert({
      gateway:             "paypal",
      paypal_order_id:     paypalOrderId,
      customer_id:         "guest",
      amount:              vipPrice,
      currency:            currencyCode,
      order_payload:       null,
      reservation_payload: reservationPayload,
      kind:                "reservation",
      status:              "pending",
    });
    if (sessionErr) {
      return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, gateway: "paypal", paypalOrderId, amount: vipPrice, currency: currencyCode });
  }

  // ── Stripe branch ────────────────────────────────────────────────────────
  let intent;
  try {
    intent = await getStripe().paymentIntents.create({
      amount:   toStripeAmount(vipPrice, currencyCode),
      currency: currencyCode.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      receipt_email: reservationPayload.customerEmail || undefined,
      metadata: {
        kind:           "reservation",
        reservation_id: reservationId,
        table_label:    tableRow.label,
      },
    });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : "Failed to create payment.";
    console.error("[reservations/intent] Stripe error:", rawMessage);
    const friendly = /at least|minimum|too small|below/i.test(rawMessage)
      ? "This booking fee is too small for card payment. Please contact us to book this table."
      : rawMessage;
    return NextResponse.json({ ok: false, error: friendly }, { status: 502 });
  }

  const { error: sessionErr } = await supabaseAdmin.from("payment_sessions").insert({
    stripe_payment_intent_id: intent.id,
    customer_id:              "guest",
    amount:                   vipPrice,
    currency:                 currencyCode,
    order_payload:            null,
    reservation_payload:      reservationPayload,
    kind:                     "reservation",
    status:                   "pending",
  });
  if (sessionErr) {
    getStripe().paymentIntents.cancel(intent.id).catch(() => {});
    return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    gateway:         "stripe",
    clientSecret:    intent.client_secret,
    paymentIntentId: intent.id,
    amount:          vipPrice,
    currency:        currencyCode,
  });
}
