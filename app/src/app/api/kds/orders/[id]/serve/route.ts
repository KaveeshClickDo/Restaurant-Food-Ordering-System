/**
 * PUT /api/kds/orders/[id]/serve
 *
 * Lets kitchen staff mark a ready dine-in ticket as served themselves — the
 * same action the waiter floor's "Served" button performs via
 * /api/waiter/tickets/[id]/serve, just reachable from the kitchen session too
 * (both food-runners and waiters may carry the plates out).
 *
 * Deliberately separate from PUT /api/kds/orders/[id]/status: that route also
 * updates the `orders` table for online/POS tickets, and "served" must never
 * reach `orders.status` (it's a dine-in-only concept — see the waiter route's
 * doc comment). This one only ever touches `dine_in_tickets`.
 *
 * Idempotent: only transitions a ticket that's currently "ready" — a stale
 * double-tap, or a ticket a waiter already served, is a no-op.
 * Requires a kitchen session.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { getKitchenSession }         from "@/lib/auth";

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const kitchenSession = await getKitchenSession();
  if (!kitchenSession) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("dine_in_tickets")
    .update({ status: "served" })
    .eq("id", id)
    .eq("status", "ready");

  if (error) {
    console.error("kds/orders/[id]/serve PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
