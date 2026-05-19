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
import { resolveDeliveryZoneFee, type DeliveryZoneShape } from "@/lib/geocode";

interface DBMenuItem {
  id:         string;
  price:      number;
  // JSONB shape produced by the menu editor — see `Variation` in src/types.
  // Older seeds used `{ name, delta }` on options; current data uses
  // `{ id, label, price }`. Both forms are accepted by the matcher below.
  variations: Array<{
    id?:       string;
    name:      string;
    required?: boolean;
    options:   Array<{ id?: string; label?: string; price?: number; name?: string; delta?: number }>;
  }> | null;
  add_ons:    Array<{ id?: string; name: string; price: number }> | null;
}

/**
 * Find an option inside one variation group that matches the user's selection.
 * Supports both the new id-based form ({ optionId }) used by the customer
 * site and the legacy name/label form kept around for old persisted orders.
 */
function findVariationOption(
  group: NonNullable<DBMenuItem["variations"]>[number],
  sel:   { optionId?: string; label?: string; name?: string },
): { price: number } | null {
  for (const opt of group.options ?? []) {
    const optLabel = opt.label ?? opt.name;
    if (sel.optionId && opt.id && opt.id === sel.optionId) {
      return { price: opt.price ?? opt.delta ?? 0 };
    }
    if (!sel.optionId && (sel.label || sel.name) && optLabel === (sel.label ?? sel.name)) {
      return { price: opt.price ?? opt.delta ?? 0 };
    }
  }
  return null;
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

  const verifiedItems: Array<Record<string, unknown>> = [];
  for (const item of rawItems) {
    const mid = typeof item.menuItemId === "string" ? item.menuItemId : null;
    if (!mid) { verifiedItems.push(item); continue; }
    const dbItem = menuMap.get(mid);
    if (!dbItem) { verifiedItems.push(item); continue; }

    // Collect every variation selection the client sent — new `selectedVariations[]`
    // form first, then fall back to the legacy singular field. We key by
    // variationId where available so the server can verify each group.
    const selVarSingular = item.selectedVariation as
      { variationId?: string; optionId?: string; label?: string; name?: string } | undefined;
    const selVarArray = item.selectedVariations as
      Array<{ variationId?: string; optionId?: string; label?: string; name?: string }> | undefined;

    const selections: Array<{ variationId?: string; optionId?: string; label?: string; name?: string }> = [];
    if (Array.isArray(selVarArray)) selections.push(...selVarArray.filter((s) => s && typeof s === "object"));
    if (selVarSingular && typeof selVarSingular === "object") selections.push(selVarSingular);

    // Build a quick map of variationId -> selection for required-check below.
    const selectionByVarId = new Map<string, { optionId?: string; label?: string; name?: string }>();
    const selectionsWithoutVarId: typeof selections = [];
    for (const s of selections) {
      if (s.variationId) selectionByVarId.set(s.variationId, s);
      else selectionsWithoutVarId.push(s);
    }

    // Enforce required variations. A variation group is required unless it
    // is explicitly `required: false`. This matches the customer modal logic
    // and protects against hand-crafted payloads that skip the UI.
    if (Array.isArray(dbItem.variations)) {
      for (const group of dbItem.variations) {
        const isRequired = group.required !== false;
        if (!isRequired) continue;
        const hasSelection = (group.id && selectionByVarId.has(group.id))
          || selectionsWithoutVarId.some((s) =>
            findVariationOption(group, s) !== null,
          );
        if (!hasSelection) {
          const itemName = typeof item.name === "string" ? item.name : "item";
          return {
            ok: false,
            error: `Item '${itemName}' is missing a required selection (${group.name}).`,
            status: 400,
          };
        }
      }
    }

    // Recompute the authoritative price: base price + every variation delta
    // + every add-on price. We sum across ALL selected variation groups,
    // not just the first one (the old code stopped after one match).
    let expectedPrice = Number(dbItem.price);

    if (Array.isArray(dbItem.variations)) {
      for (const group of dbItem.variations) {
        let sel: { optionId?: string; label?: string; name?: string } | undefined;
        if (group.id) sel = selectionByVarId.get(group.id);
        if (!sel) {
          sel = selectionsWithoutVarId.find((s) => findVariationOption(group, s) !== null);
        }
        if (!sel) continue;
        const match = findVariationOption(group, sel);
        if (match) expectedPrice += match.price;
      }
    }

    const selAddOns = item.selectedAddOns as Array<{ id?: string; name?: string }> | undefined;
    if (selAddOns?.length && Array.isArray(dbItem.add_ons)) {
      for (const sel of selAddOns) {
        const dbAddon = dbItem.add_ons.find((a) =>
          (sel.id && a.id && a.id === sel.id) || a.name === sel.name,
        );
        if (dbAddon) expectedPrice += dbAddon.price ?? 0;
      }
    }

    verifiedItems.push({ ...item, price: Math.round(expectedPrice * 100) / 100 });
  }

  // ── Fee normalisation ─────────────────────────────────────────────────────
  // `delivery_fee` from the client is treated as a hint only. For delivery
  // orders with admin-configured zones, the authoritative fee is computed
  // server-side from the address below (see "Delivery zone enforcement").
  let   deliveryFee     = typeof body.delivery_fee    === "number" ? Math.max(0, body.delivery_fee)    : 0;
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

  // ── Delivery zone enforcement (authoritative fee) ─────────────────────────
  // If admin configured zones and the order is for delivery, geocode the
  // address server-side and override whatever delivery_fee the client sent.
  // This stops a tampered client from paying a £0 fee for a £5 zone.
  if (fulfillment === "delivery" && typeof body.address === "string" && body.address.trim()) {
    const rawZones = (settingsRow?.data?.deliveryZones ?? []) as DeliveryZoneShape[];
    const enabledZones = rawZones.filter((z) => z && z.enabled);

    const settingsRestaurant = (settingsRow?.data?.restaurant ?? {}) as {
      lat?: number; lng?: number; deliveryFee?: number;
    };
    const restaurantDefaultFee = typeof settingsRestaurant.deliveryFee === "number"
      ? Math.max(0, settingsRestaurant.deliveryFee)
      : 0;

    if (enabledZones.length > 0
        && typeof settingsRestaurant.lat === "number"
        && typeof settingsRestaurant.lng === "number") {
      const lookup = await resolveDeliveryZoneFee(
        body.address.trim(),
        settingsRestaurant.lat,
        settingsRestaurant.lng,
        enabledZones,
      );
      if (lookup.kind === "zone") {
        deliveryFee = Math.max(0, lookup.fee);
      } else if (lookup.kind === "outside") {
        return {
          ok: false,
          error: "Your delivery address is outside our service area.",
          status: 400,
        };
      } else {
        // Geocoding failed (network error / address not found). Don't reject
        // the order — fall back to the restaurant default fee so we don't
        // lose the sale, and the admin can correct it manually if needed.
        deliveryFee = restaurantDefaultFee;
      }
    } else {
      // No zones configured (or restaurant lat/lng not set) — use the
      // single global delivery fee from settings.
      deliveryFee = restaurantDefaultFee;
    }
  } else if (fulfillment !== "delivery") {
    // Non-delivery orders never carry a delivery fee.
    deliveryFee = 0;
  }

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
