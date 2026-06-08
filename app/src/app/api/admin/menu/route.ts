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

  // Reject duplicate names (case-insensitive). The DB has no unique constraint
  // on name, so two items called "Margherita" would otherwise both be created
  // and confuse customers, the kitchen, and reporting. ilike narrows the scan;
  // the JS compare confirms an exact (case-insensitive) match so names that
  // happen to contain SQL wildcards (% / _) don't yield false positives.
  const newName = String(body.name ?? "").trim();
  if (newName) {
    const { data: dupes } = await supabaseAdmin
      .from("menu_items")
      .select("id, name")
      .ilike("name", newName);
    if ((dupes ?? []).some((r) => String(r.name ?? "").trim().toLowerCase() === newName.toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: `A menu item named "${newName}" already exists.` },
        { status: 409 },
      );
    }
  }

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
