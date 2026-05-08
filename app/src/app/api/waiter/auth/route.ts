/**
 * POST /api/waiter/auth
 * Validates a waiter's PIN against app_settings.
 * Sets an httpOnly session cookie on success.
 * Falls back to seed defaults if no waiters are configured yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import type { WaiterStaff }          from "@/types";
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

  // Rate-limit per IP + staff ID to prevent targeted PIN brute-force.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`waiter-auth:${ip}:${staffId}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  try {
    const { data: row } = await supabaseAdmin
      .from("app_settings").select("data").limit(1).single();

    const waiters: WaiterStaff[] = row?.data?.waiters ?? [];
    if (waiters.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No staff accounts configured. Ask your admin to set up waiter accounts." },
        { status: 401 },
      );
    }

    const waiter = waiters.find((w) => w.id === staffId && w.active);
    if (!waiter || waiter.pin !== pin) {
      return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pin: _p, ...safe } = waiter;

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
