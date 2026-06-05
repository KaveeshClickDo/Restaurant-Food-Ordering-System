/**
 * GET /api/admin/pos-sales?from=ISO&to=ISO&limit=N
 * Admin-only POS sales feed for the POS Reports panel. Returns ALL sales
 * (every cashier) — admin reporting is never scoped to a single operator.
 *
 * This is the admin-session equivalent of /api/pos/sales (which is gated on a
 * POS session). The admin dashboard reads its own admin route rather than the
 * POS route, so there is no cross-surface auth bypass.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToSale } from "@/lib/posSaleMap";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const from  = searchParams.get("from");
  const to    = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit") ?? 1000), 5000);

  let q = supabaseAdmin
    .from("pos_sales")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit);

  if (from) q = q.gte("date", from);
  if (to)   q = q.lte("date", to);

  const { data, error } = await q;
  if (error) {
    console.error("GET /api/admin/pos-sales:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sales: (data ?? []).map(rowToSale) });
}
