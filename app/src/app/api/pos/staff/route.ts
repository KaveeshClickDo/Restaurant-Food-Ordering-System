/**
 * GET  /api/pos/staff — list staff (PINs never returned). Public, so the
 *                       /pos/login tile picker works before any session exists.
 * POST /api/pos/staff — create one. Caller must be a logged-in admin OR a
 *                       POS staff member with permissions.canManageStaff.
 *
 * The pos_staff table is the source of truth — PINs are bcrypt-hashed in
 * pin_hash and never leave the server.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getPosSession } from "@/lib/auth";
import { ROLE_PERMISSIONS, type POSRole } from "@/types/pos";

const PUBLIC_COLUMNS = "id, name, email, role, active, permissions, hourly_rate, avatar_color, created_at";
const HASH_ROUNDS = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any) {
  return {
    id:          row.id,
    name:        row.name,
    email:       row.email ?? "",
    role:        row.role,
    active:      row.active,
    permissions: row.permissions ?? {},
    hourlyRate:  row.hourly_rate ?? undefined,
    avatarColor: row.avatar_color,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
    pin:         "",
  };
}

/**
 * Returns true when the request carries either:
 *   • an admin session (admin panel calling), or
 *   • a POS session whose permissions.canManageStaff flag is true.
 * Used by POST/PATCH/DELETE — write paths only.
 */
async function canManageStaff(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const session = await getPosSession();
  if (!session) return false;
  const { data } = await supabaseAdmin
    .from("pos_staff").select("permissions, active").eq("id", session.id).maybeSingle();
  return Boolean(data?.active && data?.permissions?.canManageStaff);
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("pos_staff")
      .select(PUBLIC_COLUMNS)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, staff: (data ?? []).map(mapRow) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[pos/staff GET]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await canManageStaff()) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    name?: string; email?: string; role?: POSRole; pin?: string;
    active?: boolean; permissions?: Record<string, boolean>;
    hourlyRate?: number; avatarColor?: string;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { name, email = "", role = "cashier", pin,
          active = true, permissions, hourlyRate, avatarColor } = body;

  if (!name?.trim() || !pin || !/^\d{4}$/.test(pin)) {
    return NextResponse.json(
      { ok: false, error: "Required: name + 4-digit numeric PIN" },
      { status: 400 },
    );
  }
  if (!["admin", "manager", "cashier"].includes(role)) {
    return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
  }

  const pinHash      = await bcrypt.hash(pin, HASH_ROUNDS);
  const finalPerms   = permissions ?? ROLE_PERMISSIONS[role];
  const finalColor   = avatarColor ?? "#7c3aed";

  const { data, error } = await supabaseAdmin
    .from("pos_staff")
    .insert({
      name:         name.trim(),
      email:        email.trim().toLowerCase(),
      role,
      pin_hash:     pinHash,
      active,
      permissions:  finalPerms,
      hourly_rate:  hourlyRate ?? null,
      avatar_color: finalColor,
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, staff: mapRow(data) }, { status: 201 });
}
