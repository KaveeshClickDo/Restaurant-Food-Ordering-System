/**
 * GET  /api/auth/driver — verifies the driver_session cookie (used by AppContext on init).
 * POST /api/auth/driver — validates driver credentials and sets session cookie.
 */

import { NextResponse }  from "next/server";
import bcrypt            from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  setSessionCookie,
  COOKIE_DRIVER,
  getDriverSession,
} from "@/lib/auth";

export async function GET() {
  const session = await getDriverSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true });
}

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

  try {
    const { data, error } = await supabaseAdmin
      .from("drivers")
      .select("id, name, email, phone, active, vehicle_info, notes, created_at, password_hash")
      .eq("email", email.trim().toLowerCase())
      .single();

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

    const driver = {
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
    };

    const token = createSessionToken({ id: data.id, role: "driver" });
    const res = NextResponse.json({ ok: true, driver });
    setSessionCookie(res, COOKIE_DRIVER, token);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[auth/driver]", message);
    return NextResponse.json({ ok: false, error: "Authentication failed. Please try again." }, { status: 500 });
  }
}
