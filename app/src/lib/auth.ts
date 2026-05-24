/**
 * Shared authentication utilities for customer, driver, and waiter sessions.
 * Follows the same HMAC-signed token pattern as adminAuth.ts.
 * Never import this from client components — server-only.
 *
 * Token format: `<exp>|<id>|<role>|<sessionVersion>|<hmac>`. The legacy
 * 4-segment form `<exp>|<id>|<role>|<hmac>` is decoded as sessionVersion=0
 * so DB rows (default=1) reject old tokens on first request after deploy.
 *
 * Staff sessions (driver/waiter/kitchen/pos) additionally verify the token's
 * sessionVersion against the live DB row. Admin-side credential changes or
 * deactivation bump the column, which immediately invalidates outstanding
 * tokens for that staff member.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ── Cookie names ──────────────────────────────────────────────────────────────
export const COOKIE_CUSTOMER = "customer_session";
export const COOKIE_DRIVER   = "driver_session";
export const COOKIE_WAITER   = "waiter_session";
export const COOKIE_KITCHEN  = "kitchen_session";
export const COOKIE_POS      = "pos_staff_session";
export const COOKIE_ADMIN    = "admin_session";

export const SESSION_DURATION_MS    = 30 * 24 * 60 * 60 * 1000; // 30 days
export const COOKIE_MAX_AGE         = 30 * 24 * 60 * 60;         // 30 days (seconds)
export const ADMIN_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days (admin sessions shorter)
export const ADMIN_COOKIE_MAX_AGE   = 7 * 24 * 60 * 60;
export const RESET_TOKEN_TTL_MS     = 60 * 60 * 1000;            // 1 hour

// ── Types ─────────────────────────────────────────────────────────────────────
export type SessionRole = "customer" | "driver" | "waiter" | "kitchen" | "pos" | "admin";

export interface SessionPayload {
  id:   string;
  role: SessionRole;
  /** Embedded session-version stamp; 0 for legacy 4-segment tokens. */
  sessionVersion: number;
}

// Staff roles whose tokens carry a DB-checked session_version. Customer and
// admin tokens skip the DB lookup (different threat model / different code path).
type StaffRole = "driver" | "waiter" | "kitchen" | "pos";
const STAFF_TABLE: Record<StaffRole, string> = {
  driver:  "drivers",
  waiter:  "waiters",
  kitchen: "kitchen_staff",
  pos:     "pos_staff",
};

// ── Secret ────────────────────────────────────────────────────────────────────
function getSecret(): string {
  const s = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  if (!s) throw new Error("AUTH_JWT_SECRET env var is not set.");
  return s;
}

// ── Token: `<exp>|<id>|<role>|<sessionVersion>|<hmac>` ───────────────────────
export function createSessionToken(
  payload: Omit<SessionPayload, "sessionVersion"> & { sessionVersion?: number },
  durationMs = SESSION_DURATION_MS,
): string {
  const secret  = getSecret();
  const exp     = String(Date.now() + durationMs);
  const version = String(payload.sessionVersion ?? 1);
  const data    = `${exp}|${payload.id}|${payload.role}|${version}`;
  const sig     = createHmac("sha256", secret).update(data).digest("hex");
  return `${data}|${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split("|");
    // Accept both formats; legacy 4-segment tokens carry no version, so we
    // decode sessionVersion=0 — guaranteed to mismatch any staff DB row
    // (default=1) and force a re-login on next request.
    let exp: string, id: string, role: string, version: string, sig: string;
    if (parts.length === 5) {
      [exp, id, role, version, sig] = parts;
    } else if (parts.length === 4) {
      [exp, id, role, sig] = parts;
      version = "0";
    } else {
      return null;
    }
    const signedData = parts.length === 5
      ? `${exp}|${id}|${role}|${version}`
      : `${exp}|${id}|${role}`;
    const secret   = getSecret();
    const expected = createHmac("sha256", secret).update(signedData).digest("hex");
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
    if (Date.now() > Number(exp)) return null;
    const parsedVersion = Number(version);
    if (!Number.isFinite(parsedVersion)) return null;
    return { id, role: role as SessionRole, sessionVersion: parsedVersion };
  } catch {
    return null;
  }
}

// ── Staff session_version helpers ─────────────────────────────────────────────
// Fetch the live session_version for a staff row. Returns null if the row
// is missing (deleted staff) which collapses cleanly into "invalid session".
export async function fetchStaffSessionVersion(
  role: StaffRole,
  id: string,
): Promise<number | null> {
  const table = STAFF_TABLE[role];
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("session_version, active")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  // Inactive staff are also rejected — covers the "deactivate should sign out"
  // bug class without admin needing to also bump session_version manually.
  if (data.active === false) return null;
  return Number(data.session_version ?? 1);
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

// Staff session reader. Adds a DB lookup that confirms the token's embedded
// session_version still matches the staff row (and that the staff row is
// active). Any admin-side credential change or deactivation bumps the column
// or sets active=false, immediately invalidating outstanding sessions.
async function readStaffSession(
  cookieName: string,
  role: StaffRole,
): Promise<SessionPayload | null> {
  const session = await readSession(cookieName);
  if (!session) return null;
  if (session.role !== role) return null;
  const current = await fetchStaffSessionVersion(role, session.id);
  if (current === null) return null;
  if (current !== session.sessionVersion) return null;
  return session;
}

export const getCustomerSession = () => readSession(COOKIE_CUSTOMER);
export const getDriverSession   = () => readStaffSession(COOKIE_DRIVER,  "driver");
export const getWaiterSession   = () => readStaffSession(COOKIE_WAITER,  "waiter");
export const getKitchenSession  = () => readStaffSession(COOKIE_KITCHEN, "kitchen");
export const getPosSession      = () => readStaffSession(COOKIE_POS,     "pos");
export const getAdminSession    = () => readSession(COOKIE_ADMIN);

// ── Shared responses ──────────────────────────────────────────────────────────
export const unauthorizedJson = () =>
  NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
