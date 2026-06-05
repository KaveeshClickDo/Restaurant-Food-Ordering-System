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

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

// Extract `Receipt: R1024` if present in the order's note field — POS sales
// embed the receipt number there so the display can show it.
function extractReceiptNo(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = note.match(/Receipt:\s*(R\d+)/);
  return m ? m[1] : null;
}

// Short, screen-friendly display code. POS sales already carry an "R…" receipt
// number in the note; every other type gets a one-letter prefix (derived from
// fulfillment) plus the last 6 chars of the id — short enough for a big-font
// counter screen, unique enough across the handful of active orders shown.
//   T-4C8A33  dine-in (table service)   C-B2C3D4  collection   R1024  POS sale
function displayNumber(id: string, fulfillment: string | null | undefined, note: string | null | undefined): string {
  const receiptNo = extractReceiptNo(note);
  if (receiptNo) return receiptNo;
  const prefix = fulfillment === "dine-in" ? "T" : "C";  // T = table, C = collection
  return `${prefix}-${String(id).slice(-6).toUpperCase()}`;
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
