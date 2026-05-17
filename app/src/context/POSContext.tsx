"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
const uuid = () => crypto.randomUUID();
import {
  POSStaff, POSProduct, POSCategory, POSModifier, POSCartItem, POSSale, POSCustomer,
  POSSettings, POSClockEntry, POSCartModifier, getOfferPrice, cartLineTotal,
} from "@/types/pos";
import { enqueue as outboxEnqueue } from "@/lib/posOutbox";
import { useApp } from "@/context/AppContext";

// ─── Seed data ───────────────────────────────────────────────────────────────

// Staff is loaded from app_settings.data.pos_staff on mount (see useEffect
// in POSProvider). No localStorage cache and no hardcoded seed — the DB is
// the only source of truth, so a fresh terminal renders the correct staff
// list immediately and edits made on one terminal are visible everywhere.

const SEED_CATEGORIES: POSCategory[] = [
  { id: "starters",  name: "Starters",       emoji: "🥗", color: "#f97316", order: 0 },
  { id: "mains",     name: "Mains",           emoji: "🍛", color: "#8b5cf6", order: 1 },
  { id: "breads",    name: "Breads & Rice",   emoji: "🫓", color: "#f59e0b", order: 2 },
  { id: "seafood",   name: "Seafood",         emoji: "🦐", color: "#06b6d4", order: 3 },
  { id: "sides",     name: "Sides",           emoji: "🫙", color: "#10b981", order: 4 },
  { id: "desserts",  name: "Desserts",        emoji: "🍮", color: "#ec4899", order: 5 },
  { id: "drinks",    name: "Drinks",          emoji: "🥤", color: "#3b82f6", order: 6 },
];

const SEED_PRODUCTS: POSProduct[] = [
  // Starters
  { id: "p-s1", categoryId: "starters", name: "Onion Bhaji", price: 5.50, emoji: "🧅", color: "#fed7aa", trackStock: false, active: true, popular: true, cost: 1.50,
    modifiers: [{id: "m-portion", name: "Portion", required: true, multiSelect: false, options: [{id: "reg", label: "Regular (4 pcs)", priceAdjust: 0},{id: "lg", label: "Large (6 pcs)", priceAdjust: 2.00}]}]},
  { id: "p-s2", categoryId: "starters", name: "Seekh Kebab", price: 7.95, emoji: "🍢", color: "#fecaca", trackStock: false, active: true, cost: 2.50,
    modifiers: [{id: "m-spice", name: "Spice Level", required: true, multiSelect: false, options: [{id: "mild", label: "Mild", priceAdjust: 0},{id: "med", label: "Medium", priceAdjust: 0},{id: "hot", label: "Hot 🌶️", priceAdjust: 0}]}]},
  { id: "p-s3", categoryId: "starters", name: "Samosa (2 pcs)", price: 4.50, emoji: "🥟", color: "#fef3c7", trackStock: false, active: true, cost: 1.00 },
  { id: "p-s4", categoryId: "starters", name: "Chicken Tikka", price: 8.50, emoji: "🍗", color: "#fecdd3", trackStock: false, active: true, popular: true, cost: 2.80,
    modifiers: [{id: "m-spice2", name: "Spice Level", required: false, multiSelect: false, options: [{id: "mild", label: "Mild", priceAdjust: 0},{id: "med", label: "Medium", priceAdjust: 0},{id: "hot", label: "Hot 🌶️", priceAdjust: 0}]}]},
  { id: "p-s5", categoryId: "starters", name: "Veg Spring Rolls", price: 5.25, emoji: "🥚", color: "#d1fae5", trackStock: false, active: true, cost: 1.20 },
  // Mains
  { id: "p-m1", categoryId: "mains", name: "Chicken Tikka Masala", price: 12.95, emoji: "🍛", color: "#fed7aa", trackStock: false, active: true, popular: true, cost: 3.50,
    modifiers: [{id: "m-spice3", name: "Spice Level", required: false, multiSelect: false, options: [{id: "mild", label: "Mild", priceAdjust: 0},{id: "med", label: "Medium", priceAdjust: 0},{id: "hot", label: "Hot 🌶️", priceAdjust: 0}]}]},
  { id: "p-m2", categoryId: "mains", name: "Lamb Rogan Josh", price: 13.95, emoji: "🍖", color: "#fecaca", trackStock: false, active: true, popular: true, cost: 4.20,
    modifiers: [{id: "m-spice4", name: "Spice Level", required: false, multiSelect: false, options: [{id: "mild", label: "Mild", priceAdjust: 0},{id: "med", label: "Medium", priceAdjust: 0},{id: "hot", label: "Hot 🌶️", priceAdjust: 0}]}]},
  { id: "p-m3", categoryId: "mains", name: "Butter Chicken", price: 12.50, emoji: "🍛", color: "#fef3c7", trackStock: false, active: true, cost: 3.20 },
  { id: "p-m4", categoryId: "mains", name: "Paneer Tikka Masala", price: 11.95, emoji: "🧀", color: "#ede9fe", trackStock: false, active: true, popular: true, cost: 2.80 },
  { id: "p-m5", categoryId: "mains", name: "Chana Masala", price: 10.50, emoji: "🫘", color: "#d1fae5", trackStock: false, active: true, cost: 2.00 },
  { id: "p-m6", categoryId: "mains", name: "Dal Makhani", price: 10.95, emoji: "🫙", color: "#dbeafe", trackStock: false, active: true, cost: 1.80 },
  { id: "p-m7", categoryId: "mains", name: "King Prawn Balti", price: 15.95, emoji: "🦐", color: "#fce7f3", trackStock: false, active: true, popular: true, cost: 5.50 },
  // Breads & Rice
  { id: "p-b1", categoryId: "breads", name: "Plain Naan", price: 2.75, emoji: "🫓", color: "#fef3c7", trackStock: false, active: true, cost: 0.40 },
  { id: "p-b2", categoryId: "breads", name: "Garlic Butter Naan", price: 3.25, emoji: "🧄", color: "#fef3c7", trackStock: false, active: true, popular: true, cost: 0.50 },
  { id: "p-b3", categoryId: "breads", name: "Peshwari Naan", price: 3.50, emoji: "🥥", color: "#fef3c7", trackStock: false, active: true, cost: 0.60 },
  { id: "p-b4", categoryId: "breads", name: "Basmati Rice", price: 3.00, emoji: "🍚", color: "#f0fdf4", trackStock: false, active: true, cost: 0.50 },
  { id: "p-b5", categoryId: "breads", name: "Pilau Rice", price: 3.50, emoji: "🍚", color: "#fef3c7", trackStock: false, active: true, cost: 0.60 },
  // Seafood
  { id: "p-sf1", categoryId: "seafood", name: "King Prawn Curry", price: 14.95, emoji: "🦐", color: "#cffafe", trackStock: false, active: true, cost: 5.00 },
  { id: "p-sf2", categoryId: "seafood", name: "Fish Tikka", price: 12.95, emoji: "🐟", color: "#e0f2fe", trackStock: false, active: true, cost: 3.80 },
  // Sides
  { id: "p-si1", categoryId: "sides", name: "Raita", price: 2.50, emoji: "🥛", color: "#ecfdf5", trackStock: false, active: true, cost: 0.50 },
  { id: "p-si2", categoryId: "sides", name: "Mint Chutney", price: 1.50, emoji: "🌿", color: "#d1fae5", trackStock: false, active: true, cost: 0.30 },
  { id: "p-si3", categoryId: "sides", name: "Poppadoms (4 pcs)", price: 3.00, emoji: "🥙", color: "#fef3c7", trackStock: false, active: true, popular: true, cost: 0.60 },
  { id: "p-si4", categoryId: "sides", name: "Mixed Pickle", price: 1.75, emoji: "🫙", color: "#fef9c3", trackStock: false, active: true, cost: 0.40 },
  // Desserts
  { id: "p-d1", categoryId: "desserts", name: "Gulab Jamun", price: 4.50, emoji: "🍡", color: "#fce7f3", trackStock: false, active: true, cost: 1.00 },
  { id: "p-d2", categoryId: "desserts", name: "Mango Kulfi", price: 4.95, emoji: "🍦", color: "#fef3c7", trackStock: false, active: true, popular: true, cost: 1.20 },
  { id: "p-d3", categoryId: "desserts", name: "Kheer", price: 4.25, emoji: "🍮", color: "#f5f3ff", trackStock: false, active: true, cost: 0.90 },
  // Drinks
  { id: "p-dr1", categoryId: "drinks", name: "Mango Lassi", price: 3.95, emoji: "🥭", color: "#fef3c7", trackStock: false, active: true, popular: true, cost: 0.70 },
  { id: "p-dr2", categoryId: "drinks", name: "Coca-Cola 330ml", price: 2.50, emoji: "🥤", color: "#fecaca", trackStock: true, stockQty: 24, active: true, cost: 0.60 },
  { id: "p-dr3", categoryId: "drinks", name: "Still Water", price: 1.50, emoji: "💧", color: "#dbeafe", trackStock: true, stockQty: 30, active: true, cost: 0.20 },
  { id: "p-dr4", categoryId: "drinks", name: "Sparkling Water", price: 1.75, emoji: "💦", color: "#e0f2fe", trackStock: true, stockQty: 20, active: true, cost: 0.25 },
  { id: "p-dr5", categoryId: "drinks", name: "Chai Tea", price: 2.75, emoji: "☕", color: "#fef3c7", trackStock: false, active: true, cost: 0.40 },
];

const SEED_SETTINGS: POSSettings = {
  businessName: "",
  taxRate: 20,
  taxInclusive: true,
  defaultTipOptions: [10, 15, 20, 25],
  receiptFooter: "Thank you for dining with us!",
  currencySymbol: "£",
  tableModeEnabled: false,
  tableCount: 10,
  loyaltyPointsPerPound: 1,
  loyaltyPointsValue: 0.01,
  giftCardEnabled: true,
  maxDiscountPercent: 100,
  requirePinForDiscount: false,
  location: "Main Branch",
  // Receipt branding — empty by default; POS page reads from AppContext.settings.restaurant
  receiptRestaurantName: "",
  receiptPhone: "",
  receiptWebsite: "",
  receiptEmail: "",
  receiptVatNumber: "",
  receiptShowLogo: false,
  receiptLogoUrl: "",
  receiptThankYouMessage: "Thank you for dining with us!",
  receiptCustomMessage: "",
  smtpFromName: "",
};

const SEED_CUSTOMERS: POSCustomer[] = [
  { id: "pc-1", name: "Arjun Sharma", email: "arjun@example.com", phone: "07700 900123",
    loyaltyPoints: 245, giftCardBalance: 0, totalSpend: 245.00, visitCount: 18,
    lastVisit: "2024-04-13T10:00:00.000Z",
    tags: ["VIP", "Regular"], notes: "Prefers mild dishes", createdAt: "2024-01-15T00:00:00.000Z" },
  { id: "pc-2", name: "Emma Wilson", email: "emma@example.com", phone: "07700 900456",
    loyaltyPoints: 80, giftCardBalance: 20.00, totalSpend: 80.00, visitCount: 6,
    lastVisit: "2024-04-09T14:00:00.000Z",
    tags: ["Regular"], notes: "", createdAt: "2024-02-10T00:00:00.000Z" },
  { id: "pc-3", name: "Mohammed Khan", email: "mo@example.com", phone: "07700 900789",
    loyaltyPoints: 512, giftCardBalance: 0, totalSpend: 512.00, visitCount: 34,
    lastVisit: "2024-04-15T19:00:00.000Z",
    tags: ["VIP", "Regular", "Halal"], notes: "Always orders Lamb Rogan Josh", createdAt: "2023-12-01T00:00:00.000Z" },
];

// ─── Context ─────────────────────────────────────────────────────────────────

interface POSContextValue {
  // Auth
  currentStaff: POSStaff | null;
  login: (staffId: string, pin: string) => Promise<boolean>;
  logout: () => void;
  // Data
  staff: POSStaff[];
  addPosStaff:    (input: { name: string; email?: string; role: "admin" | "manager" | "cashier"; pin: string; hourlyRate?: number; avatarColor?: string }) => Promise<{ ok: boolean; error?: string }>;
  updatePosStaff: (id: string, patch: { name?: string; email?: string; role?: "admin" | "manager" | "cashier"; pin?: string; active?: boolean; hourlyRate?: number; avatarColor?: string }) => Promise<{ ok: boolean; error?: string }>;
  deletePosStaff: (id: string) => Promise<{ ok: boolean; error?: string }>;
  refreshPosStaff: () => Promise<void>;
  products: POSProduct[];
  setProducts: React.Dispatch<React.SetStateAction<POSProduct[]>>;
  categories: POSCategory[];
  setCategories: React.Dispatch<React.SetStateAction<POSCategory[]>>;
  sales: POSSale[];
  setSales: React.Dispatch<React.SetStateAction<POSSale[]>>;
  customers: POSCustomer[];
  setCustomers: React.Dispatch<React.SetStateAction<POSCustomer[]>>;
  clockEntries: POSClockEntry[];
  setClockEntries: React.Dispatch<React.SetStateAction<POSClockEntry[]>>;
  settings: POSSettings;
  setSettings: React.Dispatch<React.SetStateAction<POSSettings>>;
  // Cart
  cart: POSCartItem[];
  addToCart: (product: POSProduct, modifiers: POSCartModifier[]) => void;
  updateCartQty: (lineId: string, qty: number) => void;
  removeFromCart: (lineId: string) => void;
  clearCart: () => void;
  updateCartNote: (lineId: string, note: string) => void;
  // Order state
  discount: { pct: number; note: string };
  setDiscount: React.Dispatch<React.SetStateAction<{ pct: number; note: string }>>;
  tipAmount: number;
  setTipAmount: React.Dispatch<React.SetStateAction<number>>;
  assignedCustomer: POSCustomer | null;
  setAssignedCustomer: React.Dispatch<React.SetStateAction<POSCustomer | null>>;
  // Computed totals
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  // Actions
  completeSale: (
    paymentMethod: "cash" | "card" | "split",
    payments: { method: "cash" | "card"; amount: number }[],
    cashTendered?: number
  ) => POSSale;
  voidSale: (saleId: string, reason: string, refundMethod?: "cash" | "card" | "none", refundAmount?: number) => void;
  clockIn: (staffId: string) => void;
  clockOut: (staffId: string) => void;
  isClocked: (staffId: string) => boolean;
  receiptCounter: number;
  // Storage management
  salesRetentionDays: number;
  exportSales: () => void;
  purgeOldSales: () => void;
}

const POSContext = createContext<POSContextValue | null>(null);

export function usePOS() {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error("usePOS must be used inside POSProvider");
  return ctx;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

// Sales older than this are excluded from localStorage to prevent quota exhaustion.
// Full history remains available in memory for the duration of the session.
const SALES_RETENTION_DAYS = 90;

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      console.warn(
        `[POS] localStorage quota exceeded writing "${key}". ` +
        "Consider exporting and purging old sales data from POS Settings → Storage.",
      );
    }
  }
}

// ─── Supabase menu sync helpers ───────────────────────────────────────────────

function syncMenuToSupabase(products: POSProduct[], categories: POSCategory[]) {
  // Map POSCategory → categories row
  const catRows = categories.map((c, i) => ({
    id: c.id, name: c.name, emoji: c.emoji, sort_order: c.order ?? i,
  }));

  // Map POSProduct → menu_items row
  const productRows = products
    .filter((p) => p.active)
    .map((p) => {
      // online MenuItem.variations[].options[].price is a delta added on top of
      // the item's base price. POS internally also uses priceAdjust (delta), so
      // this is a 1:1 passthrough.
      const variations = (p.modifiers ?? [])
        .filter((m) => !m.multiSelect)
        .map((m) => ({
          id: m.id, name: m.name,
          options: m.options.map((o) => ({
            id: o.id, label: o.label,
            price: parseFloat(o.priceAdjust.toFixed(2)),
          })),
        }));

      const addOns: { id: string; name: string; price: number }[] = [];
      for (const m of (p.modifiers ?? []).filter((m) => m.multiSelect)) {
        for (const o of m.options) {
          addOns.push({ id: o.id, name: o.label, price: Math.max(0, o.priceAdjust) });
        }
      }

      // POS doesn't manage meal-period assignments — those live in a separate
      // menu_item_meal_periods join table managed exclusively by the admin
      // Menu Management panel. POS upserts to menu_items don't touch the
      // join table, so existing tags are preserved across POS edits.
      return {
        id:          p.id,
        category_id: p.categoryId,
        name:        p.name,
        description: p.description ?? "",
        price:       p.price,
        image:       p.imageUrl ?? null,
        dietary:     [],
        popular:     p.popular ?? false,
        variations:  variations.length > 0 ? variations : null,
        add_ons:     addOns.length > 0 ? addOns : null,
        stock_qty:   p.trackStock ? (p.stockQty ?? null) : null,
      };
    });

  fetch("/api/pos/menu", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ categories: catRows, products: productRows }),
  }).catch(() => {});
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function POSProvider({ children }: { children: React.ReactNode }) {
  // currentStaff starts null on every mount; the httpOnly pos_staff_session
  // cookie is the source of truth. A useEffect below calls GET /api/pos/auth
  // to hydrate this from the server. localStorage is no longer trusted for
  // identity — only for non-auth UI state caches.
  const [currentStaff, setCurrentStaff] = useState<POSStaff | null>(null);
  const [staff, setStaff] = useState<POSStaff[]>([]);
  const [products, setProducts] = useState<POSProduct[]>(() =>
    load<POSProduct[]>("pos_products", SEED_PRODUCTS)
  );
  const [categories, setCategories] = useState<POSCategory[]>(() =>
    load<POSCategory[]>("pos_categories", SEED_CATEGORIES)
  );
  const [sales, setSales] = useState<POSSale[]>(() =>
    load<POSSale[]>("pos_sales", [])
  );
  const [customers, setCustomers] = useState<POSCustomer[]>(() =>
    load<POSCustomer[]>("pos_customers", SEED_CUSTOMERS)
  );
  const [clockEntries, setClockEntries] = useState<POSClockEntry[]>(() =>
    load<POSClockEntry[]>("pos_clock", [])
  );
  const [settings, setSettings] = useState<POSSettings>(() => {
    // Merge stored data with SEED_SETTINGS so any field added after the user's
    // last save is present with its default value, avoiding `undefined` in inputs.
    const stored = load<Partial<POSSettings>>("pos_settings", {});
    return { ...SEED_SETTINGS, ...stored };
  });
  const [cart, setCart] = useState<POSCartItem[]>([]);
  const [discount, setDiscount] = useState({ pct: 0, note: "" });
  const [tipAmount, setTipAmount] = useState(0);
  const [assignedCustomer, setAssignedCustomer] = useState<POSCustomer | null>(null);
  const receiptCounter = useRef(load<number>("pos_receipt_counter", 1000));

  // ── Staff — DB-backed (pos_staff table) ──────────────────────────────────
  // The browser never holds a real PIN; the API strips pin_hash on every
  // response. Mutations call the REST endpoints directly and re-fetch.
  const refreshPosStaff = useCallback(async () => {
    try {
      const res = await fetch("/api/pos/staff");
      if (!res.ok) return;
      const json = await res.json() as { ok: boolean; staff?: POSStaff[] };
      if (json.ok && Array.isArray(json.staff)) setStaff(json.staff);
    } catch { /* network — leave staff state untouched */ }
  }, []);

  useEffect(() => { refreshPosStaff(); }, [refreshPosStaff]);

  const addPosStaff = useCallback(async (input: {
    name: string; email?: string; role: "admin" | "manager" | "cashier";
    pin: string; hourlyRate?: number; avatarColor?: string;
  }) => {
    const res = await fetch("/api/pos/staff", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? "Failed to add staff" };
    await refreshPosStaff();
    return { ok: true };
  }, [refreshPosStaff]);

  const updatePosStaff = useCallback(async (id: string, patch: {
    name?: string; email?: string; role?: "admin" | "manager" | "cashier";
    pin?: string; active?: boolean; hourlyRate?: number; avatarColor?: string;
  }) => {
    const res = await fetch(`/api/pos/staff/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(patch),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? "Failed to update staff" };
    await refreshPosStaff();
    return { ok: true };
  }, [refreshPosStaff]);

  const deletePosStaff = useCallback(async (id: string) => {
    const res = await fetch(`/api/pos/staff/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? "Failed to delete staff" };
    await refreshPosStaff();
    return { ok: true };
  }, [refreshPosStaff]);

  // Mirror the admin-configured currency symbol into POSSettings so existing
  // POS components (which read settings.currencySymbol) stay correct without
  // each one needing to switch to AppContext directly.
  const { settings: appSettings } = useApp();
  useEffect(() => {
    const adminSym = appSettings.currency?.symbol;
    if (adminSym && adminSym !== settings.currencySymbol) {
      setSettings((p) => ({ ...p, currencySymbol: adminSym }));
    }
  }, [appSettings.currency?.symbol, settings.currencySymbol]);

  useEffect(() => { save("pos_products", products); }, [products]);
  useEffect(() => { save("pos_categories", categories); }, [categories]);
  useEffect(() => {
    // Only persist sales within the retention window to prevent localStorage quota exhaustion.
    // Sales older than SALES_RETENTION_DAYS days remain available in memory for this session
    // but are not written to disk. Use exportSales() to download a full archive before they age out.
    const cutoff = Date.now() - SALES_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    save("pos_sales", sales.filter((s) => new Date(s.date).getTime() >= cutoff));
  }, [sales]);
  useEffect(() => { save("pos_customers", customers); }, [customers]);
  useEffect(() => { save("pos_clock", clockEntries); }, [clockEntries]);
  useEffect(() => { save("pos_settings", settings); }, [settings]);

  // ── Supabase menu sync ────────────────────────────────────────────────────
  // On mount: load categories + products from Supabase (the shared source of truth).
  // If Supabase is empty we seed it from the current localStorage/seed data so the
  // waiter app immediately has a menu to show.
  useEffect(() => {
    fetch("/api/pos/menu")
      .then((r) => { if (!r.ok) throw new Error(`/api/pos/menu ${r.status}`); return r.json(); })
      .then((d: { ok: boolean; categories: Record<string,unknown>[]; items: Record<string,unknown>[] }) => {
        if (!d.ok) return;

        if (d.categories.length > 0) {
          setCategories((prev) =>
            d.categories.map((row, i) => {
              const existing = prev.find((c) => c.id === row.id);
              return {
                id:    row.id    as string,
                name:  row.name  as string,
                emoji: (row.emoji as string) ?? "🍽️",
                color: existing?.color ?? "#f97316",
                order: (row.sort_order as number) ?? i,
              } satisfies POSCategory;
            })
          );
        }

        if (d.items.length > 0) {
          setProducts((prev) =>
            d.items.map((row) => {
              const existing = prev.find((p) => p.id === row.id);
              const basePrice = Number(row.price);

              // Rebuild POS modifiers from online variations + add_ons.
              // variations[].options[].price is stored as a delta on top of the
              // item's base price, matching POS's internal priceAdjust model.
              const modifiers: POSModifier[] = [];
              for (const v of (row.variations as {id:string;name:string;options:{id:string;label:string;price:number}[]}[] ?? [])) {
                modifiers.push({
                  id: v.id, name: v.name, required: false, multiSelect: false,
                  options: v.options.map((o) => ({
                    id: o.id, label: o.label,
                    priceAdjust: parseFloat(Number(o.price).toFixed(2)),
                  })),
                });
              }
              const addOns = (row.add_ons as {id:string;name:string;price:number}[] ?? []);
              if (addOns.length > 0) {
                modifiers.push({
                  id: "add-ons", name: "Add-ons", required: false, multiSelect: true,
                  options: addOns.map((a) => ({ id: a.id, label: a.name, priceAdjust: a.price })),
                });
              }

              return {
                id:          row.id as string,
                categoryId:  row.category_id as string,
                name:        row.name as string,
                description: (row.description as string) || undefined,
                price:       basePrice,
                imageUrl:    (row.image as string) || undefined,
                emoji:       existing?.emoji  ?? "🍽️",
                color:       existing?.color  ?? "#fed7aa",
                popular:     (row.popular as boolean) ?? false,
                modifiers:   modifiers.length > 0 ? modifiers : undefined,
                trackStock:  row.stock_qty !== null && row.stock_qty !== undefined,
                stockQty:    row.stock_qty !== null ? Number(row.stock_qty) : undefined,
                active:      true,
                cost:        existing?.cost ?? 0,
              } satisfies POSProduct;
            })
          );
        } else {
          // Supabase is empty — seed it with the current POS data so the waiter has a menu
          syncMenuToSupabase(
            load<POSProduct[]>("pos_products", SEED_PRODUCTS),
            load<POSCategory[]>("pos_categories", SEED_CATEGORIES),
          );
        }
      })
      .catch(() => { /* network error — POS keeps working from localStorage */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced push: whenever the POS menu changes, sync to Supabase so the
  // waiter app (via AppContext Realtime) sees the update immediately.
  const menuSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuSyncReady = useRef(false); // skip first render (already loaded above)
  useEffect(() => {
    if (!menuSyncReady.current) { menuSyncReady.current = true; return; }
    if (menuSyncTimer.current) clearTimeout(menuSyncTimer.current);
    menuSyncTimer.current = setTimeout(() => syncMenuToSupabase(products, categories), 1500);
    return () => { if (menuSyncTimer.current) clearTimeout(menuSyncTimer.current); };
  }, [products, categories]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  // Server-authoritative login: the PIN is validated by /api/pos/auth, which
  // sets the httpOnly pos_staff_session cookie and returns the staff record.
  // The browser never compares PINs — and never sees other staff's PINs.
  const login = useCallback(async (staffId: string, pin: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/pos/auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ staffId, pin }),
      });
      if (!res.ok) return false;
      const json = await res.json() as { ok: boolean; staff?: POSStaff };
      if (!json.ok || !json.staff) return false;
      setCurrentStaff(json.staff);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Session hydration on mount ────────────────────────────────────────────
  // Read the server session (httpOnly cookie) and populate currentStaff. Any
  // stale pos_session key from an older client build is cleared so it can't
  // be reused as an identity claim.
  useEffect(() => {
    if (typeof window !== "undefined") {
      try { localStorage.removeItem("pos_session"); } catch { /* ignore */ }
    }
    fetch("/api/pos/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { ok: boolean; staff?: POSStaff } | null) => {
        if (json?.ok && json.staff) setCurrentStaff(json.staff);
      })
      .catch(() => { /* network — fall through to login screen */ });
  }, []);

  const logout = useCallback(() => {
    setCurrentStaff(null);
    setCart([]);
    setDiscount({ pct: 0, note: "" });
    setTipAmount(0);
    setAssignedCustomer(null);
    // Clear the server-side session cookie.
    fetch("/api/pos/auth", { method: "DELETE" }).catch(() => {});
  }, []);

  // ── Idle-timeout auto-logout ──────────────────────────────────────────────
  // Log the staff member out after 30 minutes of inactivity so unattended
  // POS terminals cannot be accessed without re-authenticating.
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!currentStaff) return;
    const reset = () => { lastActivity.current = Date.now(); };
    window.addEventListener("click",      reset, { passive: true });
    window.addEventListener("keydown",    reset, { passive: true });
    window.addEventListener("touchstart", reset, { passive: true });
    return () => {
      window.removeEventListener("click",      reset);
      window.removeEventListener("keydown",    reset);
      window.removeEventListener("touchstart", reset);
    };
  }, [currentStaff]);

  useEffect(() => {
    if (!currentStaff) return;
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_TIMEOUT_MS) logout();
    }, 60_000);
    return () => clearInterval(id);
  }, [currentStaff, logout]);

  // ── Cart ─────────────────────────────────────────────────────────────────
  const addToCart = useCallback((product: POSProduct, modifiers: POSCartModifier[]) => {
    const modPrice = modifiers.reduce((sum, m) => sum + m.priceAdjust, 0);
    const offerPrice = getOfferPrice(product); // null for cart-level offer types
    const basePrice = offerPrice ?? product.price;
    const unitPrice = basePrice + modPrice;
    // Snapshot offer for cart-level quantity-based types (bogo, multibuy, qty_discount)
    const cartOffer = product.offer?.active ? product.offer : undefined;
    setCart((prev) => {
      // Merge with existing identical line (same product + same modifiers, no custom note)
      const modKey = JSON.stringify(modifiers);
      const existing = prev.find(
        (l) => l.productId === product.id && JSON.stringify(l.modifiers) === modKey
      );
      if (existing && !existing.note) {
        return prev.map((l) =>
          l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, {
        lineId: uuid(),
        productId: product.id,
        name: product.name,
        basePrice: product.price,
        price: unitPrice,
        quantity: 1,
        modifiers,
        offer: cartOffer,
      }];
    });
  }, []);

  const updateCartQty = useCallback((lineId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.lineId !== lineId));
    } else {
      setCart((prev) => prev.map((l) => l.lineId === lineId ? { ...l, quantity: qty } : l));
    }
  }, []);

  const removeFromCart = useCallback((lineId: string) => {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setDiscount({ pct: 0, note: "" });
    setTipAmount(0);
    setAssignedCustomer(null);
  }, []);

  const updateCartNote = useCallback((lineId: string, note: string) => {
    setCart((prev) => prev.map((l) => l.lineId === lineId ? { ...l, note } : l));
  }, []);

  // ── Computed totals ───────────────────────────────────────────────────────
  const subtotal = cart.reduce((sum, l) => sum + cartLineTotal(l), 0);
  const discountAmount = subtotal * (discount.pct / 100);
  const afterDiscount = subtotal - discountAmount;

  let taxAmount = 0;
  if (settings.taxInclusive) {
    // VAT is already included — extract it
    taxAmount = afterDiscount - afterDiscount / (1 + settings.taxRate / 100);
  } else {
    taxAmount = afterDiscount * (settings.taxRate / 100);
  }
  const grandTotal = settings.taxInclusive
    ? afterDiscount + tipAmount
    : afterDiscount + taxAmount + tipAmount;

  // ── Complete sale ─────────────────────────────────────────────────────────
  const completeSale = useCallback((
    paymentMethod: "cash" | "card" | "split",
    payments: { method: "cash" | "card"; amount: number }[],
    cashTendered?: number
  ): POSSale => {
    receiptCounter.current += 1;
    save("pos_receipt_counter", receiptCounter.current);

    const sub = cart.reduce((s, l) => s + cartLineTotal(l), 0);
    const disc = sub * (discount.pct / 100);
    const after = sub - disc;
    const tax = settings.taxInclusive
      ? after - after / (1 + settings.taxRate / 100)
      : after * (settings.taxRate / 100);
    const total = settings.taxInclusive
      ? after + tipAmount
      : after + tax + tipAmount;

    const cashPayment = payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0);
    const change = cashTendered !== undefined ? cashTendered - cashPayment : undefined;

    const sale: POSSale = {
      id: uuid(),
      receiptNo: `R${receiptCounter.current}`,
      items: [...cart],
      subtotal: sub,
      discountAmount: disc,
      discountNote: discount.note,
      taxAmount: tax,
      // Snapshot the VAT mode at time of sale so receipts always show the correct label,
      // even if the settings change later.
      taxRate: settings.taxRate,
      taxInclusive: settings.taxInclusive,
      tipAmount,
      total,
      paymentMethod,
      payments,
      cashTendered,
      changeGiven: change,
      staffId: currentStaff?.id ?? "",
      staffName: currentStaff?.name ?? "",
      customerId: assignedCustomer?.id,
      customerName: assignedCustomer?.name,
      date: new Date().toISOString(),
      voided: false,
    };

    setSales((prev) => [sale, ...prev]);

    // Route the sale to the Kitchen Display System via the orders table.
    // Fire-and-forget — a network failure must never block the POS workflow.
    // On failure the sale is placed in the outbox and retried when connectivity restores.
    fetch("/api/pos/orders", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(sale),
    }).then(async (r) => {
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        console.error("POS→KDS sync failed:", r.status, j.error ?? "(no details)");
        outboxEnqueue(sale);
      }
    }).catch((err) => {
      console.error("POS→KDS sync network error:", err);
      outboxEnqueue(sale);
    });

    // Update customer loyalty points
    if (assignedCustomer) {
      const pts = Math.floor(total * settings.loyaltyPointsPerPound);
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === assignedCustomer.id
            ? {
                ...c,
                loyaltyPoints: c.loyaltyPoints + pts,
                totalSpend: c.totalSpend + total,
                visitCount: c.visitCount + 1,
                lastVisit: new Date().toISOString(),
              }
            : c
        )
      );
    }

    // Deduct stock
    setProducts((prev) =>
      prev.map((p) => {
        const cartLine = cart.find((l) => l.productId === p.id);
        if (!cartLine || !p.trackStock || p.stockQty === undefined) return p;
        return { ...p, stockQty: Math.max(0, (p.stockQty ?? 0) - cartLine.quantity) };
      })
    );

    clearCart();
    return sale;
  }, [cart, discount, tipAmount, settings, currentStaff, assignedCustomer, clearCart]);

  const voidSale = useCallback((
    saleId: string,
    reason: string,
    refundMethod?: "cash" | "card" | "none",
    refundAmount?: number,
  ) => {
    setSales((prev) =>
      prev.map((s) => s.id === saleId
        ? { ...s, voided: true, voidReason: reason, refundMethod, refundAmount }
        : s)
    );
  }, []);

  // ── Clock in/out ──────────────────────────────────────────────────────────
  const clockIn = useCallback((staffId: string) => {
    const member = staff.find((s) => s.id === staffId);
    if (!member) return;
    setClockEntries((prev) => [
      ...prev,
      { id: uuid(), staffId, staffName: member.name, clockIn: new Date().toISOString() },
    ]);
  }, [staff]);

  const clockOut = useCallback((staffId: string) => {
    setClockEntries((prev) => {
      const lastOpen = [...prev].reverse().find((e) => e.staffId === staffId && !e.clockOut);
      if (!lastOpen) return prev;
      const totalMinutes = Math.floor((Date.now() - new Date(lastOpen.clockIn).getTime()) / 60000);
      return prev.map((e) =>
        e.id === lastOpen.id ? { ...e, clockOut: new Date().toISOString(), totalMinutes } : e
      );
    });
  }, []);

  const isClocked = useCallback((staffId: string): boolean => {
    const last = [...clockEntries].reverse().find((e) => e.staffId === staffId);
    return !!last && !last.clockOut;
  }, [clockEntries]);

  // ── Storage management ────────────────────────────────────────────────────

  // Download all in-memory sales as a JSON file so admins can archive data
  // before it ages past SALES_RETENTION_DAYS and drops off localStorage.
  const exportSales = useCallback(() => {
    const blob = new Blob([JSON.stringify(sales, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `pos-sales-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sales]);

  // Drop sales older than SALES_RETENTION_DAYS from both memory and localStorage.
  // Call this to reclaim localStorage space if the quota warning appears.
  const purgeOldSales = useCallback(() => {
    const cutoff = Date.now() - SALES_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    setSales((prev) => prev.filter((s) => new Date(s.date).getTime() >= cutoff));
  }, []);

  return (
    <POSContext.Provider value={{
      currentStaff, login, logout,
      staff, addPosStaff, updatePosStaff, deletePosStaff, refreshPosStaff,
      products, setProducts,
      categories, setCategories,
      sales, setSales,
      customers, setCustomers,
      clockEntries, setClockEntries,
      settings, setSettings,
      cart, addToCart, updateCartQty, removeFromCart, clearCart, updateCartNote,
      discount, setDiscount,
      tipAmount, setTipAmount,
      assignedCustomer, setAssignedCustomer,
      subtotal, discountAmount, taxAmount, grandTotal,
      completeSale, voidSale,
      clockIn, clockOut, isClocked,
      receiptCounter: receiptCounter.current,
      salesRetentionDays: SALES_RETENTION_DAYS,
      exportSales,
      purgeOldSales,
    }}>
      {children}
    </POSContext.Provider>
  );
}
