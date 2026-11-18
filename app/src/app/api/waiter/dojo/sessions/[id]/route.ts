/**
 * GET /api/waiter/dojo/sessions/[id] — poll a terminal session while the waiter
 * takes a card at the table. Waiter-gated mirror of the POS route; the work is
 * shared in lib/dojo/sessionHandlers.
 */

import { NextRequest } from "next/server";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { handleGetSession } from "@/lib/dojo/sessionHandlers";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;
  const { id } = await ctx.params;
  return handleGetSession(id);
}
