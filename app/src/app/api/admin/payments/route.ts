/**
 * GET /api/admin/payments — payment history for the admin Payments panel.
 *
 * Returns all online orders with money attached:
 *   • Stripe-paid orders (payment_status in 'paid'/'refunded'/'partially_refunded')
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

  return NextResponse.json({ ok: true, payments: data ?? [] });
}
