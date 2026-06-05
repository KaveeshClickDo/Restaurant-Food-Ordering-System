/**
 * PATCH  /api/admin/collection-staff/[id] — update fields; omit `pin` to keep current.
 * DELETE /api/admin/collection-staff/[id] — remove a collection staff member.
 *
 * Mirrors /api/admin/kitchen-staff/[id]. Bumps session_version only on a real
 * credential change (PIN/email) or deactivation, so harmless edits don't sign
 * the operator out of /collection.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { CollectionStaffUpdateSchema } from "@/lib/schemas/staff";

const HASH_ROUNDS = 10;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, CollectionStaffUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.name        !== undefined) patch.name         = body.name;
  if (body.email       !== undefined) patch.email        = body.email ? body.email.toLowerCase() : "";
  if (body.active      !== undefined) patch.active       = body.active;
  if (body.avatarColor !== undefined) patch.avatar_color = body.avatarColor;
  if (body.pin) patch.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);

  const { data: current } = await supabaseAdmin
    .from("collection_staff")
    .select("email, active, session_version")
    .eq("id", id)
    .maybeSingle();

  const currentEmail  = String(current?.email ?? "").toLowerCase();
  const currentActive = current?.active !== false;

  const newEmail     = body.email?.toLowerCase();
  const emailChanged = newEmail !== undefined && newEmail !== currentEmail;
  const pinChanged   = body.pin !== undefined;
  const deactivating = body.active === false && currentActive === true;

  if (emailChanged || pinChanged || deactivating) {
    patch.session_version = Number(current?.session_version ?? 1) + 1;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("collection_staff").update(patch).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin.from("collection_staff").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
