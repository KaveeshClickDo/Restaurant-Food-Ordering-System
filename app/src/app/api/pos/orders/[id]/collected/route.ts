/**
 * PUT /api/pos/orders/[id]/collected
 * Marks a POS (collection) order as "delivered" once the customer has picked it up.
 * Uses the service role key — no admin cookie needed because this endpoint is
 * called from a trusted in-restaurant screen (customer display / KDS).
 * Only allowed when the order's current status is "ready".
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Safety guard — only advance from "ready"; never touch in-flight or already-done orders
  const { data: order, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("status, fulfillment")
    .eq("id", id)
    .single();

  if (fetchErr || !order) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "ready") {
    return NextResponse.json(
      { ok: false, error: `Order is '${order.status}', not 'ready'.` },
      { status: 409 },
    );
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({ status: "delivered" })
    .eq("id", id);

  if (error) {
    console.error("pos/orders/[id]/collected PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
