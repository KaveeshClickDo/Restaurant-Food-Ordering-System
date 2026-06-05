/**
 * PUT /api/pos/orders/[id]/collected
 * Marks a POS (collection) order as "delivered" once the customer has picked it up.
 * Called from the kitchen UI. Requires an operational staff session
 * (kitchen / POS / waiter). Only allowed when the order's current status is "ready".
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import {
  getPosSession,
  getKitchenSession,
  getWaiterSession,
  unauthorizedJson,
} from "@/lib/auth";
import { sendOrderStatusEmail }      from "@/lib/emailServer";

// PUT body is empty — no schema needed. Auth + DB-state check are the guards.

async function isStaffAuthenticated(): Promise<boolean> {
  const [pos, kitchen, waiter] = await Promise.all([
    getPosSession(),
    getKitchenSession(),
    getWaiterSession(),
  ]);
  return Boolean(pos || kitchen || waiter);
}

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isStaffAuthenticated()) return unauthorizedJson();

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

  // Notify the customer that their collection order has been picked up
  // (status → "delivered"). Fire-and-forget so an SMTP outage never fails the
  // status update. sendOrderStatusEmail is a no-op for guest / POS walk-in
  // orders, so in-restaurant cash sales don't trigger a bogus send.
  sendOrderStatusEmail(id, "delivered").catch((err: unknown) =>
    console.error("[pos/collected] delivered email:", err instanceof Error ? err.message : err)
  );

  return NextResponse.json({ ok: true });
}
