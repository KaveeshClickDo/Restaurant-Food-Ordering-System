/**
 * PUT /api/waiter/dojo/sessions/[id]/cancel — cancel a session before the card
 * is presented. Waiter-gated mirror of the POS route; work shared in
 * lib/dojo/sessionHandlers.
 */

import { NextRequest } from "next/server";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { handleCancelSession } from "@/lib/dojo/sessionHandlers";

export async function PUT(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  return handleCancelSession(id);
}
