/**
 * POST /api/kitchen/auth  — PIN login for kitchen staff (bcrypt-hashed)
 * GET  /api/kitchen/auth  — return current session's staff record
 *
 * Reads from the kitchen_staff table.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  setSessionCookie,
  getKitchenSession,
  COOKIE_KITCHEN,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/apiValidation";
import { StaffPinLoginSchema } from "@/lib/schemas/auth";

const PUBLIC_COLUMNS = "id, name, email, role, active, created_at";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`kitchen-auth:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  const parsed = await parseBody(req, StaffPinLoginSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { staffId, pin } = parsed.data;

  try {
    const { data: member } = await supabaseAdmin
      .from("kitchen_staff")
      .select(`${PUBLIC_COLUMNS}, pin_hash`)
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pin_hash: _h, ...safe } = member;

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

export async function GET() {
  const session = await getKitchenSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  try {
    const { data: member } = await supabaseAdmin
      .from("kitchen_staff")
      .select(PUBLIC_COLUMNS)
      .eq("id", session.id)
      .eq("active", true)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ ok: false, error: "Staff account not found or inactive." }, { status: 401 });
    }
    return NextResponse.json({ ok: true, staff: member });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[kitchen/auth GET]", message);
    return NextResponse.json({ ok: false, error: "Failed to fetch staff." }, { status: 500 });
  }
}
