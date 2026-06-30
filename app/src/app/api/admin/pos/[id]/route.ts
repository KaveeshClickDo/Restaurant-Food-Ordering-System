/**
 * PATCH  /api/admin/pos/[id] — update a POS staff member; omit `password` to keep current.
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
import { revokeDeviceTokens } from "@/lib/posDeviceToken";

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
  if (body.password) patch.password_hash = await bcrypt.hash(body.password, HASH_ROUNDS);
  if (body.pin)      patch.pin_hash      = await bcrypt.hash(body.pin, HASH_ROUNDS);

  // Bump session_version ONLY on a real credential change — not just because
  // the form re-sent an existing field. Without this guard every harmless edit
  // (name / role / hourly rate / avatar / permissions) signs the cashier out
  // of the POS terminal because the form posts the whole row whether or not
  // anything actually changed.
  const { data: current } = await supabaseAdmin
    .from("pos_staff")
    .select("email, active, session_version")
    .eq("id", id)
    .maybeSingle();

  const currentEmail  = String(current?.email ?? "").toLowerCase();
  const currentActive = current?.active !== false;

  const newEmail     = body.email?.toLowerCase();
  const emailChanged = newEmail !== undefined && newEmail !== currentEmail;
  // body.password / body.pin are only present when the admin typed a new one —
  // POSStaffPanel strips blanks before sending.
  const passwordChanged = body.password !== undefined;
  const pinChanged      = body.pin !== undefined;
  const deactivating = body.active === false && currentActive === true;

  if (emailChanged || passwordChanged || pinChanged || deactivating) {
    patch.session_version = Number(current?.session_version ?? 1) + 1;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("pos_staff").update(patch).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // B2: a credential change or deactivation must also kill this staff's tablet
  // device tokens, so no enrolled device can keep refreshing a session with the
  // old credential — they're forced back to a password login.
  if (passwordChanged || pinChanged || deactivating) {
    await revokeDeviceTokens(id);
  }

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
