/**
 * GET /api/pos/orders/dine-in — dine-in orders for the POS dashboard.
 *
 * Replaces direct `supabase.from("orders")` reads in pos/DashboardView.
 *
 * Query params:
 *   from   ISO-8601 lower bound (inclusive)
 *   to     ISO-8601 upper bound (inclusive)
 *   limit  max rows (defaults 200, capped 2000)
 *
 * Requires a POS session. The admin dashboard reads dine-in orders via
 * /api/admin/orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPosSession, unauthorizedJson } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const pos = await getPosSession();
  if (!pos) return unauthorizedJson();

  const { searchParams } = new URL(req.url);
  const from  = searchParams.get("from");
  const to    = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 2000);

  let q = supabaseAdmin
    .from("orders")
    .select("id, items, total, note, status, payment_status, payment_method, date, refunded_amount, gift_card_used")
    .eq("fulfillment", "dine-in")
    .order("date", { ascending: false })
    .limit(limit);

  if (from) q = q.gte("date", from);
  if (to)   q = q.lte("date", to);

  const { data, error } = await q;
  if (error) {
    console.error("pos/orders/dine-in GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orders: data ?? [] });
}
