/**
 * GET /api/admin/payments — payment history for the admin Payments panel.
 *
 * Returns all online orders with money attached:
 *   • Stripe-paid orders   (payment_status in 'paid'/'refunded'/'partially_refunded')
 *   • PayPal-paid orders   (same payment_status set)
 *   • Cash orders that have been marked paid (rare today but supported)
 *
 * Query params:
 *   • status   — filter by payment_status ("paid" | "refunded" | "partially_refunded")
 *   • method   — filter by payment_method (e.g. "Cash", "Card (Stripe)")
 *   • from/to  — ISO date range filter on the order date
 *   • limit    — page size (default 100, max 500)
 *
 * Joins the customer name so the panel doesn't need a second roundtrip.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const method = url.searchParams.get("method");
  const from   = url.searchParams.get("from");
  const to     = url.searchParams.get("to");
  const limit  = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));

  let query = supabaseAdmin
    .from("orders")
    .select(`
      id, date, total, payment_method, payment_status,
      stripe_payment_intent_id, stripe_charge_id,
      paypal_order_id, paypal_capture_id,
      refunded_amount, refunds, status, fulfillment,
      customer_id,
      customers ( name, email )
    `)
    .in("payment_status", ["paid", "refunded", "partially_refunded"])
    .order("date", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("payment_status", status);
  if (method) query = query.eq("payment_method", method);
  if (from)   query = query.gte("date", from);
  if (to)     query = query.lte("date", to);

  const { data, error } = await query;
  if (error) {
    console.error("admin/payments GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // VIP booking fees collected online are also "payments that actually moved
  // money" — surface them in the same panel so admin reconciliation sees the
  // whole picture. Only the online slice belongs here (Stripe/PayPal); the
  // POS/admin cash+card slice lives in the POS report.
  // Skip the union if the caller asked to filter by a status other than
  // "paid" — VIP fees are never refunded, so they don't belong in those tabs.
  let feeRows: PaymentRow[] = [];
  if (!status || status === "paid") {
    let feeQ = supabaseAdmin
      .from("reservations")
      .select(`
        id, created_at, vip_fee,
        payment_method, payment_status, payment_ref,
        customer_name, customer_email, table_label, status
      `)
      .eq("payment_status", "paid")
      .gt("vip_fee", 0)
      .in("payment_method", ["stripe", "paypal"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (from) feeQ = feeQ.gte("created_at", from);
    if (to)   feeQ = feeQ.lte("created_at", to);
    const { data: fees, error: feeErr } = await feeQ;
    if (feeErr && !feeErr.message?.includes("schema cache") && !feeErr.message?.includes("vip_fee")) {
      console.error("admin/payments fees:", feeErr.message);
    }
    feeRows = (fees ?? []).map(mapFeeToPaymentRow);
  }

  // Online gift card SALES collected through Stripe are also "money that moved"
  // — surface them here so reconciliation sees the whole online picture. Only
  // the online (gateway) slice belongs here; admin counter sales live on the
  // admin finance report. Skipped for non-"paid" tabs (sales aren't refunded).
  let gcRows: PaymentRow[] = [];
  if (!status || status === "paid") {
    let gcQ = supabaseAdmin
      .from("gift_cards")
      .select("id, code, initial_amount, created_at, stripe_payment_intent_id, issued_to_email, issued_to_name")
      .not("stripe_payment_intent_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (from) gcQ = gcQ.gte("created_at", from);
    if (to)   gcQ = gcQ.lte("created_at", to);
    const { data: gcs, error: gcErr } = await gcQ;
    if (gcErr && !gcErr.message?.includes("schema cache")) {
      console.error("admin/payments gift cards:", gcErr.message);
    }
    gcRows = (gcs ?? []).map(mapGiftCardToPaymentRow);
  }

  // Merge orders + VIP fees + gift card sales, sort by date descending; cap to
  // the requested limit so we don't grow the response unbounded.
  const merged = [...(data ?? []), ...feeRows, ...gcRows]
    .sort((a, b) => new Date((b as { date: string }).date).getTime() - new Date((a as { date: string }).date).getTime())
    .slice(0, limit);

  return NextResponse.json({ ok: true, payments: merged });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaymentRow = any;

// Shape a paid VIP reservation as a row the Payments panel can render side-by-
// side with orders. The synthetic id prefix lets the UI tell fees from orders
// at a glance; the gateway reference lives in payment_ref.
// Shape an online (Stripe) gift card sale as a Payments-panel row. Mirrors the
// VIP-fee mapper: a synthetic id prefix tells card sales apart from orders, and
// the gateway reference lives in stripe_payment_intent_id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGiftCardToPaymentRow(g: any): PaymentRow {
  return {
    id:                       `gc:${g.id}`,
    date:                     g.created_at,
    total:                    Number(g.initial_amount ?? 0),
    payment_method:           "Gift card (Stripe)",
    payment_status:           "paid",
    stripe_payment_intent_id: g.stripe_payment_intent_id ?? null,
    stripe_charge_id:         null,
    paypal_order_id:          null,
    paypal_capture_id:        null,
    refunded_amount:          0,
    refunds:                  [],
    status:                   "active",
    fulfillment:              "gift_card",
    customer_id:              null,
    customers:                g.issued_to_email
      ? { name: g.issued_to_name ?? "Gift card", email: g.issued_to_email }
      : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFeeToPaymentRow(r: any): PaymentRow {
  const isStripe = r.payment_method === "stripe";
  const isPaypal = r.payment_method === "paypal";
  return {
    id:                       `vip:${r.id}`,
    date:                     r.created_at,
    total:                    Number(r.vip_fee ?? 0),
    payment_method:           isStripe ? "VIP fee (Stripe)" : isPaypal ? "VIP fee (PayPal)" : "VIP fee",
    payment_status:           "paid",
    stripe_payment_intent_id: isStripe ? r.payment_ref ?? null : null,
    stripe_charge_id:         null,
    paypal_order_id:          isPaypal ? r.payment_ref ?? null : null,
    paypal_capture_id:        null,
    refunded_amount:          0,
    refunds:                  [],
    status:                   r.status,
    fulfillment:              "booking",
    customer_id:              null,
    customers:                r.customer_email
      ? { name: r.customer_name ?? "Guest", email: r.customer_email }
      : null,
  };
}
