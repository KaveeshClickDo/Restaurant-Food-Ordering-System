/**
 * PATCH  /api/admin/kitchen-staff/[id] — update fields; omit `pin` to keep current.
 * DELETE /api/admin/kitchen-staff/[id] — remove a kitchen staff member.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { KitchenStaffUpdateSchema } from "@/lib/schemas/staff";

const HASH_ROUNDS = 10;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, KitchenStaffUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.name        !== undefined) patch.name         = body.name;
  if (body.email       !== undefined) patch.email        = body.email ? body.email.toLowerCase() : "";
  if (body.active      !== undefined) patch.active       = body.active;
  if (body.avatarColor !== undefined) patch.avatar_color = body.avatarColor;
  if (body.role        !== undefined) patch.role         = body.role;
  if (body.pin) patch.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);

  // Bump session_version on PIN / email change or deactivation so the chef's
  // open KDS tab is logged out on its next poll instead of staying authed.
  const credentialsChanged =
    body.pin !== undefined || body.email !== undefined || body.active === false;
  if (credentialsChanged) {
    const { data: current } = await supabaseAdmin
      .from("kitchen_staff")
      .select("session_version")
      .eq("id", id)
      .maybeSingle();
    patch.session_version = Number(current?.session_version ?? 1) + 1;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("kitchen_staff").update(patch).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin.from("kitchen_staff").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
