/**
 * PUT    /api/admin/menu/[id] — update a menu item
 * DELETE /api/admin/menu/[id] — delete a menu item
 * Requires a valid admin session cookie.
 *
 * Stock fields (`stock_qty`, `stock_status`, `track_stock`) are explicitly
 * stripped from the payload here. Live stock is server-authoritative: each
 * sale decrements it via `decrement_stock_atomic`, and admin's stale form
 * snapshot must NOT clobber the live counter when admin re-saves an
 * unrelated field (price, name, image). Stock writes go through
 * /api/admin/menu/[id]/stock instead — that endpoint is the only place
 * admin can set qty / status / track-flag.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { MenuUpdateSchema }                     from "@/lib/schemas/menu";

const STOCK_FIELDS = ["stock_qty", "stock_status", "track_stock"] as const;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, MenuUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data as Record<string, unknown>;

  // Pull meal-period assignments out — they live in the join table, not on menu_items.
  // Only reconcile if the field was actually sent (undefined = "don't touch tags").
  const mealPeriodIdsProvided = Array.isArray(body.mealPeriodIds);
  const mealPeriodIds = mealPeriodIdsProvided ? (body.mealPeriodIds as string[]) : [];
  delete body.mealPeriodIds;

  // Stock is owned by /api/admin/menu/[id]/stock. Strip any stock fields the
  // admin form happens to include so a save of unrelated fields (name, image,
  // price) doesn't reset the live counter that customer/POS sales have been
  // decrementing.
  for (const f of STOCK_FIELDS) delete body[f];

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

  // Fetch the item first to get the image URL
  const { data: item } = await supabaseAdmin
    .from("menu_items")
    .select("image")
    .eq("id", id)
    .single();

    // Delete from db
  const { error } = await supabaseAdmin.from("menu_items").delete().eq("id", id);
  if (error) {
    console.error("admin/menu/[id] DELETE:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Cleanup bucket if image exists
  if (item?.image) {
    const parts = item.image.split("/menu-images/");
    if (parts.length > 1) {
      await supabaseAdmin.storage.from("menu-images").remove([parts[1]]);
    }
  }

  return NextResponse.json({ ok: true });
}
