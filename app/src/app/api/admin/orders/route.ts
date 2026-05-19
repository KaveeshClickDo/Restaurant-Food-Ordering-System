/**
 * GET /api/admin/orders — admin-gated orders list with optional date range.
 *
 * Replaces the direct `supabase.from("orders").select(...)` call that
 * OnlineReportsPanel used to make from the browser anon client.
 *
 * Query params:
 *   from   ISO-8601 lower bound (inclusive)
 *   to     ISO-8601 upper bound (inclusive)
 *   limit  max rows (defaults 1000, capped 10000)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const from  = searchParams.get("from");
  const to    = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit") ?? 1000), 10000);

  let q = supabaseAdmin
    .from("orders")
    .select("*, customer:customers(id, name, email, phone)")
    .order("date", { ascending: false })
    .limit(limit);

  if (from) q = q.gte("date", from);
  if (to)   q = q.lte("date", to);

  const { data, error } = await q;
  if (error) {
    console.error("admin/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, orders: data ?? [] });
}
