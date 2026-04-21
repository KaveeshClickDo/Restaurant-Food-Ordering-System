/**
 * POST /api/auth/driver
 *
 * Validates driver credentials server-side. Never returns password_hash.
 * Uses the Supabase service role key so RLS does not apply.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password } = body;

  if (!email?.trim() || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("drivers")
    .select("id, name, email, phone, active, vehicle_info, notes, created_at, password_hash")
    .eq("email", email.trim().toLowerCase())
    .single();

  // Return a generic error regardless of whether the account exists
  // to avoid leaking information about which emails are registered.
  if (error || !data) {
    return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
  }

  if (!data.active) {
    return NextResponse.json({ ok: false, error: "Your account has been deactivated." }, { status: 403 });
  }

  const valid = await bcrypt.compare(password, data.password_hash);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
  }

  // Return the driver without password_hash
  return NextResponse.json({
    ok: true,
    driver: {
      id:          data.id,
      name:        data.name,
      email:       data.email,
      phone:       data.phone ?? "",
      active:      data.active,
      vehicleInfo: data.vehicle_info || undefined,
      notes:       data.notes       || undefined,
      createdAt:   typeof data.created_at === "string"
                     ? data.created_at
                     : new Date(data.created_at).toISOString(),
    },
  });
}
