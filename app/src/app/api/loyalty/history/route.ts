/**
 * GET /api/loyalty/history — the logged-in customer's points ledger.
 *
 * Powers the History list on /account?tab=rewards (the +/− lines grouped by
 * month, McDonald's-style). Most recent first, capped at 100 rows.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();

  const { data, error } = await supabaseAdmin
    .from("loyalty_transactions")
    .select("id, type, points, balance_after, order_id, pos_sale_id, reward_id, note, created_at")
    .eq("customer_id", session.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("GET /api/loyalty/history:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const transactions = (data ?? []).map((r) => ({
    id:           String(r.id),
    type:         String(r.type),
    points:       Number(r.points),
    balanceAfter: Number(r.balance_after),
    orderId:      r.order_id ?? null,
    posSaleId:    r.pos_sale_id ?? null,
    rewardId:     r.reward_id ?? null,
    note:         String(r.note ?? ""),
    createdAt:    typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
  }));

  return NextResponse.json({ ok: true, transactions });
}
