/**
 * GET /api/customer-display/orders — collection-screen feed.
 *
 * Public endpoint (in-store screen at the counter, no login). Returns ONLY
 * the minimum fields needed to show "your order is ready, please collect" —
 * no PII, no addresses, no phone numbers. Just receipt-style fields.
 *
 * Replaces the public `supabase.from("orders")` subscription on the display.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

// Extract `Receipt: R1024` if present in the order's note field — POS sales
// embed the receipt number there so the display can show it.
function extractReceiptNo(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = note.match(/Receipt:\s*(R\d+)/);
  return m ? m[1] : null;
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, status, fulfillment, delivery_status, date, scheduled_time, items, note")
    .in("status", ACTIVE_STATUSES)
    .order("date", { ascending: true })
    .limit(50);

  if (error) {
    console.error("customer-display/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Strip note (may contain customer name / staff name / addresses) and return
  // only the public-safe fields the in-store screen actually needs.
  const sanitized = (data ?? []).map((o: Record<string, unknown>) => ({
    id:              o.id,
    status:          o.status,
    fulfillment:     o.fulfillment,
    // delivery_status is needed so the display can distinguish a delivery
    // order that's "ready" but still awaiting driver pickup vs one already
    // out for delivery vs a collection order ready for the customer.
    deliveryStatus:  o.delivery_status ?? null,
    date:            o.date,
    scheduledTime:   o.scheduled_time ?? null,
    items:           o.items ?? [],
    receiptNo:       extractReceiptNo(o.note as string | null | undefined),
  }));

  return NextResponse.json({ ok: true, orders: sanitized });
}
