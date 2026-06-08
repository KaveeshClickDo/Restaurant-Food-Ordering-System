/**
 * GET /api/admin/orders — admin-gated orders list with optional date range.
 *
 * Replaces the direct `supabase.from("orders").select(...)` call that
 * OnlineReportsPanel used to make from the browser anon client.
 *
 * Query params:
 *   from    ISO-8601 lower bound (inclusive)
 *   to      ISO-8601 upper bound (inclusive)
 *   limit   max rows (defaults 1000, capped 10000)
 *   source  "dine-in" | "pos" — scopes the read for the admin monitoring
 *           boards. dine-in = fulfillment "dine-in"; pos = the POS counter
 *           mirror (the shared pos-walk-in customer, collection fulfillment).
 *           Omitted → all orders (existing behaviour for Finance Reports).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

const POS_CUSTOMER_ID = "pos-walk-in";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");
  const source = searchParams.get("source");
  const limit  = Math.min(Number(searchParams.get("limit") ?? 1000), 10000);

  let q = supabaseAdmin
    .from("orders")
    .select("*, customer:customers(id, name, email, phone)")
    .order("date", { ascending: false })
    .limit(limit);

  if (source === "dine-in") {
    q = q.eq("fulfillment", "dine-in");
  } else if (source === "pos") {
    q = q.eq("customer_id", POS_CUSTOMER_ID).eq("fulfillment", "collection");
  }

  if (from) q = q.gte("date", from);
  if (to)   q = q.lte("date", to);

  const { data, error } = await q;
  if (error) {
    console.error("admin/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, orders: data ?? [] });
}
