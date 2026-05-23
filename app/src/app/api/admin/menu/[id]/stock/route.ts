/**
 * PUT /api/admin/menu/[id]/stock — dedicated stock writer.
 *
 * The general `PUT /api/admin/menu/[id]` strips stock fields so unrelated
 * edits (name, image, price) can't reset the live counter mid-shift. This
 * route is the single sanctioned place to write `stock_qty`, `stock_status`,
 * and `track_stock`.
 *
 * Two modes — caller picks one:
 *
 *   1. Track-quantity mode  → body: { mode: "qty", stockQty: number }
 *        Writes stock_qty = <value>, track_stock = true, stock_status = null
 *        (cleared so a stale manual status can't accidentally re-take effect
 *        if admin later switches the item off track-quantity).
 *
 *   2. Manual-status mode   → body: { mode: "manual", stockStatus: enum }
 *        Writes stock_status = <value>, track_stock = false, stock_qty = null.
 *
 * Authorisation: admin session, OR a POS session with the canManageMenu
 * permission (POS-admin / manager). POS-admin / manager already manages
 * menu items via the POS settings tab — gating stock to admin-only would
 * mean staff have to switch apps just to mark an item out of stock.
 * Bare cashiers (no canManageMenu) cannot reach this route.
 *
 * The bulk-sync POST /api/pos/menu still strips stock columns: only this
 * targeted endpoint may write them, so a stale POS local snapshot can't
 * overwrite the live counter via a debounced background sync.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { requirePosPermission } from "@/lib/posPermissions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseBody } from "@/lib/apiValidation";

const StockUpdateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode:     z.literal("qty"),
    stockQty: z.number().int().min(0, "Stock quantity cannot be negative."),
  }),
  z.object({
    mode:        z.literal("manual"),
    stockStatus: z.enum(["in_stock", "low_stock", "out_of_stock"]),
  }),
]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Admin cookie OR POS session with canManageMenu. We check admin first
  // because it's the cheaper check (just a cookie read); falls through to
  // the POS gate only when there's no admin session.
  const isAdmin = await isAdminAuthenticated();
  if (!isAdmin) {
    const gate = await requirePosPermission("canManageMenu");
    if (!gate.ok) return gate.response;
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });

  const parsed = await parseBody(req, StockUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  // Build the patch. Mode picks track_stock + which column carries state;
  // the other column is nulled so it can't drift out of the chosen mode.
  const patch =
    body.mode === "qty"
      ? { stock_qty: body.stockQty, track_stock: true,  stock_status: null }
      : { stock_qty: null,          track_stock: false, stock_status: body.stockStatus };

  const { error } = await supabaseAdmin
    .from("menu_items")
    .update(patch)
    .eq("id", id);

  if (error) {
    console.error(`admin/menu/${id}/stock PUT:`, error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
