/**
 * Server-only helper for waiter route authentication.
 * Checks the httpOnly waiter_session cookie set by POST /api/waiter/auth.
 * Never import this from client components.
 */

import { getWaiterSession, unauthorizedJson } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Returns null if the request carries a valid waiter session,
 * or a 401 NextResponse to return immediately if it does not.
 */
export async function requireWaiterAuth(): Promise<NextResponse | null> {
  const session = await getWaiterSession();
  if (!session) return unauthorizedJson();
  return null;
}
