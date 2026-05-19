/**
 * PATCH /api/pos/sales/[id] — void or refund a POS sale.
 *
 * Body: { voidReason, refundMethod, refundAmount }
 *
 * Marks the pos_sales row as voided and also flips the corresponding orders
 * row so the KDS view stays consistent.
 *
 * AUTHZ:
 *   - Requires `canVoidSale` permission on the caller's pos_staff row, OR an
 *     admin session. A bare cashier session is not enough.
 *   - When a refundAmount is supplied, additionally requires `canIssueRefund`.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { parseBody }                 from "@/lib/apiValidation";
import { PosSaleVoidSchema }         from "@/lib/schemas/pos";
import { requirePosPermission }      from "@/lib/posPermissions";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  // Void requires `canVoidSale`. We re-check `canIssueRefund` below when a
  // refund amount is present so refund-without-void or refund-only flows
  // can't be triggered by a void-only operator.
  const voidGate = await requirePosPermission("canVoidSale");
  if (!voidGate.ok) return voidGate.response;
  const actor = voidGate.staff; // null when admin

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });

  const parsed = await parseBody(req, PosSaleVoidSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const reason = body.voidReason;
  const refundMethod = body.refundMethod ?? "none";
  const refundAmount = body.refundAmount && body.refundAmount > 0 ? body.refundAmount : null;

  // Refund-side gate: only managers/admins (canIssueRefund) can move money.
  if (refundAmount !== null) {
    const refundGate = await requirePosPermission("canIssueRefund");
    if (!refundGate.ok) return refundGate.response;
  }

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
      voided_by:   actor?.id ?? "admin",
      void_reason: reason,
      voided_at:   new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true, id: updated.id });
}
