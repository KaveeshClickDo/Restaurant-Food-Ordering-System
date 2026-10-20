/**
 * GET /api/pos/dojo/sessions/[id] — poll a terminal session's status.
 * The POS calls this ~once per second while the card is being taken.
 * Auth only; the work is shared in lib/dojo/sessionHandlers.
 */

import { NextRequest } from "next/server";
import { getTillStaffSession, unauthorizedJson } from "@/lib/auth";
import { handleGetSession } from "@/lib/dojo/sessionHandlers";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getTillStaffSession())) return unauthorizedJson();
  const { id } = await ctx.params;
  return handleGetSession(id);
}
