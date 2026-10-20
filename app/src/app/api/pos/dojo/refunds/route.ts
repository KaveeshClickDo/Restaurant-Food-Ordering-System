/**
 * POST /api/pos/dojo/refunds — server-side ("customer not present") refund on a
 * previously captured Dojo payment intent. Dojo's recommended refund method.
 *
 * Gated by `canIssueRefund` (or admin), mirroring the POS void/refund flow. For
 * a card-present refund (customer + card at the terminal) the client instead
 * opens a MatchedRefund/UnlinkedRefund via POST /api/pos/dojo/sessions.
 *
 * Send the same `requestId` when retrying one refund: it is Dojo's idempotency
 * key, so a double tap or a network retry can't refund twice. After the refund
 * the intent is read back (as Dojo's checklist asks) and its status returned:
 * "Refunded" when fully refunded, "Captured" with refundedAmount when partial.
 * On the sandbox, refunds of terminal payments fail; Dojo confirmed that's a
 * sandbox limitation and approves a correct request.
 *
 * Body (amount in MAJOR units): see DojoRefundSchema.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requirePosPermission } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { DojoRefundSchema } from "@/lib/schemas/dojo";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDojoGateway } from "@/lib/dojo";
import { dojoErrorResponse, toMinorUnits } from "@/lib/dojo/respond";

export async function POST(req: NextRequest) {
  const gate = await requirePosPermission("canIssueRefund");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, DojoRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  try {
    const gateway = getDojoGateway();
    const result = await gateway.createRefund({
      paymentIntentId: body.paymentIntentId,
      amount: toMinorUnits(body.amount),
      refundReason: body.refundReason,
      notes: body.notes,
      idempotencyKey: body.requestId ?? randomUUID(),
    });

    // Read the outcome back; the refund itself already succeeded, so a failed
    // read only means the status isn't confirmed yet (the webhook updates it).
    let status: string | null = null;
    let refundedAmount: number | null = null;
    try {
      const intent = await gateway.getPaymentIntent(body.paymentIntentId);
      status = intent.status;
      refundedAmount = typeof intent.refundedAmount === "number" ? intent.refundedAmount / 100 : null;
      const { error } = await supabaseAdmin
        .from("dojo_payments")
        .update({ status })
        .eq("payment_intent_id", body.paymentIntentId);
      if (error) console.error("[dojo/refunds] dojo_payments status update:", error.message);
    } catch (err) {
      console.error("[dojo/refunds] reading the intent back:", err instanceof Error ? err.message : err);
    }

    return NextResponse.json({
      ok: true,
      refundId: result.refundId,
      message: result.message ?? null,
      status,
      refundedAmount,
    });
  } catch (err) {
    return dojoErrorResponse(err, "refund");
  }
}
