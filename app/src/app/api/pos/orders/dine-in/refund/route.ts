/**
 * POST /api/pos/orders/dine-in/refund — refund settled (delivered) dine-in
 * orders from the POS dashboard's Dine-In tab.
 *
 * POS-native counterpart to /api/waiter/refund. The POS dashboard runs on the
 * pos_staff_session cookie (NOT waiter_session), so it cannot use the waiter
 * endpoints — calling them returned 401 "Unauthorized". Gated by the POS
 * `canIssueRefund` permission (admin session overrides), matching the gate the
 * dashboard already uses to show the button.
 *
 * Dine-in orders store the NET total (gift card already deducted, kept separately
 * in gift_card_used). A gift card is prepaid money, so only the cash/card portion
 * is refundable, plus any tip added on the card machine. A card refund of a bill
 * paid on the Dojo card machine goes back to the card through Dojo first. The
 * money rules are in lib/dineInRefund.ts, shared with the waiter app.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePosPermission } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { PosDineInRefundSchema } from "@/lib/schemas/pos";
import { refundDineInOrders } from "@/lib/dineInRefund";
import { dojoErrorResponse } from "@/lib/dojo/respond";

export async function POST(req: NextRequest) {
  const gate = await requirePosPermission("canIssueRefund");
  if (!gate.ok) return gate.response;
  // Actor stamped from the session-bound POS staff row (admin → "POS Admin")
  // so the audit trail can't be forged from the request body.
  const actorName = gate.staff?.name ?? "POS Admin";

  const parsed = await parseBody(req, PosDineInRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { orderIds, refundAmount, refundMethod, reason, refundRequestId } = parsed.data;

  const result = await refundDineInOrders({
    orderIds,
    refundAmount,
    refundMethod: refundMethod ?? "cash",
    reason,
    actorName,
    staffId: gate.staff?.id ?? null,
    refundRequestId,
    logTag: "pos/orders/dine-in/refund",
  });
  if ("dojoError" in result) return dojoErrorResponse(result.dojoError, "refund");
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
