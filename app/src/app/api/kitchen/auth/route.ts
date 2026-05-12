/**
 * POST /api/kitchen/auth  — PIN login for kitchen staff
 * GET  /api/kitchen/auth  — return current session's staff record
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import type { KitchenStaff }         from "@/types";
import {
  createSessionToken,
  setSessionCookie,
  getKitchenSession,
  COOKIE_KITCHEN,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

async function getKitchenStaff(): Promise<KitchenStaff[]> {
  const { data: row } = await supabaseAdmin
    .from("app_settings").select("data").limit(1).single();
  return row?.data?.kitchenStaff ?? [];
}

// ── POST: authenticate with staffId + PIN ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`kitchen-auth:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  let body: { staffId?: string; pin?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { staffId, pin } = body;
  if (!staffId || !pin) {
    return NextResponse.json({ ok: false, error: "staffId and pin are required." }, { status: 400 });
  }

  try {
    const staff = await getKitchenStaff();
    if (staff.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Kitchen staff not configured. Ask your admin to add staff accounts." },
        { status: 503 },
      );
    }
    const member = staff.find((s) => s.id === staffId && s.active);
    if (!member || member.pin !== pin) {
      return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pin: _p, ...safe } = member;

    const token = createSessionToken({ id: staffId, role: "kitchen" });
    const res   = NextResponse.json({ ok: true, staff: safe });
    setSessionCookie(res, COOKIE_KITCHEN, token);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[kitchen/auth POST]", message);
    return NextResponse.json({ ok: false, error: "Authentication failed. Please try again." }, { status: 500 });
  }
}

// ── GET: return current staff member from session cookie ──────────────────────
export async function GET() {
  const session = await getKitchenSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  try {
    const staff  = await getKitchenStaff();
    const member = staff.find((s) => s.id === session.id);
    if (!member || !member.active) {
      return NextResponse.json({ ok: false, error: "Staff account not found or inactive." }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pin: _p, ...safe } = member;
    return NextResponse.json({ ok: true, staff: safe });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[kitchen/auth GET]", message);
    return NextResponse.json({ ok: false, error: "Failed to fetch staff." }, { status: 500 });
  }
}
