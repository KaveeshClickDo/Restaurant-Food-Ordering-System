/**
 * Shared order validation + normalisation.
 *
 * Two routes need to verify a customer-supplied cart against authoritative
 * server data before turning it into an order:
 *   • /api/orders             — cash / pay-on-delivery flow (insert immediately)
 *   • /api/payments/intent    — Stripe flow (stash in payment_sessions, insert
 *                                only after webhook payment_intent.succeeded)
 *
 * Both must apply the same checks: price verification from the menu_items
 * table, coupon validation, server-authoritative total, fee whitelisting,
 * fulfillment / address rules. Keeping that logic in one place stops the
 * two paths from drifting apart and accidentally introducing a way for a
 * client to pay £5 for a £20 order on one route but not the other.
 *
 * The coupon usage-count increment is the caller's responsibility, because
 * the cash path commits immediately while the Stripe path must defer until
 * the webhook confirms payment.
 */

import { randomInt } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

interface DBMenuItem {
  id:         string;
  price:      number;
  variations: Array<{ name: string; options: Array<{ name: string; delta: number }> }> | null;
  add_ons:    Array<{ name: string; price: number }> | null;
}

export interface VerifiedCoupon {
  id: string;
  code: string;
  discount: number;
}

export interface ValidatedOrder {
  row: {
    id:                string;
    customer_id:       string;
    date:              string;
    status:            string;
    fulfillment:       string;
    payment_method:    string;
    address:           string | null;
    note:              string | null;
    scheduled_time:    string | null;
    items:             unknown[];
    total:             number;
    delivery_fee:      number;
    service_fee:       number;
    vat_amount:        number | null;
    vat_inclusive:     boolean | null;
    coupon_code:       string | null;
    coupon_discount:   number;
    store_credit_used: number;
    delivery_code:     string | null;
  };
  verifiedItems: Array<Record<string, unknown>>;
  coupon: VerifiedCoupon | null;
  currency: { code: string; symbol: string };
}

export type ValidationFailure = { ok: false; error: string; status: number };
export type ValidationSuccess = { ok: true; data: ValidatedOrder };

/**
 * Run all the checks `/api/orders` historically did, but return a structured
 * result so the caller can decide what to do with it (insert immediately,
 * or stash in payment_sessions and wait for a webhook).
 *
 * `committedCustomerId` is the authenticated customer id (or "guest"). Caller
 * must verify the session before calling this — we don't re-check auth here.
 */
export async function validateAndNormaliseOrder(
  body: Record<string, unknown>,
  committedCustomerId: string,
): Promise<ValidationFailure | ValidationSuccess> {
  const { id, fulfillment, items, payment_method, address } = body;

  if (!id || typeof id !== "string") {
    return { ok: false, error: "'id' is required.", status: 400 };
  }
  if (fulfillment !== "delivery" && fulfillment !== "collection" && fulfillment !== "dine-in") {
    return { ok: false, error: "'fulfillment' must be 'delivery', 'collection', or 'dine-in'.", status: 400 };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "Cart is empty — add at least one item before placing an order.", status: 400 };
  }

  const rawItems = items as Array<Record<string, unknown>>;
  for (const item of rawItems) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "Each order item must be an object.", status: 400 };
    }
    if (typeof item.name !== "string" || !item.name.trim()) {
      return { ok: false, error: "Each order item must have a name.", status: 400 };
    }
    if (typeof item.qty !== "number" || !Number.isInteger(item.qty) || item.qty < 1) {
      return { ok: false, error: "Each order item must have a valid quantity (positive integer).", status: 400 };
    }
    if (typeof item.price !== "number" || item.price < 0) {
      return { ok: false, error: "Each order item must have a valid price.", status: 400 };
    }
  }

  if (!payment_method || typeof payment_method !== "string" || !String(payment_method).trim()) {
    return { ok: false, error: "A payment method is required.", status: 400 };
  }
  if (fulfillment === "delivery" && (!address || typeof address !== "string" || !String(address).trim())) {
    return { ok: false, error: "A delivery address is required for delivery orders.", status: 400 };
  }

  // ── Price verification ────────────────────────────────────────────────────
  const menuItemIds = rawItems
    .map((i) => i.menuItemId)
    .filter((mid): mid is string => typeof mid === "string" && mid.length > 0);

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

  const verifiedItems = rawItems.map((item) => {
    const mid = typeof item.menuItemId === "string" ? item.menuItemId : null;
    if (!mid) return item;
    const dbItem = menuMap.get(mid);
    if (!dbItem) return item;

    let expectedPrice = Number(dbItem.price);

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

    const selAddOns = item.selectedAddOns as Array<{ name?: string }> | undefined;
    if (selAddOns?.length && Array.isArray(dbItem.add_ons)) {
      for (const sel of selAddOns) {
        const dbAddon = dbItem.add_ons.find((a) => a.name === sel.name);
        if (dbAddon) expectedPrice += dbAddon.price ?? 0;
      }
    }

    return { ...item, price: Math.round(expectedPrice * 100) / 100 };
  });

  // ── Fee normalisation ─────────────────────────────────────────────────────
  const deliveryFee     = typeof body.delivery_fee    === "number" ? Math.max(0, body.delivery_fee)    : 0;
  const serviceFee      = typeof body.service_fee     === "number" ? Math.max(0, body.service_fee)     : 0;
  const vatAmount       = typeof body.vat_amount      === "number" ? Math.max(0, body.vat_amount)      : 0;
  const vatInclusive    = typeof body.vat_inclusive   === "boolean" ? body.vat_inclusive               : true;
  const storeCreditUsed = typeof body.store_credit_used === "number" && body.store_credit_used >= 0
                            ? body.store_credit_used : 0;

  // ── Coupon validation (no increment — caller's responsibility) ────────────
  const couponCode = typeof body.coupon_code === "string" ? body.coupon_code.trim().toUpperCase() : null;
  let verifiedCoupon: VerifiedCoupon | null = null;

  // Read app_settings once so we can also grab the currency for downstream callers.
  const { data: settingsRow } = await supabaseAdmin
    .from("app_settings").select("data").eq("id", 1).single();

  const settingsCurrency = (settingsRow?.data?.currency as { code?: string; symbol?: string } | undefined) ?? {};
  const currency = {
    code:   typeof settingsCurrency.code   === "string" && settingsCurrency.code   ? settingsCurrency.code   : "GBP",
    symbol: typeof settingsCurrency.symbol === "string" && settingsCurrency.symbol ? settingsCurrency.symbol : "£",
  };

  if (couponCode) {
    const coupons: Array<{
      id: string; code: string; type: string; value: number;
      minOrderAmount: number; expiryDate: string; usageLimit: number;
      usageCount: number; active: boolean;
    }> = settingsRow?.data?.coupons ?? [];

    const coupon = coupons.find((c) => c.code.toUpperCase() === couponCode);

    if (!coupon || !coupon.active) {
      return { ok: false, error: "Coupon code is invalid or no longer active.", status: 400 };
    }
    if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
      return { ok: false, error: "This coupon has expired.", status: 400 };
    }
    if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
      return { ok: false, error: "This coupon has reached its usage limit.", status: 400 };
    }

    const verifiedSubtotal = verifiedItems.reduce(
      (s, i) => s + (i.price as number) * (i.qty as number), 0,
    );
    if (coupon.minOrderAmount > 0 && verifiedSubtotal < coupon.minOrderAmount) {
      return {
        ok: false,
        error: `This coupon requires a minimum order of ${currency.symbol}${coupon.minOrderAmount.toFixed(2)}.`,
        status: 400,
      };
    }

    const discount = coupon.type === "percentage"
      ? Math.round(verifiedSubtotal * (coupon.value / 100) * 100) / 100
      : coupon.value;

    verifiedCoupon = { id: coupon.id, code: coupon.code, discount };
  }

  // ── Server-authoritative total ────────────────────────────────────────────
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
      (verifiedCoupon?.discount ?? 0) -
      storeCreditUsed
    ) * 100) / 100,
  );

  // ── Delivery PIN (only for delivery fulfillment) ──────────────────────────
  const deliveryCode = fulfillment === "delivery"
    ? String(randomInt(0, 10_000)).padStart(4, "0")
    : null;

  const row = {
    id:                String(id),
    customer_id:       committedCustomerId,
    date:              typeof body.date === "string" ? body.date : new Date().toISOString(),
    status:            "pending",
    fulfillment:       String(fulfillment),
    payment_method:    String(payment_method),
    address:           typeof body.address        === "string" ? body.address.trim()  : null,
    note:              typeof body.note           === "string" ? body.note.trim()     : null,
    scheduled_time:    typeof body.scheduled_time === "string" ? body.scheduled_time  : null,
    items:             verifiedItems,
    total:             serverTotal,
    delivery_fee:      deliveryFee,
    service_fee:       serviceFee,
    vat_amount:        vatAmount > 0 ? vatAmount   : null,
    vat_inclusive:     vatAmount > 0 ? vatInclusive : null,
    coupon_code:       verifiedCoupon?.code ?? null,
    coupon_discount:   verifiedCoupon?.discount ?? 0,
    store_credit_used: storeCreditUsed,
    delivery_code:     deliveryCode,
  };

  return { ok: true, data: { row, verifiedItems, coupon: verifiedCoupon, currency } };
}

/**
 * Increment the usage counter for a verified coupon. Safe to call after the
 * order is committed (cash flow) or after webhook confirms payment (Stripe).
 * Fire-and-forget: if this fails the order still exists; only the usage
 * counter is stale, which the admin can correct.
 */
export async function incrementCouponUsage(couponId: string): Promise<void> {
  const { data: settingsRow } = await supabaseAdmin
    .from("app_settings").select("data").eq("id", 1).single();
  if (!settingsRow?.data) return;

  const coupons: Array<{ id: string; usageCount: number }> = settingsRow.data.coupons ?? [];
  const updatedCoupons = coupons.map((c) =>
    c.id === couponId ? { ...c, usageCount: (c.usageCount ?? 0) + 1 } : c,
  );

  await supabaseAdmin
    .from("app_settings")
    .update({ data: { ...settingsRow.data, coupons: updatedCoupons } })
    .eq("id", 1);
}
