/**
 * PUT /api/admin/orders/[id]/status — update order status
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { sendOrderStatusEmail }                 from "@/lib/emailServer";
import type { OrderStatus }                     from "@/types";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  let body: { status?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  if (!body.status) {
    return NextResponse.json({ ok: false, error: "'status' is required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({ status: body.status })
    .eq("id", id);

  if (error) {
    console.error("admin/orders/[id]/status PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Fire-and-forget — email failure must never fail the status update response
  sendOrderStatusEmail(id, body.status as OrderStatus).catch((err: unknown) =>
    console.error("[orders] status email:", err instanceof Error ? err.message : err)
  );

  return NextResponse.json({ ok: true });
}
