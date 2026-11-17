/**
 * PUT /api/waiter/tickets/[id]/serve
 *
 * Marks a ready kitchen ticket as served — the waiter has actually carried the
 * food to the table. Deliberately a status distinct from "delivered": that one
 * means the whole bill was settled/paid, and reusing it here would make a
 * served-but-unpaid ticket vanish from occupancy too (not just the kitchen
 * board). "served" is excluded from the KDS's own ACTIVE_STATUSES (so it still
 * drops off the kitchen board) but kept in the waiter floor's active-ticket
 * list (so the table still reads "Occupied" instead of falling back to Available/Seated)
 *
 * Idempotent: only transitions a ticket that's currently "ready" — a stale
 * double-tap, or a ticket someone else already served, is a no-op.
 * Requires a waiter session.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { requireWaiterAuth }         from "@/lib/waiterAuth";

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireWaiterAuth();
  if (authError) return authError;

  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("dine_in_tickets")
    .update({ status: "served" })
    .eq("id", id)
    .eq("status", "ready");

  if (error) {
    console.error("waiter/tickets/[id]/serve PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
