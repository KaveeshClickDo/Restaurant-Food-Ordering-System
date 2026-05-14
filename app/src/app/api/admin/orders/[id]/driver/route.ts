/**
 * PUT /api/admin/orders/[id]/driver — assign or unassign a driver; update delivery status
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  let body: {
    driver_id:       string;
    driver_name:     string;
    delivery_status: string;
    // Optional: also update order status (e.g. "delivered")
    status?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  // Block advancing delivery beyond "assigned" until the kitchen has marked
  // the order ready. A driver may accept (assign) a preparing order and head
  // to the shop, but pick-up / on-the-way / delivered all require the food
  // to actually be ready. "delivered" is allowed through so idempotent
  // re-marks don't 400.
  const advancing = ["picked_up", "on_the_way", "delivered"].includes(body.delivery_status);
  if (advancing) {
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from("orders")
      .select("status")
      .eq("id", id)
      .single();
    if (fetchErr || !current) {
      return NextResponse.json(
        { ok: false, error: fetchErr?.message ?? "Order not found." },
        { status: 404 },
      );
    }
    if (current.status !== "ready" && current.status !== "delivered") {
      return NextResponse.json(
        { ok: false, error: "Order must be marked ready by the kitchen before pickup or delivery." },
        { status: 400 },
      );
    }
  }

  const patch: Record<string, unknown> = {
    driver_id:       body.driver_id,
    driver_name:     body.driver_name,
    delivery_status: body.delivery_status,
  };
  if (body.status) patch.status = body.status;

  const { error } = await supabaseAdmin.from("orders").update(patch).eq("id", id);
  if (error) {
    console.error("admin/orders/[id]/driver PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
