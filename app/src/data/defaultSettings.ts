/**
 * DEFAULT_SETTINGS — the single source of truth for what a fresh
 * app_settings.data row looks like.
 *
 * Imported by:
 *   • AppContext        — used as the in-memory baseline before realtime data arrives
 *   • seed-settings.ts  — the post-migrate script that upserts this blob into the DB
 *
 * Keep this file React-free and Next-free: the seed script runs under Node
 * via tsx and can only import plain data modules. No "use client", no React
 * imports, no Next.js APIs.
 *
 * Fields that have moved to dedicated tables (coupons, paymentAuditLog,
 * pos_staff, waiters, kitchenStaff, diningTables) are kept here as empty
 * placeholders during the transition. They'll be removed from
 * AdminSettings and from this file in the cleanup pass once every admin
 * panel reads/writes them through the new endpoints.
 */

import type {
  AdminSettings, ColorSettings, CurrencySettings, DeliveryZone, PaymentMethod,
  PrinterSettings, ReceiptSettings, SeoSettings, TaxSettings,
} from "@/types";
import { restaurantInfo, defaultSchedule } from "@/data/restaurant";
import { DEFAULT_FOOTER_PAGES }              from "@/data/footerPages";
import { DEFAULT_EMAIL_TEMPLATES }           from "@/lib/emailTemplates";

// The legacy DEFAULT_FOOTER_PAGES seed is now expressed as `customPages`
// (FooterPage and CustomPage have been merged into a single "Pages" concept).
// We mint stable ids from the slug so seeds remain idempotent across reseeds.
const DEFAULT_PAGES_AS_CUSTOM = DEFAULT_FOOTER_PAGES.map((p) => ({
  id: `seed-${p.slug}`,
  title: p.title,
  slug: p.slug,
  content: p.content,
  seoTitle: "",
  seoDescription: "",
  published: p.enabled,
  createdAt: p.lastModified,
  updatedAt: p.lastModified,
}));

const NO_RESTRICTION = { restricted: false, minKm: 0, maxKm: 50 };

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "stripe", name: "Card (Stripe)",  description: "Visa, Mastercard, Amex via Stripe", adminNote: "",              enabled: true, builtIn: true, order: 0, deliveryRange: NO_RESTRICTION },
  { id: "paypal", name: "PayPal",         description: "Fast, secure PayPal checkout",       adminNote: "",              enabled: true, builtIn: true, order: 1, deliveryRange: NO_RESTRICTION },
  { id: "cash",   name: "Cash",           description: "Pay in store or on delivery",         adminNote: "Pay on delivery", enabled: true, builtIn: true, order: 2, deliveryRange: { restricted: true, minKm: 0, maxKm: 3 } },
];

export const DEFAULT_DELIVERY_ZONES: DeliveryZone[] = [
  { id: "zone-1", name: "Central",  minRadiusKm: 0, maxRadiusKm: 3,  fee: 1.99, enabled: true, color: "#f97316" },
  { id: "zone-2", name: "Local",    minRadiusKm: 3, maxRadiusKm: 8,  fee: 2.99, enabled: true, color: "#3b82f6" },
  { id: "zone-3", name: "Extended", minRadiusKm: 8, maxRadiusKm: 15, fee: 4.99, enabled: true, color: "#a855f7" },
];

export const DEFAULT_COLORS: ColorSettings = { primaryColor: "#18181B", backgroundColor: "#FFFFFF" };

export const DEFAULT_TAX: TaxSettings = { enabled: false, rate: 20, inclusive: true, showBreakdown: true };

export const DEFAULT_CURRENCY: CurrencySettings = { code: "GBP", symbol: "£" };

export const DEFAULT_RECEIPT: ReceiptSettings = {
  showLogo: false, logoUrl: "", restaurantName: restaurantInfo.name, address: "",
  phone: restaurantInfo.phone, website: "", email: "", vatNumber: "",
  thankYouMessage: "Thank you for your order!", customMessage: "",
};

export const DEFAULT_SEO: SeoSettings = {
  metaTitle: `${restaurantInfo.name} — Order Online`,
  metaDescription: `Order online from ${restaurantInfo.name}.`,
  metaKeywords: `food delivery, online order, ${restaurantInfo.name}`,
  ogImage: "",
  siteUrl: "",
  faviconUrl: "",
};

export const DEFAULT_PRINTER: PrinterSettings = {
  enabled: false, name: "Kitchen Printer", connection: "network",
  ip: "", port: 9100, bluetoothAddress: "", bluetoothName: "",
  autoPrint: true, paperWidth: 48, allowedIps: [],
};

export const DEFAULT_SETTINGS: AdminSettings = {
  restaurant: restaurantInfo,
  schedule: defaultSchedule,
  manualClosed: false,
  stripePublicKey: "",
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  paymentAuditLog: [],            // moved to payment_audit_log table
  deliveryZones: DEFAULT_DELIVERY_ZONES,
  seo: DEFAULT_SEO,
  customHeadCode: "",
  printer: DEFAULT_PRINTER,
  emailTemplates: DEFAULT_EMAIL_TEMPLATES,
  // Deprecated — kept as an empty array for back-compat with old snapshots.
  // The unified "Pages" panel now manages everything via `customPages`.
  footerPages: [],
  footerCopyright: `© ${new Date().getFullYear()} ${restaurantInfo.name}. All rights reserved.`,
  customPages: DEFAULT_PAGES_AS_CUSTOM,
  menuLinks: [],
  colors: DEFAULT_COLORS,
  footerLogos: [],
  receiptSettings: DEFAULT_RECEIPT,
  coupons: [],                    // moved to coupons table
  taxSettings: DEFAULT_TAX,
  waiters: [],                    // moved to waiters table
  kitchenStaff: [],               // moved to kitchen_staff table
  diningTables: [],               // moved to dining_tables table
  reservationSystem: {
    enabled: false,
    slotDurationMinutes: 90,
    maxAdvanceDays: 30,
    openTime: "12:00",
    closeTime: "22:00",
    slotIntervalMinutes: 30,
    maxPartySize: 10,
    blackoutDates: [],
    reviewUrl: "",
    floorPlans: [],
    floorPlanImageUrl: "",
    floorPlanMarkerScale: 1,
  },
  currency: DEFAULT_CURRENCY,
  giftCardSettings: {
    enabled: true,
    presets: [10, 25, 50, 100],
    minAmount: 5,
    maxAmount: 500,
    expiryMonths: 12,
  },
  loyaltyPointsPerPound: 1,
  loyaltyPointsExpiryMonths: 1
};
