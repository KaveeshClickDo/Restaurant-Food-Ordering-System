/**
 * GET /api/driver/orders — orders relevant to the current driver.
 *
 * Returns:
 *  - orders assigned to this driver (any status), AND
 *  - unassigned delivery orders still in "preparing"/"ready" (available pool).
 *
 * Replaces the prior pattern where the browser anon client read every
 * customer's orders and filtered client-side.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDriverSession, unauthorizedJson } from "@/lib/auth";

export async function GET() {
  const session = await getDriverSession();
  if (!session) return unauthorizedJson();

  // Two queries:
  //  1. Orders assigned to this driver — any status EXCEPT cancelled/refunded
  //     (those were killed by admin/refund flow and the driver must drop them
  //     from their queue; delivered ones still show so today's completions
  //     remain visible).
  //  2. Unassigned delivery orders in preparing/ready — the available pool.
  const [mine, available] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("*, customer:customers(id, name, phone)")
      .eq("driver_id", session.id)
      .not("status", "in", "(cancelled,refunded)")
      .order("date", { ascending: false }),
    supabaseAdmin
      .from("orders")
      .select("*, customer:customers(id, name, phone)")
      .is("driver_id", null)
      .eq("fulfillment", "delivery")
      .in("status", ["preparing", "ready"])
      .order("date", { ascending: true }),
  ]);

  if (mine.error)      return NextResponse.json({ ok: false, error: mine.error.message }, { status: 500 });
  if (available.error) return NextResponse.json({ ok: false, error: available.error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    mine:      mine.data      ?? [],
    available: available.data ?? [],
  });
}
