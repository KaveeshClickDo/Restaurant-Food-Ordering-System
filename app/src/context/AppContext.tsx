"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import {
  AdminSettings, AuditEntry, BreakfastMenuSettings, CartItem, Category, ColorSettings, Coupon,
  DeliveryStatus, DeliveryZone, Driver, MenuItem, Customer, Order, OrderStatus, PaymentMethod,
  PrinterSettings, Refund, SavedAddress, SeoSettings, ReceiptSettings, StockStatus,
  TaxSettings,
} from "@/types";
import { buildColorCss } from "@/lib/colorUtils";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { DEFAULT_FOOTER_PAGES } from "@/data/footerPages";
import SeoHead from "@/components/SeoHead";
import { restaurantInfo, defaultSchedule } from "@/data/restaurant";
import { categories as defaultCategories, menuItems as defaultMenuItems } from "@/data/menu";
import { mockCustomers } from "@/data/customers";

// ─── Email template merge ─────────────────────────────────────────────────────
// Keeps existing edited templates and fills in any new default events that are
// not yet stored (e.g. new reservation events added after initial setup).
function mergeEmailTemplates(stored: typeof DEFAULT_EMAIL_TEMPLATES | undefined | null) {
  if (!stored || stored.length === 0) return DEFAULT_EMAIL_TEMPLATES;
  const storedEvents = new Set(stored.map((t) => t.event));
  const missing = DEFAULT_EMAIL_TEMPLATES.filter((t) => !storedEvents.has(t.event));
  return missing.length > 0 ? [...stored, ...missing] : stored;
}

// ─── Cart (session data — stays in localStorage) ──────────────────────────────

type CartAction =
  | { type: "ADD"; item: CartItem }
  | { type: "REMOVE"; id: string }
  | { type: "UPDATE_QTY"; id: string; qty: number }
  | { type: "CLEAR" };

function cartReducer(state: CartItem[], action: CartAction): CartItem[] {
  switch (action.type) {
    case "ADD":    return [...state, action.item];
    case "REMOVE": return state.filter((i) => i.id !== action.id);
    case "UPDATE_QTY":
      return state.map((i) => (i.id === action.id ? { ...i, quantity: action.qty } : i))
                  .filter((i) => i.quantity > 0);
    case "CLEAR":  return [];
    default:       return state;
  }
}

// ─── Context shape ────────────────────────────────────────────────────────────

interface AppContextValue {
  cart: CartItem[];
  addToCart: (item: CartItem) => void;
  removeFromCart: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  clearCart: () => void;
  cartTotal: number;
  cartCount: number;
  settings: AdminSettings;
  updateSettings: (patch: Partial<AdminSettings>) => void;
  isOpen: boolean;
  fulfillment: "delivery" | "collection";
  setFulfillment: (f: "delivery" | "collection") => void;
  scheduledTime: string | null;
  setScheduledTime: (t: string | null) => void;
  categories: Category[];
  menuItems: MenuItem[];
  addCategory: (cat: Category) => void;
  updateCategory: (cat: Category) => void;
  deleteCategory: (id: string) => void;
  addMenuItem: (item: MenuItem) => void;
  updateMenuItem: (item: MenuItem) => void;
  deleteMenuItem: (id: string) => void;
  reorderCategories: (cats: Category[]) => void;
  customers: Customer[];
  addOrder: (customerId: string, order: Order) => void;
  updateOrderStatus: (customerId: string, orderId: string, status: OrderStatus) => void;
  addCustomer: (customer: Customer) => void;
  updateCustomer: (customer: Customer) => void;
  currentUser: Customer | null;
  login: (email: string, password: string) => boolean;
  register: (name: string, email: string, phone: string, password: string) => { success: boolean; error?: string };
  logout: () => void;
  toggleFavourite: (menuItemId: string) => void;
  isFavourite: (menuItemId: string) => boolean;
  updatePaymentMethod: (method: PaymentMethod) => void;
  togglePaymentMethod: (id: string, enabled: boolean) => void;
  reorderPaymentMethods: (methods: PaymentMethod[]) => void;
  addDeliveryZone: (zone: DeliveryZone) => void;
  updateDeliveryZone: (zone: DeliveryZone) => void;
  deleteDeliveryZone: (id: string) => void;
  coupons: Coupon[];
  addCoupon: (coupon: Coupon) => void;
  updateCoupon: (coupon: Coupon) => void;
  deleteCoupon: (id: string) => void;
  toggleCoupon: (id: string, active: boolean) => void;
  appliedCoupon: { couponId: string; code: string; discountAmount: number } | null;
  applyCoupon: (code: string, cartSubtotal: number) => { valid: boolean; error?: string; discountAmount?: number };
  removeCoupon: () => void;
  incrementCouponUsage: (couponId: string) => void;
  addSavedAddress: (customerId: string, address: SavedAddress) => void;
  updateSavedAddress: (customerId: string, address: SavedAddress) => void;
  deleteSavedAddress: (customerId: string, addressId: string) => void;
  setDefaultAddress: (customerId: string, addressId: string) => void;
  drivers: Driver[];
  currentDriver: Driver | null;
  /** Validates credentials via the server-side /api/auth/driver route. */
  driverLogin: (email: string, password: string) => Promise<boolean>;
  driverLogout: () => void;
  addDriver: (data: Omit<Driver, "id" | "createdAt"> & { password: string }) => Promise<Driver>;
  updateDriver: (id: string, data: Partial<Omit<Driver, "id" | "createdAt">> & { password?: string }) => Promise<Driver>;
  deleteDriver: (id: string) => Promise<void>;
  toggleDriver: (id: string, active: boolean) => Promise<void>;
  assignDriverToOrder: (customerId: string, orderId: string, driverId: string | null) => void;
  updateDeliveryStatus: (customerId: string, orderId: string, status: DeliveryStatus) => void;
  addRefund: (customerId: string, orderId: string, refund: Refund) => void;
  spendStoreCredit: (customerId: string, amount: number) => void;
  // ─── Breakfast menu ───────────────────────────────────────────────────────
  updateBreakfastSettings: (patch: Partial<BreakfastMenuSettings>) => void;
  addBreakfastCategory: (cat: Category) => void;
  updateBreakfastCategory: (cat: Category) => void;
  deleteBreakfastCategory: (id: string) => void;
  reorderBreakfastCategories: (cats: Category[]) => void;
  addBreakfastItem: (item: MenuItem) => void;
  updateBreakfastItem: (item: MenuItem) => void;
  deleteBreakfastItem: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ─── Defaults ─────────────────────────────────────────────────────────────────

const NO_RESTRICTION = { restricted: false, minKm: 0, maxKm: 50 };

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "stripe", name: "Card (Stripe)",  description: "Visa, Mastercard, Amex via Stripe", adminNote: "",              enabled: true, builtIn: true, order: 0, deliveryRange: NO_RESTRICTION },
  { id: "paypal", name: "PayPal",         description: "Fast, secure PayPal checkout",       adminNote: "",              enabled: true, builtIn: true, order: 1, deliveryRange: NO_RESTRICTION },
  { id: "cash",   name: "Cash",           description: "Pay in store or on delivery",         adminNote: "Pay on delivery", enabled: true, builtIn: true, order: 2, deliveryRange: { restricted: true, minKm: 0, maxKm: 3 } },
];

const DEFAULT_DELIVERY_ZONES: DeliveryZone[] = [
  { id: "zone-1", name: "Central",  minRadiusKm: 0, maxRadiusKm: 3,  fee: 1.99, enabled: true, color: "#f97316" },
  { id: "zone-2", name: "Local",    minRadiusKm: 3, maxRadiusKm: 8,  fee: 2.99, enabled: true, color: "#3b82f6" },
  { id: "zone-3", name: "Extended", minRadiusKm: 8, maxRadiusKm: 15, fee: 4.99, enabled: true, color: "#a855f7" },
];

const DEFAULT_COLORS: ColorSettings = { primaryColor: "#f97316", backgroundColor: "#f9fafb" };

const DEFAULT_TAX: TaxSettings = { enabled: false, rate: 20, inclusive: true, showBreakdown: true };

const DEFAULT_RECEIPT: ReceiptSettings = {
  showLogo: false, logoUrl: "", restaurantName: restaurantInfo.name,
  phone: restaurantInfo.phone, website: "", email: "", vatNumber: "",
  thankYouMessage: "Thank you for your order!", customMessage: "",
};

const DEFAULT_SEO: SeoSettings = {
  metaTitle: `${restaurantInfo.name} — Order Online`,
  metaDescription: `Order online from ${restaurantInfo.name}.`,
  metaKeywords: `food delivery, online order, ${restaurantInfo.name}`,
};

const DEFAULT_PRINTER: PrinterSettings = {
  enabled: false, name: "Kitchen Printer", ip: "", port: 9100, autoPrint: true, paperWidth: 48,
};

const DEFAULT_SETTINGS: AdminSettings = {
  restaurant: restaurantInfo,
  schedule: defaultSchedule,
  manualClosed: false,
  stripePublicKey: "",
  // stripeSecretKey, paypalClientId → server-side env vars only
  // smtpHost/Port/User/Password → server-side env vars only
  // drivers → managed via /api/admin/drivers (separate Supabase table)
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  paymentAuditLog: [],
  deliveryZones: DEFAULT_DELIVERY_ZONES,
  seo: DEFAULT_SEO,
  customHeadCode: "",
  printer: DEFAULT_PRINTER,
  emailTemplates: DEFAULT_EMAIL_TEMPLATES,
  footerPages: DEFAULT_FOOTER_PAGES,
  footerCopyright: `© ${new Date().getFullYear()} ${restaurantInfo.name}. All rights reserved.`,
  customPages: [],
  menuLinks: [],
  colors: DEFAULT_COLORS,
  footerLogos: [],
  receiptSettings: DEFAULT_RECEIPT,
  coupons: [],
  taxSettings: DEFAULT_TAX,
  breakfastMenu: {
    enabled: false,
    startTime: "07:00",
    endTime: "11:30",
    categories: [],
    items: [],
  },
  waiters: [
    { id: "w-1", name: "Head Waiter", pin: "1111", role: "senior", active: true, avatarColor: "#7c3aed", createdAt: new Date().toISOString() },
    { id: "w-2", name: "Alex",        pin: "2222", role: "waiter",  active: true, avatarColor: "#0891b2", createdAt: new Date().toISOString() },
    { id: "w-3", name: "Sophie",      pin: "3333", role: "waiter",  active: true, avatarColor: "#16a34a", createdAt: new Date().toISOString() },
  ],
  diningTables: [
    ...Array.from({ length: 6 },  (_, i) => ({ id: `t-${i+1}`,  number: i+1,  label: `T${i+1}`,  seats: i < 2 ? 2 : 4, section: "Main Hall", active: true })),
    ...Array.from({ length: 4 },  (_, i) => ({ id: `t-${i+7}`,  number: i+7,  label: `T${i+7}`,  seats: 4,             section: "Terrace",   active: true })),
    ...Array.from({ length: 2 },  (_, i) => ({ id: `t-${i+11}`, number: i+11, label: `B${i+1}`,  seats: 2,             section: "Bar",       active: true })),
  ],
  reservationSystem: {
    enabled: false,
    slotDurationMinutes: 90,
    maxAdvanceDays: 30,
    openTime: "12:00",
    closeTime: "22:00",
    slotIntervalMinutes: 30,
  },
};

// ─── Store open check ─────────────────────────────────────────────────────────

function isStoreOpen(settings: AdminSettings): boolean {
  if (settings.manualClosed) return false;
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const now = new Date();
  const day = settings.schedule[days[now.getDay()]];
  if (!day || day.closed) return false;
  const [oh, om] = day.open.split(":").map(Number);
  const [ch, cm] = day.close.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= oh * 60 + om && cur < ch * 60 + cm;
}

// ─── Coupon validator ─────────────────────────────────────────────────────────

function validateCouponCode(code: string, subtotal: number, coupons: Coupon[]) {
  const coupon = coupons.find((c) => c.code.toUpperCase() === code.trim().toUpperCase());
  if (!coupon)         return { valid: false as const, error: "Invalid coupon code." };
  if (!coupon.active)  return { valid: false as const, error: "This coupon is no longer active." };
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date())
    return { valid: false as const, error: "This coupon has expired." };
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit)
    return { valid: false as const, error: "This coupon has reached its usage limit." };
  if (coupon.minOrderAmount > 0 && subtotal < coupon.minOrderAmount)
    return { valid: false as const, error: `Minimum order of £${coupon.minOrderAmount.toFixed(2)} required.` };
  const discountAmount =
    coupon.type === "percentage"
      ? parseFloat((subtotal * (coupon.value / 100)).toFixed(2))
      : parseFloat(Math.min(coupon.value, subtotal).toFixed(2));
  return { valid: true as const, coupon, discountAmount };
}

// ─── DB row → TypeScript mappers ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCategory(row: any): Category {
  return { id: row.id, name: row.name, emoji: row.emoji };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMenuItem(row: any): MenuItem {
  return {
    id: row.id, categoryId: row.category_id,
    name: row.name, description: row.description ?? "",
    price: Number(row.price),
    image: row.image || undefined,
    dietary: row.dietary ?? [],
    popular: row.popular ?? false,
    variations: row.variations ?? [],
    addOns: row.add_ons ?? [],
    stockQty: row.stock_qty ?? undefined,
    stockStatus: (row.stock_status as StockStatus) || undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrder(row: any): Order {
  return {
    id: row.id,
    customerId: row.customer_id,
    date: typeof row.date === "string" ? row.date : new Date(row.date).toISOString(),
    status: row.status as OrderStatus,
    fulfillment: row.fulfillment,
    total: Number(row.total),
    items: row.items ?? [],
    address: row.address || undefined,
    note: row.note || undefined,
    paymentMethod: row.payment_method || undefined,
    deliveryFee: row.delivery_fee ? Number(row.delivery_fee) : undefined,
    serviceFee: row.service_fee ? Number(row.service_fee) : undefined,
    scheduledTime: row.scheduled_time || undefined,
    couponCode: row.coupon_code || undefined,
    couponDiscount: row.coupon_discount ? Number(row.coupon_discount) : undefined,
    vatAmount: row.vat_amount ? Number(row.vat_amount) : undefined,
    vatInclusive: row.vat_inclusive ?? undefined,
    driverId: row.driver_id || undefined,
    driverName: row.driver_name || undefined,
    deliveryStatus: (row.delivery_status as DeliveryStatus) || undefined,
    refunds: row.refunds ?? [],
    refundedAmount: row.refunded_amount ? Number(row.refunded_amount) : undefined,
    storeCreditUsed: row.store_credit_used ? Number(row.store_credit_used) : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomer(row: any): Customer {
  return {
    id: row.id, name: row.name, email: row.email,
    phone: row.phone ?? "",
    password: row.password || undefined,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(row.created_at).toISOString(),
    tags: row.tags ?? [],
    orders: (row.orders ?? []).map(mapOrder).sort(
      (a: Order, b: Order) => new Date(b.date).getTime() - new Date(a.date).getTime()
    ),
    favourites: row.favourites ?? [],
    savedAddresses: row.saved_addresses ?? [],
    storeCredit: row.store_credit ? Number(row.store_credit) : undefined,
  };
}

// ─── TypeScript → DB row mappers ─────────────────────────────────────────────

function categoryToRow(c: Category, order: number) {
  return { id: c.id, name: c.name, emoji: c.emoji, sort_order: order };
}

function menuItemToRow(m: MenuItem) {
  return {
    id: m.id, category_id: m.categoryId,
    name: m.name, description: m.description ?? "",
    price: m.price, image: m.image ?? "",
    dietary: m.dietary, popular: m.popular ?? false,
    variations: m.variations ?? [], add_ons: m.addOns ?? [],
    stock_qty: m.stockQty ?? null, stock_status: m.stockStatus ?? "in_stock",
  };
}

function orderToRow(o: Order) {
  return {
    id: o.id, customer_id: o.customerId, date: o.date,
    status: o.status, fulfillment: o.fulfillment, total: o.total,
    items: o.items,
    address: o.address ?? "", note: o.note ?? "",
    payment_method: o.paymentMethod ?? "",
    delivery_fee: o.deliveryFee ?? 0, service_fee: o.serviceFee ?? 0,
    scheduled_time: o.scheduledTime ?? "", coupon_code: o.couponCode ?? "",
    coupon_discount: o.couponDiscount ?? 0,
    vat_amount: o.vatAmount ?? 0, vat_inclusive: o.vatInclusive ?? true,
    driver_id: o.driverId ?? "", driver_name: o.driverName ?? "",
    delivery_status: o.deliveryStatus ?? "",
    refunds: o.refunds ?? [],
    refunded_amount: o.refundedAmount ?? 0,
    store_credit_used: o.storeCreditUsed ?? 0,
  };
}

function customerToRow(c: Customer) {
  return {
    id: c.id, name: c.name, email: c.email,
    phone: c.phone ?? "", password: c.password ?? "",
    created_at: c.createdAt,
    tags: c.tags ?? [], favourites: c.favourites ?? [],
    saved_addresses: c.savedAddresses ?? [],
    store_credit: c.storeCredit ?? 0,
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [cart, dispatch]         = useReducer(cartReducer, []);
  const [settings, setSettings]  = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems]   = useState<MenuItem[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  // Mirror of customers state accessible from inside Realtime callbacks without
  // closure staleness — callbacks capture the ref value, not the state snapshot.
  const customersRef = useRef<Customer[]>([]);
  // Drivers are fetched from the server-side /api/admin/drivers endpoint —
  // they are NOT part of app_settings so they are never exposed to customers.
  const [drivers, setDrivers]       = useState<Driver[]>([]);
  const [currentUser, setCurrentUser]   = useState<Customer | null>(null);
  const [currentDriver, setCurrentDriver] = useState<Driver | null>(null);
  const [fulfillment, setFulfillment] = useState<"delivery" | "collection">("delivery");
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    couponId: string; code: string; discountAmount: number;
  } | null>(null);
  // isOpen is client-only: start false on both server and client to prevent
  // hydration mismatches caused by timezone differences between the server
  // (UTC) and the browser (local timezone). Updated after mount via useEffect.
  const [isOpen, setIsOpen] = useState(false);

  // Keep customersRef in sync so Realtime callbacks always read current state.
  useEffect(() => { customersRef.current = customers; }, [customers]);

  // ── Session data: cart, user, driver stay in localStorage ─────────────────

  useEffect(() => {
    try {
      const c = localStorage.getItem("sg_cart");
      if (c) (JSON.parse(c) as CartItem[]).forEach((item) => dispatch({ type: "ADD", item }));
      const u = localStorage.getItem("sg_current_user");
      if (u) setCurrentUser(JSON.parse(u));
      const d = localStorage.getItem("sg_driver_session");
      if (d) setCurrentDriver(JSON.parse(d));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { localStorage.setItem("sg_cart", JSON.stringify(cart)); }, [cart]);

  useEffect(() => {
    if (currentUser) localStorage.setItem("sg_current_user", JSON.stringify(currentUser));
    else localStorage.removeItem("sg_current_user");
  }, [currentUser]);

  useEffect(() => {
    if (currentDriver) localStorage.setItem("sg_driver_session", JSON.stringify(currentDriver));
    else localStorage.removeItem("sg_driver_session");
  }, [currentDriver]);

  // ── isOpen: recompute on client after mount, and whenever settings change ────
  // This runs only in the browser, avoiding server/client timezone mismatches.
  useEffect(() => {
    setIsOpen(isStoreOpen(settings));
    // Recheck every minute so the banner updates without a page reload
    const id = setInterval(() => setIsOpen(isStoreOpen(settings)), 60_000);
    return () => clearInterval(id);
  }, [settings]);

  // ── Initial load from Supabase ─────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        // Settings
        const { data: settingsData, error: settingsErr } = await supabase
          .from("app_settings").select("data").eq("id", 1).single();
        if (settingsErr && settingsErr.code !== "PGRST116") {
          // PGRST116 = no rows (first run) — any other error is unexpected
          console.error("AppContext: failed to load settings:", settingsErr.message);
        }
        if (settingsData?.data) {
          // Deep-merge with DEFAULT_SETTINGS so new fields added to the default
          // are always present even if the stored snapshot pre-dates them.
          // Note: sensitive fields (drivers, stripeSecretKey, smtpPassword, etc.)
          // are intentionally omitted — they must never be sent to the browser.
          const d = settingsData.data;
          setSettings({
            ...DEFAULT_SETTINGS,
            ...d,
            // Ensure critical nested objects always have their default structure
            restaurant:      { ...DEFAULT_SETTINGS.restaurant,      ...(d.restaurant      ?? {}) },
            schedule:        { ...DEFAULT_SETTINGS.schedule,        ...(d.schedule        ?? {}) },
            colors:          { ...DEFAULT_SETTINGS.colors,          ...(d.colors          ?? {}) },
            taxSettings:     { ...DEFAULT_SETTINGS.taxSettings,     ...(d.taxSettings     ?? {}) },
            printer:         { ...DEFAULT_SETTINGS.printer,         ...(d.printer         ?? {}) },
            seo:             { ...DEFAULT_SETTINGS.seo,             ...(d.seo             ?? {}) },
            receiptSettings: { ...DEFAULT_SETTINGS.receiptSettings, ...(d.receiptSettings ?? {}) },
            breakfastMenu: {
              ...DEFAULT_SETTINGS.breakfastMenu,
              ...(d.breakfastMenu ?? {}),
              categories: d.breakfastMenu?.categories ?? DEFAULT_SETTINGS.breakfastMenu.categories,
              items:      d.breakfastMenu?.items      ?? DEFAULT_SETTINGS.breakfastMenu.items,
            },
            emailTemplates: mergeEmailTemplates(d.emailTemplates),
            footerPages:    d.footerPages    ?? DEFAULT_SETTINGS.footerPages,
            paymentMethods: d.paymentMethods ?? DEFAULT_SETTINGS.paymentMethods,
            deliveryZones:  d.deliveryZones  ?? DEFAULT_SETTINGS.deliveryZones,
            coupons:        d.coupons        ?? [],
            waiters:           d.waiters           ?? DEFAULT_SETTINGS.waiters,
            diningTables:      d.diningTables      ?? DEFAULT_SETTINGS.diningTables,
            reservationSystem: { ...DEFAULT_SETTINGS.reservationSystem, ...(d.reservationSystem ?? {}) },
            // Sensitive fields explicitly excluded — never loaded into client state:
            // drivers, stripeSecretKey, paypalClientId, smtpHost/Port/User/Password
          });
        } else if (!settingsData) {
          // First run — seed settings into the DB
          await supabase.from("app_settings").insert({ id: 1, data: DEFAULT_SETTINGS });
        }

        // Drivers — fetched via server API, not from app_settings
        try {
          const driversRes = await fetch("/api/admin/drivers");
          if (driversRes.ok) {
            const { drivers: loaded } = await driversRes.json() as { drivers: Driver[] };
            setDrivers(loaded ?? []);
          }
        } catch (err) {
          console.error("AppContext: failed to load drivers:", err);
        }

        // Categories
        const { data: catsData, error: catsErr } = await supabase
          .from("categories").select("*").order("sort_order", { ascending: true });
        if (catsErr) {
          console.error("AppContext: failed to load categories:", catsErr.message);
        } else if (catsData && catsData.length > 0) {
          setCategories(catsData.map(mapCategory));
        } else {
          // Seed via server-side API (uses service role key, works with RLS enabled)
          try {
            await fetch("/api/admin/seed", { method: "POST" });
          } catch (e) {
            console.error("AppContext: seed failed:", e);
          }
          setCategories(defaultCategories);
        }

        // Menu items
        const { data: menuData, error: menuErr } = await supabase.from("menu_items").select("*");
        if (menuErr) {
          console.error("AppContext: failed to load menu items:", menuErr.message);
        } else if (menuData && menuData.length > 0) {
          setMenuItems(menuData.map(mapMenuItem));
        } else {
          // Seed was already triggered above if categories were empty;
          // optimistically use defaults until realtime event arrives.
          setMenuItems(defaultMenuItems);
        }

        // Customers (with nested orders)
        const { data: custsData, error: custsErr } = await supabase
          .from("customers").select("*, orders(*)");
        if (custsErr) {
          console.error("AppContext: failed to load customers:", custsErr.message);
        } else if (custsData && custsData.length > 0) {
          setCustomers(custsData.map(mapCustomer));
        } else {
          // Seed was triggered above; use mock data as optimistic default.
          setCustomers(mockCustomers);
        }
      } catch (err) {
        // Network down, CORS issue, or unexpected data shape — log it clearly
        console.error("AppContext init failed:", err instanceof Error ? err.message : err);
      }
    }
    init();
  }, []);

  // ── Realtime subscriptions (replaces storage event listener) ──────────────

  useEffect(() => {
    const channel = supabase
      .channel("restaurant-realtime")
      // Settings — deep-merge so nested objects (restaurant, schedule, colors, etc.)
      // are never partially overwritten, which would cause "cannot read property of undefined" crashes.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "app_settings" },
        ({ new: row }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = (row as any).data ?? {};
          setSettings({
            ...DEFAULT_SETTINGS,
            ...d,
            restaurant:      { ...DEFAULT_SETTINGS.restaurant,      ...(d.restaurant      ?? {}) },
            schedule:        { ...DEFAULT_SETTINGS.schedule,        ...(d.schedule        ?? {}) },
            colors:          { ...DEFAULT_SETTINGS.colors,          ...(d.colors          ?? {}) },
            taxSettings:     { ...DEFAULT_SETTINGS.taxSettings,     ...(d.taxSettings     ?? {}) },
            printer:         { ...DEFAULT_SETTINGS.printer,         ...(d.printer         ?? {}) },
            seo:             { ...DEFAULT_SETTINGS.seo,             ...(d.seo             ?? {}) },
            receiptSettings: { ...DEFAULT_SETTINGS.receiptSettings, ...(d.receiptSettings ?? {}) },
            breakfastMenu: {
              ...DEFAULT_SETTINGS.breakfastMenu,
              ...(d.breakfastMenu ?? {}),
              categories: d.breakfastMenu?.categories ?? DEFAULT_SETTINGS.breakfastMenu.categories,
              items:      d.breakfastMenu?.items      ?? DEFAULT_SETTINGS.breakfastMenu.items,
            },
            emailTemplates: mergeEmailTemplates(d.emailTemplates),
            footerPages:    d.footerPages    ?? DEFAULT_SETTINGS.footerPages,
            paymentMethods: d.paymentMethods ?? DEFAULT_SETTINGS.paymentMethods,
            deliveryZones:  d.deliveryZones  ?? DEFAULT_SETTINGS.deliveryZones,
            coupons:        d.coupons        ?? [],
            waiters:           d.waiters           ?? DEFAULT_SETTINGS.waiters,
            diningTables:      d.diningTables      ?? DEFAULT_SETTINGS.diningTables,
            reservationSystem: { ...DEFAULT_SETTINGS.reservationSystem, ...(d.reservationSystem ?? {}) },
            // drivers, stripeSecretKey, smtpPassword, etc. intentionally excluded
          });
        })
      // Categories
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ eventType, new: newRow, old: oldRow }: any) => {
          if (eventType === "DELETE") {
            setCategories((prev) => prev.filter((c) => c.id !== oldRow.id));
          } else {
            const cat = mapCategory(newRow);
            setCategories((prev) => {
              const idx = prev.findIndex((c) => c.id === cat.id);
              return idx >= 0 ? prev.map((c) => (c.id === cat.id ? cat : c)) : [...prev, cat];
            });
          }
        })
      // Menu items
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ eventType, new: newRow, old: oldRow }: any) => {
          if (eventType === "DELETE") {
            setMenuItems((prev) => prev.filter((m) => m.id !== oldRow.id));
          } else {
            const item = mapMenuItem(newRow);
            setMenuItems((prev) => {
              const idx = prev.findIndex((m) => m.id === item.id);
              return idx >= 0 ? prev.map((m) => (m.id === item.id ? item : m)) : [...prev, item];
            });
          }
        })
      // Orders
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async ({ eventType, new: newRow, old: oldRow }: any) => {
          if (eventType === "DELETE") {
            setCustomers((prev) => prev.map((c) => ({
              ...c, orders: c.orders.filter((o) => o.id !== oldRow.id),
            })));
          } else {
            const order = mapOrder(newRow);
            const patchOrders = (orders: Order[]) => {
              const exists = orders.some((o) => o.id === order.id);
              return exists ? orders.map((o) => (o.id === order.id ? order : o))
                            : [order, ...orders];
            };

            // If the order's customer is not yet in state (e.g. pos-walk-in sentinel
            // or a race condition where the customer INSERT event hasn't arrived yet),
            // fetch and add them so the order isn't silently dropped.
            const knownCustomer = customersRef.current.some((c) => c.id === order.customerId);
            if (!knownCustomer) {
              const { data: cusData } = await supabase
                .from("customers").select("*, orders(*)").eq("id", order.customerId).single();
              if (cusData) {
                const newCustomer = mapCustomer(cusData);
                setCustomers((prev) => {
                  // Another concurrent event may have already added this customer
                  if (prev.some((c) => c.id === newCustomer.id)) {
                    return prev.map((c) => c.id !== newCustomer.id ? c : { ...c, orders: patchOrders(c.orders) });
                  }
                  return [...prev, { ...newCustomer, orders: patchOrders(newCustomer.orders) }];
                });
                return;
              }
            }

            setCustomers((prev) => prev.map((c) =>
              c.id !== order.customerId ? c : { ...c, orders: patchOrders(c.orders) }
            ));
            setCurrentUser((prev) =>
              prev && prev.id === order.customerId
                ? { ...prev, orders: patchOrders(prev.orders) }
                : prev
            );
          }
        })
      // Customers
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async ({ eventType, new: newRow, old: oldRow }: any) => {
          if (eventType === "DELETE") {
            setCustomers((prev) => prev.filter((c) => c.id !== oldRow.id));
          } else if (eventType === "INSERT") {
            const { data } = await supabase
              .from("customers").select("*, orders(*)").eq("id", newRow.id).single();
            if (data) setCustomers((prev) => [...prev, mapCustomer(data)]);
          } else {
            // UPDATE — patch fields, keep in-memory orders
            setCustomers((prev) => prev.map((c) =>
              c.id !== newRow.id ? c : {
                ...c,
                name: newRow.name, email: newRow.email, phone: newRow.phone ?? "",
                tags: newRow.tags ?? [], favourites: newRow.favourites ?? [],
                savedAddresses: newRow.saved_addresses ?? [],
                storeCredit: newRow.store_credit ? Number(newRow.store_credit) : undefined,
              }
            ));
            setCurrentUser((prev) =>
              prev && prev.id === newRow.id
                ? {
                    ...prev,
                    name: newRow.name, email: newRow.email, phone: newRow.phone ?? "",
                    tags: newRow.tags ?? [], favourites: newRow.favourites ?? [],
                    savedAddresses: newRow.saved_addresses ?? [],
                    storeCredit: newRow.store_credit ? Number(newRow.store_credit) : undefined,
                  }
                : prev
            );
          }
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Color theme injection ──────────────────────────────────────────────────

  useEffect(() => {
    const { primaryColor, backgroundColor } = settings.colors ?? DEFAULT_COLORS;
    const css = buildColorCss(primaryColor, backgroundColor);
    if (!css) return;
    let el = document.getElementById("color-theme-vars");
    if (!el) { el = document.createElement("style"); el.id = "color-theme-vars"; document.head.appendChild(el); }
    el.textContent = css;
  }, [settings.colors]);

  // ─── Cart actions ──────────────────────────────────────────────────────────

  const addToCart    = (item: CartItem) => dispatch({ type: "ADD", item });
  const removeFromCart = (id: string)   => dispatch({ type: "REMOVE", id });
  const updateQty    = (id: string, qty: number) => dispatch({ type: "UPDATE_QTY", id, qty });
  const clearCart    = () => dispatch({ type: "CLEAR" });

  // ─── Settings ─────────────────────────────────────────────────────────────

  // All settings mutations go through a server-side API route (requires admin auth cookie).
  // This prevents any browser visitor from modifying settings via the anon Supabase key.
  function persistSettings(next: AdminSettings) {
    fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: next }),
    }).then(async (r) => {
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        console.error("settings persist:", r.status, j.error);
      }
    }).catch((err) => console.error("settings persist:", err));
  }

  const updateSettings = (patch: Partial<AdminSettings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      persistSettings(next);
      return next;
    });

  // Internal helper: functional update + server-side persist.
  // Use this instead of setSettings directly for any mutation that must survive a refresh.
  const mutateSettings = (fn: (prev: AdminSettings) => AdminSettings) =>
    setSettings((prev) => {
      const next = fn(prev);
      persistSettings(next);
      return next;
    });

  // ─── Categories ───────────────────────────────────────────────────────────
  // All writes go through admin API routes (require admin session cookie).

  const addCategory = (cat: Category) => {
    setCategories((prev) => {
      const row = categoryToRow(cat, prev.length);
      fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("addCategory:", j.error); }
      }).catch((e) => console.error("addCategory:", e));
      return [...prev, cat];
    });
  };

  const updateCategory = (cat: Category) => {
    setCategories((prev) => {
      fetch(`/api/admin/categories/${cat.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cat.name, emoji: cat.emoji }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("updateCategory:", j.error); }
      }).catch((e) => console.error("updateCategory:", e));
      return prev.map((c) => (c.id === cat.id ? cat : c));
    });
  };

  const deleteCategory = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setMenuItems((prev) => prev.filter((m) => m.categoryId !== id));
    fetch(`/api/admin/categories/${id}`, { method: "DELETE" })
      .then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("deleteCategory:", j.error); }
      }).catch((e) => console.error("deleteCategory:", e));
  };

  const reorderCategories = (cats: Category[]) => {
    setCategories(cats);
    const rows = cats.map((c, i) => categoryToRow(c, i));
    fetch("/api/admin/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: rows }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("reorderCategories:", j.error); }
    }).catch((e) => console.error("reorderCategories:", e));
  };

  // ─── Menu items ───────────────────────────────────────────────────────────
  // All writes go through admin API routes (require admin session cookie).

  const addMenuItem = (item: MenuItem) => {
    setMenuItems((prev) => [...prev, item]);
    fetch("/api/admin/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(menuItemToRow(item)),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("addMenuItem:", j.error); }
    }).catch((e) => console.error("addMenuItem:", e));
  };

  const updateMenuItem = (item: MenuItem) => {
    setMenuItems((prev) => prev.map((m) => (m.id === item.id ? item : m)));
    fetch(`/api/admin/menu/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(menuItemToRow(item)),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("updateMenuItem:", j.error); }
    }).catch((e) => console.error("updateMenuItem:", e));
  };

  const deleteMenuItem = (id: string) => {
    setMenuItems((prev) => prev.filter((m) => m.id !== id));
    fetch(`/api/admin/menu/${id}`, { method: "DELETE" })
      .then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("deleteMenuItem:", j.error); }
      }).catch((e) => console.error("deleteMenuItem:", e));
  };

  // ─── Customer & order actions ──────────────────────────────────────────────

  const addCustomer = (customer: Customer) => {
    setCustomers((prev) => [...prev, customer]);
    fetch("/api/admin/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customerToRow(customer)),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("addCustomer:", j.error); }
    }).catch((e) => console.error("addCustomer:", e));
  };

  const updateCustomer = (customer: Customer) => {
    setCustomers((prev) => prev.map((c) => (c.id === customer.id ? customer : c)));
    fetch(`/api/admin/customers/${customer.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customerToRow(customer)),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("updateCustomer:", j.error); }
    }).catch((e) => console.error("updateCustomer:", e));
  };

  const addOrder = (customerId: string, order: Order) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === customerId ? { ...c, orders: [order, ...c.orders] } : c))
    );
    setCurrentUser((prev) =>
      prev && prev.id === customerId ? { ...prev, orders: [order, ...prev.orders] } : prev
    );
    // Insert via server-side route — anon key has no INSERT on orders
    fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderToRow(order)),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("addOrder:", j.error); }
    }).catch((e) => console.error("addOrder:", e));
  };

  const addRefund = (customerId: string, orderId: string, refund: Refund) => {
    const currentOrder = customers
      .find((c) => c.id === customerId)
      ?.orders.find((o) => o.id === orderId);
    if (!currentOrder) return;

    const newRefunds = [...(currentOrder.refunds ?? []), refund];
    const newRefundedAmount = (currentOrder.refundedAmount ?? 0) + refund.amount;
    const newStatus: OrderStatus =
      newRefundedAmount >= currentOrder.total ? "refunded" : "partially_refunded";

    const patchOrder = (o: Order): Order =>
      o.id !== orderId
        ? o
        : { ...o, refunds: newRefunds, refundedAmount: newRefundedAmount, status: newStatus };

    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== customerId) return c;
        const newStoreCredit =
          refund.method === "store_credit"
            ? (c.storeCredit ?? 0) + refund.amount
            : c.storeCredit;
        return { ...c, orders: c.orders.map(patchOrder), storeCredit: newStoreCredit };
      })
    );
    setCurrentUser((prev) => {
      if (!prev || prev.id !== customerId) return prev;
      const newStoreCredit =
        refund.method === "store_credit"
          ? (prev.storeCredit ?? 0) + refund.amount
          : prev.storeCredit;
      return { ...prev, orders: prev.orders.map(patchOrder), storeCredit: newStoreCredit };
    });

    // ── Single atomic order update via admin API route ──────────────────────
    const storeCreditPayload =
      refund.method === "store_credit"
        ? {
            customerId,
            newStoreCredit:
              (customers.find((c) => c.id === customerId)?.storeCredit ?? 0) + refund.amount,
          }
        : {};

    fetch(`/api/admin/orders/${orderId}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newStatus,
        refunds:         newRefunds,
        refundedAmount:  newRefundedAmount,
        ...storeCreditPayload,
      }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("addRefund:", j.error); }
    }).catch((e) => console.error("addRefund:", e));
  };

  const spendStoreCredit = (customerId: string, amount: number) => {
    const prevCredit = customers.find((c) => c.id === customerId)?.storeCredit ?? 0;
    const newBalance = Math.max(0, prevCredit - amount);
    const patch = (c: Customer) => ({ ...c, storeCredit: newBalance });
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? patch(c) : c)));
    setCurrentUser((prev) => (prev && prev.id === customerId ? patch(prev) : prev));
    // Server validates current balance and computes the new value — client cannot manipulate the result
    fetch(`/api/customers/${customerId}/spend-credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("spendStoreCredit:", j.error); }
    }).catch((e) => console.error("spendStoreCredit:", e));
  };

  const updateOrderStatus = (customerId: string, orderId: string, status: OrderStatus) => {
    const patch = (o: Order) => (o.id === orderId ? { ...o, status } : o);
    setCustomers((prev) =>
      prev.map((c) => (c.id === customerId ? { ...c, orders: c.orders.map(patch) } : c))
    );
    setCurrentUser((prev) =>
      prev && prev.id === customerId ? { ...prev, orders: prev.orders.map(patch) } : prev
    );
    fetch(`/api/admin/orders/${orderId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("updateOrderStatus:", j.error); }
    }).catch((e) => console.error("updateOrderStatus:", e));
  };

  // ─── Auth ─────────────────────────────────────────────────────────────────

  const login = (email: string, password: string): boolean => {
    const found = customers.find(
      (c) => c.email.toLowerCase() === email.toLowerCase() && c.password === password
    );
    if (found) { setCurrentUser(found); return true; }
    return false;
  };

  const register = (name: string, email: string, phone: string, password: string): { success: boolean; error?: string } => {
    if (customers.some((c) => c.email.toLowerCase() === email.toLowerCase())) {
      return { success: false, error: "An account with this email already exists." };
    }
    const newCustomer: Customer = {
      id: crypto.randomUUID(), name, email, phone, password,
      createdAt: new Date().toISOString(), tags: [], orders: [],
    };
    setCustomers((prev) => [...prev, newCustomer]);
    setCurrentUser(newCustomer);
    // Insert via server-side route — anon key has no INSERT on customers
    fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: newCustomer.id, name, email, phone, password, createdAt: newCustomer.createdAt }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("register:", j.error); }
    }).catch((e) => console.error("register:", e));
    return { success: true };
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem("sg_current_user");
  };

  // ─── Favourites ───────────────────────────────────────────────────────────

  const isFavourite = (menuItemId: string): boolean =>
    !!(currentUser && (currentUser.favourites ?? []).includes(menuItemId));

  const toggleFavourite = (menuItemId: string) => {
    if (!currentUser) return;
    const current = currentUser.favourites ?? [];
    const updated = current.includes(menuItemId)
      ? current.filter((id) => id !== menuItemId)
      : [...current, menuItemId];
    const updatedUser = { ...currentUser, favourites: updated };
    setCurrentUser(updatedUser);
    setCustomers((prev) => prev.map((c) => (c.id === currentUser.id ? { ...c, favourites: updated } : c)));
    fetch(`/api/customers/${currentUser.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favourites: updated }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("toggleFavourite:", j.error); }
    }).catch((e) => console.error("toggleFavourite:", e));
  };

  // ─── Saved addresses ──────────────────────────────────────────────────────

  function patchAddresses(customerId: string, updater: (addrs: SavedAddress[]) => SavedAddress[]) {
    const patch = (c: Customer) => {
      const newAddrs = updater(c.savedAddresses ?? []);
      return { ...c, savedAddresses: newAddrs };
    };
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? patch(c) : c)));
    setCurrentUser((prev) => {
      if (!prev || prev.id !== customerId) return prev;
      const updated = patch(prev);
      fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saved_addresses: updated.savedAddresses }),
      }).then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("patchAddresses:", j.error); }
      }).catch((e) => console.error("patchAddresses:", e));
      return updated;
    });
  }

  const addSavedAddress = (customerId: string, address: SavedAddress) =>
    patchAddresses(customerId, (addrs) => {
      const isFirst = addrs.length === 0;
      return [...addrs.map((a) => (isFirst ? { ...a, isDefault: false } : a)), { ...address, isDefault: isFirst || address.isDefault }];
    });

  const updateSavedAddress = (customerId: string, address: SavedAddress) =>
    patchAddresses(customerId, (addrs) => addrs.map((a) => (a.id === address.id ? address : a)));

  const deleteSavedAddress = (customerId: string, addressId: string) =>
    patchAddresses(customerId, (addrs) => {
      const remaining = addrs.filter((a) => a.id !== addressId);
      const wasDefault = addrs.find((a) => a.id === addressId)?.isDefault ?? false;
      if (wasDefault && remaining.length > 0) remaining[0] = { ...remaining[0], isDefault: true };
      return remaining;
    });

  const setDefaultAddress = (customerId: string, addressId: string) =>
    patchAddresses(customerId, (addrs) => addrs.map((a) => ({ ...a, isDefault: a.id === addressId })));

  // ─── Payment methods ──────────────────────────────────────────────────────

  const updatePaymentMethod = (method: PaymentMethod) =>
    mutateSettings((prev) => ({
      ...prev,
      paymentMethods: prev.paymentMethods.map((m) => (m.id === method.id ? method : m)),
    }));

  const togglePaymentMethod = (id: string, enabled: boolean) =>
    mutateSettings((prev) => {
      const method = prev.paymentMethods.find((m) => m.id === id);
      const entry: AuditEntry = {
        id: crypto.randomUUID(), timestamp: new Date().toISOString(),
        action: `${enabled ? "Enabled" : "Disabled"} ${method?.name ?? id}`, actor: "Admin",
      };
      return {
        ...prev,
        paymentMethods: prev.paymentMethods.map((m) => (m.id === id ? { ...m, enabled } : m)),
        paymentAuditLog: [entry, ...prev.paymentAuditLog].slice(0, 50),
      };
    });

  const reorderPaymentMethods = (methods: PaymentMethod[]) =>
    mutateSettings((prev) => ({ ...prev, paymentMethods: methods }));

  // ─── Delivery zones ───────────────────────────────────────────────────────

  const addDeliveryZone = (zone: DeliveryZone) =>
    mutateSettings((prev) => ({ ...prev, deliveryZones: [...prev.deliveryZones, zone] }));

  const updateDeliveryZone = (zone: DeliveryZone) =>
    mutateSettings((prev) => ({
      ...prev, deliveryZones: prev.deliveryZones.map((z) => (z.id === zone.id ? zone : z)),
    }));

  const deleteDeliveryZone = (id: string) =>
    mutateSettings((prev) => ({ ...prev, deliveryZones: prev.deliveryZones.filter((z) => z.id !== id) }));

  // ─── Coupons ──────────────────────────────────────────────────────────────

  const addCoupon    = (c: Coupon) => mutateSettings((p) => ({ ...p, coupons: [...(p.coupons ?? []), c] }));
  const updateCoupon = (c: Coupon) => mutateSettings((p) => ({ ...p, coupons: (p.coupons ?? []).map((x) => (x.id === c.id ? c : x)) }));
  const deleteCoupon = (id: string) => mutateSettings((p) => ({ ...p, coupons: (p.coupons ?? []).filter((x) => x.id !== id) }));
  const toggleCoupon = (id: string, active: boolean) =>
    mutateSettings((p) => ({ ...p, coupons: (p.coupons ?? []).map((x) => (x.id === id ? { ...x, active } : x)) }));
  const incrementCouponUsage = (couponId: string) =>
    mutateSettings((p) => ({
      ...p, coupons: (p.coupons ?? []).map((x) => (x.id === couponId ? { ...x, usageCount: x.usageCount + 1 } : x)),
    }));

  const applyCoupon = (code: string, subtotal: number): { valid: boolean; error?: string; discountAmount?: number } => {
    const result = validateCouponCode(code, subtotal, settings.coupons ?? []);
    if (!result.valid) return { valid: false, error: result.error };
    setAppliedCoupon({ couponId: result.coupon.id, code: result.coupon.code, discountAmount: result.discountAmount });
    return { valid: true, discountAmount: result.discountAmount };
  };

  const removeCoupon = () => setAppliedCoupon(null);

  // ─── Drivers — managed via server API (never in app_settings) ────────────

  const addDriver = async (
    data: Omit<Driver, "id" | "createdAt"> & { password: string },
  ): Promise<Driver> => {
    const res = await fetch("/api/admin/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json() as { ok: boolean; driver?: Driver; error?: string };
    if (!json.ok || !json.driver) throw new Error(json.error ?? "Failed to create driver");
    setDrivers((prev) => [json.driver!, ...prev]);
    return json.driver;
  };

  const updateDriver = async (
    id: string,
    data: Partial<Omit<Driver, "id" | "createdAt">> & { password?: string },
  ): Promise<Driver> => {
    const res = await fetch(`/api/admin/drivers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json() as { ok: boolean; driver?: Driver; error?: string };
    if (!json.ok || !json.driver) throw new Error(json.error ?? "Failed to update driver");
    setDrivers((prev) => prev.map((d) => (d.id === id ? json.driver! : d)));
    // Keep currentDriver in sync if it was the updated driver
    setCurrentDriver((prev) => (prev?.id === id ? json.driver! : prev));
    return json.driver;
  };

  const deleteDriver = async (id: string): Promise<void> => {
    const res = await fetch(`/api/admin/drivers/${id}`, { method: "DELETE" });
    const json = await res.json() as { ok: boolean; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to delete driver");
    setDrivers((prev) => prev.filter((d) => d.id !== id));
  };

  const toggleDriver = async (id: string, active: boolean): Promise<void> => {
    await updateDriver(id, { active });
  };

  const driverLogin = async (email: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json() as { ok: boolean; driver?: Driver; error?: string };
      if (json.ok && json.driver) {
        setCurrentDriver(json.driver);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const driverLogout = () => setCurrentDriver(null);

  const assignDriverToOrder = (customerId: string, orderId: string, driverId: string | null) => {
    const driver = driverId ? drivers.find((d) => d.id === driverId) : null;
    const patch = {
      driverId:       driverId       ?? undefined,
      driverName:     driver?.name   ?? undefined,
      deliveryStatus: driverId ? ("assigned" as DeliveryStatus) : undefined,
    };
    setCustomers((prev) => prev.map((c) =>
      c.id !== customerId ? c : { ...c, orders: c.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)) }
    ));
    fetch(`/api/admin/orders/${orderId}/driver`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driver_id:       driverId ?? "",
        driver_name:     driver?.name ?? "",
        delivery_status: driverId ? "assigned" : "",
      }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("assignDriver:", j.error); }
    }).catch((e) => console.error("assignDriver:", e));
  };

  const updateDeliveryStatus = (customerId: string, orderId: string, status: DeliveryStatus) => {
    const orderPatch: Partial<Order> = {
      deliveryStatus: status,
      ...(status === "delivered" ? { status: "delivered" as OrderStatus } : {}),
    };
    const patchOrders = (orders: Order[]) =>
      orders.map((o) => (o.id === orderId ? { ...o, ...orderPatch } : o));
    setCustomers((prev) => prev.map((c) =>
      c.id !== customerId ? c : { ...c, orders: patchOrders(c.orders) }
    ));
    setCurrentUser((prev) =>
      prev && prev.id === customerId ? { ...prev, orders: patchOrders(prev.orders) } : prev
    );
    const body: Record<string, string> = { delivery_status: status };
    if (status === "delivered") body.status = "delivered";
    fetch(`/api/admin/orders/${orderId}/driver`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("updateDeliveryStatus:", j.error); }
    }).catch((e) => console.error("updateDeliveryStatus:", e));
  };

  // ─── Breakfast menu ────────────────────────────────────────────────────────

  const bm = () => settings.breakfastMenu ?? { enabled: false, startTime: "07:00", endTime: "11:30", categories: [], items: [] };

  const updateBreakfastSettings = (patch: Partial<BreakfastMenuSettings>) =>
    mutateSettings((p) => ({ ...p, breakfastMenu: { ...bm(), ...patch } }));

  const addBreakfastCategory = (cat: Category) =>
    mutateSettings((p) => ({ ...p, breakfastMenu: { ...bm(), categories: [...(bm().categories), cat] } }));

  const updateBreakfastCategory = (cat: Category) =>
    mutateSettings((p) => ({ ...p, breakfastMenu: { ...bm(), categories: bm().categories.map((c) => (c.id === cat.id ? cat : c)) } }));

  const deleteBreakfastCategory = (id: string) =>
    mutateSettings((p) => ({
      ...p,
      breakfastMenu: {
        ...bm(),
        categories: bm().categories.filter((c) => c.id !== id),
        items: bm().items.filter((i) => i.categoryId !== id),
      },
    }));

  const reorderBreakfastCategories = (cats: Category[]) =>
    mutateSettings((p) => ({ ...p, breakfastMenu: { ...bm(), categories: cats } }));

  const addBreakfastItem = (item: MenuItem) =>
    mutateSettings((p) => ({ ...p, breakfastMenu: { ...bm(), items: [...bm().items, item] } }));

  const updateBreakfastItem = (item: MenuItem) =>
    mutateSettings((p) => ({ ...p, breakfastMenu: { ...bm(), items: bm().items.map((i) => (i.id === item.id ? item : i)) } }));

  const deleteBreakfastItem = (id: string) =>
    mutateSettings((p) => ({ ...p, breakfastMenu: { ...bm(), items: bm().items.filter((i) => i.id !== id) } }));

  // ─── Derived values ────────────────────────────────────────────────────────

  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  return (
    <AppContext.Provider
      value={{
        cart, addToCart, removeFromCart, updateQty, clearCart, cartTotal, cartCount,
        settings, updateSettings, isOpen,
        fulfillment, setFulfillment, scheduledTime, setScheduledTime,
        categories, menuItems,
        addCategory, updateCategory, deleteCategory, reorderCategories,
        addMenuItem, updateMenuItem, deleteMenuItem,
        customers, addOrder, updateOrderStatus, addCustomer, updateCustomer,
        currentUser, login, register, logout,
        toggleFavourite, isFavourite,
        updatePaymentMethod, togglePaymentMethod, reorderPaymentMethods,
        addDeliveryZone, updateDeliveryZone, deleteDeliveryZone,
        coupons: settings.coupons ?? [],
        addCoupon, updateCoupon, deleteCoupon, toggleCoupon,
        incrementCouponUsage, appliedCoupon, applyCoupon, removeCoupon,
        addSavedAddress, updateSavedAddress, deleteSavedAddress, setDefaultAddress,
        drivers,
        currentDriver, driverLogin, driverLogout,
        addDriver, updateDriver, deleteDriver, toggleDriver,
        assignDriverToOrder, updateDeliveryStatus, addRefund, spendStoreCredit,
        updateBreakfastSettings,
        addBreakfastCategory, updateBreakfastCategory, deleteBreakfastCategory, reorderBreakfastCategories,
        addBreakfastItem, updateBreakfastItem, deleteBreakfastItem,
      }}
    >
      <SeoHead settings={settings} />
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
