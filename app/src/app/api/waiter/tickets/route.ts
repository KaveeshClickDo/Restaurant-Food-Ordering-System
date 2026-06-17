/**
 * GET /api/waiter/tickets — active dine-in kitchen tickets (rounds) for the
 * /waiter floor: occupancy, kitchen status, and ready-to-serve.
 *
 * One row per round (the original order + each "add more"), distinct from the
 * single `orders` bill that BillView builds/settles. Returned under the `orders`
 * key so the floor's existing parser is unchanged — only the URL differs from
 * the old /api/waiter/orders poll. Requires a waiter session.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireWaiterAuth } from "@/lib/waiterAuth";

const ACTIVE_TICKET_STATUSES = ["pending", "confirmed", "preparing", "ready", "delivered"];

export async function GET() {
  const authError = await requireWaiterAuth();
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("dine_in_tickets")
    .select("id, items, note, status, table_label, table_id, round_no, date, order_id")
    .in("status", ACTIVE_TICKET_STATUSES)
    .order("date", { ascending: false })
    .limit(500);

  if (error) {
    console.error("waiter/tickets GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, orders: data ?? [] });
}
