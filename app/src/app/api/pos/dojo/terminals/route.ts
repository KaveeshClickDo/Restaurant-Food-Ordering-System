/**
 * GET /api/pos/dojo/terminals — list Dojo card terminals for this account, for
 * the payment screen's machine picker (DojoChargePanel).
 *
 * Every status by default (?available=1 for only the free ones). `tid` is the
 * machine's name as Dojo lists it (e.g. VCMSEEKSIP0), which is also accepted as
 * DOJO_TERMINAL_ID. Namespaced under /dojo to avoid the existing
 * /api/pos/terminals (the till/POS device concept — unrelated to Dojo hardware).
 * The waiter app has its own /api/waiter/dojo/terminals over the same handler.
 */

import { NextRequest } from "next/server";
import { getTillStaffSession, unauthorizedJson } from "@/lib/auth";
import { handleListTerminals } from "@/lib/dojo/sessionHandlers";

export async function GET(req: NextRequest) {
  if (!(await getTillStaffSession())) return unauthorizedJson();
  return handleListTerminals(new URL(req.url).searchParams.get("available") === "1");
}
