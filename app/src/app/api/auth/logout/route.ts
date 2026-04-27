/**
 * POST /api/auth/logout — clears the customer session cookie.
 */

import { NextResponse }                    from "next/server";
import { clearSessionCookie, COOKIE_CUSTOMER } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, COOKIE_CUSTOMER);
  return res;
}
