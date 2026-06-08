/**
 * Next.js edge middleware — route protection.
 * Uses the Web Crypto API (Edge-compatible) — NOT Node.js `crypto`.
 *
 * Every operator/display surface is gated on its OWN signed session cookie and
 * has its own dedicated /login route. There is NO cross-surface bypass — an
 * admin session does NOT grant access to /kitchen, /pos, /waiter, or the
 * customer display. Each surface requires its own login.
 *
 *   /driver/*           (except /driver/login)            — driver_session
 *   /kitchen/*          (except /kitchen/login)           — kitchen_session
 *   /pos/*             (except /pos/login)               — pos_staff_session
 *   /waiter/*           (except /waiter/login)            — waiter_session
 *   /admin/*            (except /admin/login)             — admin_session
 *   /customer-display/* (except /customer-display/login)  — customer_display_session
 *
 * The middleware only checks signature + expiry + role. Per-session invalidation
 * (staff session_version, the display password version) is enforced downstream
 * at the API layer (lib/auth.ts), where a DB lookup is available — doing it here
 * would force every edge request to read Postgres.
 */

import { NextRequest, NextResponse } from "next/server";

// ── Shared HMAC verify ───────────────────────────────────────────────────────
// Accepts both token formats: legacy 4-segment `<exp>|<id>|<role>|<sig>` and
// the staff-versioned 5-segment `<exp>|<id>|<role>|<sessionVersion>|<sig>`
// introduced for credential-rotation invalidation. The middleware only does
// signature + expiry + role — session_version is validated downstream at the
// API layer (lib/auth.ts) where a DB lookup is available; doing it here
// would force every edge request to read Postgres.
async function verifyToken(token: string, expectedRole: string): Promise<boolean> {
  try {
    const secret = process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "";
    if (!secret) return false;

    const parts = token.split("|");
    let exp: string, role: string, sig: string;
    let signedData: string;
    // The id (and version) segments are part of the signed payload but aren't
    // checked here — only exp, role, and signature are. session_version is
    // validated downstream at the API layer (see header comment).
    if (parts.length === 5) {
      const [e, i, r, v, s] = parts;
      exp = e; role = r; sig = s;
      signedData = `${e}|${i}|${r}|${v}`;
    } else if (parts.length === 4) {
      const [e, i, r, s] = parts;
      exp = e; role = r; sig = s;
      signedData = `${e}|${i}|${r}`;
    } else {
      return false;
    }
    if (role !== expectedRole) return false;
    if (Date.now() > Number(exp)) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf      = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedData));
    const expected = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expected === sig;
  } catch {
    return false;
  }
}

// Generic single-cookie gate: redirect to `loginPath` unless the named cookie
// holds a token valid for `role`.
//
// We deliberately do NOT bounce an already-authenticated visitor off the login
// page here. Middleware only checks the token signature/expiry/role — it can't
// see the DB session_version (staff credential rotation) or the display
// password version. A login→app redirect based on signature alone would
// ping-pong a stale-but-signed cookie: the app page 401s at the API layer and
// sends the client back to /login, which middleware would bounce straight back
// to the app. Each login page instead handles the "already signed in" case
// client-side (it checks the real session and redirects on success).
async function gate(
  req: NextRequest,
  pathname: string,
  loginPath: string,
  cookieName: string,
  role: string,
): Promise<NextResponse | null> {
  if (pathname.startsWith(loginPath)) return null;
  const token = req.cookies.get(cookieName)?.value;
  const valid = token ? await verifyToken(token, role) : false;
  if (!valid) return NextResponse.redirect(new URL(loginPath, req.url));
  return null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Driver routes ─────────────────────────────────────────────────────────
  if (pathname.startsWith("/driver")) {
    const r = await gate(req, pathname, "/driver/login", "driver_session", "driver");
    if (r) return r;
  }

  // ── Kitchen routes ────────────────────────────────────────────────────────
  // Kitchen staff only — no admin bypass.
  if (pathname.startsWith("/kitchen")) {
    const r = await gate(req, pathname, "/kitchen/login", "kitchen_session", "kitchen");
    if (r) return r;
  }

  // ── POS routes ────────────────────────────────────────────────────────────
  // POS staff only — no admin bypass.
  if (pathname.startsWith("/pos")) {
    const r = await gate(req, pathname, "/pos/login", "pos_staff_session", "pos");
    if (r) return r;
  }

  // ── Waiter routes ─────────────────────────────────────────────────────────
  if (pathname.startsWith("/waiter")) {
    const r = await gate(req, pathname, "/waiter/login", "waiter_session", "waiter");
    if (r) return r;
  }

  // ── Collection routes ─────────────────────────────────────────────────────
  // Collection staff only — no admin bypass (admin is accepted at the API layer).
  if (pathname.startsWith("/collection")) {
    const r = await gate(req, pathname, "/collection/login", "collection_session", "collection");
    if (r) return r;
  }

  // ── Admin routes ──────────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    const r = await gate(req, pathname, "/admin/login", "admin_session", "admin");
    if (r) return r;
  }

  // ── Customer Display ──────────────────────────────────────────────────────
  // Gated on the long-lived display session. "Stay open until set" is handled
  // by the login page: when no password is configured it auto-grants a session
  // and redirects straight through, so open screens still work seamlessly.
  if (pathname.startsWith("/customer-display")) {
    const r = await gate(req, pathname, "/customer-display/login", "customer_display_session", "display");
    if (r) return r;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/driver", "/driver/:path*",
    "/kitchen", "/kitchen/:path*",
    "/pos", "/pos/:path*",
    "/waiter", "/waiter/:path*",
    "/collection", "/collection/:path*",
    "/admin", "/admin/:path*",
    "/customer-display", "/customer-display/:path*",
  ],
};
