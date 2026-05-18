/**
 * PATCH  /api/admin/dining-tables/[id] — update a table.
 * DELETE /api/admin/dining-tables/[id] — remove a table.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { DiningTableUpdateSchema } from "@/lib/schemas/menu";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, DiningTableUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  // Block duplicate labels on rename (case-insensitive, ignoring self).
  if (body.label !== undefined) {
    const trimmedLabel = body.label;
    const { data: existing } = await supabaseAdmin
      .from("dining_tables")
      .select("id")
      .ilike("label", trimmedLabel)
      .neq("id", id)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { ok: false, error: `A table labeled "${trimmedLabel}" already exists. Use a different label.` },
        { status: 409 },
      );
    }
    body.label = trimmedLabel;
  }

  const patch: Record<string, unknown> = {};
  if (body.label     !== undefined) patch.label      = body.label;
  if (body.number    !== undefined) patch.number     = body.number;
  if (body.seats     !== undefined) patch.seats      = body.seats;
  if (body.section   !== undefined) patch.section    = body.section?.trim() ?? "";
  if (body.active    !== undefined) patch.active     = body.active;
  if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("dining_tables").update(patch).eq("id", id);
  if (error) {
    // 23505 = unique_violation on dining_tables_label_unique.
    if (error.code === "23505" || error.message?.includes("dining_tables_label_unique")) {
      return NextResponse.json(
        { ok: false, error: "Another table already uses this label." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  // Refuse hard-delete when the table has reservations referencing it. There
  // is no FK constraint (table_id is just `text`), so deletion would silently
  // orphan history. Direct admins to deactivate instead, which preserves data.
  const { count, error: countErr } = await supabaseAdmin
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("table_id", id);

  if (countErr && !countErr.message?.includes("schema cache") && !countErr.message?.includes("not found")) {
    return NextResponse.json({ ok: false, error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `This table has ${count} reservation${count === 1 ? "" : "s"} on record. Deactivate it instead to hide it from new bookings while preserving history.`,
      },
      { status: 409 },
    );
  }

  const { error } = await supabaseAdmin.from("dining_tables").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
