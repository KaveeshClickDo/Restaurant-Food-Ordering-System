/**
 * PATCH  /api/admin/pos/[id] — update a POS staff member; omit `pin` to keep current.
 * DELETE /api/admin/pos/[id] — delete one.
 *
 * Admin-only via the admin session cookie. Mirrors /api/admin/waiters/[id] and
 * /api/admin/kitchen-staff/[id]; the only POS-specific bit is re-deriving the
 * permission map when `role` changes (and no explicit `permissions` was sent).
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { ROLE_PERMISSIONS } from "@/types/pos";
import { parseBody } from "@/lib/apiValidation";
import { PosStaffUpdateSchema } from "@/lib/schemas/staff";

const HASH_ROUNDS = 10;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, PosStaffUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.name        !== undefined) patch.name         = body.name;
  if (body.email       !== undefined) patch.email        = body.email ? body.email.toLowerCase() : "";
  if (body.active      !== undefined) patch.active       = body.active;
  if (body.hourlyRate  !== undefined) patch.hourly_rate  = body.hourlyRate;
  if (body.avatarColor !== undefined) patch.avatar_color = body.avatarColor;
  if (body.permissions !== undefined) patch.permissions  = body.permissions;
  if (body.role        !== undefined) {
    patch.role = body.role;
    // If permissions wasn't sent alongside, re-apply the role's default map so
    // dropping role→cashier actually downgrades their access.
    if (body.permissions === undefined) patch.permissions = ROLE_PERMISSIONS[body.role];
  }
  if (body.pin) patch.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);

  // Bump session_version on PIN / email change or deactivation so an active
  // POS terminal session is forced through a fresh PIN entry on its next call.
  const credentialsChanged =
    body.pin !== undefined || body.email !== undefined || body.active === false;
  if (credentialsChanged) {
    const { data: current } = await supabaseAdmin
      .from("pos_staff")
      .select("session_version")
      .eq("id", id)
      .maybeSingle();
    patch.session_version = Number(current?.session_version ?? 1) + 1;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("pos_staff").update(patch).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin.from("pos_staff").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
