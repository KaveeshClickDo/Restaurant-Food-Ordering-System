/**
 * GET  /api/admin/drivers  — return all drivers (password_hash excluded)
 * POST /api/admin/drivers  — create a driver (password hashed with bcrypt)
 *
 * Uses the Supabase service role key — runs on the server only.
 * Drivers table must have RLS enabled with no public SELECT policy so the
 * anon key cannot read it.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Driver } from "@/types";

// Columns returned to the client — password_hash is never included.
const PUBLIC_COLUMNS = "id, name, email, phone, active, vehicle_info, notes, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Driver {
  return {
    id:          row.id,
    name:        row.name,
    email:       row.email,
    phone:       row.phone ?? "",
    active:      row.active,
    vehicleInfo: row.vehicle_info || undefined,
    notes:       row.notes       || undefined,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
  };
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("drivers")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, drivers: (data ?? []).map(mapRow) });
}

export async function POST(request: Request) {
  let body: { name?: string; email?: string; phone?: string; password?: string; active?: boolean; vehicleInfo?: string; notes?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email, phone, password, active = true, vehicleInfo, notes } = body;

  if (!name?.trim() || !email?.trim() || !phone?.trim() || !password?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Required: name, email, phone, password" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { data, error } = await supabaseAdmin
    .from("drivers")
    .insert({
      id:            crypto.randomUUID(),
      name:          name.trim(),
      email:         email.trim().toLowerCase(),
      phone:         phone.trim(),
      password_hash: passwordHash,
      active,
      vehicle_info:  vehicleInfo?.trim() || null,
      notes:         notes?.trim()       || null,
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "A driver with this email already exists." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, driver: mapRow(data) }, { status: 201 });
}
