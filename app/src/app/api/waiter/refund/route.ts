/**
 * POST /api/waiter/refund
 * Processes a full or partial refund for settled (delivered) waiter orders.
 * Fetches all orders by ID, computes totals, sets payment_status, and appends
 * a refund record to each order's `refunds` JSON array. A refund changes the
 * *payment* state only — `status` stays "delivered" (the food was served);
 * payment_status is the source of truth for refunds, as in the admin route.
 * Uses the service-role key — anon role cannot UPDATE orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { getWaiterSession } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { WaiterRefundSchema } from "@/lib/schemas/waiter";

interface RefundRecord {
  id: string;
  orderId: string;
  amount: number;
  type: "full" | "partial";
  reason: string;
  method: string;
  processedAt: string;
  processedBy: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;
  const session = await getWaiterSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const parsed = await parseBody(req, WaiterRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  // F-INS-5: refundedBy in body is ignored — server stamps the actor from
  // the session-bound waiter row so the audit trail can't be forged.
  const { orderIds, refundAmount, refundMethod, reason } = parsed.data;

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
  const actorName = waiterRow?.name ?? "Staff";

  // Fetch the current orders to get totals and existing refund records.
  // gift_card_used lets us cap the refund at the real money taken (the
  // gift-card portion is prepaid and therefore non-refundable).
  const { data: orders, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("id, total, refunds, refunded_amount, gift_card_used")
    .in("id", orderIds)
    .eq("fulfillment", "dine-in")
    .eq("status", "delivered");

  if (fetchErr) {
    console.error("waiter/refund fetch:", fetchErr.message);
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ ok: false, error: "No delivered orders found for these IDs." }, { status: 404 });
  }

  // Cap the refund at the money still refundable. This guard is load-bearing:
  // status stays "delivered" after a refund, so the fetch above no longer
  // filters out already-refunded orders — without the cap a repeat request
  // could return more money than was ever taken.
  const moneyCap      = round2(orders.reduce((s, o) => s + o.total, 0));
  const priorRefunded = round2(orders.reduce((s, o) => s + (Number(o.refunded_amount) || 0), 0));
  const remaining     = round2(moneyCap - priorRefunded);
  if (refundAmount > remaining + 0.001) {
    return NextResponse.json(
      { ok: false, error: `Refund (${refundAmount.toFixed(2)}) cannot exceed the ${remaining.toFixed(2)} refundable. The gift-card portion is non-refundable.` },
      { status: 400 },
    );
  }

  // "refunded" = the customer now has ALL their money back, cumulatively —
  // a second partial refund that clears the balance still counts as full.
  const isFullRefund = priorRefunded + refundAmount >= moneyCap - 0.001;
  const newPaymentStatus = isFullRefund ? "refunded" : "partially_refunded";
  const processedAt = new Date().toISOString();
  const processedBy = actorName;

  // Distribute the refund across orders in proportion to each order's MONEY
  // paid so a multi-order table bill splits fairly.
  const updates = orders.map((o) => {
    const orderMoney = o.total;
    const orderShare = moneyCap > 0 ? (orderMoney / moneyCap) * refundAmount : 0;
    const roundedShare = round2(orderShare);

    const existingRefunds: RefundRecord[] = Array.isArray(o.refunds) ? o.refunds as RefundRecord[] : [];
    const newRecord: RefundRecord = {
      id:          crypto.randomUUID(),
      orderId:     o.id,
      amount:      roundedShare,
      type:        isFullRefund ? "full" : "partial",
      reason:      reason,
      method:      refundMethod ?? "cash",
      processedAt,
      processedBy,
    };

    return {
      id:              o.id,
      payment_status:  newPaymentStatus,
      refunds:         [...existingRefunds, newRecord],
      refunded_amount: round2((Number(o.refunded_amount ?? 0)) + roundedShare),
    };
  });

  // Update each order — `status` is intentionally NOT touched: the order was
  // delivered and the refund only changes its payment state.
  const errors: string[] = [];
  await Promise.all(
    updates.map(async ({ id, payment_status, refunds, refunded_amount }) => {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ payment_status, refunds, refunded_amount })
        .eq("id", id);
      if (error) errors.push(`${id}: ${error.message}`);
    })
  );

  if (errors.length > 0) {
    console.error("waiter/refund update errors:", errors);
    return NextResponse.json({ ok: false, error: errors.join("; ") }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    refunded: orders.length,
    totalRefunded: refundAmount,
    type: newPaymentStatus,
  });
}
