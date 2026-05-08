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

  try {
    // Try to update with optional void-audit columns first.
    // If those columns don't exist yet (migration not run), fall back to status-only update.
    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        status:      "cancelled",
        void_reason: reason.trim(),
        voided_by:   voidedBy?.trim() ?? null,
        voided_at:   new Date().toISOString(),
      })
      .in("id", orderIds)
      .eq("fulfillment", "dine-in")
      .not("status", "in", '("delivered","cancelled","refunded","partially_refunded")');

    if (error) {
      // If the void audit columns don't exist yet, retry with just the status change.
      if (error.code === "PGRST204" || error.message?.includes("void_reason") || error.message?.includes("voided_by")) {
        const { error: fallbackError } = await supabaseAdmin
          .from("orders")
          .update({ status: "cancelled" })
          .in("id", orderIds)
          .eq("fulfillment", "dine-in")
          .not("status", "in", '("delivered","cancelled","refunded","partially_refunded")');

        if (fallbackError) {
          console.error("waiter/void fallback:", fallbackError.message);
          return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
        }
      } else {
        console.error("waiter/void:", error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, voided: orderIds.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/void]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
