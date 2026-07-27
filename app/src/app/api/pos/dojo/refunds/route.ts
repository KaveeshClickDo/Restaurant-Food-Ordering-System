/**
 * POST /api/pos/dojo/refunds — server-side ("customer not present") refund on a
 * previously captured Dojo payment intent.
 *
 * Gated by `canIssueRefund` (or admin), mirroring the POS void/refund flow. For
 * a card-present refund (customer + card at the terminal) the client instead
 * opens a MatchedRefund/UnlinkedRefund via POST /api/pos/dojo/sessions.
 *
 * Body (amount in MAJOR units): see DojoRefundSchema.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requirePosPermission } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { DojoRefundSchema } from "@/lib/schemas/dojo";
import { getDojoGateway } from "@/lib/dojo";
import { dojoErrorResponse, toMinorUnits } from "@/lib/dojo/respond";

export async function POST(req: NextRequest) {
  const gate = await requirePosPermission("canIssueRefund");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, DojoRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  try {
    const result = await getDojoGateway().createRefund({
      paymentIntentId: body.paymentIntentId,
      amount: toMinorUnits(body.amount),
      refundReason: body.refundReason,
      notes: body.notes,
      idempotencyKey: randomUUID(),
    });
    return NextResponse.json({ ok: true, refundId: result.refundId, message: result.message ?? null });
  } catch (err) {
    return dojoErrorResponse(err);
  }
}
