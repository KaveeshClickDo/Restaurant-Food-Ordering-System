/**
 * DELETE /api/pos/menu/[id] — channel-aware POS removal of a menu item.
 *
 * The POS admin owns the `in_store` channel only. So "delete from POS" means:
 *   • Item is on BOTH channels  → drop `in_store`, keep it online. The row
 *     survives; the customer site is unaffected. Admin sees it with the
 *     in-store box unticked and can re-enable it.
 *   • Item is in_store-only      → actually delete the row (nothing online
 *     depends on it). Meal-period join rows cascade away via the FK.
 *
 * Requires `canManageMenu` (admin, or POS-admin/manager with the flag) — the
 * same gate the POS bulk-sync POST uses.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosPermission } from "@/lib/posPermissions";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requirePosPermission("canManageMenu");
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });

  // Look up the item so the server — not the client — decides delete vs. unlist.
  const { data: row, error: lookupErr } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, channels")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr) {
    console.error(`DELETE /api/pos/menu/${id} lookup:`, lookupErr.message);
    return NextResponse.json({ ok: false, error: lookupErr.message }, { status: 500 });
  }
  if (!row) {
    // Already gone — idempotent success so the POS UI can just drop it.
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  // Legacy rows with null/empty channels are treated as "both".
  const channels: string[] = Array.isArray(row.channels) && row.channels.length > 0
    ? row.channels
    : ["in_store", "online"];

  const alsoOnline = channels.includes("online");

  if (alsoOnline) {
    // Keep it online; just take it off the till. Never let channels go empty.
    const next = channels.filter((c) => c !== "in_store");
    const finalChannels = next.length > 0 ? next : ["online"];
    const { error } = await supabaseAdmin
      .from("menu_items")
      .update({ channels: finalChannels })
      .eq("id", id);
    if (error) {
      console.error(`DELETE /api/pos/menu/${id} unlist:`, error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: "removed_from_pos", channels: finalChannels });
  }

  // In-store-only → real delete. menu_item_meal_periods rows cascade.
  const { error } = await supabaseAdmin.from("menu_items").delete().eq("id", id);
  if (error) {
    console.error(`DELETE /api/pos/menu/${id} delete:`, error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: "deleted" });
}
