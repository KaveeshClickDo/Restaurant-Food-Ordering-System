/**
 * POST   /api/pos/auth — validate a POS staff PIN and issue a session cookie.
 * DELETE /api/pos/auth — clear the POS session cookie (logout).
 * GET    /api/pos/auth — return the current staff record if the cookie is valid.
 *
 * Reads from the pos_staff table; PINs are bcrypt-hashed in pin_hash and
 * never sent to the browser. POSContext relies on this endpoint to hydrate
 * `currentStaff` from the httpOnly cookie on every page load.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  setSessionCookie,
  getPosSession,
  COOKIE_POS,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/apiValidation";
import { StaffPinLoginSchema } from "@/lib/schemas/auth";

const POS_SESSION_HOURS = 8; // typical shift length
const PUBLIC_COLUMNS = "id, name, email, role, active, permissions, hourly_rate, avatar_color, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStaff(row: any) {
  return {
    id:          row.id,
    name:        row.name,
    email:       row.email ?? "",
    role:        row.role,
    active:      row.active,
    permissions: row.permissions ?? {},
    hourlyRate:  row.hourly_rate ?? undefined,
    avatarColor: row.avatar_color,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, StaffPinLoginSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { staffId, pin } = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`pos-auth:${ip}:${staffId}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  try {
    const { count } = await supabaseAdmin
      .from("pos_staff").select("id", { count: "exact", head: true }).eq("active", true);

    if ((count ?? 0) === 0) {
      return NextResponse.json(
        { ok: false, error: "POS staff not configured. Add staff accounts via Admin → POS Staff." },
        { status: 503 },
      );
    }

    const { data: member } = await supabaseAdmin
      .from("pos_staff")
      .select(`${PUBLIC_COLUMNS}, pin_hash, session_version`)
      .eq("id", staffId)
      .eq("active", true)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
    }

    const valid = await bcrypt.compare(pin, member.pin_hash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
    }

    const token = createSessionToken(
      {
        id:             staffId,
        role:           "pos",
        sessionVersion: Number(member.session_version ?? 1),
      },
      POS_SESSION_HOURS * 60 * 60 * 1000,
    );

    const res = NextResponse.json({ ok: true, staff: mapStaff(member) });
    setSessionCookie(res, COOKIE_POS, token);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[pos/auth POST]", message);
    return NextResponse.json({ ok: false, error: "Authentication failed. Please try again." }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_POS, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}

export async function GET() {
  const session = await getPosSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const { data: member } = await supabaseAdmin
      .from("pos_staff")
      .select(PUBLIC_COLUMNS)
      .eq("id", session.id)
      .eq("active", true)
      .maybeSingle();

    if (!member) return NextResponse.json({ ok: false }, { status: 401 });
    return NextResponse.json({ ok: true, staff: mapStaff(member) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[pos/auth GET]", message);
    return NextResponse.json({ ok: false, error: "Failed to fetch staff." }, { status: 500 });
  }
}
