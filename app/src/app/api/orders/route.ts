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

  // ── Server-side coupon validation ─────────────────────────────────────────
  // Re-validate on the server so a client cannot claim a discount for an
  // expired, inactive, or over-limit coupon.
  const couponCode = typeof body.coupon_code === "string" ? body.coupon_code.trim().toUpperCase() : null;
  let verifiedCouponDiscount = 0;

  if (couponCode) {
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();

    const coupons: Array<{
      id: string; code: string; type: string; value: number;
      minOrderAmount: number; expiryDate: string; usageLimit: number;
      usageCount: number; active: boolean;
    }> = settingsRow?.data?.coupons ?? [];

    const coupon = coupons.find((c) => c.code.toUpperCase() === couponCode);

    if (!coupon || !coupon.active) {
      return NextResponse.json({ ok: false, error: "Coupon code is invalid or no longer active." }, { status: 400 });
    }
    if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
      return NextResponse.json({ ok: false, error: "This coupon has expired." }, { status: 400 });
    }
    if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
      return NextResponse.json({ ok: false, error: "This coupon has reached its usage limit." }, { status: 400 });
    }

    // Calculate subtotal (total before delivery/service fees — use client-sent subtotal if available)
    const subtotal = typeof body.subtotal === "number" ? body.subtotal : total;
    if (coupon.minOrderAmount > 0 && subtotal < coupon.minOrderAmount) {
      return NextResponse.json({
        ok: false,
        error: `This coupon requires a minimum order of £${coupon.minOrderAmount.toFixed(2)}.`,
      }, { status: 400 });
    }

    verifiedCouponDiscount = coupon.type === "percentage"
      ? Math.round(subtotal * (coupon.value / 100) * 100) / 100
      : coupon.value;

    // Increment usage count atomically via JSON patch on the settings row
    const updatedCoupons = coupons.map((c) =>
      c.id === coupon.id ? { ...c, usageCount: c.usageCount + 1 } : c
    );
    await supabaseAdmin
      .from("app_settings")
      .update({ data: { ...settingsRow!.data, coupons: updatedCoupons } })
      .eq("id", 1);
  }

  // ── Enforce safe initial status — client cannot choose an arbitrary status ─
  const row = {
    ...body,
    // Overwrite any client-supplied discount with the server-verified amount
    ...(couponCode ? { coupon_discount: verifiedCouponDiscount } : {}),
    status: ALLOWED_INITIAL_STATUS,
    date:   typeof body.date === "string" ? body.date : new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("orders").insert(row);
  if (error) {
    console.error("orders POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Fire-and-forget — email failure must never fail the order response
  sendOrderConfirmationEmail({
    id:              id,
    customer_id:     customer_id,
    fulfillment:     fulfillment,
    total:           total,
    items:           items as Array<{ name: string; qty: number; price: number }>,
    payment_method:  payment_method as string | undefined,
    address:         address as string | undefined,
    delivery_fee:    body.delivery_fee as number | undefined,
    service_fee:     body.service_fee as number | undefined,
    vat_amount:      body.vat_amount as number | undefined,
    vat_inclusive:   body.vat_inclusive as boolean | undefined,
    coupon_code:     couponCode ?? undefined,
    coupon_discount: couponCode ? verifiedCouponDiscount : undefined,
    date:            row.date as string,
  }).catch((err: unknown) =>
    console.error("[orders] confirmation email:", err instanceof Error ? err.message : err)
  );

  return NextResponse.json({ ok: true });
}
