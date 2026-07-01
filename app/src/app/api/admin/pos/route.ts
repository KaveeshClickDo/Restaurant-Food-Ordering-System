/**
 * GET  /api/admin/pos  — list every POS staff member (password_hash excluded).
 * POST /api/admin/pos  — create one; the supplied password is bcrypt-hashed.
 *
 * Admin-only via the admin session cookie. Mirrors /api/admin/waiters and
 * /api/admin/kitchen-staff so the Admin → POS Staff panel no longer depends
 * on the public /api/pos/staff endpoint (which filters to active-only for the
 * /pos login tile picker). The pos_staff table is the source of truth.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { ROLE_PERMISSIONS } from "@/types/pos";
import { parseBody } from "@/lib/apiValidation";
import { PosStaffCreateSchema } from "@/lib/schemas/staff";

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
    password:         "",
    pin:              "",
  };
}

export async function GET() {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  // No active filter — admins see active *and* inactive staff so they can
  // reactivate someone. (The /pos login picker uses /api/pos/staff for that.)
  const { data, error } = await supabaseAdmin
    .from("pos_staff")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, staff: (data ?? []).map(mapRow) });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const parsed = await parseBody(request, PosStaffCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { name, email = "", role = "cashier", password, pin,
          active = true, permissions, hourlyRate, avatarColor } = parsed.data;

  const passwordHash = await bcrypt.hash(password, HASH_ROUNDS);
  const pinHash      = pin ? await bcrypt.hash(pin, HASH_ROUNDS) : null;
  const finalPerms = permissions ?? ROLE_PERMISSIONS[role];

  const { data, error } = await supabaseAdmin
    .from("pos_staff")
    .insert({
      name:         name,
      email:        email ? email.toLowerCase() : "",
      role,
      password_hash:     passwordHash,
      pin_hash:          pinHash,
      active,
      permissions:  finalPerms,
      hourly_rate:  hourlyRate ?? null,
      avatar_color: avatarColor ?? "#7c3aed",
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, staff: mapRow(data) }, { status: 201 });
}
