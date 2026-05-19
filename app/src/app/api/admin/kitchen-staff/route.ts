/**
 * GET  /api/admin/kitchen-staff  — list every kitchen staff member.
 * POST /api/admin/kitchen-staff  — create one; PIN is bcrypt-hashed.
 *
 * Replaces the JSONB list at app_settings.data.kitchenStaff. Admin-only.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { KitchenStaffCreateSchema } from "@/lib/schemas/staff";

const PUBLIC_COLUMNS = "id, name, email, role, active, avatar_color, created_at";
const HASH_ROUNDS = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any) {
  return {
    id:          row.id,
    name:        row.name,
    email:       row.email ?? "",
    role:        row.role,
    active:      row.active,
    avatarColor: row.avatar_color,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
  };
}

export async function GET() {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("kitchen_staff")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, kitchenStaff: (data ?? []).map(mapRow) });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const parsed = await parseBody(request, KitchenStaffCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { name, email = "", role = "chef", pin, active = true, avatarColor } = parsed.data;

  const pinHash = await bcrypt.hash(pin, HASH_ROUNDS);

  const { data, error } = await supabaseAdmin
    .from("kitchen_staff")
    .insert({
      name:         name,
      email:        email ? email.toLowerCase() : "",
      role,
      pin_hash:     pinHash,
      active,
      avatar_color: avatarColor ?? "#dc2626",
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, kitchenStaff: mapRow(data) }, { status: 201 });
}
