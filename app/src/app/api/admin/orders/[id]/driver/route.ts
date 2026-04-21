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
