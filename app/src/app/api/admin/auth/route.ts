/**
 * POST /api/admin/auth  — login (sets httpOnly cookie)
 * GET  /api/admin/auth  — check session status
 * DELETE /api/admin/auth — logout (clears cookie)
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import {
  createAdminToken,
  isAdminAuthenticated,
  COOKIE_MAX_AGE,
  COOKIE_ADMIN,
  misconfiguredResponse,
} from "@/lib/adminAuth";

export async function GET() {
  const ok = await isAdminAuthenticated();
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}

export async function POST(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  if (!adminPassword) {
    return misconfiguredResponse("ADMIN_PASSWORD env var is not set.");
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const candidate = body.password ?? "";

  // Timing-safe comparison via fixed-length sha256 hashes. Hashing both sides
  // first means the comparison buffer is always 32 bytes regardless of the
  // candidate length — closing the length-leak from the previous version
  // (where `a.length === b.length` could be detected by timing or response
  // characteristics).
  const candidateHash = createHash("sha256").update(candidate).digest();
  const storedHash    = createHash("sha256").update(adminPassword).digest();
  const valid = timingSafeEqual(candidateHash, storedHash);

  if (!valid) {
    return NextResponse.json({ ok: false, error: "Invalid password." }, { status: 401 });
  }

  const token = createAdminToken();
  const res   = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_ADMIN, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_ADMIN);
  return res;
}
