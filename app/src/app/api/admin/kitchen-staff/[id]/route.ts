/**
 * PATCH  /api/admin/kitchen-staff/[id] — update fields; omit `pin` to keep current.
 * DELETE /api/admin/kitchen-staff/[id] — remove a kitchen staff member.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

const PUBLIC_COLUMNS = "id, name, email, role, active, avatar_color, created_at";
const HASH_ROUNDS = 10;
const ROLES = ["chef", "head_chef", "kitchen_manager"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  let body: { name?: string; email?: string; role?: string; pin?: string;
              active?: boolean; avatarColor?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if (body.name        !== undefined) patch.name         = body.name.trim();
  if (body.email       !== undefined) patch.email        = body.email.trim().toLowerCase();
  if (body.active      !== undefined) patch.active       = body.active;
  if (body.avatarColor !== undefined) patch.avatar_color = body.avatarColor;
  if (body.role        !== undefined) {
    if (!ROLES.includes(body.role as typeof ROLES[number])) {
      return NextResponse.json(
        { ok: false, error: `Role must be one of: ${ROLES.join(", ")}` },
        { status: 400 },
      );
    }
    patch.role = body.role;
  }
  if (body.pin) {
    if (!/^\d{4,6}$/.test(body.pin)) {
      return NextResponse.json({ ok: false, error: "PIN must be 4–6 digits" }, { status: 400 });
    }
    patch.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);
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
