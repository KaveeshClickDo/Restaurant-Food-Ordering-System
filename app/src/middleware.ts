/**
 * Next.js edge middleware — route protection.
 * Uses the Web Crypto API (Edge-compatible) — NOT Node.js `crypto`.
 *
 * Protected:
 *   /driver/*  (except /driver/login)   — requires driver_session cookie
 *   /kitchen/* (except /kitchen/login)  — requires kitchen_session OR admin_session
 *   /pos/*     (except /pos/login)      — requires pos_staff_session OR admin_session
 *
 * Not covered (inline login on the page itself, no separate /login route):
 *   /admin/*   — page renders its own login form when /api/admin/auth returns 401
 *   /waiter/*  — page renders its own PIN picker when /api/waiter/auth check fails
 *
 *   Those pages still rely on client-side gating + API-level auth (which is
 *   enforced in every /api/admin/* and /api/waiter/* handler). Promoting them
 *   to middleware-redirected pages requires splitting each into a public
 *   /login subroute and a protected dashboard — tracked separately.
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

const verifyDriverToken  = (t: string) => verifyToken(t, "driver");
const verifyPosToken     = (t: string) => verifyToken(t, "pos");
const verifyKitchenToken = (t: string) => verifyToken(t, "kitchen");
const verifyAdminToken   = (t: string) => verifyToken(t, "admin");

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Driver routes ─────────────────────────────────────────────────────────
  if (pathname.startsWith("/driver")) {
    const token        = req.cookies.get("driver_session")?.value;
    const validDriver  = token ? await verifyDriverToken(token) : false;

    if (!pathname.startsWith("/driver/login") && !validDriver) {
      return NextResponse.redirect(new URL("/driver/login", req.url));
    }
    if (pathname === "/driver/login" && validDriver) {
      return NextResponse.redirect(new URL("/driver", req.url));
    }
  }

  // ── Kitchen routes ────────────────────────────────────────────────────────
  if (pathname.startsWith("/kitchen")) {
    // /kitchen/login is the public entry point — always allow it
    if (pathname.startsWith("/kitchen/login")) {
      return NextResponse.next();
    }

    const kitchenToken = req.cookies.get("kitchen_session")?.value;
    const adminToken   = req.cookies.get("admin_session")?.value;

    const [validKitchen, validAdmin] = await Promise.all([
      kitchenToken ? verifyKitchenToken(kitchenToken) : Promise.resolve(false),
      adminToken   ? verifyAdminToken(adminToken)     : Promise.resolve(false),
    ]);

    if (!validKitchen && !validAdmin) {
      return NextResponse.redirect(new URL("/kitchen/login", req.url));
    }
  }

  // ── POS routes ────────────────────────────────────────────────────────────
  if (pathname.startsWith("/pos")) {
    // /pos/login is the public entry point — always allow it
    if (pathname.startsWith("/pos/login")) {
      return NextResponse.next();
    }

    const posToken   = req.cookies.get("pos_staff_session")?.value;
    const adminToken = req.cookies.get("admin_session")?.value;

    const [validPos, validAdmin] = await Promise.all([
      posToken   ? verifyPosToken(posToken)       : Promise.resolve(false),
      adminToken ? verifyAdminToken(adminToken)   : Promise.resolve(false),
    ]);

    if (!validPos && !validAdmin) {
      return NextResponse.redirect(new URL("/pos/login", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/driver", "/driver/:path*",
    "/kitchen", "/kitchen/:path*",
    "/pos", "/pos/:path*",
  ],
};
