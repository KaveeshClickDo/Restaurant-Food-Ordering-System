/**
 * GET /api/admin/booking-fees — paid VIP table booking fees.
 *
 * Surfaces the non-refundable booking fees collected on VIP reservations as a
 * dedicated revenue stream. The Admin Payments panel reads the `online` slice
 * (Stripe + PayPal) and the POS / Online finance reports each read their own
 * slice (online vs cash+card at the till).
 *
 * Query params:
 *   • source — "online" (stripe/paypal) | "pos" (cash/card) | "all" (default)
 *   • from   — ISO date lower bound on reservation created_at (inclusive)
 *   • to     — ISO date upper bound on created_at (inclusive)
 *   • limit  — page size (default 500, max 2000)
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ONLINE_METHODS = ["stripe", "paypal"];
const POS_METHODS    = ["cash", "card"];

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const url    = new URL(req.url);
  const source = (url.searchParams.get("source") ?? "all") as "all" | "online" | "pos";
  const from   = url.searchParams.get("from");
  const to     = url.searchParams.get("to");
  const limit  = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || 500));

  let q = supabaseAdmin
    .from("reservations")
    .select(`
      id, created_at, date, time,
      table_id, table_label, section,
      customer_name, customer_email, customer_phone,
      vip_fee, payment_status, payment_method, payment_ref, source,
      status
    `)
    .eq("payment_status", "paid")
    .gt("vip_fee", 0)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (source === "online") q = q.in("payment_method", ONLINE_METHODS);
  if (source === "pos")    q = q.in("payment_method", POS_METHODS);
  if (from) q = q.gte("created_at", from);
  if (to)   q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) {
    // Older DBs that haven't run the VIP migration yet will not have these
    // columns — surface an empty list rather than a 500 so the panels can
    // render their empty state cleanly.
    if (error.message?.includes("schema cache") || error.message?.includes("vip_fee") || error.message?.includes("payment_status")) {
      return NextResponse.json({ ok: true, fees: [] });
    }
    console.error("admin/booking-fees GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fees: data ?? [] });
}
