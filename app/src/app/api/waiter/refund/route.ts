/**
 * POST /api/waiter/refund
 * Processes a full or partial refund for settled (delivered) waiter orders.
 * Fetches all orders by ID, computes totals, sets the correct status,
 * and appends a refund record to each order's `refunds` JSON array.
 * Uses the service-role key — anon role cannot UPDATE orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  let body: {
    orderIds?: string[];
    refundAmount?: number;   // total amount to refund (across all orders combined)
    refundMethod?: "cash" | "card";
    reason?: string;
    refundedBy?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { orderIds, refundAmount, refundMethod, reason, refundedBy } = body;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ ok: false, error: "orderIds is required." }, { status: 400 });
  }
  if (typeof refundAmount !== "number" || refundAmount <= 0) {
    return NextResponse.json({ ok: false, error: "refundAmount must be a positive number." }, { status: 400 });
  }
  if (!reason?.trim()) {
    return NextResponse.json({ ok: false, error: "reason is required." }, { status: 400 });
  }

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
      reason:      reason!.trim(),
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
