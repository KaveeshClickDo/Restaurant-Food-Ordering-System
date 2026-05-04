/**
 * POST /api/pos/auth — validate a POS staff PIN and issue an httpOnly session cookie.
 *
 * Staff records are stored in app_settings.data.pos_staff (managed via the admin
 * panel → POS Staff section). If no POS staff have been configured the endpoint
 * returns 503 so the caller knows setup is required, rather than falling back to
 * hard-coded seed credentials.
 *
 * The resulting `pos_staff_session` cookie is checked by /api/pos/orders and
 * /api/pos/menu POST handlers so that only authenticated POS terminals can push
 * data into the KDS / menu tables.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  setSessionCookie,
  COOKIE_POS,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

const POS_SESSION_HOURS = 8; // typical shift length

export async function POST(req: NextRequest) {
  let body: { staffId?: string; pin?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { staffId, pin } = body;
  if (!staffId || !pin) {
    return NextResponse.json({ ok: false, error: "staffId and pin are required." }, { status: 400 });
  }

  // Rate-limit per IP + staff ID — prevent PIN brute-force.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`pos-auth:${ip}:${staffId}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  try {
    const { data: row } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();

    const posStaff: Array<{
      id: string; name: string; role: string; pin: string; active: boolean;
    }> = row?.data?.pos_staff ?? [];

    if (posStaff.length === 0) {
      return NextResponse.json(
        { ok: false, error: "POS staff not configured. Add staff accounts via Admin → POS Staff." },
        { status: 503 },
      );
    }

    const member = posStaff.find((s) => s.id === staffId && s.active);
    if (!member || member.pin !== pin) {
      return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
    }

    const token = createSessionToken(
      { id: staffId, role: "pos" },
      POS_SESSION_HOURS * 60 * 60 * 1000,
    );

    const res = NextResponse.json({
      ok: true,
      staff: { id: member.id, name: member.name, role: member.role },
    });
    setSessionCookie(res, COOKIE_POS, token);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[pos/auth]", message);
    return NextResponse.json({ ok: false, error: "Authentication failed. Please try again." }, { status: 500 });
  }
}

/** DELETE /api/pos/auth — clear the POS session cookie (logout). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_POS, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
