/**
 * POST /api/kitchen/logout — clear the kitchen_session cookie
 */

import { NextResponse }        from "next/server";
import { clearSessionCookie, COOKIE_KITCHEN } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, COOKIE_KITCHEN);
  return res;
}
