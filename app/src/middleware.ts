/**
 * Next.js edge middleware — route protection.
 * Uses the Web Crypto API (Edge-compatible) — NOT Node.js `crypto`.
 *
 * Protected:
 *   /driver/*  (except /driver/login)        — requires driver_session cookie
 *   /kitchen/* (except /kitchen/login)        — requires kitchen_session OR admin_session
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

// ── Admin token: `<exp>.<hmac>` signed with ADMIN_JWT_SECRET ─────────────────
async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.ADMIN_JWT_SECRET?.trim() ?? "";
    if (!secret) return false;

    const dot = token.lastIndexOf(".");
    if (dot < 1) return false;
    const exp = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    if (Date.now() > Number(exp)) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf      = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(exp));
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/driver", "/driver/:path*", "/kitchen", "/kitchen/:path*"],
};
