/**
 * POST /api/pos/dojo/sessions — start a SALE on a Dojo terminal, from a
 * POS-family surface (till, collection, gift card, reservation fee).
 * Refund sessions are not accepted here: they pay money out, so they would need
 * their own route gated on canIssueRefund.
 *
 * Auth only: the flow itself lives in lib/dojo/sessionHandlers, shared with the
 * waiter's /api/waiter/dojo/* routes. Only POS and collection sessions may drive
 * the machine here (getTillStaffSession), and only a POS session may start a
 * keyed (card-not-present) sale: the till takes those for phone bookings.
 */

import { NextRequest } from "next/server";
import { getTillStaffSession, unauthorizedJson } from "@/lib/auth";
import { handleCreateSession } from "@/lib/dojo/sessionHandlers";

export async function POST(req: NextRequest) {
  const staff = await getTillStaffSession();
  if (!staff) return unauthorizedJson();
  return handleCreateSession(req, { allowKeyed: staff.role === "pos" });
}
