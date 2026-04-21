/**
 * Server-side admin authentication helpers.
 * Uses a plaintext ADMIN_PASSWORD from env and HMAC-signed session tokens
 * stored in an httpOnly cookie. Never import this from client code.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME     = "admin_session";
const TOKEN_DURATION  = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
export const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;   // 7 days in seconds

// ── Token helpers ────────────────────────────────────────────────────────────

function getSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "ADMIN_JWT_SECRET env var is not set. Generate a random string (e.g. openssl rand -hex 32) and add it to .env.local.",
    );
  }
  return secret;
}

/** Creates a signed session token: `<expiry_ms>.<hmac_hex>` */
export function createAdminToken(): string {
  const exp     = String(Date.now() + TOKEN_DURATION);
  const sig     = createHmac("sha256", getSecret()).update(exp).digest("hex");
  return `${exp}.${sig}`;
}

/** Returns true if the token is well-formed, correctly signed, and not expired. */
export function verifyAdminToken(token: string): boolean {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return false;
    const exp = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac("sha256", getSecret()).update(exp).digest("hex");
    // Lengths must match before timingSafeEqual
    if (sig.length !== expected.length) return false;
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return false;
    return Date.now() < Number(exp);
  } catch {
    return false;
  }
}

// ── Request-level helpers ────────────────────────────────────────────────────

/** Reads the admin_session cookie and returns true if it contains a valid token. */
export async function isAdminAuthenticated(): Promise<boolean> {
  try {
    const jar   = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
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
