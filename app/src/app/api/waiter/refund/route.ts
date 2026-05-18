/**
 * POST /api/waiter/refund
 * Processes a full or partial refund for settled (delivered) waiter orders.
 * Fetches all orders by ID, computes totals, sets the correct status,
 * and appends a refund record to each order's `refunds` JSON array.
 * Uses the service-role key — anon role cannot UPDATE orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireWaiterAuth } from "@/lib/waiterAuth";
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

export async function POST(req: NextRequest) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;

  const parsed = await parseBody(req, WaiterRefundSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { orderIds, refundAmount, refundMethod, reason, refundedBy } = parsed.data;

  // Fetch the current orders to get totals and existing refund records
  const { data: orders, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("id, total, refunds, refunded_amount")
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

  const grandTotal = orders.reduce((s, o) => s + Number(o.total), 0);
  const isFullRefund = refundAmount >= grandTotal - 0.001; // tolerance for float rounding
  const newStatus = isFullRefund ? "refunded" : "partially_refunded";
  const processedAt = new Date().toISOString();
  const processedBy = refundedBy?.trim() ?? "Staff";

  // Distribute refund proportionally across orders
  // Each order gets: its_total / grand_total * refundAmount
  const updates = orders.map((o) => {
    const orderTotal = Number(o.total);
    const orderShare = grandTotal > 0 ? (orderTotal / grandTotal) * refundAmount : 0;
    const roundedShare = Math.round(orderShare * 100) / 100;

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
      status:          newStatus,
      refunds:         [...existingRefunds, newRecord],
      refunded_amount: (Number(o.refunded_amount ?? 0)) + roundedShare,
    };
  });

  // Update each order (Supabase upsert or individual updates)
  const errors: string[] = [];
  await Promise.all(
    updates.map(async ({ id, status, refunds, refunded_amount }) => {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ status, refunds, refunded_amount })
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
    type: newStatus,
  });
}
