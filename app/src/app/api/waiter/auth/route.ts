/**
 * POST /api/waiter/auth
 * Validates a waiter's PIN against the waiters table (bcrypt-hashed).
 * Sets an httpOnly session cookie on success.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  setSessionCookie,
  COOKIE_WAITER,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/apiValidation";
import { StaffPinLoginSchema } from "@/lib/schemas/auth";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, StaffPinLoginSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { staffId, pin } = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`waiter-auth:${ip}:${staffId}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  try {
    const { data: waiter } = await supabaseAdmin
      .from("waiters")
      .select("id, name, email, role, pin_hash, active, hourly_rate, avatar_color, created_at, session_version")
      .eq("id", staffId)
      .eq("active", true)
      .maybeSingle();

    if (!waiter) {
      return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
    }

    const valid = await bcrypt.compare(pin, waiter.pin_hash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
    }

    // Return the camelCase shape the /waiter UI reads (e.g. `avatarColor` for
    // the header avatar). pin_hash and session_version are never exposed.
    const safe = {
      id:          waiter.id,
      name:        waiter.name,
      email:       waiter.email ?? "",
      role:        waiter.role ?? "waiter",
      active:      waiter.active,
      hourlyRate:  waiter.hourly_rate ?? undefined,
      avatarColor: waiter.avatar_color,
      createdAt:   waiter.created_at,
    };

    const token = createSessionToken({
      id:             staffId,
      role:           "waiter",
      sessionVersion: Number(waiter.session_version ?? 1),
    });
    const res = NextResponse.json({ ok: true, waiter: safe });
    setSessionCookie(res, COOKIE_WAITER, token);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/auth]", message);
    return NextResponse.json({ ok: false, error: "Authentication failed. Please try again." }, { status: 500 });
  }
}
