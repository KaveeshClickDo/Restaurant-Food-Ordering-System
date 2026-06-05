/**
 * GET /api/pos/orders/collection — active online collection orders for the
 * POS pickup queue (CollectionView).
 *
 * Only real online collection orders are returned — POS walk-in mirror rows
 * (customer_id = "pos-walk-in") are excluded; those are settled at the till
 * via pos_sales and handed over on the KDS. Terminal statuses are dropped so
 * the board only shows orders still in play.
 *
 * Requires a POS or admin session.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";

const POS_CUSTOMER_ID = "pos-walk-in";
const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

export async function GET(req: NextRequest) {
  const [pos, admin] = await Promise.all([getPosSession(), isAdminAuthenticated()]);
  if (!pos && !admin) return unauthorizedJson();

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 2000);

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(`
      id, items, total, note, status, payment_method, payment_status,
      date, scheduled_time, customer_id,
      customers ( name, phone )
    `)
    .eq("fulfillment", "collection")
    .neq("customer_id", POS_CUSTOMER_ID)
    .in("status", ACTIVE_STATUSES)
    .order("date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("pos/orders/collection GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orders: data ?? [] });
}
