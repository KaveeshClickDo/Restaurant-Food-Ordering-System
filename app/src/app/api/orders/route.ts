/**
 * POST /api/orders — public endpoint for customer order placement.
 * Validates the payload server-side and inserts via the service role key,
 * so the anon key never needs INSERT permission on the orders table.
 */

import { NextRequest, NextResponse }    from "next/server";
import { supabaseAdmin }               from "@/lib/supabaseAdmin";
import { sendOrderConfirmationEmail }  from "@/lib/emailServer";

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
  const { id, customer_id, fulfillment, total, items, payment_method, address } = body;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ ok: false, error: "'id' is required." }, { status: 400 });
  }
  if (!customer_id || typeof customer_id !== "string") {
    return NextResponse.json({ ok: false, error: "'customer_id' is required." }, { status: 400 });
  }
  if (fulfillment !== "delivery" && fulfillment !== "collection" && fulfillment !== "dine-in") {
    return NextResponse.json({ ok: false, error: "'fulfillment' must be 'delivery', 'collection', or 'dine-in'." }, { status: 400 });
  }
  if (typeof total !== "number" || total < 0) {
    return NextResponse.json({ ok: false, error: "'total' must be a non-negative number." }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: false, error: "Cart is empty — add at least one item before placing an order." }, { status: 400 });
  }

  // ── Validate item structure ───────────────────────────────────────────────
  for (const item of items as unknown[]) {
    if (typeof item !== "object" || item === null) {
      return NextResponse.json({ ok: false, error: "Each order item must be an object." }, { status: 400 });
    }
    const it = item as Record<string, unknown>;
    if (typeof it.name !== "string" || !it.name.trim()) {
      return NextResponse.json({ ok: false, error: "Each order item must have a name." }, { status: 400 });
    }
    if (typeof it.qty !== "number" || !Number.isInteger(it.qty) || it.qty < 1) {
      return NextResponse.json({ ok: false, error: "Each order item must have a valid quantity (positive integer)." }, { status: 400 });
    }
    if (typeof it.price !== "number" || it.price < 0) {
      return NextResponse.json({ ok: false, error: "Each order item must have a valid price." }, { status: 400 });
    }
  }

  // ── Payment and delivery-specific checks ──────────────────────────────────
  if (!payment_method || typeof payment_method !== "string" || !String(payment_method).trim()) {
    return NextResponse.json({ ok: false, error: "A payment method is required." }, { status: 400 });
  }
  if (fulfillment === "delivery" && (!address || typeof address !== "string" || !String(address).trim())) {
    return NextResponse.json({ ok: false, error: "A delivery address is required for delivery orders." }, { status: 400 });
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

  // Fire-and-forget — email failure must never fail the order response
  sendOrderConfirmationEmail({
    id:             id,
    customer_id:    customer_id,
    fulfillment:    fulfillment,
    total:          total,
    items:          items as Array<{ name: string; qty: number; price: number }>,
    payment_method: payment_method as string | undefined,
    address:        address as string | undefined,
    delivery_fee:   body.delivery_fee as number | undefined,
    service_fee:    body.service_fee as number | undefined,
    vat_amount:     body.vat_amount as number | undefined,
    vat_inclusive:  body.vat_inclusive as boolean | undefined,
    coupon_code:    body.coupon_code as string | undefined,
    coupon_discount: body.coupon_discount as number | undefined,
    date:           row.date,
  }).catch((err: unknown) =>
    console.error("[orders] confirmation email:", err instanceof Error ? err.message : err)
  );

  return NextResponse.json({ ok: true });
}
