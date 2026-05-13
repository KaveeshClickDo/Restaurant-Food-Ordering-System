/**
 * PATCH  /api/pos/staff/[id] — update fields; omit `pin` to keep current.
 * DELETE /api/pos/staff/[id] — remove a staff member.
 *
 * Caller must be a logged-in admin OR a POS staff member with
 * permissions.canManageStaff.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getPosSession } from "@/lib/auth";
import { ROLE_PERMISSIONS, type POSRole } from "@/types/pos";

const HASH_ROUNDS = 10;

async function canManageStaff(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const session = await getPosSession();
  if (!session) return false;
  const { data } = await supabaseAdmin
    .from("pos_staff").select("permissions, active").eq("id", session.id).maybeSingle();
  return Boolean(data?.active && data?.permissions?.canManageStaff);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await canManageStaff()) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: {
    name?: string; email?: string; role?: POSRole; pin?: string;
    active?: boolean; permissions?: Record<string, boolean>;
    hourlyRate?: number; avatarColor?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if (body.name        !== undefined) patch.name         = body.name.trim();
  if (body.email       !== undefined) patch.email        = body.email.trim().toLowerCase();
  if (body.active      !== undefined) patch.active       = body.active;
  if (body.hourlyRate  !== undefined) patch.hourly_rate  = body.hourlyRate;
  if (body.avatarColor !== undefined) patch.avatar_color = body.avatarColor;
  if (body.permissions !== undefined) patch.permissions  = body.permissions;
  if (body.role        !== undefined) {
    if (!["admin", "manager", "cashier"].includes(body.role)) {
      return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
    }
    patch.role = body.role;
    // If permissions wasn't explicitly sent alongside, re-apply the role's
    // default permission map so dropping role->cashier actually downgrades.
    if (body.permissions === undefined) patch.permissions = ROLE_PERMISSIONS[body.role];
  }
  if (body.pin) {
    if (!/^\d{4}$/.test(body.pin)) {
      return NextResponse.json({ ok: false, error: "PIN must be 4 digits" }, { status: 400 });
    }
    patch.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("pos_staff").update(patch).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await canManageStaff()) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const { error } = await supabaseAdmin.from("pos_staff").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
