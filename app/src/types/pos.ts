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

export type POSOfferType =
  | "percent"       // simple % off per unit
  | "fixed"         // fixed £ off per unit
  | "price"         // override to a special price per unit
  | "bogo"          // buy X get Y free
  | "multibuy"      // buy X for £Y (bundle price)
  | "qty_discount"; // buy ≥ minQty, get value% off each

export interface POSOffer {
  type: POSOfferType;
  value: number;        // % for percent/qty_discount; £ for fixed/price/multibuy
  label?: string;       // custom badge text, e.g. "Happy Hour"
  active: boolean;
  startDate?: string;   // YYYY-MM-DD (inclusive)
  endDate?: string;     // YYYY-MM-DD (inclusive)
  // BOGO
  buyQty?: number;      // items to buy (bogo, multibuy)
  freeQty?: number;     // items free (bogo)
  // Qty discount
  minQty?: number;      // minimum quantity to trigger (qty_discount)
}

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
  sku?: string;
  stockQty?: number;
  trackStock: boolean;
  active: boolean;
  popular?: boolean;
  cost?: number; // cost price for margin tracking
  offer?: POSOffer;
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

export interface POSCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  loyaltyPoints: number;
  giftCardBalance: number;
  totalSpend: number;
  visitCount: number;
  lastVisit?: string; // ISO
  tags: string[];
  notes?: string;
  createdAt: string;
}

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
