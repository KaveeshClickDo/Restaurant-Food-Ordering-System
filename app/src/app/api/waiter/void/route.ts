/**
 * POST /api/waiter/void
 * Cancels one or more active waiter orders (before payment).
 * Requires the orderId(s), a reason, and the staff member's name.
 * Uses the service-role key — anon role cannot UPDATE orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  let body: {
    orderIds?: string[];
    reason?: string;
    voidedBy?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { orderIds, reason, voidedBy } = body;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ ok: false, error: "orderIds is required." }, { status: 400 });
  }
  if (!reason?.trim()) {
    return NextResponse.json({ ok: false, error: "reason is required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      status:     "cancelled",
      void_reason: reason.trim(),
      voided_by:  voidedBy?.trim() ?? null,
      voided_at:  new Date().toISOString(),
    })
    .in("id", orderIds)
    .not("status", "in", '("delivered","cancelled","refunded","partially_refunded")');

  if (error) {
    console.error("waiter/void:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, voided: orderIds.length });
}
