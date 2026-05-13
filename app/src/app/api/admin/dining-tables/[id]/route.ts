/**
 * PATCH  /api/admin/dining-tables/[id] — update a table.
 * DELETE /api/admin/dining-tables/[id] — remove a table.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  let body: {
    label?: string; number?: number | null; seats?: number;
    section?: string; active?: boolean; sortOrder?: number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if (body.label     !== undefined) patch.label      = body.label.trim();
  if (body.number    !== undefined) patch.number     = body.number;
  if (body.seats     !== undefined) patch.seats      = body.seats;
  if (body.section   !== undefined) patch.section    = body.section.trim();
  if (body.active    !== undefined) patch.active     = body.active;
  if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("dining_tables").update(patch).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin.from("dining_tables").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
