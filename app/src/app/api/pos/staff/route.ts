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
import { getPosSession } from "@/lib/auth";
import { ROLE_PERMISSIONS } from "@/types/pos";
import { parseBody } from "@/lib/apiValidation";
import { PosStaffCreateSchema } from "@/lib/schemas/staff";

// Full row — only returned to authenticated managers/admins.
const FULL_COLUMNS = "id, name, email, role, active, permissions, hourly_rate, avatar_color, created_at";
// Tile-picker columns — what the public /pos/login screen needs (no PII, no payroll).
const TILE_COLUMNS = "id, name, role, active, avatar_color";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTileRow(row: any) {
  return {
    id:          row.id,
    name:        row.name,
    role:        row.role,
    active:      row.active,
    avatarColor: row.avatar_color,
    // The login UI expects these keys to exist; return empty so its shape stays.
    email:       "",
    permissions: {},
    hourlyRate:  undefined,
    createdAt:   "",
    pin:         "",
  };
}

/**
 * Returns true when the request carries a POS session whose
 * permissions.canManageStaff flag is true. Used by POST — write path only.
 * The admin panel manages POS staff via /api/admin/pos, so there is no admin
 * bypass here.
 */
async function canManageStaff(): Promise<boolean> {
  const session = await getPosSession();
  if (!session) return false;
  const { data } = await supabaseAdmin
    .from("pos_staff").select("permissions, active").eq("id", session.id).maybeSingle();
  return Boolean(data?.active && data?.permissions?.canManageStaff);
}

export async function GET() {
  try {
    // F-INS-10: public callers (the /pos/login tile picker) get only the
    // minimum fields needed to show name + avatar, AND only active staff —
    // deactivated members must not appear as a login option. Elevated callers
    // (admin / POS manager opening the on-device Staff view) get the full row
    // for ALL staff including inactive ones — they need to see deactivated
    // members to reactivate, audit, or delete them. Mirrors the admin panel
    // at /api/admin/pos.
    const elevated = await canManageStaff();

    let q = supabaseAdmin
      .from("pos_staff")
      .select(elevated ? FULL_COLUMNS : TILE_COLUMNS)
      .order("created_at", { ascending: true });
    if (!elevated) q = q.eq("active", true);
    const { data, error } = await q;

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const mapped = (data ?? []).map(elevated ? mapRow : mapTileRow);
    return NextResponse.json({ ok: true, staff: mapped });
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

  const parsed = await parseBody(request, PosStaffCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  // F-INS-6 (extended): POS managers with canManageStaff can create cashiers,
  // but role/permission elevation must go through the website-admin panel
  // (/api/admin/pos) — otherwise a manager could bootstrap an admin row and
  // self-promote. This POS route therefore only ever creates cashiers.
  if (parsed.data.role && parsed.data.role !== "cashier") {
    return NextResponse.json(
      { ok: false, error: "Only an admin can create manager or admin staff." },
      { status: 403 },
    );
  }
  if (parsed.data.permissions !== undefined) {
    return NextResponse.json(
      { ok: false, error: "Only an admin can set custom permissions." },
      { status: 403 },
    );
  }

  const { name, email = "", role = "cashier", pin,
          active = true, permissions, hourlyRate, avatarColor } = parsed.data;

  const pinHash      = await bcrypt.hash(pin, HASH_ROUNDS);
  const finalPerms   = permissions ?? ROLE_PERMISSIONS[role];
  const finalColor   = avatarColor ?? "#7c3aed";

  const { data, error } = await supabaseAdmin
    .from("pos_staff")
    .insert({
      name:         name,
      email:        email ? email.toLowerCase() : "",
      role,
      pin_hash:     pinHash,
      active,
      permissions:  finalPerms,
      hourly_rate:  hourlyRate ?? null,
      avatar_color: finalColor,
    })
    .select(FULL_COLUMNS)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, staff: mapRow(data) }, { status: 201 });
}
