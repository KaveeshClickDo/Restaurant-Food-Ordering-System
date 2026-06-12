/**
 * /api/admin/rewards/[id] — edit / delete a loyalty reward.
 *
 *   PATCH  → update points cost, name/description override, active, ordering.
 *   DELETE → remove the reward from the catalog. Past redemptions keep their
 *            ledger rows (reward_id goes NULL via ON DELETE SET NULL).
 *
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseBody } from "@/lib/apiValidation";
import { LoyaltyRewardUpdateSchema } from "@/lib/schemas/loyalty";
import { mapRewardRow, REWARD_SELECT } from "@/lib/loyaltyRewards";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, LoyaltyRewardUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const updates: Record<string, unknown> = {};
  if (body.menuItemId  !== undefined) updates.menu_item_id = body.menuItemId;
  if (body.name        !== undefined) updates.name         = body.name.trim();
  if (body.description !== undefined) updates.description  = body.description.trim();
  if (body.pointsCost  !== undefined) updates.points_cost  = body.pointsCost;
  if (body.active      !== undefined) updates.active       = body.active;
  if (body.sortOrder   !== undefined) updates.sort_order   = body.sortOrder;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("loyalty_rewards")
    .update(updates)
    .eq("id", id)
    .select(REWARD_SELECT)
    .maybeSingle();

  if (error) {
    console.error(`PATCH /api/admin/rewards/${id}:`, error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Reward not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, reward: mapRewardRow(data) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin.from("loyalty_rewards").delete().eq("id", id);
  if (error) {
    console.error(`DELETE /api/admin/rewards/${id}:`, error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
