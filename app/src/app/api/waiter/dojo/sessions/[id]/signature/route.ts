/**
 * PUT /api/waiter/dojo/sessions/[id]/signature — accept or reject a signature
 * verification from the waiter app. Body: { accepted: boolean }.
 * Waiter-gated mirror of the POS route; work shared in lib/dojo/sessionHandlers.
 */

import { NextRequest } from "next/server";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { handleSignSession } from "@/lib/dojo/sessionHandlers";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  return handleSignSession(req, id);
}
