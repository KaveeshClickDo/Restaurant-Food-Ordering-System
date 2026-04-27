/**
 * POST /api/waiter/logout — clears the waiter session cookie.
 */

import { NextResponse }                   from "next/server";
import { clearSessionCookie, COOKIE_WAITER } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, COOKIE_WAITER);
  return res;
}
