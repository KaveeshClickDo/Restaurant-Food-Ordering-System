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
export const COOKIE_DISPLAY  = "customer_display_session";
export const COOKIE_COLLECTION = "collection_session";

export const SESSION_DURATION_MS    = 30 * 24 * 60 * 60 * 1000; // 30 days
export const COOKIE_MAX_AGE         = 30 * 24 * 60 * 60;         // 30 days (seconds)
export const ADMIN_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days (admin sessions shorter)
export const ADMIN_COOKIE_MAX_AGE   = 7 * 24 * 60 * 60;
export const RESET_TOKEN_TTL_MS     = 60 * 60 * 1000;            // 1 hour
// Customer Display screens are unattended kiosks/TVs — their session is meant
// to effectively never expire. The ONLY thing that logs a screen out is an
// admin changing/clearing the display password (which bumps session_version).
// A 10-year lifetime makes the token's `exp` a non-event in practice.
export const DISPLAY_SESSION_DURATION_MS = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years
export const DISPLAY_COOKIE_MAX_AGE      = 10 * 365 * 24 * 60 * 60;        // ~10 years (seconds)

// ── Types ─────────────────────────────────────────────────────────────────────
export type SessionRole = "customer" | "driver" | "waiter" | "kitchen" | "pos" | "admin" | "display" | "collection";

export interface SessionPayload {
  id:   string;
  role: SessionRole;
  /** Embedded session-version stamp; 0 for legacy 4-segment tokens. */
  sessionVersion: number;
}

// Staff roles whose tokens carry a DB-checked session_version. Customer and
// admin tokens skip the DB lookup (different threat model / different code path).
type StaffRole = "driver" | "waiter" | "kitchen" | "pos" | "collection";
const STAFF_TABLE: Record<StaffRole, string> = {
  driver:     "drivers",
  waiter:     "waiters",
  kitchen:    "kitchen_staff",
  pos:        "pos_staff",
  collection: "collection_staff",
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

/** Customer Display cookie — same options but with the ~10-year max-age so the
 *  screen stays signed in indefinitely (until the password changes). */
export function setDisplaySessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_DISPLAY, token, cookieOpts(DISPLAY_COOKIE_MAX_AGE));
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

// Customer session reader. Like the staff reader, it confirms the token's
// embedded session_version still matches the customer row so an admin password
// reset (or account deactivation) invalidates outstanding sessions. Unlike
// staff, it is deliberately LENIENT on a query error (e.g. the `session_version`
// column not yet present on a not-quite-migrated DB): in that case it keeps the
// session valid rather than logging every customer out. Once the column exists,
// a missing row → invalid (deleted account) and active=false → invalid.
async function readCustomerSession(cookieName: string): Promise<SessionPayload | null> {
  const session = await readSession(cookieName);
  if (!session) return null;
  if (session.role !== "customer") return null;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("session_version, active")
    .eq("id", session.id)
    .maybeSingle();

  if (error) return session;        // migration window / transient — fail open
  if (!data) return null;            // account deleted
  if (data.active === false) return null;
  const current = Number(data.session_version ?? 1);
  if (current !== session.sessionVersion) return null;
  return session;
}

// ── Customer Display auth ─────────────────────────────────────────────────────
// The display password lives in the server-only `display_auth` table (id=1),
// never in app_settings.data (which the anon client reads). A null password_hash
// means the display is OPEN (no password set). session_version is bumped by the
// admin set/clear endpoint and is the sole invalidation trigger for display
// sessions, which otherwise never expire.
export async function fetchDisplayAuth(): Promise<{ passwordHash: string | null; sessionVersion: number }> {
  const { data, error } = await supabaseAdmin
    .from("display_auth")
    .select("password_hash, session_version")
    .eq("id", 1)
    .maybeSingle();
  // Missing row / transient error → treat as "open, version 1" so a not-yet-
  // seeded DB doesn't hard-fail the screen.
  if (error || !data) return { passwordHash: null, sessionVersion: 1 };
  return {
    passwordHash:   data.password_hash ?? null,
    sessionVersion: Number(data.session_version ?? 1),
  };
}

/** True when an admin has set a Customer Display password (screen is locked). */
export async function isDisplayProtected(): Promise<boolean> {
  const { passwordHash } = await fetchDisplayAuth();
  return passwordHash !== null && passwordHash !== "";
}

// Display session reader. Validates the signed token, confirms role, and checks
// the embedded session_version against the live display_auth row — so a password
// change/clear (which bumps the version) invalidates every screen on its next
// request. Nothing else expires it.
export async function getDisplaySession(): Promise<SessionPayload | null> {
  const session = await readSession(COOKIE_DISPLAY);
  if (!session || session.role !== "display") return null;
  const { sessionVersion } = await fetchDisplayAuth();
  if (sessionVersion !== session.sessionVersion) return null;
  return session;
}

export const getCustomerSession = () => readCustomerSession(COOKIE_CUSTOMER);
export const getDriverSession   = () => readStaffSession(COOKIE_DRIVER,  "driver");
export const getWaiterSession   = () => readStaffSession(COOKIE_WAITER,  "waiter");
export const getKitchenSession  = () => readStaffSession(COOKIE_KITCHEN, "kitchen");
export const getPosSession      = () => readStaffSession(COOKIE_POS,     "pos");
export const getCollectionSession = () => readStaffSession(COOKIE_COLLECTION, "collection");
export const getAdminSession    = () => readSession(COOKIE_ADMIN);

/**
 * Returns the first valid session across admin + every staff surface, or null.
 *
 * For shared *utility* routes (e.g. POST /api/email) that several operator
 * surfaces legitimately call from their OWN device — each surface carries only
 * its own cookie, so any one of them is sufficient. This is the right gate for
 * a generic capability; it is NOT a substitute for a resource-specific guard
 * (admin data, POS permissions, etc.).
 *
 * Admin is checked first (cookie-only, no DB round-trip). Each staff reader
 * returns null cheaply when its cookie is absent (no DB hit), so on a real
 * single-surface device at most ONE session_version lookup runs.
 */
export async function getAnyStaffSession(): Promise<SessionPayload | null> {
  const admin = await getAdminSession();
  if (admin) return admin;
  const [pos, waiter, kitchen, collection, driver] = await Promise.all([
    getPosSession(),
    getWaiterSession(),
    getKitchenSession(),
    getCollectionSession(),
    getDriverSession(),
  ]);
  return pos ?? waiter ?? kitchen ?? collection ?? driver ?? null;
}

// ── Shared responses ──────────────────────────────────────────────────────────
export const unauthorizedJson = () =>
  NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
