/**
 * POST   /api/collection/auth — validate a collection-staff PIN, issue a session cookie.
 * DELETE /api/collection/auth — clear the collection session cookie (logout).
 * GET    /api/collection/auth — return the current staff record if the cookie is valid.
 *
 * Reads from the collection_staff table; PINs are bcrypt-hashed in pin_hash and
 * never sent to the browser. Mirrors /api/pos/auth and /api/kitchen/auth.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  setSessionCookie,
  getCollectionSession,
  COOKIE_COLLECTION,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/apiValidation";
import { StaffPinLoginSchema } from "@/lib/schemas/auth";

const COLLECTION_SESSION_HOURS = 8; // typical shift length
const PUBLIC_COLUMNS = "id, name, email, active, avatar_color, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStaff(row: any) {
  return {
    id:          row.id,
    name:        row.name,
    email:       row.email ?? "",
    active:      row.active,
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
  const { limited } = rateLimit(`collection-auth:${ip}:${staffId}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  try {
    const { count } = await supabaseAdmin
      .from("collection_staff").select("id", { count: "exact", head: true }).eq("active", true);

    if ((count ?? 0) === 0) {
      return NextResponse.json(
        { ok: false, error: "Collection staff not configured. Add accounts via Admin → Collection Staff." },
        { status: 503 },
      );
    }

    const { data: member } = await supabaseAdmin
      .from("collection_staff")
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
        role:           "collection",
        sessionVersion: Number(member.session_version ?? 1),
      },
      COLLECTION_SESSION_HOURS * 60 * 60 * 1000,
    );

    const res = NextResponse.json({ ok: true, staff: mapStaff(member) });
    setSessionCookie(res, COOKIE_COLLECTION, token);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[collection/auth POST]", message);
    return NextResponse.json({ ok: false, error: "Authentication failed. Please try again." }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_COLLECTION, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}

export async function GET() {
  const session = await getCollectionSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const { data: member } = await supabaseAdmin
      .from("collection_staff")
      .select(PUBLIC_COLUMNS)
      .eq("id", session.id)
      .eq("active", true)
      .maybeSingle();

    if (!member) return NextResponse.json({ ok: false }, { status: 401 });
    return NextResponse.json({ ok: true, staff: mapStaff(member) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[collection/auth GET]", message);
    return NextResponse.json({ ok: false, error: "Failed to fetch staff." }, { status: 500 });
  }
}
