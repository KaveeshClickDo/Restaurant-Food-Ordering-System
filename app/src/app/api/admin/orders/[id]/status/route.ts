/**
 * PUT /api/admin/orders/[id]/status — update order status
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { sendOrderStatusEmail }                 from "@/lib/emailServer";
import type { OrderStatus }                     from "@/types";
import { parseBody }                            from "@/lib/apiValidation";
import { OrderStatusUpdateSchema }              from "@/lib/schemas/pos";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, OrderStatusUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

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
