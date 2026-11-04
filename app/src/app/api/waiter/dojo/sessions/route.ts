/**
 * POST /api/waiter/dojo/sessions — start a card payment on a Dojo terminal from
 * the waiter app (table bill settle).
 *
 * Exists so the /waiter UI only ever calls /api/waiter/* (the surface boundary);
 * the payment flow itself is shared with the POS via lib/dojo/sessionHandlers.
 * Gated on a waiter session, so a POS-session tightening can't silently break
 * waiter payments. Card-present only: a keyed sale is refused (the guest is at
 * the table with their card).
 */

import { NextRequest } from "next/server";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { handleCreateSession } from "@/lib/dojo/sessionHandlers";

export async function POST(req: NextRequest) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;
  return handleCreateSession(req);
}
