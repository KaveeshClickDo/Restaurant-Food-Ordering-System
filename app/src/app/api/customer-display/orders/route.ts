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
import { getDisplaySession } from "@/lib/auth";
import { extractReceiptNo, fullOrderNumber } from "@/lib/orderNumber";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

// Screen-friendly display label for the counter board:
//   POS sale   → R1024         (the till receipt number, carried in the note)
//   dine-in    → Table T4      (the table name, parsed from the note — matches
//                               the bill receipt and every other surface)
//   collection → #ORD-1A2B3C4D (the full order number the customer already has)
function displayNumber(id: string, fulfillment: string | null | undefined, note: string | null | undefined): string {
  const receiptNo = extractReceiptNo(note);
  if (receiptNo) return receiptNo;
  if (fulfillment === "dine-in") {
    const m = (note ?? "").match(/Table\s+(\S+)/);
    return m ? `Table ${m[1]}` : "Dine-in";
  }
  return fullOrderNumber(id);
}

export async function GET() {
  // Gated on the display session. Middleware already redirects the page to
  // /customer-display/login when the cookie is missing/invalid; this guards the
  // data itself and — crucially — enforces session_version, so a password
  // change/clear (which bumps the version) returns 401 here and the screen
  // bounces back to the login page on its next 4-second poll.
  const session = await getDisplaySession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Delivery orders are intentionally excluded — the in-store collection screen
  // only shows orders a customer can walk up and collect (collection, dine-in,
  // POS). Delivery is the driver's concern, not the counter's.
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, status, fulfillment, date, items, note")
    .in("status", ACTIVE_STATUSES)
    .neq("fulfillment", "delivery")
    .order("date", { ascending: true })
    .limit(50);

  if (error) {
    console.error("customer-display/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Strip note (may contain customer name / staff name / addresses) and return
  // only the public-safe fields the in-store screen actually needs.
  const sanitized = (data ?? []).map((o: Record<string, unknown>) => ({
    id:          o.id,
    status:      o.status,
    fulfillment: o.fulfillment,
    date:        o.date,
    items:       o.items ?? [],
    displayNo:   displayNumber(String(o.id), o.fulfillment as string | null, o.note as string | null),
  }));

  return NextResponse.json({ ok: true, orders: sanitized });
}
