/**
 * Admin management of the Customer Display screen password.
 *
 *   GET    /api/admin/display-password — { set: boolean }  (is a password set?)
 *   POST   /api/admin/display-password — set/change the password
 *   DELETE /api/admin/display-password — remove the password (display goes open)
 *
 * Requires a valid admin session. The bcrypt hash lives in the server-only
 * `display_auth` table — never in app_settings.data (the anon client reads that
 * blob). Every mutation bumps session_version, which logs out all live display
 * screens on their next poll (see lib/auth getDisplaySession).
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchDisplayAuth } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { DisplayPasswordSchema } from "@/lib/schemas/auth";

const HASH_ROUNDS = 12;

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { passwordHash } = await fetchDisplayAuth();
  return NextResponse.json({ ok: true, set: passwordHash !== null && passwordHash !== "" });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, DisplayPasswordSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const { sessionVersion } = await fetchDisplayAuth();
  const hash = await bcrypt.hash(parsed.data.password, HASH_ROUNDS);

  const { error } = await supabaseAdmin
    .from("display_auth")
    .upsert({
      id:              1,
      password_hash:   hash,
      session_version: sessionVersion + 1,
      updated_at:      new Date().toISOString(),
    });

  if (error) {
    console.error("admin/display-password POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, set: true });
}

export async function DELETE() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { sessionVersion } = await fetchDisplayAuth();
  const { error } = await supabaseAdmin
    .from("display_auth")
    .upsert({
      id:              1,
      password_hash:   null,
      session_version: sessionVersion + 1,
      updated_at:      new Date().toISOString(),
    });

  if (error) {
    console.error("admin/display-password DELETE:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, set: false });
}
