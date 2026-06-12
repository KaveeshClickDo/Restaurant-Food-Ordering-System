/**
 * GET /api/rewards — public reward catalog for the customer site.
 *
 * Returns active rewards whose linked menu item is still live, sorted by
 * points cost, plus the distinct cost tiers (the milestone bar stops).
 * No auth: the catalog is marketing content; balances come from /api/auth/me.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mapRewardRow, REWARD_SELECT } from "@/lib/loyaltyRewards";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("loyalty_rewards")
    .select(REWARD_SELECT)
    .eq("active", true)
    .order("points_cost", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("GET /api/rewards:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Hide rewards whose menu item was deactivated — they can't be fulfilled.
  const rewards = (data ?? []).map(mapRewardRow).filter((r) => r.menuItemActive !== false);

  // Milestone tiers for the progress bar: distinct costs, ascending, max 6.
  const tiers = Array.from(new Set(rewards.map((r) => r.pointsCost)))
    .sort((a, b) => a - b)
    .slice(0, 6);

  return NextResponse.json({ ok: true, rewards, tiers });
}
