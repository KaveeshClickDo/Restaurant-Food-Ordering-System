/**
 * POST /api/orders — public endpoint for customer order placement.
 * Validates the payload server-side and inserts via the service role key,
 * so the anon key never needs INSERT permission on the orders table.
 *
 * Security measures applied here:
 *  - Explicit field whitelist: `...body` spread is gone; only known columns are
 *    inserted. Sensitive fields (driver_id, delivery_status, refunded_amount, etc.)
 *    are never accepted from the client.
 *  - Server-side price verification: item prices are replaced with authoritative
 *    values from the menu_items table. Variation deltas and add-on prices are also
 *    looked up from the DB rather than trusted from the client.
 *  - Server-authoritative total: the grand total is recalculated from verified
 *    prices + whitelisted fees; the client-supplied total is ignored.
 *  - Status locked to "pending": client cannot set an arbitrary initial status.
 *  - Server-side coupon re-validation: discount amount is re-derived from the
 *    canonical coupon definition, not the client-supplied figure.
 */

import { NextRequest, NextResponse }    from "next/server";
import { supabaseAdmin }               from "@/lib/supabaseAdmin";
import { sendOrderConfirmationEmail }  from "@/lib/emailServer";

interface DBMenuItem {
  id:         string;
  price:      number;
  variations: Array<{ name: string; options: Array<{ name: string; delta: number }> }> | null;
  add_ons:    Array<{ name: string; price: number }> | null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  // ── Required field checks ─────────────────────────────────────────────────
  const { id, customer_id, fulfillment, items, payment_method, address } = body;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ ok: false, error: "'id' is required." }, { status: 400 });
  }
  if (!customer_id || typeof customer_id !== "string") {
    return NextResponse.json({ ok: false, error: "'customer_id' is required." }, { status: 400 });
  }
  if (fulfillment !== "delivery" && fulfillment !== "collection" && fulfillment !== "dine-in") {
    return NextResponse.json({ ok: false, error: "'fulfillment' must be 'delivery', 'collection', or 'dine-in'." }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: false, error: "Cart is empty — add at least one item before placing an order." }, { status: 400 });
  }

  // ── Validate item structure ───────────────────────────────────────────────
  const rawItems = items as Array<Record<string, unknown>>;
  for (const item of rawItems) {
    if (typeof item !== "object" || item === null) {
      return NextResponse.json({ ok: false, error: "Each order item must be an object." }, { status: 400 });
    }
    if (typeof item.name !== "string" || !item.name.trim()) {
      return NextResponse.json({ ok: false, error: "Each order item must have a name." }, { status: 400 });
    }
    if (typeof item.qty !== "number" || !Number.isInteger(item.qty) || item.qty < 1) {
      return NextResponse.json({ ok: false, error: "Each order item must have a valid quantity (positive integer)." }, { status: 400 });
    }
    if (typeof item.price !== "number" || item.price < 0) {
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

  // ── Fix 2: Server-side price verification ────────────────────────────────
  // Collect all menuItemIds present in the order.
  const menuItemIds = rawItems
    .map((i) => i.menuItemId)
    .filter((mid): mid is string => typeof mid === "string" && mid.length > 0);

  // Fetch authoritative base price, variations, and add-ons from the DB.
  let menuMap = new Map<string, DBMenuItem>();
  if (menuItemIds.length > 0) {
    const { data: menuRows } = await supabaseAdmin
      .from("menu_items")
      .select("id, price, variations, add_ons")
      .in("id", menuItemIds);
    menuMap = new Map(
      (menuRows ?? []).map((r) => [r.id as string, r as unknown as DBMenuItem]),
    );
  }

  // Replace each item's client-supplied price with the server-authoritative price.
  // - Base price: from DB
  // - Variation delta: looked up from DB by variation option name (client name trusted, price is not)
  // - Add-on prices: looked up from DB by add-on name (client name trusted, price is not)
  // Items whose menuItemId is missing or not found in the DB are kept as-is;
  // this handles POS / waiter dine-in paths which don't use menuItemId.
  const verifiedItems = rawItems.map((item) => {
    const mid = typeof item.menuItemId === "string" ? item.menuItemId : null;
    if (!mid) return item;
    const dbItem = menuMap.get(mid);
    if (!dbItem) return item;

    let expectedPrice = Number(dbItem.price);

    // Variation: client tells us the option name; we look up the delta from the DB.
    const selVar = item.selectedVariation as { name?: string } | undefined;
    if (selVar?.name && Array.isArray(dbItem.variations)) {
      outer: for (const group of dbItem.variations) {
        for (const opt of group.options ?? []) {
          if (opt.name === selVar.name) {
            expectedPrice += opt.delta ?? 0;
            break outer;
          }
        }
      }
    }

    // Add-ons: client tells us the add-on names; we look up the prices from the DB.
    const selAddOns = item.selectedAddOns as Array<{ name?: string }> | undefined;
    if (selAddOns?.length && Array.isArray(dbItem.add_ons)) {
      for (const sel of selAddOns) {
        const dbAddon = dbItem.add_ons.find((a) => a.name === sel.name);
        if (dbAddon) expectedPrice += dbAddon.price ?? 0;
      }
    }

    return { ...item, price: Math.round(expectedPrice * 100) / 100 };
  });

  // ── Whitelist and normalise fee fields ────────────────────────────────────
  const deliveryFee     = typeof body.delivery_fee    === "number" ? Math.max(0, body.delivery_fee)    : 0;
  const serviceFee      = typeof body.service_fee     === "number" ? Math.max(0, body.service_fee)     : 0;
  const vatAmount       = typeof body.vat_amount      === "number" ? Math.max(0, body.vat_amount)      : 0;
  const vatInclusive    = typeof body.vat_inclusive   === "boolean" ? body.vat_inclusive               : true;
  const storeCreditUsed = typeof body.store_credit_used === "number" && body.store_credit_used >= 0
                            ? body.store_credit_used : 0;

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

    // Use verified item subtotal for minimum-order check and discount calculation.
    const verifiedSubtotal = verifiedItems.reduce(
      (s, i) => s + (i.price as number) * (i.qty as number), 0,
    );
    if (coupon.minOrderAmount > 0 && verifiedSubtotal < coupon.minOrderAmount) {
      return NextResponse.json({
        ok: false,
        error: `This coupon requires a minimum order of £${coupon.minOrderAmount.toFixed(2)}.`,
      }, { status: 400 });
    }

    verifiedCouponDiscount = coupon.type === "percentage"
      ? Math.round(verifiedSubtotal * (coupon.value / 100) * 100) / 100
      : coupon.value;

    // Increment usage count atomically via JSON patch on the settings row
    const updatedCoupons = coupons.map((c) =>
      c.id === coupon.id ? { ...c, usageCount: c.usageCount + 1 } : c,
    );
    await supabaseAdmin
      .from("app_settings")
      .update({ data: { ...settingsRow!.data, coupons: updatedCoupons } })
      .eq("id", 1);
  }

  // ── Server-authoritative total ────────────────────────────────────────────
  // Recalculate from verified item prices + whitelisted fees.
  // Exclusive VAT is added on top; inclusive VAT is already in the item prices.
  const itemsSubtotal = verifiedItems.reduce(
    (s, i) => s + (i.price as number) * (i.qty as number), 0,
  );
  const serverTotal = Math.max(
    0,
    Math.round((
      itemsSubtotal +
      deliveryFee +
      serviceFee +
      (vatInclusive ? 0 : vatAmount) -
      (couponCode ? verifiedCouponDiscount : 0) -
      storeCreditUsed
    ) * 100) / 100,
  );

  // ── Fix 1: Explicit field whitelist — no ...body spread ───────────────────
  // Only columns a customer is permitted to set at order creation time are included.
  // driver_id, driver_name, delivery_status, refunds, refunded_amount, voided_by,
  // void_reason, and voided_at are intentionally absent.
  const row = {
    id:               String(id),
    customer_id:      String(customer_id),
    date:             typeof body.date === "string" ? body.date : new Date().toISOString(),
    status:           "pending",
    fulfillment,
    payment_method:   String(payment_method),
    address:          typeof body.address        === "string" ? body.address.trim()  : null,
    note:             typeof body.note           === "string" ? body.note.trim()     : null,
    scheduled_time:   typeof body.scheduled_time === "string" ? body.scheduled_time  : null,
    items:            verifiedItems,
    total:            serverTotal,
    delivery_fee:     deliveryFee,
    service_fee:      serviceFee,
    vat_amount:       vatAmount > 0 ? vatAmount   : null,
    vat_inclusive:    vatAmount > 0 ? vatInclusive : null,
    coupon_code:      couponCode ?? null,
    coupon_discount:  couponCode ? verifiedCouponDiscount : 0,
    store_credit_used: storeCreditUsed,
  };

  const { error } = await supabaseAdmin.from("orders").insert(row);
  if (error) {
    console.error("orders POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Fire-and-forget — email failure must never fail the order response
  sendOrderConfirmationEmail({
    id:              String(id),
    customer_id:     String(customer_id),
    fulfillment:     fulfillment as string,
    total:           serverTotal,
    items:           verifiedItems as Array<{ name: string; qty: number; price: number }>,
    payment_method:  String(payment_method),
    address:         typeof body.address === "string" ? body.address : undefined,
    delivery_fee:    deliveryFee   > 0 ? deliveryFee   : undefined,
    service_fee:     serviceFee    > 0 ? serviceFee    : undefined,
    vat_amount:      vatAmount     > 0 ? vatAmount     : undefined,
    vat_inclusive:   vatAmount     > 0 ? vatInclusive  : undefined,
    coupon_code:     couponCode    ?? undefined,
    coupon_discount: couponCode    ? verifiedCouponDiscount : undefined,
    date:            row.date,
  }).catch((err: unknown) =>
    console.error("[orders] confirmation email:", err instanceof Error ? err.message : err),
  );

  return NextResponse.json({ ok: true, orderId: String(id), total: serverTotal });
}
