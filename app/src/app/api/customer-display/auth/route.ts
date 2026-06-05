/**
 * Customer Display screen auth.
 *
 *   GET    /api/customer-display/auth  — status: { protected, authed }
 *   POST   /api/customer-display/auth  — unlock the screen (sets session cookie)
 *   DELETE /api/customer-display/auth  — log the screen out (clears cookie)
 *
 * The display board (/customer-display) is gated by middleware on a long-lived,
 * never-expiring session cookie. The ONLY thing that logs a screen out is an
 * admin changing/clearing the password (which bumps display_auth.session_version
 * — see getDisplaySession / fetchDisplayAuth in lib/auth).
 *
 * "Stay open until set": when no password is configured, POST auto-grants a
 * session with no password required, so existing screens keep working with zero
 * friction. Once an admin sets a password, the version bump invalidates those
 * open sessions and the screen must enter the password.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  createSessionToken,
  setDisplaySessionCookie,
  clearSessionCookie,
  fetchDisplayAuth,
  getDisplaySession,
  COOKIE_DISPLAY,
  DISPLAY_SESSION_DURATION_MS,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/apiValidation";
import { DisplayLoginSchema } from "@/lib/schemas/auth";

export async function GET() {
  const [{ passwordHash }, session] = await Promise.all([
    fetchDisplayAuth(),
    getDisplaySession(),
  ]);
  const isProtected = passwordHash !== null && passwordHash !== "";
  return NextResponse.json({ ok: true, protected: isProtected, authed: session !== null });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`display-auth:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  const parsed = await parseBody(req, DisplayLoginSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const { passwordHash, sessionVersion } = await fetchDisplayAuth();
  const isProtected = passwordHash !== null && passwordHash !== "";

  if (isProtected) {
    const candidate = parsed.data.password ?? "";
    if (!candidate) {
      return NextResponse.json({ ok: false, error: "Password required." }, { status: 401 });
    }
    const valid = await bcrypt.compare(candidate, passwordHash as string);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
    }
  }
  // Not protected → auto-grant (display stays open). Any supplied password is
  // ignored in that case.

  const token = createSessionToken(
    { id: "display", role: "display", sessionVersion },
    DISPLAY_SESSION_DURATION_MS,
  );
  const res = NextResponse.json({ ok: true });
  setDisplaySessionCookie(res, token);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, COOKIE_DISPLAY);
  return res;
}
