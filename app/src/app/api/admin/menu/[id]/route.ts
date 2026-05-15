/**
 * PUT    /api/admin/menu/[id] — update a menu item
 * DELETE /api/admin/menu/[id] — delete a menu item
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  // Pull meal-period assignments out — they live in the join table, not on menu_items.
  // Only reconcile if the field was actually sent (undefined = "don't touch tags").
  const mealPeriodIdsProvided = Array.isArray(body.mealPeriodIds);
  const mealPeriodIds = mealPeriodIdsProvided ? (body.mealPeriodIds as string[]) : [];
  delete body.mealPeriodIds;

  const { error } = await supabaseAdmin.from("menu_items").update(body).eq("id", id);
  if (error) {
    console.error("admin/menu/[id] PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (mealPeriodIdsProvided) {
    // Replace the join rows for this item: delete then re-insert. The set is
    // tiny per item so the round-trip cost is negligible.
    const { error: delErr } = await supabaseAdmin
      .from("menu_item_meal_periods")
      .delete()
      .eq("menu_item_id", id);
    if (delErr) {
      console.error("admin/menu/[id] PUT mealPeriods delete:", delErr.message);
      return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }

    if (mealPeriodIds.length > 0) {
      const joinRows = mealPeriodIds.map((mpId) => ({
        menu_item_id: id,
        meal_period_id: mpId,
      }));
      const { error: insErr } = await supabaseAdmin
        .from("menu_item_meal_periods")
        .insert(joinRows);
      if (insErr) {
        console.error("admin/menu/[id] PUT mealPeriods insert:", insErr.message);
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin.from("menu_items").delete().eq("id", id);
  if (error) {
    console.error("admin/menu/[id] DELETE:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
