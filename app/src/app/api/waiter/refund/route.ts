/**
 * POST /api/waiter/refund
 * Processes a full or partial refund for settled (delivered) waiter orders.
 * A refund changes the *payment* state only — `status` stays "delivered" (the
 * food was served); payment_status is the source of truth for refunds, as in
 * the admin route. A card refund of a bill paid on the Dojo card machine goes
 * back to the card through Dojo first. The money rules are in
 * lib/dineInRefund.ts, shared with the POS Dine-In tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { getWaiterSession } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { WaiterRefundSchema } from "@/lib/schemas/waiter";
import { refundDineInOrders } from "@/lib/dineInRefund";
import { dojoErrorResponse } from "@/lib/dojo/respond";

export async function POST(req: NextRequest) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;
  const session = await getWaiterSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const parsed = await parseBody(req, WaiterRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  // F-INS-5: refundedBy in body is ignored — server stamps the actor from
  // the session-bound waiter row so the audit trail can't be forged.
  const { orderIds, refundAmount, refundMethod, reason, refundRequestId } = parsed.data;

  // Refunds are a senior / head-waiter privilege. The client hides the action
  // for regular waiters, but enforce it server-side too so a forged request
  // can't bypass the role gate (AUTH_AUDIT 06-F12 elevation).
  const { data: waiterRow } = await supabaseAdmin
    .from("waiters").select("name, role").eq("id", session.id).maybeSingle();
  if (waiterRow?.role !== "senior") {
    return NextResponse.json(
      { ok: false, error: "Only senior staff can process refunds." },
      { status: 403 },
    );
  }

  const result = await refundDineInOrders({
    orderIds,
    refundAmount,
    refundMethod: refundMethod ?? "cash",
    reason,
    actorName: waiterRow?.name ?? "Staff",
    refundRequestId,
    logTag: "waiter/refund",
  });
  if ("dojoError" in result) return dojoErrorResponse(result.dojoError, "refund");
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
