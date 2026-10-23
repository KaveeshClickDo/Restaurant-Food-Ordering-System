/**
 * GET /api/waiter/dojo/terminals — the waiter app's list of Dojo card machines,
 * for its payment screen's machine picker. Same handler as the POS route,
 * behind a waiter session (the /waiter app only calls /api/waiter/*).
 */

import { NextRequest } from "next/server";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { handleListTerminals } from "@/lib/dojo/sessionHandlers";

export async function GET(req: NextRequest) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;
  return handleListTerminals(new URL(req.url).searchParams.get("available") === "1");
}
