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

export interface POSProduct {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  description?: string;
  emoji?: string;
  color: string; // tile accent color (hex)
  modifiers?: POSModifier[];
  sku?: string;
  stockQty?: number;
  trackStock: boolean;
  active: boolean;
  popular?: boolean;
  cost?: number; // cost price for margin tracking
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
  price: number; // per unit including modifiers
  quantity: number;
  modifiers: POSCartModifier[];
  note?: string;
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
  date: string; // ISO
  voided: boolean;
  voidReason?: string;
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
}
