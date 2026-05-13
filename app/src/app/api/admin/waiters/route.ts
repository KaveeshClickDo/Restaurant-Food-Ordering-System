/**
 * GET  /api/admin/waiters  — list every waiter (pin_hash excluded).
 * POST /api/admin/waiters  — create a waiter; the supplied PIN is bcrypt-hashed.
 *
 * Replaces the JSONB list at app_settings.data.waiters. Admin-only via the
 * admin session cookie. The waiters table has RLS deny-anon, so the anon key
 * can never read pin_hash even if a request bypassed this route.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

const PUBLIC_COLUMNS = "id, name, email, active, hourly_rate, avatar_color, created_at";
const HASH_ROUNDS = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any) {
  return {
    id:           row.id,
    name:         row.name,
    email:        row.email ?? "",
    active:       row.active,
    hourlyRate:   row.hourly_rate ?? undefined,
    avatarColor:  row.avatar_color,
    createdAt:    typeof row.created_at === "string"
                    ? row.created_at
                    : new Date(row.created_at).toISOString(),
  };
}

export async function GET() {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("waiters")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, waiters: (data ?? []).map(mapRow) });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  let body: {
    name?: string; email?: string; pin?: string;
    active?: boolean; hourlyRate?: number; avatarColor?: string;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { name, email = "", pin, active = true, hourlyRate, avatarColor } = body;

  if (!name?.trim() || !pin || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json(
      { ok: false, error: "Required: name + numeric PIN (4–6 digits)" },
      { status: 400 },
    );
  }

  const pinHash = await bcrypt.hash(pin, HASH_ROUNDS);

  const { data, error } = await supabaseAdmin
    .from("waiters")
    .insert({
      name:         name.trim(),
      email:        email.trim().toLowerCase(),
      pin_hash:     pinHash,
      active,
      hourly_rate:  hourlyRate ?? null,
      avatar_color: avatarColor ?? "#0891b2",
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, waiter: mapRow(data) }, { status: 201 });
}
