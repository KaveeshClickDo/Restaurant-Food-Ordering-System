/**
 * /api/admin/rewards — loyalty reward catalog management.
 *
 *   GET  → list ALL rewards (active + inactive) with their menu item joined.
 *   POST → create a reward (point-priced menu item).
 *
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseBody } from "@/lib/apiValidation";
import { LoyaltyRewardCreateSchema } from "@/lib/schemas/loyalty";
import { mapRewardRow, REWARD_SELECT } from "@/lib/loyaltyRewards";

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("loyalty_rewards")
    .select(REWARD_SELECT)
    .order("sort_order", { ascending: true })
    .order("points_cost", { ascending: true });

  if (error) {
    console.error("GET /api/admin/rewards:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rewards: (data ?? []).map(mapRewardRow) });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, LoyaltyRewardCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  // The linked menu item must exist — the FK would reject it anyway, but a
  // clean 400 beats a raw constraint error.
  const { data: menuItem } = await supabaseAdmin
    .from("menu_items").select("id").eq("id", body.menuItemId).maybeSingle();
  if (!menuItem) {
    return NextResponse.json({ ok: false, error: "Menu item not found." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("loyalty_rewards")
    .insert({
      menu_item_id: body.menuItemId,
      name:         body.name?.trim() ?? "",
      description:  body.description?.trim() ?? "",
      points_cost:  body.pointsCost,
      active:       body.active ?? true,
      sort_order:   body.sortOrder ?? 0,
    })
    .select(REWARD_SELECT)
    .single();

  if (error) {
    console.error("POST /api/admin/rewards:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, reward: mapRewardRow(data) });
}
