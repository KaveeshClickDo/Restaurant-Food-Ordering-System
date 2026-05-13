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

export async function POST(req: NextRequest) {
  let body: { staffId?: string; pin?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { staffId, pin } = body;
  if (!staffId || !pin) {
    return NextResponse.json({ ok: false, error: "staffId and pin are required." }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`waiter-auth:${ip}:${staffId}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  try {
    const { data: waiter } = await supabaseAdmin
      .from("waiters")
      .select("id, name, email, pin_hash, active, hourly_rate, avatar_color, created_at")
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pin_hash: _h, ...safe } = waiter;

    const token = createSessionToken({ id: staffId, role: "waiter" });
    const res = NextResponse.json({ ok: true, waiter: safe });
    setSessionCookie(res, COOKIE_WAITER, token);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/auth]", message);
    return NextResponse.json({ ok: false, error: "Authentication failed. Please try again." }, { status: 500 });
  }
}
