/**
 * PATCH /api/pos/sales/[id] — void or refund a POS sale.
 *
 * Body: { voidReason, refundMethod, refundAmount }
 *
 * Marks the pos_sales row as voided and also flips the corresponding orders
 * row so the KDS view stays consistent.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { getPosSession }             from "@/lib/auth";
import { parseBody }                 from "@/lib/apiValidation";
import { PosSaleVoidSchema }         from "@/lib/schemas/pos";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getPosSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });

  const parsed = await parseBody(req, PosSaleVoidSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const reason = body.voidReason;
  const refundMethod = body.refundMethod ?? "none";
  const refundAmount = body.refundAmount && body.refundAmount > 0 ? body.refundAmount : null;

  const { data: updated, error } = await supabaseAdmin
    .from("pos_sales")
    .update({
      voided:        true,
      void_reason:   reason,
      voided_at:     new Date().toISOString(),
      refund_method: refundMethod,
      refund_amount: refundAmount,
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ ok: false, error: "Sale not found." }, { status: 404 });
    }
    console.error(`PATCH /api/pos/sales/${id}:`, error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Also flip the KDS-side orders row so kitchen + admin see the void
  // immediately. Failure here is non-fatal — pos_sales is the audit truth.
  await supabaseAdmin
    .from("orders")
    .update({
      status:      "cancelled",
      voided_by:   session.id,
      void_reason: reason,
      voided_at:   new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true, id: updated.id });
}
