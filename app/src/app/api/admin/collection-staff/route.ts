/**
 * GET  /api/admin/collection-staff  — list every collection staff member.
 * POST /api/admin/collection-staff  — create one; password is bcrypt-hashed.
 *
 * Flat list (no roles). Admin-only. Mirrors /api/admin/kitchen-staff.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { CollectionStaffCreateSchema } from "@/lib/schemas/staff";

const PUBLIC_COLUMNS = "id, name, email, active, avatar_color, created_at";
const HASH_ROUNDS = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any) {
  return {
    id:          row.id,
    name:        row.name,
    email:       row.email ?? "",
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
    .from("collection_staff")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, collectionStaff: (data ?? []).map(mapRow) });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const parsed = await parseBody(request, CollectionStaffCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { name, email = "", password, active = true, avatarColor } = parsed.data;

  const passwordHash = await bcrypt.hash(password, HASH_ROUNDS);

  const { data, error } = await supabaseAdmin
    .from("collection_staff")
    .insert({
      name,
      email:        email ? email.toLowerCase() : "",
      password_hash:     passwordHash,
      active,
      avatar_color: avatarColor ?? "#f97316",
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, collectionStaff: mapRow(data) }, { status: 201 });
}
