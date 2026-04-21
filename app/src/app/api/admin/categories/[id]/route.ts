/**
 * PUT    /api/admin/categories/[id] — update a category
 * DELETE /api/admin/categories/[id] — delete a category (cascades to menu_items)
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

  let body: { name?: string; emoji?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const patch: Record<string, string> = {};
  if (body.name  !== undefined) patch.name  = body.name;
  if (body.emoji !== undefined) patch.emoji = body.emoji;

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

  const { error } = await supabaseAdmin.from("categories").delete().eq("id", id);
  if (error) {
    console.error("admin/categories/[id] DELETE:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
