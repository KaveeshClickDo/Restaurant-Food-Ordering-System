/**
 * PATCH  /api/pos/staff/[id] — update fields; omit `password` to keep current.
 * DELETE /api/pos/staff/[id] — remove a staff member.
 *
 * Caller must be a POS staff member with permissions.canManageStaff. The admin
 * panel manages POS staff via /api/admin/pos, so there is no admin bypass here —
 * which means role/permission elevation and admin-row edits are not possible on
 * this POS route at all.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPosSession } from "@/lib/auth";
import { ROLE_PERMISSIONS } from "@/types/pos";
import { parseBody } from "@/lib/apiValidation";
import { PosStaffUpdateSchema } from "@/lib/schemas/staff";

const HASH_ROUNDS = 10;

interface ManageStaffContext {
  posSessionId: string;    // pos_staff.id of the calling manager
}

async function manageStaffContext(): Promise<ManageStaffContext | null> {
  const session = await getPosSession();
  if (!session) return null;
  const { data } = await supabaseAdmin
    .from("pos_staff").select("permissions, active").eq("id", session.id).maybeSingle();
  if (!data?.active || !data.permissions?.canManageStaff) return null;
  return { posSessionId: session.id };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await manageStaffContext();
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // F-INS-6: a POS manager cannot edit their own row (no self-permission-grant),
  // cannot edit a POS-admin row, and cannot mutate `permissions` or `role` on
  // anyone — those changes require the website-admin panel (/api/admin/pos).
  if (id === ctx.posSessionId) {
    return NextResponse.json(
      { ok: false, error: "Managers cannot edit their own staff record. Ask an admin." },
      { status: 403 },
    );
  }
  {
    const { data: target } = await supabaseAdmin
      .from("pos_staff").select("role").eq("id", id).maybeSingle();
    if (target?.role === "admin") {
      return NextResponse.json(
        { ok: false, error: "Managers cannot edit admin staff. Ask an admin." },
        { status: 403 },
      );
    }
  }

  const parsed = await parseBody(req, PosStaffUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  if (body.permissions !== undefined || body.role !== undefined) {
    return NextResponse.json(
      { ok: false, error: "Only an admin can change role or permissions." },
      { status: 403 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (body.name        !== undefined) patch.name         = body.name;
  if (body.email       !== undefined) patch.email        = body.email ? body.email.toLowerCase() : "";
  if (body.active      !== undefined) patch.active       = body.active;
  if (body.hourlyRate  !== undefined) patch.hourly_rate  = body.hourlyRate;
  if (body.avatarColor !== undefined) patch.avatar_color = body.avatarColor;
  if (body.permissions !== undefined) patch.permissions  = body.permissions;
  if (body.role        !== undefined) {
    patch.role = body.role;
    // If permissions wasn't explicitly sent alongside, re-apply the role's
    // default permission map so dropping role->cashier actually downgrades.
    if (body.permissions === undefined) patch.permissions = ROLE_PERMISSIONS[body.role];
  }
  if (body.password) patch.password_hash = await bcrypt.hash(body.password, HASH_ROUNDS);

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
  const ctx = await manageStaffContext();
  if (!ctx) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Self-deletion is a footgun — refuse it always.
  if (id === ctx.posSessionId) {
    return NextResponse.json(
      { ok: false, error: "Cannot delete your own staff record while signed in." },
      { status: 400 },
    );
  }

  // Last-admin guard: if deleting an admin would leave zero active admins,
  // refuse (admin-tier lockout prevention).
  const { data: target } = await supabaseAdmin
    .from("pos_staff").select("role, active").eq("id", id).maybeSingle();
  if (target?.role === "admin" && target.active) {
    const { count } = await supabaseAdmin
      .from("pos_staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("active", true);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { ok: false, error: "Cannot delete the last active admin. Promote another staff member first." },
        { status: 400 },
      );
    }
  }

  // POS managers cannot delete admin rows.
  if (target?.role === "admin") {
    return NextResponse.json(
      { ok: false, error: "Managers cannot delete admin staff." },
      { status: 403 },
    );
  }

  const { error } = await supabaseAdmin.from("pos_staff").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
