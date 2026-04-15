"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useState,
} from "react";
import { AdminSettings, AuditEntry, CartItem, Category, Coupon, CustomPage, DeliveryStatus, DeliveryZone, Driver, EmailTemplate, FooterLogo, FooterPage, MenuLink, MenuItem, Customer, Order, OrderStatus, PaymentMethod, PrinterSettings, SavedAddress, SeoSettings, ReceiptSettings, TaxSettings } from "@/types";
import type { ColorSettings } from "@/types";
import { buildColorCss } from "@/lib/colorUtils";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { DEFAULT_FOOTER_PAGES } from "@/data/footerPages";
import SeoHead from "@/components/SeoHead";
import { restaurantInfo, defaultSchedule } from "@/data/restaurant";
import { categories as defaultCategories, menuItems as defaultMenuItems } from "@/data/menu";
import { mockCustomers } from "@/data/customers";

// ─── Cart ───────────────────────────────────────────────────────────────────

type CartAction =
  | { type: "ADD"; item: CartItem }
  | { type: "REMOVE"; id: string }
  | { type: "UPDATE_QTY"; id: string; qty: number }
  | { type: "CLEAR" };

function cartReducer(state: CartItem[], action: CartAction): CartItem[] {
  switch (action.type) {
    case "ADD":
      return [...state, action.item];
    case "REMOVE":
      return state.filter((i) => i.id !== action.id);
    case "UPDATE_QTY":
      return state
        .map((i) => (i.id === action.id ? { ...i, quantity: action.qty } : i))
        .filter((i) => i.quantity > 0);
    case "CLEAR":
      return [];
    default:
      return state;
  }
}

// ─── Context shape ───────────────────────────────────────────────────────────

interface AppContextValue {
  // Cart
  cart: CartItem[];
  addToCart: (item: CartItem) => void;
  removeFromCart: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  clearCart: () => void;
  cartTotal: number;
  cartCount: number;

  // Settings
  settings: AdminSettings;
  updateSettings: (patch: Partial<AdminSettings>) => void;

  // Store state
  isOpen: boolean;

  // Fulfillment type
  fulfillment: "delivery" | "collection";
  setFulfillment: (f: "delivery" | "collection") => void;

  // Scheduled ordering (set when restaurant is closed but customer picks a future slot)
  scheduledTime: string | null;  // null = ASAP; string = human-readable slot label
  setScheduledTime: (t: string | null) => void;

  // Menu management
  categories: Category[];
  menuItems: MenuItem[];
  addCategory: (cat: Category) => void;
  updateCategory: (cat: Category) => void;
  deleteCategory: (id: string) => void;
  addMenuItem: (item: MenuItem) => void;
  updateMenuItem: (item: MenuItem) => void;
  deleteMenuItem: (id: string) => void;
  reorderCategories: (cats: Category[]) => void;

  // Customers
  customers: Customer[];
  addOrder: (customerId: string, order: Order) => void;
  updateOrderStatus: (customerId: string, orderId: string, status: OrderStatus) => void;
  addCustomer: (customer: Customer) => void;
  updateCustomer: (customer: Customer) => void;

  // Auth
  currentUser: Customer | null;
  login: (email: string, password: string) => boolean;
  register: (name: string, email: string, phone: string, password: string) => { success: boolean; error?: string };
  logout: () => void;

  // Favourites
  toggleFavourite: (menuItemId: string) => void;
  isFavourite: (menuItemId: string) => boolean;

  // Payment methods
  updatePaymentMethod: (method: PaymentMethod) => void;
  togglePaymentMethod: (id: string, enabled: boolean) => void;
  reorderPaymentMethods: (methods: PaymentMethod[]) => void;

  // Delivery zones
  addDeliveryZone: (zone: DeliveryZone) => void;
  updateDeliveryZone: (zone: DeliveryZone) => void;
  deleteDeliveryZone: (id: string) => void;

  // Coupons — admin CRUD
  coupons: Coupon[];
  addCoupon: (coupon: Coupon) => void;
  updateCoupon: (coupon: Coupon) => void;
  deleteCoupon: (id: string) => void;
  toggleCoupon: (id: string, active: boolean) => void;

  // Applied coupon — checkout session (ephemeral, not persisted)
  appliedCoupon: { couponId: string; code: string; discountAmount: number } | null;
  applyCoupon: (code: string, cartSubtotal: number) => { valid: boolean; error?: string; discountAmount?: number };
  removeCoupon: () => void;
  incrementCouponUsage: (couponId: string) => void;

  // Saved addresses — customer address book
  addSavedAddress: (customerId: string, address: SavedAddress) => void;
  updateSavedAddress: (customerId: string, address: SavedAddress) => void;
  deleteSavedAddress: (customerId: string, addressId: string) => void;
  setDefaultAddress: (customerId: string, addressId: string) => void;

  // Drivers — admin CRUD + driver auth
  drivers: Driver[];
  currentDriver: Driver | null;
  driverLogin: (email: string, password: string) => boolean;
  driverLogout: () => void;
  addDriver: (driver: Driver) => void;
  updateDriver: (driver: Driver) => void;
  deleteDriver: (id: string) => void;
  toggleDriver: (id: string, active: boolean) => void;
  assignDriverToOrder: (customerId: string, orderId: string, driverId: string | null) => void;
  updateDeliveryStatus: (customerId: string, orderId: string, status: DeliveryStatus) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

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

const DEFAULT_COLORS: ColorSettings = {
  primaryColor:    "#f97316", // orange-500
  backgroundColor: "#f9fafb", // gray-50
};

const DEFAULT_TAX_SETTINGS: TaxSettings = {
  enabled:       false,
  rate:          20,
  inclusive:     true,   // UK standard: prices shown inclusive of VAT
  showBreakdown: true,
};

const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  showLogo:         false,
  logoUrl:          "",
  restaurantName:   restaurantInfo.name,
  phone:            restaurantInfo.phone,
  website:          "",
  email:            "",
  vatNumber:        "",
  thankYouMessage:  "Thank you for your order!",
  customMessage:    "",
};

const DEFAULT_SEO: SeoSettings = {
  metaTitle:       `${restaurantInfo.name} — Order Online`,
  metaDescription: `Order online from ${restaurantInfo.name}. Fast delivery and easy collection.`,
  metaKeywords:    `food delivery, online order, ${restaurantInfo.name}`,
};

const DEFAULT_PRINTER: PrinterSettings = {
  enabled:    false,
  name:       "Kitchen Printer",
  ip:         "",
  port:       9100,
  autoPrint:  true,
  paperWidth: 48,   // 80 mm
};

// ─── Coupon validator ────────────────────────────────────────────────────────

function validateCouponCode(
  code: string,
  cartSubtotal: number,
  coupons: Coupon[],
): { valid: true; coupon: Coupon; discountAmount: number } | { valid: false; error: string } {
  const coupon = coupons.find((c) => c.code.toUpperCase() === code.trim().toUpperCase());
  if (!coupon)          return { valid: false, error: "Invalid coupon code." };
  if (!coupon.active)   return { valid: false, error: "This coupon is no longer active." };
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
    return { valid: false, error: "This coupon has expired." };
  }
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, error: "This coupon has reached its usage limit." };
  }
  if (coupon.minOrderAmount > 0 && cartSubtotal < coupon.minOrderAmount) {
    return { valid: false, error: `Minimum order of £${coupon.minOrderAmount.toFixed(2)} required for this coupon.` };
  }
  const discountAmount =
    coupon.type === "percentage"
      ? parseFloat((cartSubtotal * (coupon.value / 100)).toFixed(2))
      : parseFloat(Math.min(coupon.value, cartSubtotal).toFixed(2));
  return { valid: true, coupon, discountAmount };
}

const DEFAULT_SETTINGS: AdminSettings = {
  drivers: [],
  restaurant: restaurantInfo,
  schedule: defaultSchedule,
  manualClosed: false,
  stripePublicKey: "",
  stripeSecretKey: "",
  paypalClientId: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPassword: "",
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  paymentAuditLog: [],
  deliveryZones: DEFAULT_DELIVERY_ZONES,
  seo: DEFAULT_SEO,
  customHeadCode: "",
  printer: DEFAULT_PRINTER,
  emailTemplates: DEFAULT_EMAIL_TEMPLATES,
  footerPages:    DEFAULT_FOOTER_PAGES,
  footerCopyright: `© ${new Date().getFullYear()} ${restaurantInfo.name}. All rights reserved.`,
  customPages: [],
  menuLinks: [],
  colors: DEFAULT_COLORS,
  footerLogos: [],
  receiptSettings: DEFAULT_RECEIPT_SETTINGS,
  coupons: [],
  taxSettings: DEFAULT_TAX_SETTINGS,
};

function isStoreOpen(settings: AdminSettings): boolean {
  if (settings.manualClosed) return false;
  const days = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ];
  const now = new Date();
  const dayName = days[now.getDay()];
  const day = settings.schedule[dayName];
  if (!day || day.closed) return false;
  const [oh, om] = day.open.split(":").map(Number);
  const [ch, cm] = day.close.split(":").map(Number);
  const current = now.getHours() * 60 + now.getMinutes();
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  return current >= openMin && current < closeMin;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [cart, dispatch] = useReducer(cartReducer, []);
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [currentDriver, setCurrentDriver] = useState<Driver | null>(null);
  const [fulfillment, setFulfillment] = useState<"delivery" | "collection">("delivery");
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>(defaultCategories);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(defaultMenuItems);
  const [customers, setCustomers] = useState<Customer[]>(mockCustomers);
  const [currentUser, setCurrentUser] = useState<Customer | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    couponId: string; code: string; discountAmount: number;
  } | null>(null);

  // Hydrate from localStorage — load everything atomically in one effect
  useEffect(() => {
    try {
      const storedSettings = localStorage.getItem("sg_settings");
      if (storedSettings) {
        const parsed = JSON.parse(storedSettings);

        // Shallow-merge with defaults so new top-level fields (deliveryZones,
        // paymentAuditLog, etc.) are present even on old stored snapshots.
        const merged: AdminSettings = { ...DEFAULT_SETTINGS, ...parsed };

        // Deep-migrate restaurant: older snapshots have a single `address` string
        // instead of the structured address fields. Backfill from defaults so
        // the admin location form never shows empty inputs.
        if (parsed.restaurant) {
          const storedR = parsed.restaurant;
          merged.restaurant = {
            ...DEFAULT_SETTINGS.restaurant,
            ...storedR,
            // Ensure all structured address fields are present
            addressLine1: storedR.addressLine1 ?? DEFAULT_SETTINGS.restaurant.addressLine1,
            addressLine2: storedR.addressLine2 ?? DEFAULT_SETTINGS.restaurant.addressLine2,
            city:         storedR.city         ?? DEFAULT_SETTINGS.restaurant.city,
            postcode:     storedR.postcode      ?? DEFAULT_SETTINGS.restaurant.postcode,
            country:      storedR.country       ?? DEFAULT_SETTINGS.restaurant.country,
          };
        }

        // Deep-migrate seo: backfill any missing fields added after initial release.
        merged.seo = { ...DEFAULT_SEO, ...(parsed.seo ?? {}) };

        // Deep-migrate printer: backfill all fields for snapshots that predate
        // the thermal printer feature.
        merged.printer = { ...DEFAULT_PRINTER, ...(parsed.printer ?? {}) };

        // Deep-migrate emailTemplates: merge stored templates with defaults so
        // newly added template events appear on old snapshots.
        if (Array.isArray(parsed.emailTemplates)) {
          const stored: EmailTemplate[] = parsed.emailTemplates;
          const storedEvents = new Set(stored.map((t: EmailTemplate) => t.event));
          const missing = DEFAULT_EMAIL_TEMPLATES.filter((d) => !storedEvents.has(d.event));
          merged.emailTemplates = [...stored, ...missing];
        }

        // Deep-migrate footerPages: merge stored pages with defaults so newly
        // added slugs appear on old snapshots without overwriting admin edits.
        if (Array.isArray(parsed.footerPages)) {
          const stored: FooterPage[] = parsed.footerPages;
          const storedSlugs = new Set(stored.map((p: FooterPage) => p.slug));
          const missing = DEFAULT_FOOTER_PAGES.filter((d) => !storedSlugs.has(d.slug));
          merged.footerPages = [...stored, ...missing];
        }
        if (!parsed.footerCopyright) {
          merged.footerCopyright = DEFAULT_SETTINGS.footerCopyright;
        }

        // Deep-migrate customPages: ensure field exists for old snapshots.
        if (!Array.isArray(parsed.customPages)) {
          merged.customPages = [];
        } else {
          // Backfill any fields added to the CustomPage type after initial release.
          merged.customPages = (parsed.customPages as CustomPage[]).map((p) => ({
            ...{ seoTitle: "", seoDescription: "", published: true, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() },
            ...p,
          }));
        }

        // Deep-migrate menuLinks: ensure field exists for old snapshots.
        if (!Array.isArray(parsed.menuLinks)) {
          merged.menuLinks = [];
        } else {
          merged.menuLinks = (parsed.menuLinks as MenuLink[]).map((l) => ({
            ...{ active: true, order: 0 },
            ...l,
          }));
        }

        // Deep-migrate colors: backfill missing fields from defaults.
        merged.colors = { ...DEFAULT_COLORS, ...(parsed.colors ?? {}) };

        // Deep-migrate footerLogos: ensure field exists for old snapshots.
        merged.footerLogos = Array.isArray(parsed.footerLogos)
          ? (parsed.footerLogos as FooterLogo[]).map((l) => ({
              ...{ href: "", enabled: true, order: 0 },
              ...l,
            }))
          : [];

        // Deep-migrate receiptSettings: backfill for snapshots that predate this feature.
        merged.receiptSettings = { ...DEFAULT_RECEIPT_SETTINGS, ...(parsed.receiptSettings ?? {}) };

        // Deep-migrate taxSettings: backfill for snapshots that predate this feature.
        merged.taxSettings = { ...DEFAULT_TAX_SETTINGS, ...(parsed.taxSettings ?? {}) };

        // Deep-migrate drivers: ensure field exists for old snapshots.
        merged.drivers = Array.isArray(parsed.drivers)
          ? (parsed.drivers as Driver[]).map((d) => ({
              ...{ active: true, vehicleInfo: "", notes: "", createdAt: new Date(0).toISOString() },
              ...d,
            }))
          : [];

        // Deep-migrate coupons: ensure field exists for old snapshots.
        const COUPON_DEFAULTS = {
          usageCount: 0, active: true, expiryDate: "",
          usageLimit: 0, minOrderAmount: 0, createdAt: new Date(0).toISOString(),
        };
        merged.coupons = Array.isArray(parsed.coupons)
          ? (parsed.coupons as Coupon[]).map((c) => ({ ...COUPON_DEFAULTS, ...c }))
          : [];

        // Deep-migrate paymentMethods: older stored methods lack deliveryRange.
        // Preserve all stored fields but backfill any missing ones from the
        // matching default method, falling back to a safe "unrestricted" value.
        if (Array.isArray(parsed.paymentMethods)) {
          merged.paymentMethods = parsed.paymentMethods.map(
            (stored: PaymentMethod) => {
              const def = DEFAULT_PAYMENT_METHODS.find((d) => d.id === stored.id);
              return {
                ...(def ?? {}),
                ...stored,
                deliveryRange: stored.deliveryRange ?? def?.deliveryRange ?? { restricted: false, minKm: 0, maxKm: 50 },
              };
            }
          );
        }

        setSettings(merged);
      }

      const storedCart = localStorage.getItem("sg_cart");
      if (storedCart) {
        const items: CartItem[] = JSON.parse(storedCart);
        items.forEach((item) => dispatch({ type: "ADD", item }));
      }

      const storedCategories = localStorage.getItem("sg_categories");
      if (storedCategories) setCategories(JSON.parse(storedCategories));

      const storedMenu = localStorage.getItem("sg_menu");
      if (storedMenu) setMenuItems(JSON.parse(storedMenu));

      const storedCustomers = localStorage.getItem("sg_customers");
      if (storedCustomers) {
        const parsed: Customer[] = JSON.parse(storedCustomers);
        // Backfill favourites and savedAddresses for snapshots that predate these fields
        setCustomers(parsed.map((c) => ({ favourites: [], savedAddresses: [], ...c })));
      }

      const storedUser = localStorage.getItem("sg_current_user");
      if (storedUser) setCurrentUser(JSON.parse(storedUser));

      const storedDriver = localStorage.getItem("sg_driver_session");
      if (storedDriver) setCurrentDriver(JSON.parse(storedDriver));
    } catch {
      // ignore parse errors
    }
    // Mark as hydrated AFTER all setState calls above have been queued.
    // React 18 batches these, so the persist effects below won't fire
    // with stale (default) data.
    setHydrated(true);
  }, []);

  // ── Cross-tab real-time sync ──────────────────────────────────────────────
  // The Web Storage API fires a `storage` event on every tab that shares the
  // same origin whenever localStorage changes — but ONLY on the tabs that did
  // NOT make the write. This gives us free cross-tab reactivity: a customer
  // placing an order in one tab immediately updates the admin panel in another,
  // and admin status changes surface instantly in the customer dashboard.
  useEffect(() => {
    function onStorageChange(e: StorageEvent) {
      if (!e.newValue) return; // key was removed — ignore
      try {
        const val = JSON.parse(e.newValue);
        switch (e.key) {
          case "sg_customers":   setCustomers(val);  break;
          case "sg_settings":    setSettings(val);   break;
          case "sg_menu":        setMenuItems(val);  break;
          case "sg_categories":  setCategories(val); break;
          case "sg_current_user":
            // Sync the logged-in session across tabs (e.g. login in one tab
            // reflects in another open tab of the same origin).
            setCurrentUser(val);
            break;
          case "sg_driver_session":
            setCurrentDriver(val);
            break;
        }
      } catch {
        // malformed JSON — ignore silently
      }
    }
    window.addEventListener("storage", onStorageChange);
    return () => window.removeEventListener("storage", onStorageChange);
  }, []); // register exactly once

  // Persist — only ever runs AFTER hydration so we never overwrite
  // localStorage with the default seed data
  useEffect(() => { if (hydrated) localStorage.setItem("sg_settings",  JSON.stringify(settings));  }, [settings,    hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem("sg_cart",      JSON.stringify(cart));      }, [cart,       hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem("sg_categories",JSON.stringify(categories));}, [categories,  hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem("sg_menu",      JSON.stringify(menuItems)); }, [menuItems,   hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem("sg_customers", JSON.stringify(customers)); }, [customers,   hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem("sg_current_user", JSON.stringify(currentUser)); }, [currentUser, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    if (currentDriver) localStorage.setItem("sg_driver_session", JSON.stringify(currentDriver));
    else localStorage.removeItem("sg_driver_session");
  }, [currentDriver, hydrated]);

  // ── Color theme injection ─────────────────────────────────────────────────
  // Overrides Tailwind v4's --color-orange-* CSS variables so every orange-*
  // utility class across the whole app reflects the admin's chosen brand color.
  // Runs after hydration and whenever the saved color settings change.
  useEffect(() => {
    const { primaryColor, backgroundColor } = settings.colors ?? DEFAULT_COLORS;
    const css = buildColorCss(primaryColor, backgroundColor);
    if (!css) return;
    let el = document.getElementById("color-theme-vars");
    if (!el) {
      el = document.createElement("style");
      el.id = "color-theme-vars";
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [settings.colors]);

  // Cart actions
  const addToCart = (item: CartItem) => dispatch({ type: "ADD", item });
  const removeFromCart = (id: string) => dispatch({ type: "REMOVE", id });
  const updateQty = (id: string, qty: number) => dispatch({ type: "UPDATE_QTY", id, qty });
  const clearCart = () => dispatch({ type: "CLEAR" });

  const updateSettings = (patch: Partial<AdminSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  // Category CRUD
  const addCategory = (cat: Category) => setCategories((prev) => [...prev, cat]);
  const updateCategory = (cat: Category) =>
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)));
  const deleteCategory = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setMenuItems((prev) => prev.filter((i) => i.categoryId !== id));
  };
  const reorderCategories = (cats: Category[]) => setCategories(cats);

  // Menu item CRUD
  const addMenuItem = (item: MenuItem) => setMenuItems((prev) => [...prev, item]);
  const updateMenuItem = (item: MenuItem) =>
    setMenuItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
  const deleteMenuItem = (id: string) =>
    setMenuItems((prev) => prev.filter((i) => i.id !== id));

  // Customer actions
  const addOrder = (customerId: string, order: Order) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === customerId ? { ...c, orders: [order, ...c.orders] } : c))
    );
    // Keep currentUser in sync so the account page reflects the new order immediately
    setCurrentUser((prev) =>
      prev && prev.id === customerId ? { ...prev, orders: [order, ...prev.orders] } : prev
    );
  };

  const updateOrderStatus = (customerId: string, orderId: string, status: OrderStatus) => {
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId
          ? { ...c, orders: c.orders.map((o) => (o.id === orderId ? { ...o, status } : o)) }
          : c
      )
    );
    // Mirror status changes onto currentUser too
    setCurrentUser((prev) =>
      prev && prev.id === customerId
        ? { ...prev, orders: prev.orders.map((o) => (o.id === orderId ? { ...o, status } : o)) }
        : prev
    );
  };

  const addCustomer = (customer: Customer) => setCustomers((prev) => [...prev, customer]);
  const updateCustomer = (customer: Customer) =>
    setCustomers((prev) => prev.map((c) => (c.id === customer.id ? customer : c)));

  // Auth
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
      id: crypto.randomUUID(),
      name, email, phone, password,
      createdAt: new Date().toISOString(),
      tags: [],
      orders: [],
    };
    setCustomers((prev) => [...prev, newCustomer]);
    setCurrentUser(newCustomer);
    return { success: true };
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem("sg_current_user");
  };

  // Favourites
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
    setCustomers((prev) =>
      prev.map((c) => (c.id === currentUser.id ? { ...c, favourites: updated } : c))
    );
  };

  // Payment method actions
  const updatePaymentMethod = (method: PaymentMethod) =>
    setSettings((prev) => ({
      ...prev,
      paymentMethods: prev.paymentMethods.map((m) => (m.id === method.id ? method : m)),
    }));

  const togglePaymentMethod = (id: string, enabled: boolean) => {
    setSettings((prev) => {
      const method = prev.paymentMethods.find((m) => m.id === id);
      const entry: AuditEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        action: `${enabled ? "Enabled" : "Disabled"} ${method?.name ?? id}`,
        actor: "Admin",
      };
      return {
        ...prev,
        paymentMethods: prev.paymentMethods.map((m) =>
          m.id === id ? { ...m, enabled } : m
        ),
        paymentAuditLog: [entry, ...prev.paymentAuditLog].slice(0, 50),
      };
    });
  };

  const reorderPaymentMethods = (methods: PaymentMethod[]) =>
    setSettings((prev) => ({ ...prev, paymentMethods: methods }));

  // Delivery zone CRUD
  const addDeliveryZone = (zone: DeliveryZone) =>
    setSettings((prev) => ({ ...prev, deliveryZones: [...prev.deliveryZones, zone] }));

  const updateDeliveryZone = (zone: DeliveryZone) =>
    setSettings((prev) => ({
      ...prev,
      deliveryZones: prev.deliveryZones.map((z) => (z.id === zone.id ? zone : z)),
    }));

  const deleteDeliveryZone = (id: string) =>
    setSettings((prev) => ({
      ...prev,
      deliveryZones: prev.deliveryZones.filter((z) => z.id !== id),
    }));

  // ── Coupon CRUD ───────────────────────────────────────────────────────────
  const addCoupon = (coupon: Coupon) =>
    setSettings((prev) => ({ ...prev, coupons: [...(prev.coupons ?? []), coupon] }));

  const updateCoupon = (coupon: Coupon) =>
    setSettings((prev) => ({
      ...prev,
      coupons: (prev.coupons ?? []).map((c) => (c.id === coupon.id ? coupon : c)),
    }));

  const deleteCoupon = (id: string) =>
    setSettings((prev) => ({
      ...prev,
      coupons: (prev.coupons ?? []).filter((c) => c.id !== id),
    }));

  const toggleCoupon = (id: string, active: boolean) =>
    setSettings((prev) => ({
      ...prev,
      coupons: (prev.coupons ?? []).map((c) => (c.id === id ? { ...c, active } : c)),
    }));

  const incrementCouponUsage = (couponId: string) =>
    setSettings((prev) => ({
      ...prev,
      coupons: (prev.coupons ?? []).map((c) =>
        c.id === couponId ? { ...c, usageCount: c.usageCount + 1 } : c
      ),
    }));

  // ── Coupon validation (checkout session) ──────────────────────────────────
  const applyCoupon = (
    code: string,
    cartSubtotal: number,
  ): { valid: boolean; error?: string; discountAmount?: number } => {
    const result = validateCouponCode(code, cartSubtotal, settings.coupons ?? []);
    if (!result.valid) return { valid: false, error: result.error };
    setAppliedCoupon({ couponId: result.coupon.id, code: result.coupon.code, discountAmount: result.discountAmount });
    return { valid: true, discountAmount: result.discountAmount };
  };

  const removeCoupon = () => setAppliedCoupon(null);

  // ── Driver CRUD ───────────────────────────────────────────────────────────
  const addDriver = (driver: Driver) =>
    setSettings((prev) => ({ ...prev, drivers: [...(prev.drivers ?? []), driver] }));

  const updateDriver = (driver: Driver) =>
    setSettings((prev) => ({
      ...prev,
      drivers: (prev.drivers ?? []).map((d) => (d.id === driver.id ? driver : d)),
    }));

  const deleteDriver = (id: string) =>
    setSettings((prev) => ({
      ...prev,
      drivers: (prev.drivers ?? []).filter((d) => d.id !== id),
    }));

  const toggleDriver = (id: string, active: boolean) =>
    setSettings((prev) => ({
      ...prev,
      drivers: (prev.drivers ?? []).map((d) => (d.id === id ? { ...d, active } : d)),
    }));

  // ── Driver auth ───────────────────────────────────────────────────────────
  const driverLogin = (email: string, password: string): boolean => {
    const found = (settings.drivers ?? []).find(
      (d) =>
        d.email.toLowerCase() === email.toLowerCase() &&
        d.password === password &&
        d.active,
    );
    if (found) { setCurrentDriver(found); return true; }
    return false;
  };

  const driverLogout = () => setCurrentDriver(null);

  // ── Driver order management ───────────────────────────────────────────────
  const assignDriverToOrder = (
    customerId: string,
    orderId: string,
    driverId: string | null,
  ) => {
    const driver = driverId
      ? (settings.drivers ?? []).find((d) => d.id === driverId)
      : null;
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId
          ? {
              ...c,
              orders: c.orders.map((o) =>
                o.id === orderId
                  ? {
                      ...o,
                      driverId:       driverId       ?? undefined,
                      driverName:     driver?.name   ?? undefined,
                      deliveryStatus: driverId ? ("assigned" as DeliveryStatus) : undefined,
                    }
                  : o
              ),
            }
          : c
      )
    );
  };

  const updateDeliveryStatus = (
    customerId: string,
    orderId: string,
    status: DeliveryStatus,
  ) => {
    const patch: Partial<Order> = {
      deliveryStatus: status,
      ...(status === "delivered" ? { status: "delivered" as OrderStatus } : {}),
    };
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId
          ? { ...c, orders: c.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)) }
          : c
      )
    );
    setCurrentUser((prev) =>
      prev && prev.id === customerId
        ? { ...prev, orders: prev.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)) }
        : prev
    );
  };

  // ── Saved address CRUD ────────────────────────────────────────────────────
  function patchCustomerAddresses(customerId: string, updater: (addrs: SavedAddress[]) => SavedAddress[]) {
    const patch = (c: Customer) => ({ ...c, savedAddresses: updater(c.savedAddresses ?? []) });
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? patch(c) : c)));
    setCurrentUser((prev) => (prev && prev.id === customerId ? patch(prev) : prev));
  }

  const addSavedAddress = (customerId: string, address: SavedAddress) =>
    patchCustomerAddresses(customerId, (addrs) => {
      // If this is the first address, make it default automatically
      const isFirst = addrs.length === 0;
      return [...addrs.map((a) => (isFirst ? { ...a, isDefault: false } : a)), { ...address, isDefault: isFirst || address.isDefault }];
    });

  const updateSavedAddress = (customerId: string, address: SavedAddress) =>
    patchCustomerAddresses(customerId, (addrs) =>
      addrs.map((a) => (a.id === address.id ? address : a))
    );

  const deleteSavedAddress = (customerId: string, addressId: string) =>
    patchCustomerAddresses(customerId, (addrs) => {
      const remaining = addrs.filter((a) => a.id !== addressId);
      // If the deleted address was default, promote the first remaining one
      const deletedWasDefault = addrs.find((a) => a.id === addressId)?.isDefault ?? false;
      if (deletedWasDefault && remaining.length > 0) {
        remaining[0] = { ...remaining[0], isDefault: true };
      }
      return remaining;
    });

  const setDefaultAddress = (customerId: string, addressId: string) =>
    patchCustomerAddresses(customerId, (addrs) =>
      addrs.map((a) => ({ ...a, isDefault: a.id === addressId }))
    );

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const isOpen = isStoreOpen(settings);

  return (
    <AppContext.Provider
      value={{
        cart, addToCart, removeFromCart, updateQty, clearCart, cartTotal, cartCount,
        settings, updateSettings, isOpen, fulfillment, setFulfillment,
        scheduledTime, setScheduledTime,
        categories, menuItems,
        addCategory, updateCategory, deleteCategory, reorderCategories,
        addMenuItem, updateMenuItem, deleteMenuItem,
        customers, addOrder, updateOrderStatus, addCustomer, updateCustomer,
        currentUser, login, register, logout,
        toggleFavourite, isFavourite,
        updatePaymentMethod, togglePaymentMethod, reorderPaymentMethods,
        addDeliveryZone, updateDeliveryZone, deleteDeliveryZone,
        coupons: settings.coupons ?? [],
        addCoupon, updateCoupon, deleteCoupon, toggleCoupon, incrementCouponUsage,
        appliedCoupon, applyCoupon, removeCoupon,
        drivers: settings.drivers ?? [],
        currentDriver, driverLogin, driverLogout,
        addDriver, updateDriver, deleteDriver, toggleDriver,
        assignDriverToOrder, updateDeliveryStatus,
        addSavedAddress, updateSavedAddress, deleteSavedAddress, setDefaultAddress,
      }}
    >
      {/* SeoHead runs on every page — receives settings as a prop so it can
          live inside the Provider without a circular useApp() dependency */}
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
