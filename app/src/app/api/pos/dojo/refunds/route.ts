/**
 * POST /api/pos/dojo/refunds — server-side ("customer not present") refund on a
 * previously captured Dojo payment intent. Dojo's recommended refund method.
 *
 * Gated by `canIssueRefund` (or admin), mirroring the POS void/refund flow. The
 * till's Void & Refund refunds card machine sales through the same helper
 * (lib/dojo/refund.ts). No route opens a refund on the card machine
 * (MatchedRefund/UnlinkedRefund): those pay money out too, so one would need
 * this same gate.
 *
 * `requestId` is required: make one per refund and send the same one when
 * retrying it. It is Dojo's idempotency key, so a double tap or a network retry
 * (including a timeout, after which the refund may have gone through) can't
 * refund twice.
 *
 * After the refund the intent is read back (as Dojo's checklist asks) and its
 * status returned: "Refunded" when fully refunded, "Captured" with
 * refundedAmount when partial.
 * On the sandbox, refunds of terminal payments fail; Dojo confirmed that's a
 * sandbox limitation and approves a correct request.
 *
 * Body (amount in MAJOR units): see DojoRefundSchema.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePosPermission } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { DojoRefundSchema } from "@/lib/schemas/dojo";
import { refundDojoPayment } from "@/lib/dojo/refund";
import { dojoErrorResponse } from "@/lib/dojo/respond";

export async function POST(req: NextRequest) {
  const gate = await requirePosPermission("canIssueRefund");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, DojoRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  try {
    // Sends, records (with who issued it) and reads back; see lib/dojo/refund.
    const outcome = await refundDojoPayment({
      paymentIntentId: body.paymentIntentId,
      amount: body.amount,
      requestId: body.requestId,
      reason: body.refundReason,
      notes: body.notes,
      staffId: gate.staff?.id ?? null,
    });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    return dojoErrorResponse(err, "refund");
  }
}
