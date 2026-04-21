/**
 * POST /api/admin/auth  — login (sets httpOnly cookie)
 * GET  /api/admin/auth  — check session status
 * DELETE /api/admin/auth — logout (clears cookie)
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual }          from "crypto";
import {
  createAdminToken,
  isAdminAuthenticated,
  COOKIE_MAX_AGE,
  misconfiguredResponse,
} from "@/lib/adminAuth";

const COOKIE_NAME = "admin_session";

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

  // Timing-safe comparison — pad shorter buffer so lengths match
  const a = Buffer.from(candidate);
  const b = Buffer.from(adminPassword);
  const maxLen = Math.max(a.length, b.length);
  const paddedA = Buffer.concat([a, Buffer.alloc(maxLen - a.length)]);
  const paddedB = Buffer.concat([b, Buffer.alloc(maxLen - b.length)]);
  // timingSafeEqual requires same length — padded above; do length check separately
  // (length mismatch is itself detectable but that's acceptable for a local admin panel)
  const valid = a.length === b.length && timingSafeEqual(paddedA, paddedB);

  if (!valid) {
    return NextResponse.json({ ok: false, error: "Invalid password." }, { status: 401 });
  }

  const token = createAdminToken();
  const res   = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
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
  res.cookies.delete(COOKIE_NAME);
  return res;
}
