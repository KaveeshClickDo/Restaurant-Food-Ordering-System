/**
 * PUT /api/pos/dojo/sessions/[id]/signature — accept or reject a signature
 * verification. Only called when a poll returns SignatureVerificationRequired.
 *
 * Body: { accepted: boolean }. Note Dojo's 80-second rule: if no decision is
 * sent the payment auto-accepts — the client should still let staff decide, but
 * the server just relays the decision.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { DojoSignatureSchema } from "@/lib/schemas/dojo";
import { getDojoGateway, resolveSnapshot } from "@/lib/dojo";
import { dojoErrorResponse } from "@/lib/dojo/respond";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getAnyStaffSession();
  if (!session) return unauthorizedJson();

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing terminal session id." }, { status: 400 });

  const parsed = await parseBody(req, DojoSignatureSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  try {
    const gateway = getDojoGateway();
    const session = await gateway.submitSignature(id, parsed.data.accepted);
    const snapshot = await resolveSnapshot(gateway, session);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    return dojoErrorResponse(err);
  }
}
