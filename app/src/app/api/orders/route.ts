/**
 * POST /api/orders — public endpoint for customer order placement.
 * Validates the payload server-side and inserts via the service role key,
 * so the anon key never needs INSERT permission on the orders table.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";

// New orders must always start in "pending" — the client must not be able to
// set an arbitrary status (e.g. "delivered") at creation time.
const ALLOWED_INITIAL_STATUS = "pending";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  // ── Required field checks ─────────────────────────────────────────────────
  const { id, customer_id, fulfillment, total, items } = body;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ ok: false, error: "'id' is required." }, { status: 400 });
  }
  if (!customer_id || typeof customer_id !== "string") {
    return NextResponse.json({ ok: false, error: "'customer_id' is required." }, { status: 400 });
  }
  if (fulfillment !== "delivery" && fulfillment !== "collection" && fulfillment !== "dine-in") {
    return NextResponse.json({ ok: false, error: "'fulfillment' must be 'delivery' or 'collection'." }, { status: 400 });
  }
  if (typeof total !== "number" || total < 0) {
    return NextResponse.json({ ok: false, error: "'total' must be a non-negative number." }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: false, error: "'items' must be a non-empty array." }, { status: 400 });
  }

  // ── Enforce safe initial status — client cannot choose an arbitrary status ─
  const row = {
    ...body,
    status:     ALLOWED_INITIAL_STATUS,
    date:       typeof body.date === "string" ? body.date : new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("orders").insert(row);
  if (error) {
    console.error("orders POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
