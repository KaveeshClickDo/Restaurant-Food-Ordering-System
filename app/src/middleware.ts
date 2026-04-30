/**
 * Next.js edge middleware — route protection.
 * Uses the Web Crypto API (Edge-compatible) — NOT Node.js `crypto`.
 *
 * Protected:
 *   /driver/* (except /driver/login) — requires a valid driver_session cookie
 */

import { NextRequest, NextResponse } from "next/server";

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get("driver_session")?.value;
  const validSession = token ? await verifyDriverToken(token) : false;

  if (pathname.startsWith("/driver") && !pathname.startsWith("/driver/login")) {
    // Dashboard and sub-routes require a valid session.
    if (!validSession) {
      return NextResponse.redirect(new URL("/driver/login", req.url));
    }
  }

  if (pathname === "/driver/login" && validSession) {
    // Already authenticated — skip the login page entirely.
    return NextResponse.redirect(new URL("/driver", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/driver", "/driver/:path*"],
};
