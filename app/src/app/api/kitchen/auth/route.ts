/**
 * POST /api/kitchen/auth  — password login for kitchen staff (bcrypt-hashed)
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
import { StaffPasswordLoginSchema } from "@/lib/schemas/auth";

const PUBLIC_COLUMNS = "id, name, email, role, active, avatar_color, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStaff(row: any) {
  return {
    id:          row.id,
    name:        row.name,
    role:        row.role,
    active:      row.active,
    avatarColor: row.avatar_color,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`kitchen-auth:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  const parsed = await parseBody(req, StaffPasswordLoginSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { staffId, password } = parsed.data;

  try {
    const { data: member } = await supabaseAdmin
      .from("kitchen_staff")
      .select(`${PUBLIC_COLUMNS}, password_hash, session_version`)
      .eq("id", staffId)
      .eq("active", true)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
    }

    if (!member.password_hash) {
      return NextResponse.json(
        { ok: false, error: "No password set for this account. Ask your admin to set one." },
        { status: 403 },
      );
    }

    const valid = await bcrypt.compare(password, member.password_hash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
    }

    const token = createSessionToken({
      id:             staffId,
      role:           "kitchen",
      sessionVersion: Number(member.session_version ?? 1),
    });
    const res   = NextResponse.json({ ok: true, staff: mapStaff(member) });
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
    return NextResponse.json({ ok: true, staff: mapStaff(member) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[kitchen/auth GET]", message);
    return NextResponse.json({ ok: false, error: "Failed to fetch staff." }, { status: 500 });
  }
}
