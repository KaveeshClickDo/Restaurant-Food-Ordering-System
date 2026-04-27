/**
 * POST /api/auth/driver/logout — clears the driver session cookie.
 */

import { NextResponse }                  from "next/server";
import { clearSessionCookie, COOKIE_DRIVER } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, COOKIE_DRIVER);
  return res;
}
