/**
 * POST /api/admin/menu — create a new menu item
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { MenuCreateSchema }                     from "@/lib/schemas/menu";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, MenuCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data as Record<string, unknown>;

  // Meal-period assignments live in the join table, not on menu_items.
  const mealPeriodIds = Array.isArray(body.mealPeriodIds) ? (body.mealPeriodIds as string[]) : [];
  delete body.mealPeriodIds;

  const { error } = await supabaseAdmin.from("menu_items").insert(body);
  if (error) {
    console.error("admin/menu POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (mealPeriodIds.length > 0) {
    const joinRows = mealPeriodIds.map((mpId) => ({
      menu_item_id: body.id as string,
      meal_period_id: mpId,
    }));
    const { error: joinErr } = await supabaseAdmin
      .from("menu_item_meal_periods")
      .insert(joinRows);
    if (joinErr) {
      console.error("admin/menu POST mealPeriods:", joinErr.message);
      return NextResponse.json({ ok: false, error: joinErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
