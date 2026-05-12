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

// ── Driver token: `<exp>|<id>|<role>|<hmac>` signed with AUTH_JWT_SECRET ──────
async function verifyDriverToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "";
    if (!secret) return false;

    const parts = token.split("|");
    if (parts.length !== 4) return false;
    const [exp, id, role, sig] = parts;
    if (role !== "driver") return false;
    if (Date.now() > Number(exp)) return false;

    const data = `${exp}|${id}|${role}`;
    const key  = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf      = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    const expected = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expected === sig;
  } catch {
    return false;
  }
}

// ── POS token: `<exp>|<id>|pos|<hmac>` signed with AUTH_JWT_SECRET ────────────
async function verifyPosToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "";
    if (!secret) return false;

    const parts = token.split("|");
    if (parts.length !== 4) return false;
    const [exp, id, role, sig] = parts;
    if (role !== "pos") return false;
    if (Date.now() > Number(exp)) return false;

    const data = `${exp}|${id}|${role}`;
    const key  = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf      = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    const expected = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expected === sig;
  } catch {
    return false;
  }
}

// ── Kitchen token: `<exp>|<id>|kitchen|<hmac>` signed with AUTH_JWT_SECRET ────
async function verifyKitchenToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "";
    if (!secret) return false;

    const parts = token.split("|");
    if (parts.length !== 4) return false;
    const [exp, id, role, sig] = parts;
    if (role !== "kitchen") return false;
    if (Date.now() > Number(exp)) return false;

    const data = `${exp}|${id}|${role}`;
    const key  = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf      = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    const expected = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expected === sig;
  } catch {
    return false;
  }
}

// ── Admin token: `<exp>|<id>|admin|<hmac>` signed with AUTH_JWT_SECRET ───────
// Unified with the other roles (customer/driver/waiter/kitchen/pos) — uses
// the same secret env var, same wire format, same verification path.
async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "";
    if (!secret) return false;

    const parts = token.split("|");
    if (parts.length !== 4) return false;
    const [exp, id, role, sig] = parts;
    if (role !== "admin") return false;
    if (Date.now() > Number(exp)) return false;

    const data = `${exp}|${id}|${role}`;
    const key  = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf      = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    const expected = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expected === sig;
  } catch {
    return false;
  }
}

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
