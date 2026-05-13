/**
 * PATCH  /api/admin/waiters/[id] — update fields; omit `pin` to keep current.
 * DELETE /api/admin/waiters/[id] — remove a waiter.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

const PUBLIC_COLUMNS = "id, name, email, active, hourly_rate, avatar_color, created_at";
const HASH_ROUNDS = 10;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  let body: {
    name?: string; email?: string; pin?: string;
    active?: boolean; hourlyRate?: number; avatarColor?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  // Build patch — only include fields the caller sent.
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined)        patch.name         = body.name.trim();
  if (body.email !== undefined)       patch.email        = body.email.trim().toLowerCase();
  if (body.active !== undefined)      patch.active       = body.active;
  if (body.hourlyRate !== undefined)  patch.hourly_rate  = body.hourlyRate;
  if (body.avatarColor !== undefined) patch.avatar_color = body.avatarColor;

  if (body.pin) {
    if (!/^\d{4,6}$/.test(body.pin)) {
      return NextResponse.json({ ok: false, error: "PIN must be 4–6 digits" }, { status: 400 });
    }
    patch.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);
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
