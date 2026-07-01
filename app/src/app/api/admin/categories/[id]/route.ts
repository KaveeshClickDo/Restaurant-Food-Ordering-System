/**
 * PUT    /api/admin/categories/[id] — update a category
 * DELETE /api/admin/categories/[id] — delete a category (cascades to menu_items)
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { CategoryUpdateSchema }                 from "@/lib/schemas/menu";
import { validateCategoryParent, countCategoryChildren, countCategoryItems } from "@/lib/categoryValidation";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, CategoryUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, string | null> = {};
  if (body.name  !== undefined) patch.name  = body.name;
  if (body.emoji !== undefined) patch.emoji = body.emoji;
  // parent_id can legitimately be set to null (converting sub → parent).
  // Validate the proposed parent server-side before persisting.
  if ("parent_id" in body) {
    const parentErr = await validateCategoryParent(id, body.parent_id ?? null);
    if (parentErr) return NextResponse.json({ ok: false, error: parentErr }, { status: 400 });
    patch.parent_id = body.parent_id ?? null;
  }

  const { error } = await supabaseAdmin.from("categories").update(patch).eq("id", id);
  if (error) {
    console.error("admin/categories/[id] PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  // A category can only be deleted when it is EMPTY — no sub-categories and no
  // items. This prevents the FK cascade from silently deleting items and the
  // `on delete set null` from orphaning sub-categories. Mirrors the admin UI
  // guard so the rule holds for direct API calls too.
  const childCount = await countCategoryChildren(id);
  if (childCount > 0) {
    return NextResponse.json(
      { ok: false, error: `Cannot delete: this category has ${childCount} sub-categor${childCount === 1 ? "y" : "ies"}. Move or remove them first.` },
      { status: 409 },
    );
  }

  const itemCount = await countCategoryItems(id);
  if (itemCount > 0) {
    return NextResponse.json(
      { ok: false, error: `Cannot delete: this category has ${itemCount} item${itemCount === 1 ? "" : "s"}. Move or remove them first.` },
      { status: 409 },
    );
  }

  const { error } = await supabaseAdmin.from("categories").delete().eq("id", id);
  if (error) {
    console.error("admin/categories/[id] DELETE:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
