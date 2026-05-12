/**
 * Server-side admin authentication helpers.
 *
 * Admin sessions now use the same `<exp>|<id>|<role>|<sig>` token format as
 * every other role (customer, driver, waiter, kitchen, pos), unified in
 * lib/auth.ts. The cookie name (`admin_session`) and 7-day duration are
 * preserved, but the *contents* are the new format — so any admin_session
 * cookies issued before this change will fail verification and force a
 * one-time re-login.
 *
 * The plaintext ADMIN_PASSWORD env var continues to be the credential. A
 * future change will replace it with a per-user `users` table (06-F16),
 * which needs DB schema work and is tracked separately.
 *
 * Never import this from client code.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  verifySessionToken,
  COOKIE_ADMIN,
  ADMIN_SESSION_DURATION_MS,
  ADMIN_COOKIE_MAX_AGE,
  getAdminSession,
} from "@/lib/auth";

export { COOKIE_ADMIN, getAdminSession };
export const COOKIE_MAX_AGE = ADMIN_COOKIE_MAX_AGE; // back-compat re-export

// ── Token helpers ────────────────────────────────────────────────────────────

/**
 * Creates a signed admin session token. Uses the unified format
 * `<exp>|<id>|<role>|<hmac>` from lib/auth.ts.
 *
 * The `id` field is set to the literal "admin" today because the system has a
 * single shared admin credential (ADMIN_PASSWORD). When per-user admins are
 * introduced, this will become the row id from the users table.
 */
export function createAdminToken(): string {
  return createSessionToken({ id: "admin", role: "admin" }, ADMIN_SESSION_DURATION_MS);
}

/** Returns true if the token is well-formed, correctly signed, has role
 *  "admin", and is not expired. */
export function verifyAdminToken(token: string): boolean {
  const payload = verifySessionToken(token);
  return payload !== null && payload.role === "admin";
}

// ── Request-level helpers ────────────────────────────────────────────────────

/** Reads the admin_session cookie and returns true if it contains a valid
 *  admin token. Same signature as before — all 30+ existing callers are
 *  unaffected by the format migration. */
export async function isAdminAuthenticated(): Promise<boolean> {
  try {
    const jar   = await cookies();
    const token = jar.get(COOKIE_ADMIN)?.value;
    if (!token) return false;
    return verifyAdminToken(token);
  } catch {
    return false;
  }
}

/** Short-circuit helper: returns a 401 JSON response. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/** Short-circuit helper: returns a 503 JSON response when a required env var is missing. */
export function misconfiguredResponse(detail: string): NextResponse {
  return NextResponse.json({ ok: false, error: `Server misconfiguration: ${detail}` }, { status: 503 });
}
