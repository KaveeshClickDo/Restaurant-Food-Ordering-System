/**
 * GET /api/pos/dojo/sessions/[id] — poll a terminal session's status.
 *
 * The POS calls this ~once per second while the card is being taken. When the
 * session settles successfully we also fetch the final payment intent so the
 * snapshot carries transactionId / authCode / card (persisted on the sale).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { getDojoGateway, resolveSnapshot } from "@/lib/dojo";
import { dojoErrorResponse } from "@/lib/dojo/respond";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getAnyStaffSession();
  if (!session) return unauthorizedJson();

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing terminal session id." }, { status: 400 });

  try {
    const gateway = getDojoGateway();
    const session = await gateway.getTerminalSession(id);
    const snapshot = await resolveSnapshot(gateway, session);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    return dojoErrorResponse(err);
  }
}
