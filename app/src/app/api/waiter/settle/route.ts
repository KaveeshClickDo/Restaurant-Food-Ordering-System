/**
 * POST /api/waiter/settle
 * Marks all active orders for a table as "delivered" and records the payment method.
 * Called by the waiter app when the customer pays their bill.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { parseBody } from "@/lib/apiValidation";
import { WaiterSettleSchema } from "@/lib/schemas/waiter";

export async function POST(req: NextRequest) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;

  const parsed = await parseBody(req, WaiterSettleSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { orderIds, tableLabel, paymentMethod } = parsed.data;

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
