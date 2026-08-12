/**
 * PUT /api/pos/dojo/sessions/[id]/signature — accept or reject a signature
 * verification. Body: { accepted: boolean }.
 * Auth only; the work is shared in lib/dojo/sessionHandlers.
 */

import { NextRequest } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { handleSignSession } from "@/lib/dojo/sessionHandlers";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAnyStaffSession())) return unauthorizedJson();
  const { id } = await ctx.params;
  return handleSignSession(req, id);
}
