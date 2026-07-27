/**
 * PUT /api/pos/dojo/sessions/[id]/cancel — cancel a terminal session before a
 * card is presented. Dojo (and the mock) reject cancellation once the card has
 * been presented/inserted; that surfaces as a 422 the client should tolerate
 * (the payment simply continues). Method is PUT (the session is not deleted).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { getDojoGateway, resolveSnapshot } from "@/lib/dojo";
import { dojoErrorResponse } from "@/lib/dojo/respond";

export async function PUT(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getAnyStaffSession();
  if (!session) return unauthorizedJson();

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing terminal session id." }, { status: 400 });

  try {
    const gateway = getDojoGateway();
    const session = await gateway.cancelTerminalSession(id);
    const snapshot = await resolveSnapshot(gateway, session);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    return dojoErrorResponse(err);
  }
}
