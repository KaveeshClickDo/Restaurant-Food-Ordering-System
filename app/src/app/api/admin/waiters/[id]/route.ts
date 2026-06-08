/**
 * PATCH  /api/admin/waiters/[id] — update fields; omit `pin` to keep current.
 * DELETE /api/admin/waiters/[id] — remove a waiter.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { WaiterUpdateSchema } from "@/lib/schemas/staff";

const PUBLIC_COLUMNS = "id, name, email, role, active, hourly_rate, avatar_color, created_at";
const HASH_ROUNDS = 10;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, WaiterUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  // Build patch — only include fields the caller sent.
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined)        patch.name         = body.name;
  if (body.email !== undefined)       patch.email        = body.email ? body.email.toLowerCase() : "";
  if (body.role !== undefined)        patch.role         = body.role;
  if (body.active !== undefined)      patch.active       = body.active;
  if (body.hourlyRate !== undefined)  patch.hourly_rate  = body.hourlyRate;
  if (body.avatarColor !== undefined) patch.avatar_color = body.avatarColor;

  if (body.pin) {
    patch.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);
  }

  // Bump session_version ONLY on a real credential change — not just because
  // the form re-sent an existing field. Without this guard every harmless edit
  // (name / role / hourly rate / avatar) signs the waiter out of their tablet
  // because the form posts the whole row whether or not anything actually changed.
  const { data: current } = await supabaseAdmin
    .from("waiters")
    .select("email, active, session_version")
    .eq("id", id)
    .maybeSingle();

  const currentEmail  = String(current?.email ?? "").toLowerCase();
  const currentActive = current?.active !== false;

  const newEmail     = body.email?.toLowerCase();
  const emailChanged = newEmail !== undefined && newEmail !== currentEmail;
  // body.pin is only present when the admin typed a new one — WaitersPanel
  // strips a blank pin before sending.
  const pinChanged   = body.pin !== undefined;
  const deactivating = body.active === false && currentActive === true;

  if (emailChanged || pinChanged || deactivating) {
    patch.session_version = Number(current?.session_version ?? 1) + 1;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("waiters")
    .update(patch)
    .eq("id", id)
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ ok: false, error: "Not found" },   { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin.from("waiters").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
