/**
 * GET /api/loyalty/history?page=N — the logged-in customer's points ledger.
 *
 * Powers the History list on /account?tab=rewards (the +/− lines grouped by
 * month, McDonald's-style) — 20 rows at a time behind a "View more" button,
 * not page-number pagination. Most recent first. `page` defaults to 1;
 * pageSize is fixed at 20 (the amount "View more" loads each time). No row
 * cap beyond that — `totalCount` tells the client whether more rows remain.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";

const PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo   = rangeFrom + PAGE_SIZE - 1;

  const { data, error, count } = await supabaseAdmin
    .from("loyalty_transactions")
    .select("id, type, points, balance_after, order_id, pos_sale_id, reward_id, note, created_at", { count: "exact" })
    .eq("customer_id", session.id)
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo);

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

  // Soonest-expiring live lot, so the account page can warn "X points expire on …".
  // Never-expiring lots (expires_at null) are excluded.
  const { data: lot } = await supabaseAdmin
    .from("loyalty_lots")
    .select("points_remaining, expires_at")
    .eq("customer_id", session.id)
    .gt("points_remaining", 0)
    .not("expires_at", "is", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const nextExpiry = lot
    ? { points: Number(lot.points_remaining), expiresAt: String(lot.expires_at) }
    : null;

  return NextResponse.json({ ok: true, transactions, nextExpiry, page, totalCount: count ?? transactions.length });
}
