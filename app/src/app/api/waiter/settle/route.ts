/**
 * POST /api/waiter/settle
 * Marks all active orders for a table as "delivered" and records the payment method.
 * Called by the waiter app when the customer pays their bill.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  let body: {
    orderIds?: string[];
    tableLabel?: string;
    paymentMethod?: "cash" | "card";
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { orderIds, tableLabel, paymentMethod } = body;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ ok: false, error: "orderIds is required." }, { status: 400 });
  }
  if (!tableLabel) {
    return NextResponse.json({ ok: false, error: "tableLabel is required." }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        status:         "delivered",
        payment_method: paymentMethod ?? "table-service",
      })
      .in("id", orderIds)
      .eq("fulfillment", "dine-in");

    if (error) {
      console.error("waiter/settle:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, settled: orderIds.length, tableLabel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/settle]", message);
    return NextResponse.json({ ok: false, error: "Failed to settle table. Please try again." }, { status: 500 });
  }
}
