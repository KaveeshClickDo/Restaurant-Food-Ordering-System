/**
 * PATCH /api/admin/users/[id]  — update a user
 * DELETE /api/admin/users/[id] — delete a user
 *
 * Body must include `type` to identify which table to touch.
 * Requires admin authentication.
 */

import { NextRequest, NextResponse }                   from "next/server";
import { supabaseAdmin }                               from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse }  from "@/lib/adminAuth";
import type { AdminSettings, WaiterStaff }             from "@/types";

// ── PATCH ─────────────────────────────────────────────────────────────────────

interface PatchBody {
  type?: string;
  name?: string;
  email?: string;
  phone?: string;
  active?: boolean;
  waiterRole?: "senior" | "waiter";
  avatarColor?: string;
  vehicleInfo?: string;
  notes?: string;
  pin?: string;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { id } = await context.params;

  let body: PatchBody;
  try {
    body = await req.json() as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { type, name, email, phone, active, waiterRole, avatarColor, vehicleInfo, notes, pin } = body;

  if (!type) {
    return NextResponse.json({ ok: false, error: "type is required." }, { status: 400 });
  }

  // ── Customer ──────────────────────────────────────────────────────────────
  if (type === "customer") {
    const updates: Record<string, unknown> = {};
    if (name  !== undefined) updates.name  = name.trim();
    if (email !== undefined) updates.email = email.trim().toLowerCase();
    if (phone !== undefined) updates.phone = phone.trim() || null;
    // customers table does not have an `active` column — skip it

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("customers")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  // ── Driver ────────────────────────────────────────────────────────────────
  if (type === "driver") {
    const updates: Record<string, unknown> = {};
    if (name        !== undefined) updates.name         = name.trim();
    if (email       !== undefined) updates.email        = email.trim().toLowerCase();
    if (phone       !== undefined) updates.phone        = phone.trim() || null;
    if (active      !== undefined) updates.active       = active;
    if (vehicleInfo !== undefined) updates.vehicle_info = vehicleInfo.trim() || null;
    if (notes       !== undefined) updates.notes        = notes.trim() || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("drivers")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  // ── Waiter ────────────────────────────────────────────────────────────────
  if (type === "waiter") {
    const { data: settingsRow, error: settingsError } = await supabaseAdmin
      .from("app_settings")
      .select("data")
      .limit(1)
      .single();

    if (settingsError) {
      return NextResponse.json({ ok: false, error: settingsError.message }, { status: 500 });
    }

    const settings = (settingsRow?.data ?? {}) as AdminSettings;
    const waiters  = settings.waiters ?? [];
    const idx      = waiters.findIndex((w: WaiterStaff) => w.id === id);

    if (idx === -1) {
      return NextResponse.json({ ok: false, error: "Waiter not found." }, { status: 404 });
    }

    const current = waiters[idx];
    const updated: WaiterStaff = {
      ...current,
      ...(name        !== undefined && { name: name.trim() }),
      ...(active      !== undefined && { active }),
      ...(waiterRole  !== undefined && { role: waiterRole }),
      ...(avatarColor !== undefined && { avatarColor }),
      ...(pin         !== undefined && { pin }),
    };

    const newWaiters = [...waiters];
    newWaiters[idx]  = updated;

    const { error: upsertError } = await supabaseAdmin
      .from("app_settings")
      .upsert({ data: { ...settings, waiters: newWaiters } });

    if (upsertError) {
      return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  if (type === "admin") {
    return NextResponse.json(
      { ok: false, error: "Admin account cannot be modified via API." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { id } = await context.params;

  let body: { type?: string };
  try {
    body = await req.json() as { type?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { type } = body;

  if (!type) {
    return NextResponse.json({ ok: false, error: "type is required." }, { status: 400 });
  }

  // ── Customer ──────────────────────────────────────────────────────────────
  if (type === "customer") {
    const { error } = await supabaseAdmin
      .from("customers")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Driver ────────────────────────────────────────────────────────────────
  if (type === "driver") {
    const { error } = await supabaseAdmin
      .from("drivers")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Waiter ────────────────────────────────────────────────────────────────
  if (type === "waiter") {
    const { data: settingsRow, error: settingsError } = await supabaseAdmin
      .from("app_settings")
      .select("data")
      .limit(1)
      .single();

    if (settingsError) {
      return NextResponse.json({ ok: false, error: settingsError.message }, { status: 500 });
    }

    const settings = (settingsRow?.data ?? {}) as AdminSettings;
    const waiters  = settings.waiters ?? [];

    const newWaiters = waiters.filter((w: WaiterStaff) => w.id !== id);

    const { error: upsertError } = await supabaseAdmin
      .from("app_settings")
      .upsert({ data: { ...settings, waiters: newWaiters } });

    if (upsertError) {
      return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  if (type === "admin") {
    return NextResponse.json(
      { ok: false, error: "Admin account cannot be deleted via API." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
}
