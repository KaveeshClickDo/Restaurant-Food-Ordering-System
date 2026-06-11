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
import { resolveDeliveryZoneFee, findZoneForDistance, haversineKm, type DeliveryZoneShape } from "@/lib/geocode";
import { lookupActiveGiftCard, clampGiftCardAmount } from "@/lib/giftCardValidation";
import type { MenuItemOffer, MenuChannel } from "@/types";

interface DBMenuItem {
  id:           string;
  name:         string;
  price:        number;
  price_online: number | null;
  channels:     MenuChannel[] | null;
  active:       boolean | null;
  offer:        MenuItemOffer | null;
  // Stock fields — used to reject orders for unavailable items before we
  // create a PaymentIntent (card flow) or insert the order (cash flow). The
  // authoritative server-side enforcement still happens in the atomic
  // decrement, but a pre-check here gives the customer a clean error and
  // prevents charging a card for something we can't supply.
  track_stock:  boolean | null;
  stock_qty:    number | null;
  stock_status: string | null;
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
 * True if `offer` is set, marked active, falls within its date window AND
 * applies on `channel`. Mirrors `isOfferActive` in src/lib/menuOfferUtils.ts
 * and `offerDateOk` in src/types/pos.ts so client and server agree on what
 * "active" means.
 */
function isOfferLive(
  offer: MenuItemOffer | null | undefined,
  channel: MenuChannel,
): offer is MenuItemOffer {
  if (!offer?.active) return false;
  const now = new Date();
  if (offer.startDate && new Date(offer.startDate) > now) return false;
  if (offer.endDate   && new Date(offer.endDate + "T23:59:59") < now) return false;
  if (offer.channels && offer.channels.length > 0 && !offer.channels.includes(channel)) return false;
  return true;
}

/**
 * Server-authoritative per-unit base price after applying any per-unit offer
 * (percent / fixed / price). Cart-level offers (bogo/multibuy/qty_discount)
 * are handled in `serverLineTotal` instead — they leave the unit price alone.
 */
function applyPerUnitOffer(
  basePrice: number,
  offer: MenuItemOffer | null | undefined,
  channel: MenuChannel,
): number {
  if (!isOfferLive(offer, channel)) return basePrice;
  switch (offer.type) {
    case "percent": return Math.max(0, parseFloat((basePrice * (1 - offer.value / 100)).toFixed(2)));
    case "fixed":   return Math.max(0, parseFloat((basePrice - offer.value).toFixed(2)));
    case "price":   return Math.max(0, parseFloat(offer.value.toFixed(2)));
    default:        return basePrice;
  }
}

/**
 * Authoritative total for a single line, applying cart-level offers. Per-unit
 * discounts must already be in `unitPrice` (see applyPerUnitOffer).
 */
function serverLineTotal(
  qty: number,
  unitPrice: number,
  offer: MenuItemOffer | null | undefined,
  channel: MenuChannel,
): number {
  if (!isOfferLive(offer, channel)) return parseFloat((unitPrice * qty).toFixed(2));
  switch (offer.type) {
    case "bogo": {
      const buyN = Math.max(1, offer.buyQty  ?? 1);
      const getN = Math.max(1, offer.freeQty ?? 1);
      const groupSize = buyN + getN;
      const paid = Math.floor(qty / groupSize) * buyN + Math.min(qty % groupSize, buyN);
      return parseFloat((paid * unitPrice).toFixed(2));
    }
    case "multibuy": {
      const need = Math.max(2, offer.buyQty ?? 2);
      const groups = Math.floor(qty / need);
      const rem    = qty % need;
      return parseFloat((groups * offer.value + rem * unitPrice).toFixed(2));
    }
    case "qty_discount": {
      const minQ = Math.max(2, offer.minQty ?? 2);
      if (qty >= minQ) return parseFloat((unitPrice * qty * (1 - offer.value / 100)).toFixed(2));
      return parseFloat((unitPrice * qty).toFixed(2));
    }
    default:
      return parseFloat((unitPrice * qty).toFixed(2));
  }
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
    gift_card_id:      string | null;
    gift_card_used:    number;
    delivery_code:     string | null;
    customer_lat:      number | null;
    customer_lng:      number | null;
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

  // Customer flow is always the `online` channel. Used to pick the right
  // base price, filter inactive-channel items, and gate per-channel offers.
  const orderChannel: MenuChannel = "online";

  let menuMap = new Map<string, DBMenuItem>();
  if (menuItemIds.length > 0) {
    const { data: menuRows } = await supabaseAdmin
      .from("menu_items")
      .select("id, name, price, price_online, channels, active, offer, variations, add_ons, track_stock, stock_qty, stock_status")
      .in("id", menuItemIds);
    menuMap = new Map(
      (menuRows ?? []).map((r) => [r.id as string, r as unknown as DBMenuItem]),
    );
  }

  // Aggregate requested qty per menu item id so the stock pre-check below
  // catches "3 x burger + 2 x burger in two cart lines" as 5 against stock.
  const requestedQtyByMenuId = new Map<string, number>();
  for (const item of rawItems) {
    const mid = typeof item.menuItemId === "string" ? item.menuItemId : null;
    if (!mid) continue;
    const qty = typeof item.qty === "number" ? Math.max(0, Math.floor(item.qty)) : 0;
    if (qty <= 0) continue;
    requestedQtyByMenuId.set(mid, (requestedQtyByMenuId.get(mid) ?? 0) + qty);
  }

  const verifiedItems: Array<Record<string, unknown>> = [];
  for (const item of rawItems) {
    const mid = typeof item.menuItemId === "string" ? item.menuItemId : null;
    if (!mid) { verifiedItems.push(item); continue; }
    const dbItem = menuMap.get(mid);
    // Reject items whose menu row no longer exists. Admin's "Delete item"
    // hard-deletes the row, so a cart built before the delete would otherwise
    // slip through here at the client-supplied price (no DB row to verify
    // against). Treat a missing row the same as a deactivated one.
    if (!dbItem) {
      const itemName = typeof item.name === "string" && item.name.trim() ? item.name : "item";
      return {
        ok: false,
        error: `'${itemName}' is no longer available. Please remove it from your cart.`,
        status: 400,
      };
    }

    // Reject items that admin has flipped off the menu since the cart was
    // built. Without this an open cart can place an order for an item that
    // the kitchen no longer offers. A null active column (legacy rows that
    // never had the column) is treated as available.
    if (dbItem.active === false) {
      const itemName = dbItem.name || (typeof item.name === "string" ? item.name : "item");
      return {
        ok: false,
        error: `'${itemName}' is no longer available. Please remove it from your cart.`,
        status: 400,
      };
    }
    // Reject items that admin removed from the online channel since the cart
    // was built. Legacy rows with null/empty channels still appear online.
    const itemChannels = dbItem.channels;
    if (Array.isArray(itemChannels) && itemChannels.length > 0 && !itemChannels.includes(orderChannel)) {
      const itemName = dbItem.name || (typeof item.name === "string" ? item.name : "item");
      return {
        ok: false,
        error: `'${itemName}' is no longer available for online orders. Please remove it from your cart.`,
        status: 400,
      };
    }

    // Stock pre-check. The atomic decrement is still the source of truth at
    // commit time, but pre-checking here gives the customer a clean 400
    // BEFORE we create a PaymentIntent (card flow) or insert (cash flow).
    // Manual "out_of_stock" wins on every channel; track-quantity rows are
    // rejected when the aggregate cart qty exceeds stock_qty.
    const itemName = dbItem.name || (typeof item.name === "string" ? item.name : "item");
    const isTracked = dbItem.track_stock === true && typeof dbItem.stock_qty === "number";
    if (!isTracked && dbItem.stock_status === "out_of_stock") {
      return {
        ok: false,
        error: `'${itemName}' is out of stock. Please remove it from your cart.`,
        status: 400,
      };
    }
    if (isTracked) {
      const requested = requestedQtyByMenuId.get(mid) ?? 0;
      const available = Math.max(0, Number(dbItem.stock_qty));
      if (requested > available) {
        return {
          ok: false,
          error: available > 0
            ? `'${itemName}' only has ${available} left in stock.`
            : `'${itemName}' is out of stock. Please remove it from your cart.`,
          status: 400,
        };
      }
    }

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

    // Recompute the authoritative price: base price (with per-unit offer
    // applied if active) + every variation delta + every add-on price. We
    // sum across ALL selected variation groups, not just the first one (the
    // old code stopped after one match).
    //
    // Per-unit offers (percent/fixed/price) discount the BASE only; cart-
    // level offers (bogo/multibuy/qty_discount) leave the per-unit price
    // alone and apply when the line total is summed below. Channel-aware:
    // an offer marked online-only won't fire on a POS-flow path (none yet,
    // but the helpers stay consistent).
    const liveOffer = isOfferLive(dbItem.offer, orderChannel) ? dbItem.offer : null;
    // Customer site uses price_online when set; falls back to base price.
    const baseForChannel = dbItem.price_online !== null && dbItem.price_online !== undefined
      ? Number(dbItem.price_online)
      : Number(dbItem.price);
    let expectedPrice = applyPerUnitOffer(baseForChannel, liveOffer, orderChannel);

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

    // Strip any client-sent offer first so a stale snapshot can't leak into
    // orders.items when the server has decided the offer isn't live.
    const { offer: _clientOffer, ...itemWithoutOffer } = item;
    void _clientOffer;
    verifiedItems.push({
      ...itemWithoutOffer,
      price: Math.round(expectedPrice * 100) / 100,
      // Snapshot the server-verified offer onto the line so the orders.items
      // jsonb is a faithful audit record. Refunds + reports key off this.
      ...(liveOffer ? { offer: liveOffer } : {}),
    });
  }

  // ── Fee normalisation ─────────────────────────────────────────────────────
  // `delivery_fee` from the client is treated as a hint only. For delivery
  // orders with admin-configured zones, the authoritative fee is computed
  // server-side from the address below (see "Delivery zone enforcement").
  let   deliveryFee     = typeof body.delivery_fee    === "number" ? Math.max(0, body.delivery_fee)    : 0;
  const serviceFee      = typeof body.service_fee     === "number" ? Math.max(0, body.service_fee)     : 0;
  const vatAmount       = typeof body.vat_amount      === "number" ? Math.max(0, body.vat_amount)      : 0;
  const vatInclusive    = typeof body.vat_inclusive   === "boolean" ? body.vat_inclusive               : true;
  // The browser's PROPOSED store-credit amount. NEVER trusted directly — it is
  // clamped against the customer's real balance + the amount owed below (the
  // same treatment the gift card gets). Before this, the claim was subtracted
  // from the total with no balance check, so a crafted request could discount
  // an order to £0 with no credit behind it.
  const storeCreditClaim = typeof body.store_credit_used === "number" && body.store_credit_used >= 0
                            ? body.store_credit_used : 0;

  // Gift card claim — we accept the code + the amount the browser proposes
  // to use, then server-side validate the card exists, isn't expired, and
  // the claim is capped by the card's balance.
  const giftCardCode = typeof body.gift_card_code === "string" && body.gift_card_code.trim()
                         ? body.gift_card_code.trim()
                         : null;
  const giftCardClaim = typeof body.gift_card_used === "number" && body.gift_card_used >= 0
                          ? body.gift_card_used
                          : 0;

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
  // If admin configured zones and the order is for delivery, compute the
  // authoritative delivery_fee server-side and override whatever the client
  // sent. This stops a tampered client from paying a £0 fee for a £5 zone.
  //
  // Preference order for distance:
  //   1. Customer-supplied pin coords (customer_lat/customer_lng) — exact,
  //      no Nominatim call, no rate limit.
  //   2. Geocode of the address string — fallback for string-only orders.
  //
  // The pin is sanity-checked: only used if both lat/lng are finite numbers in
  // valid ranges. A malformed pin falls through to geocoding (same path as
  // before this column existed).
  const rawCustLat = typeof body.customer_lat === "number" ? body.customer_lat : null;
  const rawCustLng = typeof body.customer_lng === "number" ? body.customer_lng : null;
  const pinIsValid = rawCustLat != null && rawCustLng != null
    && Number.isFinite(rawCustLat) && Number.isFinite(rawCustLng)
    && Math.abs(rawCustLat) <= 90 && Math.abs(rawCustLng) <= 180;
  const custLat = pinIsValid ? rawCustLat : null;
  const custLng = pinIsValid ? rawCustLng : null;

  if (fulfillment === "delivery" && typeof body.address === "string" && body.address.trim()) {
    const rawZones = (settingsRow?.data?.deliveryZones ?? []) as DeliveryZoneShape[];
    const enabledZones = rawZones.filter((z) => z && z.enabled);

    const settingsRestaurant = (settingsRow?.data?.restaurant ?? {}) as {
      lat?: number; lng?: number; deliveryFee?: number;
    };
    const restaurantDefaultFee = typeof settingsRestaurant.deliveryFee === "number"
      ? Math.max(0, settingsRestaurant.deliveryFee)
      : 0;

    const zonesActive = enabledZones.length > 0;
    const haveRestaurantCoords =
      typeof settingsRestaurant.lat === "number" && typeof settingsRestaurant.lng === "number";

    if (zonesActive && !haveRestaurantCoords) {
      // Misconfiguration: admin enabled zones but never pinned the restaurant.
      // The client UI computes zone fees against a London fallback (51.515,
      // -0.063), so without this guard we'd silently charge restaurantDefaultFee
      // while the customer was shown a zone fee. Refuse rather than allow the
      // mismatch — the admin must set the restaurant coords first.
      return {
        ok: false,
        error: "Delivery is temporarily unavailable. Please contact the restaurant.",
        status: 400,
      };
    }

    if (zonesActive) {
      // restaurantLat/restaurantLng are narrowed by the guard above.
      const restLat = settingsRestaurant.lat as number;
      const restLng = settingsRestaurant.lng as number;

      let usedPin = false;
      if (custLat != null && custLng != null) {
        // Fast path: trust the customer-supplied pin.
        const distKm = haversineKm(restLat, restLng, custLat, custLng);
        const zone = findZoneForDistance(distKm, enabledZones);
        if (zone) {
          deliveryFee = Math.max(0, zone.fee);
          usedPin = true;
        } else {
          return {
            ok: false,
            error: "Your delivery address is outside our service area.",
            status: 400,
          };
        }
      }
      if (!usedPin) {
        const lookup = await resolveDeliveryZoneFee(
          body.address.trim(),
          restLat,
          restLng,
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
          // Geocoding failed (network blip, address not found, etc.) AND the
          // customer didn't drop a pin we could fall back to. Don't silently
          // substitute restaurantDefaultFee — the customer was shown the zone
          // fee on screen, charging anything different is a mismatch. Reject
          // and prompt them to pin their location (the checkout map supports
          // this and persists the pin on retry).
          return {
            ok: false,
            error: "We couldn't verify your delivery distance from your address. Please drop a pin on the map to confirm your exact location, then try again.",
            status: 400,
          };
        }
      }
    } else {
      // No zones configured at all — the single global restaurant delivery fee
      // is the customer's expected fee, so this fallback is legitimate.
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
      (s, i) => s + serverLineTotal(
        Number(i.qty),
        Number(i.price),
        (i.offer as MenuItemOffer | undefined) ?? null,
        orderChannel,
      ),
      0,
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
  // serverLineTotal applies any cart-level offer snapshotted on the line
  // (per-unit offer is already baked into i.price by applyPerUnitOffer above).
  const itemsSubtotal = verifiedItems.reduce(
    (s, i) => s + serverLineTotal(
      Number(i.qty),
      Number(i.price),
      (i.offer as MenuItemOffer | undefined) ?? null,
      orderChannel,
    ),
    0,
  );
  // Total after coupon but BEFORE store credit + gift card are applied.
  const preStoreCreditTotal = Math.max(
    0,
    Math.round((
      itemsSubtotal +
      deliveryFee +
      serviceFee +
      (vatInclusive ? 0 : vatAmount) -
      (verifiedCoupon?.discount ?? 0)
    ) * 100) / 100,
  );

  // ── Store credit clamp (server-authoritative) ─────────────────────────────
  // Look up the customer's REAL balance and cap the spend at
  // min(claim, balance, amount owed). The guest / POS sentinels have no real
  // balance. This is what makes "store_credit_used: 9999" impossible — the
  // total can never be discounted below what the balance actually backs.
  let storeCreditUsed = 0;
  if (
    storeCreditClaim > 0 &&
    committedCustomerId &&
    committedCustomerId !== "guest" &&
    committedCustomerId !== "pos-walk-in"
  ) {
    const { data: cust } = await supabaseAdmin
      .from("customers").select("store_credit").eq("id", committedCustomerId).maybeSingle();
    const balance = Number(cust?.store_credit ?? 0);
    storeCreditUsed = Math.max(0, Math.round(Math.min(storeCreditClaim, balance, preStoreCreditTotal) * 100) / 100);
  }

  // Running total before gift card — coupon + store credit have been applied.
  // Gift card claim is capped by min(card.balance, runningTotal).
  const runningTotal = Math.max(
    0,
    Math.round((preStoreCreditTotal - storeCreditUsed) * 100) / 100,
  );

  // ── Gift card validation + clamp ──────────────────────────────────────────
  // We look up the card (if a code was supplied), verify it's redeemable
  // right now, and clamp the claimed amount to min(balance, runningTotal).
  // The clamp is what server-side total recomputation guarantees — the
  // browser cannot inflate the amount beyond what's actually available.
  let giftCardId: string | null = null;
  let giftCardUsed = 0;
  if (giftCardCode && giftCardClaim > 0) {
    const result = await lookupActiveGiftCard(giftCardCode);
    if (!result.ok) {
      return { ok: false, error: result.message, status: 400 };
    }
    giftCardId   = result.card.id;
    giftCardUsed = clampGiftCardAmount({
      cardBalance:  result.card.balance,
      runningTotal,
      requested:    giftCardClaim,
    });
  }

  const serverTotal = Math.max(
    0,
    Math.round((runningTotal - giftCardUsed) * 100) / 100,
  );

  // ── Stale-balance guard ───────────────────────────────────────────────────
  // The card couldn't cover what the client applied: clampGiftCardAmount
  // reduced the claim (giftCardUsed < giftCardClaim) AND a real remainder is
  // left (serverTotal > 0). This is the concurrent/stale-balance case — another
  // order or browser tab spent the card between the customer's balance lookup
  // and this submit. The client may have shown "fully covered" and hidden the
  // payment tiles, so placing the order anyway would create one whose remainder
  // has NO way to be collected: it's tagged 'Gift card / credit' (a driver
  // never knows to collect cash) and no card was charged. Reject so the client
  // re-fetches the true balance and re-prompts the customer to pay the rest.
  // (Note: a legitimate partial gift-card payment sends a claim equal to the
  // real balance, so giftCardClaim === giftCardUsed and this never fires; an
  // over-claim relative to the order total leaves serverTotal === 0, also safe.)
  if (giftCardCode && giftCardClaim > giftCardUsed + 0.001 && serverTotal > 0.001) {
    return {
      ok: false,
      error: "Your gift card balance changed and no longer covers this order. Please review the remaining amount and choose how to pay.",
      status: 409,
    };
  }

  // Same stale-balance guard for store credit: the customer's credit dropped
  // (another order/tab spent it) so the clamp reduced the claim and a real
  // remainder is left. Refuse rather than place an order the client thought was
  // covered — the client re-fetches the balance and re-prompts for payment.
  if (storeCreditClaim > storeCreditUsed + 0.001 && serverTotal > 0.001) {
    return {
      ok: false,
      error: "Your store credit balance changed and no longer covers this order. Please review the remaining amount and choose how to pay.",
      status: 409,
    };
  }

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
    gift_card_id:      giftCardId,
    gift_card_used:    giftCardUsed,
    delivery_code:     deliveryCode,
    customer_lat:      fulfillment === "delivery" ? custLat : null,
    customer_lng:      fulfillment === "delivery" ? custLng : null,
  };

  return { ok: true, data: { row, verifiedItems, coupon: verifiedCoupon, currency } };
}

// NOTE: server-side coupon usage is now claimed atomically via
// `claimCouponUsage` in lib/storeCredit.ts (backed by the row-locked
// `claim_coupon_usage` Postgres function). The old read-modify-write
// `incrementCouponUsage` here rewrote the whole app_settings.data blob and could
// lose concurrent updates / exceed the usage limit under a race — it has been
// removed. (The identically-named client helper in AppContext is unrelated.)
