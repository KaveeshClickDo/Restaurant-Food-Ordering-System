/**
 * Shared authentication utilities for customer, driver, and waiter sessions.
 * Follows the same HMAC-signed token pattern as adminAuth.ts.
 * Never import this from client components — server-only.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// ── Cookie names ──────────────────────────────────────────────────────────────
export const COOKIE_CUSTOMER = "customer_session";
export const COOKIE_DRIVER   = "driver_session";
export const COOKIE_WAITER   = "waiter_session";
export const COOKIE_KITCHEN  = "kitchen_session";
export const COOKIE_POS      = "pos_staff_session";

export const SESSION_DURATION_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days
export const COOKIE_MAX_AGE       = 30 * 24 * 60 * 60;         // 30 days (seconds)
export const RESET_TOKEN_TTL_MS   = 60 * 60 * 1000;            // 1 hour

// ── Types ─────────────────────────────────────────────────────────────────────
export type SessionRole = "customer" | "driver" | "waiter" | "kitchen" | "pos";

export interface SessionPayload {
  id:   string;
  role: SessionRole;
}

// ── Secret ────────────────────────────────────────────────────────────────────
function getSecret(): string {
  const s = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  if (!s) throw new Error("AUTH_JWT_SECRET env var is not set.");
  return s;
}

// ── Token: `<exp>|<id>|<role>|<hmac>` ────────────────────────────────────────
export function createSessionToken(
  payload: SessionPayload,
  durationMs = SESSION_DURATION_MS,
): string {
  const secret = getSecret();
  const exp    = String(Date.now() + durationMs);
  const data   = `${exp}|${payload.id}|${payload.role}`;
  const sig    = createHmac("sha256", secret).update(data).digest("hex");
  return `${data}|${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split("|");
    if (parts.length !== 4) return null;
    const [exp, id, role, sig] = parts;
    const data     = `${exp}|${id}|${role}`;
    const secret   = getSecret();
    const expected = createHmac("sha256", secret).update(data).digest("hex");
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
    if (Date.now() > Number(exp)) return null;
    return { id, role: role as SessionRole };
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────
const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path:     "/",
  maxAge,
});

export function setSessionCookie(res: NextResponse, name: string, token: string): void {
  res.cookies.set(name, token, cookieOpts(COOKIE_MAX_AGE));
}

export function clearSessionCookie(res: NextResponse, name: string): void {
  res.cookies.set(name, "", cookieOpts(0));
}

// ── Session readers ───────────────────────────────────────────────────────────
async function readSession(cookieName: string): Promise<SessionPayload | null> {
  try {
    const jar   = await cookies();
    const token = jar.get(cookieName)?.value;
    if (!token) return null;
    return verifySessionToken(token);
  } catch {
    return null;
  }
}

export const getCustomerSession = () => readSession(COOKIE_CUSTOMER);
export const getDriverSession   = () => readSession(COOKIE_DRIVER);
export const getWaiterSession   = () => readSession(COOKIE_WAITER);
export const getKitchenSession  = () => readSession(COOKIE_KITCHEN);
export const getPosSession      = () => readSession(COOKIE_POS);

// ── Shared responses ──────────────────────────────────────────────────────────
export const unauthorizedJson = () =>
  NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
