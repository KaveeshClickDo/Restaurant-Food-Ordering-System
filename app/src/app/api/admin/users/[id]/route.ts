/**
 * PATCH  /api/admin/users/[id] — update a user (body.type selects the table)
 * DELETE /api/admin/users/[id] — delete a user (body.type selects the table)
 *
 * Dispatches by `type` to the right table:
 *   customer  → customers
 *   driver    → drivers
 *   waiter    → waiters
 *   kitchen   → kitchen_staff
 *   pos       → pos_staff
 *
 * Admin auth required. PINs are bcrypt-hashed; omitting `pin` keeps the
 * existing hash.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt                         from "bcryptjs";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { ROLE_PERMISSIONS, type POSRole } from "@/types/pos";

const HASH_ROUNDS = 10;

interface PatchBody {
  type?: string;
  name?: string;
  email?: string;
  phone?: string;
  active?: boolean;
  waiterRole?: "senior" | "waiter";
  kitchenRole?: "chef" | "head_chef" | "kitchen_manager";
  posRole?: POSRole;
  avatarColor?: string;
  hourlyRate?: number;
  vehicleInfo?: string;
  notes?: string;
  pin?: string;
}

async function hashPin(pin: string, allow6: boolean): Promise<string | { error: string }> {
  const re = allow6 ? /^\d{4,6}$/ : /^\d{4}$/;
  if (!re.test(pin)) {
    return { error: allow6 ? "PIN must be 4–6 digits" : "PIN must be exactly 4 digits" };
  }
  return bcrypt.hash(pin, HASH_ROUNDS);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await context.params;

  let body: PatchBody;
  try { body = await req.json() as PatchBody; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { type } = body;
  if (!type) return NextResponse.json({ ok: false, error: "type is required." }, { status: 400 });

  // ── Customer ────────────────────────────────────────────────────────────────
  if (type === "customer") {
    const updates: Record<string, unknown> = {};
    if (body.name  !== undefined) updates.name  = body.name.trim();
    if (body.email !== undefined) updates.email = body.email.trim().toLowerCase();
    if (body.phone !== undefined) updates.phone = body.phone.trim() || null;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("customers").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Driver ──────────────────────────────────────────────────────────────────
  if (type === "driver") {
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name         = body.name.trim();
    if (body.email       !== undefined) updates.email        = body.email.trim().toLowerCase();
    if (body.phone       !== undefined) updates.phone        = body.phone.trim() || null;
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.vehicleInfo !== undefined) updates.vehicle_info = body.vehicleInfo.trim() || null;
    if (body.notes       !== undefined) updates.notes        = body.notes.trim() || null;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("drivers").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Waiter ──────────────────────────────────────────────────────────────────
  if (type === "waiter") {
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name         = body.name.trim();
    if (body.email       !== undefined) updates.email        = body.email.trim().toLowerCase();
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.avatarColor !== undefined) updates.avatar_color = body.avatarColor;
    if (body.hourlyRate  !== undefined) updates.hourly_rate  = body.hourlyRate;
    if (body.pin) {
      const r = await hashPin(body.pin, true);
      if (typeof r !== "string") return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      updates.pin_hash = r;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("waiters").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Kitchen staff ───────────────────────────────────────────────────────────
  if (type === "kitchen") {
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name         = body.name.trim();
    if (body.email       !== undefined) updates.email        = body.email.trim().toLowerCase();
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.avatarColor !== undefined) updates.avatar_color = body.avatarColor;
    if (body.kitchenRole !== undefined) {
      if (!["chef", "head_chef", "kitchen_manager"].includes(body.kitchenRole)) {
        return NextResponse.json({ ok: false, error: "Invalid kitchen role." }, { status: 400 });
      }
      updates.role = body.kitchenRole;
    }
    if (body.pin) {
      const r = await hashPin(body.pin, true);
      if (typeof r !== "string") return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      updates.pin_hash = r;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("kitchen_staff").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── POS staff ───────────────────────────────────────────────────────────────
  if (type === "pos") {
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name         = body.name.trim();
    if (body.email       !== undefined) updates.email        = body.email.trim().toLowerCase();
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.avatarColor !== undefined) updates.avatar_color = body.avatarColor;
    if (body.hourlyRate  !== undefined) updates.hourly_rate  = body.hourlyRate;
    if (body.posRole     !== undefined) {
      if (!["admin", "manager", "cashier"].includes(body.posRole)) {
        return NextResponse.json({ ok: false, error: "Invalid POS role." }, { status: 400 });
      }
      updates.role        = body.posRole;
      updates.permissions = ROLE_PERMISSIONS[body.posRole];
    }
    if (body.pin) {
      const r = await hashPin(body.pin, false);
      if (typeof r !== "string") return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      updates.pin_hash = r;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("pos_staff").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Admin ───────────────────────────────────────────────────────────────────
  if (type === "admin") {
    return NextResponse.json(
      { ok: false, error: "Admin account cannot be modified via API." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await context.params;

  let body: { type?: string };
  try { body = await req.json() as { type?: string }; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { type } = body;
  if (!type) return NextResponse.json({ ok: false, error: "type is required." }, { status: 400 });

  const tableForType: Record<string, string | undefined> = {
    customer: "customers",
    driver:   "drivers",
    waiter:   "waiters",
    kitchen:  "kitchen_staff",
    pos:      "pos_staff",
  };

  const table = tableForType[type];
  if (!table) {
    if (type === "admin") {
      return NextResponse.json(
        { ok: false, error: "Admin account cannot be deleted via API." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
