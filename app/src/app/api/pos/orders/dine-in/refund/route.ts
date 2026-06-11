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
 * Dine-in orders store the GROSS goods total with the gift-card-covered portion
 * kept separately in gift_card_used. A gift card is prepaid money, so only the
 * cash/card portion (moneyPaidGross) is refundable — the refund is capped at it.
 *
 * Uses the service-role key — the anon role cannot UPDATE orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosPermission } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { PosDineInRefundSchema } from "@/lib/schemas/pos";
import { moneyPaidGross } from "@/lib/giftCardMoney";

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
  const gate = await requirePosPermission("canIssueRefund");
  if (!gate.ok) return gate.response;
  // Actor stamped from the session-bound POS staff row (admin → "POS Admin")
  // so the audit trail can't be forged from the request body.
  const actorName = gate.staff?.name ?? "POS Admin";

  const parsed = await parseBody(req, PosDineInRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { orderIds, refundAmount, refundMethod, reason } = parsed.data;

  // Only settled (delivered) dine-in orders are refundable. gift_card_used lets
  // us cap the refund at the real money taken (the gift-card portion is prepaid
  // and therefore non-refundable).
  const { data: orders, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("id, total, refunds, refunded_amount, gift_card_used")
    .in("id", orderIds)
    .eq("fulfillment", "dine-in")
    .eq("status", "delivered");

  if (fetchErr) {
    console.error("pos/orders/dine-in/refund fetch:", fetchErr.message);
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ ok: false, error: "No delivered orders found for these IDs." }, { status: 404 });
  }

  // Refundable money = cash/card collected (gift card excluded), net of any
  // prior refunds on these orders.
  const moneyCap      = round2(orders.reduce((s, o) => s + moneyPaidGross(o.total, o.gift_card_used), 0));
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
  const isFullRefund     = priorRefunded + refundAmount >= moneyCap - 0.001;
  const newPaymentStatus = isFullRefund ? "refunded" : "partially_refunded";
  const processedAt      = new Date().toISOString();

  // Distribute the refund across orders in proportion to each order's MONEY paid
  // (gift card netted out) so a multi-order table bill splits fairly.
  const updates = orders.map((o) => {
    const orderMoney   = moneyPaidGross(o.total, o.gift_card_used);
    const orderShare   = moneyCap > 0 ? (orderMoney / moneyCap) * refundAmount : 0;
    const roundedShare = round2(orderShare);

    const existingRefunds: RefundRecord[] = Array.isArray(o.refunds) ? o.refunds as RefundRecord[] : [];
    const newRecord: RefundRecord = {
      id:          crypto.randomUUID(),
      orderId:     o.id,
      amount:      roundedShare,
      type:        isFullRefund ? "full" : "partial",
      reason,
      method:      refundMethod ?? "cash",
      processedAt,
      processedBy: actorName,
    };

    return {
      id:              o.id,
      payment_status:  newPaymentStatus,
      refunds:         [...existingRefunds, newRecord],
      refunded_amount: round2((Number(o.refunded_amount ?? 0)) + roundedShare),
    };
  });

  // `status` is intentionally NOT touched: the order was delivered and the
  // refund only changes its payment state (payment_status is the source of
  // truth for refunds, matching the admin refund route).
  const errors: string[] = [];
  await Promise.all(
    updates.map(async ({ id, payment_status, refunds, refunded_amount }) => {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ payment_status, refunds, refunded_amount })
        .eq("id", id);
      if (error) errors.push(`${id}: ${error.message}`);
    }),
  );

  if (errors.length > 0) {
    console.error("pos/orders/dine-in/refund update:", errors);
    return NextResponse.json({ ok: false, error: errors.join("; ") }, { status: 500 });
  }

  return NextResponse.json({
    ok:            true,
    refunded:      orders.length,
    totalRefunded: refundAmount,
    type:          newPaymentStatus,
  });
}
