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
import { restoreStock, type StockItem } from "@/lib/stockMutation";
import type { POSCartItem }          from "@/types/pos";

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

  // Conditionally void: `.eq("voided", false)` makes this a no-op idempotent
  // operation if the sale has already been voided. Returning the items so we
  // know what to restore — but only if this UPDATE was the one that actually
  // changed the row (otherwise we'd double-restore on retries).
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
    .eq("voided", false)
    .select("id, items")
    .maybeSingle();

  if (error) {
    console.error(`PATCH /api/pos/sales/${id}:`, error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // No row matched: either the sale doesn't exist, or it was already voided.
  // Disambiguate with a lookup so the caller gets a sensible status.
  if (!updated) {
    const { data: existing } = await supabaseAdmin
      .from("pos_sales").select("id, voided").eq("id", id).maybeSingle();
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Sale not found." }, { status: 404 });
    }
    // Already voided — idempotent success, no stock restore.
    return NextResponse.json({ ok: true, id: existing.id, alreadyVoided: true });
  }

  // Restore stock for every catalogued line. Best-effort — a failure here just
  // leaves a small under-count that admin can correct manually.
  const items = Array.isArray(updated.items) ? (updated.items as POSCartItem[]) : [];
  const stockItems: StockItem[] = items
    .map((it) => ({ id: it.productId, qty: it.quantity }))
    .filter((i) => i.id);
  restoreStock(stockItems).catch((err) =>
    console.error(`[pos/sales/${id}] stock restore on void:`, err instanceof Error ? err.message : err),
  );

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
