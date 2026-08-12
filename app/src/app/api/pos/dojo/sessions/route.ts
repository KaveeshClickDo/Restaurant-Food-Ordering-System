/**
 * POST /api/pos/dojo/sessions — start a card-present payment (or card refund) on
 * a Dojo terminal, from a POS-family surface (till, collection, gift card,
 * reservation fee).
 *
 * Auth only: the flow itself lives in lib/dojo/sessionHandlers, shared with the
 * waiter's /api/waiter/dojo/* routes. Any valid staff (or admin) session may
 * take a payment — each surface carries only its own session cookie.
 */

import { NextRequest } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { handleCreateSession } from "@/lib/dojo/sessionHandlers";

export async function POST(req: NextRequest) {
  if (!(await getAnyStaffSession())) return unauthorizedJson();
  return handleCreateSession(req);
}
