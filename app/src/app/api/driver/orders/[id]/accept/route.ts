/**
 * POST /api/driver/orders/[id]/accept — driver self-assigns an unassigned
 * delivery order to themselves.
 *
 * Guards:
 *   - Requires a valid driver session.
 *   - Order must be fulfillment="delivery", status in (preparing, ready),
 *     and have no driver_id yet (no stealing).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDriverSession, unauthorizedJson } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getDriverSession();
  if (!session) return unauthorizedJson();

  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing order id." }, { status: 400 });

  // Look up the driver name (the orders table also stores it for the KDS view).
  const { data: driverRow } = await supabaseAdmin
    .from("drivers")
    .select("name, active")
    .eq("id", session.id)
    .maybeSingle();
  if (!driverRow?.active) {
    return NextResponse.json({ ok: false, error: "Driver account inactive." }, { status: 403 });
  }

  // Conditional update: only succeed when the order is genuinely unassigned.
  // The .is("driver_id", null) filter blocks the race where another driver
  // claimed the order between the page loading and the click.
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      driver_id:       session.id,
      driver_name:     driverRow.name,
      delivery_status: "assigned",
    })
    .eq("id", id)
    .eq("fulfillment", "delivery")
    .in("status", ["preparing", "ready"])
    .is("driver_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("driver/orders/[id]/accept POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Order is no longer available." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
