/**
 * Customer-side offer math for `MenuItem` / `CartItem`.
 *
 * Mirrors the POS implementation in `src/types/pos.ts` so behaviour is
 * identical across the in-store and online channels. The split between this
 * file and the POS helpers is purely shape-based (POSProduct/POSCartItem vs
 * MenuItem/CartItem); the rules are the same.
 *
 * Convention:
 *  • Per-unit offers (percent, fixed, price) discount the item's *base*
 *    price only — variation/add-on extras are NOT discounted. The
 *    discounted unit price is baked into `CartItem.price` at add-to-cart
 *    time, so cart-level math here only handles bogo / multibuy /
 *    qty_discount.
 *  • Cart-level offers are snapshotted on the cart line at add time
 *    (`CartItem.offer`) so a mid-cart admin change does not retroactively
 *    rewrite a line. Server-side validation re-applies against the current
 *    DB state and may reject expired offers at order time.
 */

import type { MenuItem, MenuItemOffer, MenuChannel } from "@/types";

/** Minimum shape the cart-line math needs. CartItem satisfies this; so does
 *  any other in-app cart-line shape (waiter dine-in passes its own structural
 *  object). Keeps the customer-site CartItem callers working unchanged. */
type OfferLine = { price: number; quantity: number; offer?: MenuItemOffer };

/** The customer site always reads in the 'online' channel; helpers default to
 *  this so callers don't have to thread the channel through every call. */
const DEFAULT_CHANNEL: MenuChannel = "online";

/** True if the offer's date window covers `now`. Inclusive on both ends. */
function offerDateOk(o: MenuItemOffer): boolean {
  const now = new Date();
  if (o.startDate && new Date(o.startDate) > now) return false;
  if (o.endDate   && new Date(o.endDate + "T23:59:59") < now) return false;
  return true;
}

/** True if the offer is configured to apply on `channel`. Empty / missing
 *  `offer.channels` means the offer is unrestricted (applies everywhere the
 *  item itself appears). */
function offerChannelOk(o: MenuItemOffer, channel: MenuChannel): boolean {
  if (!o.channels || o.channels.length === 0) return true;
  return o.channels.includes(channel);
}

/**
 * Effective per-unit price for the given channel. POS / Waiter always use the
 * base price; the customer site uses `priceOnline` when set, otherwise falls
 * back to `price`. Per-unit offer discounts are NOT included here — see
 * `getOfferUnitPrice`.
 */
export function effectiveMenuPrice(
  item: MenuItem | null | undefined,
  channel: MenuChannel = DEFAULT_CHANNEL,
): number {
  if (!item) return 0;
  if (channel === "online" && typeof item.priceOnline === "number") return item.priceOnline;
  return item.price;
}

/** True if `item` is configured to appear on `channel`. Legacy rows without
 *  a `channels` value default to appearing on both. */
export function isOnChannel(
  item: MenuItem | null | undefined,
  channel: MenuChannel = DEFAULT_CHANNEL,
): boolean {
  if (!item) return false;
  const list = item.channels;
  if (!list || list.length === 0) return true;
  return list.includes(channel);
}

/** True if the item has an offer that is currently active for `channel`. */
export function isOfferActive(
  item: MenuItem | null | undefined,
  channel: MenuChannel = DEFAULT_CHANNEL,
): boolean {
  const o = item?.offer;
  return !!(o?.active && offerDateOk(o) && offerChannelOk(o, channel));
}

/**
 * For per-unit offers (percent / fixed / price) returns the discounted unit
 * price for the item's *base* price (no variations / add-ons). Returns null
 * for cart-level offers — those are computed in cartLineTotal.
 *
 * Computed against the channel's effective price (so customer-site percent
 * offers discount priceOnline when set). Discounts never push below zero.
 */
export function getOfferUnitPrice(
  item: MenuItem | null | undefined,
  channel: MenuChannel = DEFAULT_CHANNEL,
): number | null {
  const o = item?.offer;
  if (!item || !o?.active || !offerDateOk(o) || !offerChannelOk(o, channel)) return null;
  const base = effectiveMenuPrice(item, channel);
  switch (o.type) {
    case "percent": return parseFloat(Math.max(0, base * (1 - o.value / 100)).toFixed(2));
    case "fixed":   return parseFloat(Math.max(0, base - o.value).toFixed(2));
    case "price":   return parseFloat(Math.max(0, o.value).toFixed(2));
    default:        return null; // cart-level offer
  }
}

/**
 * Render-ready badge text. Returns null when no offer is active on this channel.
 * Prefer the admin-supplied custom label; fall back to a sensible default.
 */
export function offerBadgeLabel(
  item: MenuItem | null | undefined,
  channel: MenuChannel = DEFAULT_CHANNEL,
): string | null {
  const o = item?.offer;
  if (!o?.active || !offerDateOk(o) || !offerChannelOk(o, channel)) return null;
  if (o.label?.trim()) return o.label.trim();
  switch (o.type) {
    case "percent":      return `${o.value}% OFF`;
    case "fixed":        return `£${o.value.toFixed(2)} OFF`;
    case "price":        return `SPECIAL`;
    case "bogo":         return `BUY ${o.buyQty ?? 1} GET ${o.freeQty ?? 1}`;
    case "multibuy":     return `${o.buyQty ?? 2} FOR ${o.value.toFixed(2)}`;
    case "qty_discount": return `${o.value}% OFF ${o.minQty ?? 2}+`;
    default:             return "OFFER";
  }
}

/**
 * Total for a single cart line. For per-unit offers the discount is already
 * in line.price; for cart-level offers we apply it here using the snapshotted
 * `line.offer`. Falls back to a plain `price * quantity` if no offer applies
 * on `channel`.
 */
export function cartLineTotal(line: OfferLine, channel: MenuChannel = DEFAULT_CHANNEL): number {
  const o = line.offer;
  if (!o?.active || !offerDateOk(o) || !offerChannelOk(o, channel)) return line.price * line.quantity;

  switch (o.type) {
    case "bogo": {
      const buyN = Math.max(1, o.buyQty  ?? 1);
      const getN = Math.max(1, o.freeQty ?? 1);
      const groupSize = buyN + getN;
      const paid = Math.floor(line.quantity / groupSize) * buyN
                 + Math.min(line.quantity % groupSize, buyN);
      return parseFloat((paid * line.price).toFixed(2));
    }
    case "multibuy": {
      const need = Math.max(2, o.buyQty ?? 2);
      const groups = Math.floor(line.quantity / need);
      const rem    = line.quantity % need;
      return parseFloat((groups * o.value + rem * line.price).toFixed(2));
    }
    case "qty_discount": {
      const minQ = Math.max(2, o.minQty ?? 2);
      if (line.quantity >= minQ) {
        return parseFloat((line.price * line.quantity * (1 - o.value / 100)).toFixed(2));
      }
      return line.price * line.quantity;
    }
    default:
      // Per-unit offers are already baked into line.price.
      return line.price * line.quantity;
  }
}

/** Money saved on this line vs. paying full price. Zero when no offer applies. */
export function cartLineSaving(line: OfferLine, channel: MenuChannel = DEFAULT_CHANNEL): number {
  const full = line.price * line.quantity;
  const actual = cartLineTotal(line, channel);
  return parseFloat(Math.max(0, full - actual).toFixed(2));
}

/** Subtotal across an entire customer cart (per-unit + cart-level offers applied). */
export function cartSubtotal(cart: OfferLine[], channel: MenuChannel = DEFAULT_CHANNEL): number {
  return parseFloat(cart.reduce((s, l) => s + cartLineTotal(l, channel), 0).toFixed(2));
}
