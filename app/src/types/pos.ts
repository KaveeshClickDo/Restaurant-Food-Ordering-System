// ─── POS System Types ────────────────────────────────────────────────────────

export type POSRole = "admin" | "manager" | "cashier";

export interface POSPermissions {
  canApplyDiscount: boolean;
  canVoidSale: boolean;
  canIssueRefund: boolean;
  canAccessDashboard: boolean;
  canManageStaff: boolean;
  canManageMenu: boolean;
  canManageCustomers: boolean;
  canAccessSettings: boolean;
}

export const ROLE_PERMISSIONS: Record<POSRole, POSPermissions> = {
  admin: {
    canApplyDiscount: true,
    canVoidSale: true,
    canIssueRefund: true,
    canAccessDashboard: true,
    canManageStaff: true,
    canManageMenu: true,
    canManageCustomers: true,
    canAccessSettings: true,
  },
  manager: {
    canApplyDiscount: true,
    canVoidSale: true,
    canIssueRefund: true,
    canAccessDashboard: true,
    canManageStaff: true,
    canManageMenu: false,
    canManageCustomers: true,
    canAccessSettings: false,
  },
  cashier: {
    canApplyDiscount: false,
    canVoidSale: false,
    canIssueRefund: false,
    canAccessDashboard: false,
    canManageStaff: false,
    canManageMenu: false,
    canManageCustomers: true,
    canAccessSettings: false,
  },
};

export interface POSStaff {
  id: string;
  name: string;
  email: string;
  role: POSRole;
  pin: string; // 4-digit PIN
  active: boolean;
  permissions: POSPermissions;
  hourlyRate?: number;
  avatarColor: string; // hex bg color
  createdAt: string;
}

export interface POSClockEntry {
  id: string;
  staffId: string;
  staffName: string;
  clockIn: string; // ISO
  clockOut?: string; // ISO
  totalMinutes?: number;
  notes?: string;
}

export interface POSModifierOption {
  id: string;
  label: string;
  priceAdjust: number; // positive = more, negative = less
}

export interface POSModifier {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  options: POSModifierOption[];
}

// ─── Offers ──────────────────────────────────────────────────────────────────
// The canonical offer types now live in src/types/index.ts as MenuItemOffer
// (shared between admin and POS). POSOffer is kept as an alias so existing
// POS-only imports continue to compile.

import type { MenuItemOffer, MenuItemOfferType } from "@/types";

export type POSOfferType = MenuItemOfferType;
export type POSOffer    = MenuItemOffer;

/** Check if the offer's date window is currently active. */
function offerDateOk(o: POSOffer): boolean {
  const now = new Date();
  if (o.startDate && new Date(o.startDate) > now) return false;
  if (o.endDate   && new Date(o.endDate + "T23:59:59") < now) return false;
  return true;
}

/**
 * For simple per-unit offers (percent, fixed, price) returns the discounted unit price.
 * Returns null for cart-level offers (bogo, multibuy, qty_discount) — those are handled by cartLineTotal.
 */
export function getOfferPrice(product: POSProduct): number | null {
  const o = product.offer;
  if (!o?.active || !offerDateOk(o)) return null;
  switch (o.type) {
    case "percent": return parseFloat(Math.max(0, product.price * (1 - o.value / 100)).toFixed(2));
    case "fixed":   return parseFloat(Math.max(0, product.price - o.value).toFixed(2));
    case "price":   return parseFloat(Math.max(0, o.value).toFixed(2));
    default:        return null; // cart-level offer
  }
}

/**
 * Returns true if the product has an offer that is active today.
 * Works for ALL offer types (including cart-level ones).
 */
export function isOfferActive(product: POSProduct): boolean {
  const o = product.offer;
  return !!(o?.active && offerDateOk(o));
}

/**
 * Compute the total for a single cart line, accounting for quantity-based offers.
 * For simple per-unit offers the price is already baked into item.price.
 */
export function cartLineTotal(item: POSCartItem): number {
  const o = item.offer;
  if (!o?.active || !offerDateOk(o)) return item.price * item.quantity;

  switch (o.type) {
    case "bogo": {
      const buyN = Math.max(1, o.buyQty  ?? 1);
      const getN = Math.max(1, o.freeQty ?? 1);
      const groupSize = buyN + getN;
      const paid = Math.floor(item.quantity / groupSize) * buyN
                 + Math.min(item.quantity % groupSize, buyN);
      return parseFloat((paid * item.price).toFixed(2));
    }
    case "multibuy": {
      const need = Math.max(2, o.buyQty ?? 2);
      const groups = Math.floor(item.quantity / need);
      const rem    = item.quantity % need;
      return parseFloat((groups * o.value + rem * item.price).toFixed(2));
    }
    case "qty_discount": {
      const minQ = Math.max(2, o.minQty ?? 2);
      if (item.quantity >= minQ) {
        return parseFloat((item.price * item.quantity * (1 - o.value / 100)).toFixed(2));
      }
      return item.price * item.quantity;
    }
    default:
      return item.price * item.quantity; // percent/fixed/price already in item.price
  }
}

/** Returns the saving amount for a cart line (0 if no saving). */
export function cartLineSaving(item: POSCartItem): number {
  const full = item.price * item.quantity;
  const actual = cartLineTotal(item);
  return parseFloat(Math.max(0, full - actual).toFixed(2));
}

// POSProduct stays a distinct interface (it carries POS-only display state
// like `modifiers` and uses `imageUrl` instead of `image`) but now also
// surfaces the shared admin fields so a POSProduct round-trips losslessly
// when the same row is read/written by the admin Menu Management panel.
// See `app/src/types/index.ts → MenuItem` for the canonical model.
import type { Variation, AddOn, StockStatus } from "@/types";

export interface POSProduct {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  description?: string;
  emoji?: string;
  imageUrl?: string; // custom image (URL or base64 data URI)
  color: string; // tile accent color (hex)
  modifiers?: POSModifier[];
  /** Admin-side variations[] — required radio groups. Mirror of MenuItem.variations. */
  variations?: Variation[];
  /** Admin-side add-ons[] — optional multi-select. Mirror of MenuItem.addOns. */
  addOns?: AddOn[];
  /** Dietary tags (e.g. "vegan", "gluten-free"). Mirror of MenuItem.dietary. */
  dietary?: string[];
  sku?: string;
  stockQty?: number;
  /** Manual status override — used when stockQty is not set. */
  stockStatus?: StockStatus;
  trackStock: boolean;
  active: boolean;
  popular?: boolean;
  cost?: number; // cost price for margin tracking
  offer?: POSOffer;
  /** Channel split — POS filters its sale grid by `in_store`. Defaults to
   *  both channels for legacy rows so they stay visible. */
  channels?: ("in_store" | "online")[];
  /** Online-price override — POS never uses this directly (it always charges
   *  `price`) but carries it through so bulk sync doesn't drop the value. */
  priceOnline?: number;
}

export interface POSCategory {
  id: string;
  name: string;
  emoji: string;
  color: string; // hex
  order: number;
}

export interface POSCartModifier {
  modifierId: string;
  modifierName: string;
  optionId: string;
  optionLabel: string;
  priceAdjust: number;
}

export interface POSCartItem {
  lineId: string;
  productId: string;
  name: string;
  basePrice: number;
  price: number; // per unit including modifiers (offer price already applied for simple types)
  quantity: number;
  modifiers: POSCartModifier[];
  note?: string;
  offer?: POSOffer; // snapshot of product offer at add-to-cart time (for cart-level offers)
}

export interface POSSplitPayment {
  method: "cash" | "card";
  amount: number;
}

export type POSPaymentMethod = "cash" | "card" | "split";

export interface POSSale {
  id: string;
  receiptNo: string;
  items: POSCartItem[];
  subtotal: number;
  discountAmount: number;
  discountNote?: string;
  taxAmount: number;
  taxRate: number;       // rate at time of sale, e.g. 20
  taxInclusive: boolean; // whether VAT was included in item prices
  tipAmount: number;
  total: number;
  paymentMethod: POSPaymentMethod;
  payments: POSSplitPayment[];
  cashTendered?: number;
  changeGiven?: number;
  staffId: string;
  staffName: string;
  customerId?: string;
  customerName?: string;
  tableNumber?: number;
  date: string; // ISO
  voided: boolean;
  voidReason?: string;
  refundMethod?: "cash" | "card" | "none"; // how the refund was issued
  refundAmount?: number;                   // amount refunded
}

// Bug #11 — POS customers are no longer a distinct local-only type. The
// `customers` table is now the single source of truth for both admin and
// POS, so POSCustomer is just an alias for the shared Customer interface.
// All POS code that reads `c.loyaltyPoints`, `c.totalSpend` etc. should use
// the `?? 0` fallback because computed fields can be undefined for rows
// that pre-date the migration.
import type { Customer } from "@/types";
export type POSCustomer = Customer;

export interface POSSettings {
  businessName: string;
  taxRate: number;
  taxInclusive: boolean;
  defaultTipOptions: number[]; // [10, 15, 20, 25]
  receiptFooter: string;
  currencySymbol: string;
  tableModeEnabled: boolean;
  tableCount: number;
  loyaltyPointsPerPound: number; // points per £ spent
  loyaltyPointsValue: number;    // £ value per point (e.g. 0.01)
  giftCardEnabled: boolean;
  maxDiscountPercent: number;
  requirePinForDiscount: boolean;
  location: string;
  // Receipt branding
  receiptRestaurantName: string;
  receiptPhone: string;
  receiptWebsite: string;
  receiptEmail: string;
  receiptVatNumber: string;
  receiptShowLogo: boolean;
  receiptLogoUrl: string;
  receiptThankYouMessage: string;
  receiptCustomMessage: string;
  // SMTP credentials are configured via server-side env vars (SMTP_HOST etc.)
  // and are no longer stored in localStorage. smtpFromName remains local as
  // it controls the display name in emailed receipts, not authentication.
  smtpFromName: string;
}
