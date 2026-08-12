/**
 * PUT /api/pos/dojo/sessions/[id]/cancel — cancel a session before a card is
 * presented (a 422 once it has been is expected; the payment continues).
 * Auth only; the work is shared in lib/dojo/sessionHandlers.
 */

import { NextRequest } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { handleCancelSession } from "@/lib/dojo/sessionHandlers";

export async function PUT(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAnyStaffSession())) return unauthorizedJson();
  const { id } = await ctx.params;
  return handleCancelSession(id);
}
