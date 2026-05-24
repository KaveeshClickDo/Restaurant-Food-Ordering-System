"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
const uuid = () => crypto.randomUUID();
import {
  POSStaff, POSProduct, POSCategory, POSModifier, POSCartItem, POSSale, POSCustomer,
  POSSettings, POSClockEntry, POSCartModifier, getOfferPrice, cartLineTotal, isOfferActive,
} from "@/types/pos";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";

// Module-scope so the value is stable across renders (used by the idle-logout effect).
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Round a money value to 2 decimal places, eliminating IEEE-754 float garbage
 * like 15.000000000000002 or 13.043478260869563. The server's Money zod
 * primitive (lib/schemas/primitives.ts) rejects anything that doesn't round
 * trip through `n * 100 === Math.round(n * 100)`, so every money field in
 * the sale payload MUST go through this before being sent.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Seed data ───────────────────────────────────────────────────────────────

// Staff is loaded from app_settings.data.pos_staff on mount (see useEffect
// in POSProvider). No localStorage cache and no hardcoded seed — the DB is
// the only source of truth, so a fresh terminal renders the correct staff
// list immediately and edits made on one terminal are visible everywhere.

// Intentionally empty. Demo categories/products must come from
// `npm run db:seed-demo` (see app/seed-demo.ts). These constants are kept
// only as typed fallbacks for the `load<…>("pos_categories", SEED_CATEGORIES)`
// pattern below — they must NEVER carry data, otherwise localStorage becomes
// a hidden seeding path that bypasses the migration script.
const SEED_CATEGORIES: POSCategory[] = [];

// Intentionally empty. See note on SEED_CATEGORIES above — seeding is the
// exclusive responsibility of `npm run db:seed-demo`.
const SEED_PRODUCTS: POSProduct[] = [];

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

// Bug #11 — POS customers are no longer cached in localStorage. The
// `customers` table is the single source of truth (shared with admin); the
// initial value is always [] and `fetchCustomers` hydrates from
// /api/pos/customers once the staff session resolves.

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
  /** Dedicated stock writer for POS-admin / manager. Goes through
   *  /api/admin/menu/[id]/stock (which accepts POS canManageMenu too), so
   *  stock writes bypass the debounced bulk sync that strips stock fields. */
  updateProductStock: (
    id: string,
    payload: { mode: "qty"; stockQty: number } | { mode: "manual"; stockStatus: "in_stock" | "low_stock" | "out_of_stock" },
  ) => void;
  categories: POSCategory[];
  setCategories: React.Dispatch<React.SetStateAction<POSCategory[]>>;
  sales: POSSale[];
  customers: POSCustomer[];
  setCustomers: React.Dispatch<React.SetStateAction<POSCustomer[]>>;
  // Bug #11 — POS mutations are now DB-backed via /api/pos/customers. The
  // returned promise resolves with { ok, error? } so the UI can surface
  // server-side validation errors. After a successful mutation the customers
  // state is refreshed so totalSpend/visitCount/lastVisit reflect any
  // server-side recomputation.
  addCustomer: (input: {
    name: string; email?: string; phone?: string; notes?: string;
    tags?: string[]; loyaltyPoints?: number; giftCardBalance?: number;
  }) => Promise<{ ok: boolean; error?: string; customer?: POSCustomer }>;
  updateCustomer: (id: string, patch: {
    name?: string; email?: string; phone?: string; notes?: string;
    tags?: string[]; loyaltyPoints?: number; giftCardBalance?: number;
  }) => Promise<{ ok: boolean; error?: string }>;
  deleteCustomer: (id: string) => Promise<{ ok: boolean; error?: string; activeOrders?: { id: string; status: string }[] }>;
  refreshCustomers: () => Promise<void>;
  clockEntries: POSClockEntry[];
  settings: POSSettings;
  setSettings: React.Dispatch<React.SetStateAction<POSSettings>>;
  // Cart
  cart: POSCartItem[];
  addToCart: (product: POSProduct, modifiers: POSCartModifier[], note?: string) => void;
  updateCartQty: (lineId: string, qty: number) => void;
  removeFromCart: (lineId: string) => void;
  clearCart: () => void;
  updateCartNote: (lineId: string, note: string) => void;
  // Order state
  discount: { pct: number; note: string };
  setDiscount: React.Dispatch<React.SetStateAction<{ pct: number; note: string }>>;
  tipAmount: number;
  setTipAmount: React.Dispatch<React.SetStateAction<number>>;
  kitchenNote: string;
  setKitchenNote: React.Dispatch<React.SetStateAction<string>>;
  assignedCustomer: POSCustomer | null;
  setAssignedCustomer: React.Dispatch<React.SetStateAction<POSCustomer | null>>;
  // Computed totals
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  // Actions
  // completeSale is async — the receipt_no is server-allocated from
  // pos_receipt_seq to prevent duplicate numbers across tills. Returns
  // `{ sale: null, error }` when the sale could not be persisted; callers
  // must surface `error` to the cashier (it carries the server's actual
  // reason — e.g. "'X' is no longer available on the menu") and not print
  // a receipt. A bare network failure leaves `error` undefined.
  completeSale: (
    paymentMethod: "cash" | "card" | "split" | "gift_card",
    payments: { method: "cash" | "card"; amount: number }[],
    cashTendered?: number,
    giftCard?: { code: string; amount: number }
  ) => Promise<{ sale: POSSale | null; error?: string }>;
  // voidSale returns `{ ok, error? }` so callers can surface the server's
  // actual reason (insufficient permission, sale already voided, refund
  // amount exceeds total, etc.) instead of a generic network message.
  voidSale: (saleId: string, reason: string, refundMethod?: "cash" | "card" | "none", refundAmount?: number) => Promise<{ ok: boolean; error?: string }>;
  clockIn: (staffId: string) => Promise<boolean>;
  clockOut: (staffId: string) => Promise<boolean>;
  isClocked: (staffId: string) => boolean;
  // Convenience
  exportSales: () => void;
}

const POSContext = createContext<POSContextValue | null>(null);

export function usePOS() {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error("usePOS must be used inside POSProvider");
  return ctx;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
// Used for the slowly-changing caches (products/categories/customers/settings).
// pos_sales, pos_clock and the receipt counter now live in the DB — see the
// /api/pos/sales and /api/pos/clock routes.

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

  // Map POSProduct → menu_items row. We now also write the parity columns
  // (cost/sku/emoji/color/active/track_stock/offer) so admin sees what POS
  // saved. The variations[] and addOns[] lists are written from the explicit
  // admin-style fields when present; otherwise we fall back to converting
  // legacy POS modifiers (radio groups → variations, multi-select → addOns).
  // NOTE: we no longer drop inactive items — `active` lives in the row now,
  // so admin can see + re-enable them.
  const productRows = products.map((p) => {
      // Prefer explicit admin-style data when set (since both editors now
      // produce these directly). Otherwise convert legacy POS modifiers.
      const variations = (p.variations && p.variations.length > 0)
        ? p.variations
        : (p.modifiers ?? [])
            .filter((m) => !m.multiSelect)
            .map((m) => ({
              id: m.id, name: m.name,
              required: m.required,
              options: m.options.map((o) => ({
                id: o.id, label: o.label,
                price: parseFloat(o.priceAdjust.toFixed(2)),
              })),
            }));

      let addOns: { id: string; name: string; price: number }[];
      if (p.addOns && p.addOns.length > 0) {
        addOns = p.addOns;
      } else {
        addOns = [];
        for (const m of (p.modifiers ?? []).filter((m) => m.multiSelect)) {
          for (const o of m.options) {
            addOns.push({ id: o.id, name: o.label, price: Math.max(0, o.priceAdjust) });
          }
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
        cost:        p.cost ?? null,
        sku:         p.sku ?? null,
        image:       p.imageUrl ?? null,
        emoji:       p.emoji ?? null,
        color:       p.color ?? null,
        dietary:     p.dietary ?? [],
        popular:     p.popular ?? false,
        active:      p.active ?? true,
        // A numeric stockQty is the source of truth for "tracked" — keep the DB
        // flag in lockstep so the atomic decrement actually runs (it skips rows
        // where track_stock = false).
        track_stock: typeof p.stockQty === "number",
        variations:  variations.length > 0 ? variations : null,
        add_ons:     addOns.length > 0 ? addOns : null,
        stock_qty:   typeof p.stockQty === "number" ? p.stockQty : null,
        stock_status: p.stockStatus ?? null,
        offer:       p.offer ?? null,
        // POS only ever ships items as in_store. If admin had the item on
        // both channels we preserve that (channels[] arrives in p via the
        // realtime load); only POS-created items lacking channels get the
        // in_store-only default.
        channels:    p.channels && p.channels.length > 0 ? p.channels : ["in_store"],
        price_online: p.priceOnline ?? null,
      };
    });

  fetch("/api/pos/menu", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ categories: catRows, products: productRows }),
  }).catch(() => {});
}

/**
 * Stable hash of the sync-relevant slice of the menu. Used by the debounced
 * push to detect "nothing actually changed since the last push" and skip a
 * redundant round-trip — important once the realtime subscription echoes
 * server-side mutations back into local state.
 *
 * Stock fields are deliberately excluded — they're not in the sync whitelist
 * either (server is authoritative for stock).
 */
export function menuHash(products: POSProduct[], categories: POSCategory[]): string {
  const p = products
    .map((x) => [x.id, x.categoryId, x.name, x.description ?? "", x.price, x.cost ?? null,
                 x.sku ?? null, x.imageUrl ?? null, x.emoji ?? null, x.color, !!x.popular,
                 !!x.active, x.variations ?? null, x.addOns ?? null, x.dietary ?? null,
                 x.offer ?? null, x.channels ?? null, x.priceOnline ?? null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const c = categories
    .map((x) => [x.id, x.name, x.emoji, x.order])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([p, c]);
}

// ─── Row mappers ─────────────────────────────────────────────────────────────
// Used by both the initial GET load and the realtime subscription so a row
// always lands in local state with the same shape. The `existing` param lets
// us preserve POS-only fields (color, emoji, cost, sku) for rows where the
// DB column is null — matters mostly for legacy items pre-1fd4919.

export function rowToPOSCategory(
  row: Record<string, unknown>,
  fallbackIndex: number,
  existing?: POSCategory,
): POSCategory {
  return {
    id:    row.id    as string,
    name:  row.name  as string,
    emoji: (row.emoji as string) ?? "🍽️",
    color: existing?.color ?? "#f97316",
    order: (row.sort_order as number) ?? fallbackIndex,
  };
}

export function rowToPOSProduct(
  row: Record<string, unknown>,
  existing?: POSProduct,
): POSProduct {
  const rawVariations = (row.variations as {id:string;name:string;required?:boolean;options:{id:string;label:string;price:number}[]}[] ?? []);
  const rawAddOns     = (row.add_ons    as {id:string;name:string;price:number}[] ?? []);

  const modifiers: POSModifier[] = [];
  for (const v of rawVariations) {
    modifiers.push({
      id: v.id, name: v.name,
      required: v.required !== false,
      multiSelect: false,
      options: v.options.map((o) => ({
        id: o.id, label: o.label,
        priceAdjust: parseFloat(Number(o.price).toFixed(2)),
      })),
    });
  }
  if (rawAddOns.length > 0) {
    modifiers.push({
      id: "add-ons", name: "Add-ons", required: false, multiSelect: true,
      options: rawAddOns.map((a) => ({ id: a.id, label: a.name, priceAdjust: a.price })),
    });
  }

  const trackStock = (row.track_stock as boolean | null | undefined)
    ?? (row.stock_qty !== null && row.stock_qty !== undefined);

  const rawChannels = row.channels as ("in_store" | "online")[] | null | undefined;
  return {
    id:          row.id as string,
    categoryId:  row.category_id as string,
    name:        row.name as string,
    description: (row.description as string) || undefined,
    price:       Number(row.price),
    cost:        row.cost !== null && row.cost !== undefined ? Number(row.cost) : (existing?.cost ?? undefined),
    sku:         (row.sku as string) || existing?.sku || undefined,
    imageUrl:    (row.image as string) || undefined,
    emoji:       (row.emoji as string) || existing?.emoji  || "🍽️",
    color:       (row.color as string) || existing?.color  || "#fed7aa",
    dietary:     (row.dietary as string[]) ?? [],
    variations:  rawVariations.length > 0 ? rawVariations : undefined,
    addOns:      rawAddOns.length > 0 ? rawAddOns : undefined,
    popular:     (row.popular as boolean) ?? false,
    modifiers:   modifiers.length > 0 ? modifiers : undefined,
    trackStock,
    stockQty:    row.stock_qty !== null && row.stock_qty !== undefined ? Number(row.stock_qty) : undefined,
    stockStatus: (row.stock_status as POSProduct["stockStatus"]) || undefined,
    active:      row.active === undefined || row.active === null ? true : !!row.active,
    offer:       (row.offer as POSProduct["offer"]) || undefined,
    channels:    Array.isArray(rawChannels) && rawChannels.length > 0 ? rawChannels : ["in_store", "online"],
    priceOnline: row.price_online !== null && row.price_online !== undefined ? Number(row.price_online) : undefined,
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function POSProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
  // sales + clockEntries are DB-backed (pos_sales / pos_clock_entries tables).
  // They start empty and are hydrated from the API once the staff session
  // resolves below.
  const [sales, setSales] = useState<POSSale[]>([]);
  // Bug #11 — initial state is always empty; the customers list is hydrated
  // from /api/pos/customers once the staff session resolves below. No
  // localStorage cache: the DB is the single source of truth so a fresh
  // terminal renders the correct list immediately and edits made on one
  // terminal are visible everywhere.
  const [customers, setCustomers] = useState<POSCustomer[]>([]);
  const [clockEntries, setClockEntries] = useState<POSClockEntry[]>([]);
  const [settings, setSettings] = useState<POSSettings>(() => {
    // Merge stored data with SEED_SETTINGS so any field added after the user's
    // last save is present with its default value, avoiding `undefined` in inputs.
    const stored = load<Partial<POSSettings>>("pos_settings", {});
    return { ...SEED_SETTINGS, ...stored };
  });
  const [cart, setCart] = useState<POSCartItem[]>([]);
  const [discount, setDiscount] = useState({ pct: 0, note: "" });
  const [tipAmount, setTipAmount] = useState(0);
  const [kitchenNote, setKitchenNote] = useState("");
  const [assignedCustomer, setAssignedCustomer] = useState<POSCustomer | null>(null);

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

  // ── Sales — DB-backed (pos_sales table) ──────────────────────────────────
  const fetchSales = useCallback(async () => {
    try {
      const res = await fetch("/api/pos/sales");
      if (!res.ok) return;
      const json = await res.json() as { ok: boolean; sales?: POSSale[] };
      if (json.ok && Array.isArray(json.sales)) setSales(json.sales);
    } catch { /* offline — keep current state */ }
  }, []);

  // ── Clock entries — DB-backed (pos_clock_entries table) ─────────────────
  const fetchClockEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/pos/clock");
      if (!res.ok) return;
      const json = await res.json() as { ok: boolean; entries?: POSClockEntry[] };
      if (json.ok && Array.isArray(json.entries)) setClockEntries(json.entries);
    } catch { /* offline — keep current state */ }
  }, []);

  // ── Customers — DB-backed (customers table, shared with admin). Bug #11.
  // Mutations go through /api/pos/customers; the optimistic state is
  // refreshed after each successful write so totalSpend / visitCount /
  // lastVisit (computed server-side from orders + pos_sales) stay accurate.
  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/pos/customers");
      if (!res.ok) return;
      const json = await res.json() as { ok: boolean; customers?: POSCustomer[] };
      if (json.ok && Array.isArray(json.customers)) setCustomers(json.customers);
    } catch { /* offline — keep current state */ }
  }, []);

  const addCustomer = useCallback(async (input: {
    name: string; email?: string; phone?: string; notes?: string;
    tags?: string[]; loyaltyPoints?: number; giftCardBalance?: number;
  }) => {
    try {
      const res = await fetch("/api/pos/customers", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(input),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; customer?: POSCustomer };
      if (!res.ok || !json.ok) return { ok: false, error: json.error ?? "Failed to add customer" };
      await fetchCustomers();
      return { ok: true, customer: json.customer };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }, [fetchCustomers]);

  const updateCustomer = useCallback(async (id: string, patch: {
    name?: string; email?: string; phone?: string; notes?: string;
    tags?: string[]; loyaltyPoints?: number; giftCardBalance?: number;
  }) => {
    try {
      const res = await fetch(`/api/pos/customers/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) return { ok: false, error: json.error ?? "Failed to update customer" };
      await fetchCustomers();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }, [fetchCustomers]);

  const deleteCustomer = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/pos/customers/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        activeOrders?: { id: string; status: string }[];
      };
      if (!res.ok || !json.ok) {
        return {
          ok: false,
          error: json.error ?? "Failed to delete customer",
          activeOrders: json.activeOrders,
        };
      }
      // Clear local optimistically; refetch will reconcile.
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      await fetchCustomers();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }, [fetchCustomers]);

  // Hydrate from the API once the staff session resolves. All three
  // endpoints require a valid pos_staff_session cookie, so calling them
  // before login would just 401 — gating on currentStaff avoids that noise.
  useEffect(() => {
    if (!currentStaff) return;
    fetchSales();
    fetchClockEntries();
    fetchCustomers();
  }, [currentStaff, fetchSales, fetchClockEntries, fetchCustomers]);

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

  // Mirror the admin VAT config into POSSettings. Without this the POS used its
  // seed defaults (20% inclusive) regardless of what admin configured — so an
  // exclusive-VAT restaurant never saw VAT added on top of the POS total.
  // When VAT is disabled admin-side, the POS rate is 0 (no tax line).
  const adminTax = appSettings.taxSettings;
  const adminTaxRate      = adminTax?.enabled ? (adminTax.rate ?? 0) : 0;
  const adminTaxInclusive = adminTax?.inclusive ?? true;
  useEffect(() => {
    setSettings((p) =>
      p.taxRate === adminTaxRate && p.taxInclusive === adminTaxInclusive
        ? p
        : { ...p, taxRate: adminTaxRate, taxInclusive: adminTaxInclusive },
    );
  }, [adminTaxRate, adminTaxInclusive]);

  useEffect(() => { save("pos_products", products); }, [products]);
  useEffect(() => { save("pos_categories", categories); }, [categories]);
  // Bug #11 — pos_customers is no longer persisted to localStorage. The
  // customers list lives in the customers table and is re-fetched from
  // /api/pos/customers on every staff login.
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
            d.categories.map((row, i) =>
              rowToPOSCategory(row, i, prev.find((c) => c.id === row.id)),
            ),
          );
        }

        if (d.items.length > 0) {
          setProducts((prev) =>
            d.items.map((row) =>
              rowToPOSProduct(row, prev.find((p) => p.id === row.id)),
            ),
          );
        }
        // If the menu is empty here, do NOT auto-seed. Seeding is the
        // exclusive responsibility of `npm run db:seed-demo` (see
        // app/seed-demo.ts). Auto-seeding from the client used to mask
        // misconfigured installs and re-populated demo data into real
        // tenants after admins had deleted it.
      })
      .catch(() => { /* network error — POS keeps working from localStorage */ });
   
  }, []);

  // Debounced push: whenever the POS menu changes, sync to Supabase so the
  // waiter app (via AppContext Realtime) sees the update immediately.
  //
  // lastSyncedHash guards against a feedback loop with the realtime
  // subscription below — when an UPDATE we just pushed (or a foreign change
  // that we then re-pushed) echoes back, the local state ends up identical
  // to what we last sent, so we skip a redundant POST instead of looping.
  const menuSyncTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuSyncReady  = useRef(false); // skip first render (already loaded above)
  const lastSyncedHash = useRef<string>("");
  useEffect(() => {
    const hash = menuHash(products, categories);
    if (!menuSyncReady.current) {
      menuSyncReady.current = true;
      lastSyncedHash.current = hash;
      return;
    }
    if (hash === lastSyncedHash.current) return; // nothing actually changed
    if (menuSyncTimer.current) clearTimeout(menuSyncTimer.current);
    menuSyncTimer.current = setTimeout(() => {
      syncMenuToSupabase(products, categories);
      lastSyncedHash.current = hash;
    }, 1500);
    return () => { if (menuSyncTimer.current) clearTimeout(menuSyncTimer.current); };
  }, [products, categories]);

  // ── Realtime: menu_items + categories ────────────────────────────────────
  // Without this, POS only sees menu changes on next page-load. Stock
  // decrements from /api/orders, /api/pos/sales, /api/waiter/orders all
  // mutate menu_items server-side; admin edits via /api/admin/menu do the
  // same. Subscribing here keeps the SaleView grid's stock counts and
  // active-flag state in sync with what the kitchen and customer see.
  useEffect(() => {
    const channel = supabase
      .channel("pos-menu-realtime")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "menu_items" },
        (payload) => {
          const newRow = payload.new as Record<string, unknown> | null;
          const oldRow = payload.old as Record<string, unknown> | null;
          const id = String(newRow?.id ?? oldRow?.id ?? "");
          if (!id) return;

          if (payload.eventType === "DELETE") {
            setProducts((prev) => prev.filter((p) => p.id !== id));
            return;
          }
          if (!newRow) return;
          setProducts((prev) => {
            const existing = prev.find((p) => p.id === id);
            const mapped = rowToPOSProduct(newRow, existing);
            if (existing) {
              return prev.map((p) => (p.id === id ? mapped : p));
            }
            return [...prev, mapped];
          });
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        (payload) => {
          const newRow = payload.new as Record<string, unknown> | null;
          const oldRow = payload.old as Record<string, unknown> | null;
          const id = String(newRow?.id ?? oldRow?.id ?? "");
          if (!id) return;

          if (payload.eventType === "DELETE") {
            setCategories((prev) => prev.filter((c) => c.id !== id));
            return;
          }
          if (!newRow) return;
          setCategories((prev) => {
            const existing = prev.find((c) => c.id === id);
            const mapped = rowToPOSCategory(newRow, prev.length, existing);
            if (existing) {
              return prev.map((c) => (c.id === id ? mapped : c));
            }
            return [...prev, mapped];
          });
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

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
  }, []);

  // Periodic self-check via /api/pos/auth — uses the kitchen-only session
  // (getPosSession in lib/auth, which validates session_version + active
  // against the DB). On 401 we log out + send the terminal back to the PIN
  // picker, so an admin PIN/email/active change kicks the cashier within
  // ~15 s. On success we refresh currentStaff so profile edits (name,
  // avatar, permissions) appear live without a sign-out.
  useEffect(() => {
    let active = true;

    async function checkSession() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/pos/auth", { cache: "no-store" });
        if (!active) return;
        if (r.status === 401) {
          // Stale or version-mismatched session — clear local state and bounce
          // to the PIN picker. Don't loop the check once we're already null.
          if (currentStaff !== null) {
            setCurrentStaff(null);
            fetch("/api/pos/auth", { method: "DELETE" }).catch(() => {});
            router.replace("/pos/login");
          }
          return;
        }
        const d = await r.json() as { ok: boolean; staff?: POSStaff };
        if (active && d.ok && d.staff) setCurrentStaff(d.staff);
      } catch { /* network blip — keep last-known */ }
    }

    checkSession();
    const id = setInterval(checkSession, 15_000);
    return () => { active = false; clearInterval(id); };
  }, [router, currentStaff]);

  const logout = useCallback(() => {
    setCurrentStaff(null);
    setCart([]);
    setDiscount({ pct: 0, note: "" });
    setTipAmount(0);
    setKitchenNote("");
    setAssignedCustomer(null);
    // Bug #11 — clear in-memory customers so the next operator on this
    // terminal starts with an empty list until they sign in. Customers are
    // re-fetched from /api/pos/customers on the next login. We still purge
    // any legacy pos_customers localStorage key written by older builds so
    // stale PII can't be revived offline.
    setCustomers([]);
    try {
      localStorage.removeItem("pos_customers");
    } catch { /* ignore — quota / private browsing */ }
    // Clear the server-side session cookie.
    fetch("/api/pos/auth", { method: "DELETE" }).catch(() => {});
  }, []);

  // ── Idle-timeout auto-logout ──────────────────────────────────────────────
  // Log the staff member out after 30 minutes of inactivity (see IDLE_TIMEOUT_MS
  // at module top) so unattended POS terminals cannot be accessed without
  // re-authenticating.
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
  const addToCart = useCallback((product: POSProduct, modifiers: POSCartModifier[], note?: string) => {
    const modPrice = modifiers.reduce((sum, m) => sum + m.priceAdjust, 0);
    const offerPrice = getOfferPrice(product); // null for cart-level offer types
    const basePrice = offerPrice ?? product.price;
    const unitPrice = basePrice + modPrice;
    // Snapshot offer for cart-level quantity-based types (bogo, multibuy, qty_discount).
    // Only snapshot when the offer actually applies in-store — isOfferActive is
    // channel-aware, so an online-only offer won't ride along on a till sale.
    const cartOffer = isOfferActive(product) ? product.offer : undefined;
    setCart((prev) => {
      // Merge with existing identical line (same product + same modifiers, no
      // custom note on either side). A note makes the line unique — bumping qty
      // on a noted line would dilute the note across silent units.
      const modKey = JSON.stringify(modifiers);
      const existing = prev.find(
        (l) => l.productId === product.id && JSON.stringify(l.modifiers) === modKey
      );
      if (existing && !existing.note && !note) {
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
        note,
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
    setKitchenNote("");
    setAssignedCustomer(null);
  }, []);

  const updateCartNote = useCallback((lineId: string, note: string) => {
    setCart((prev) => prev.map((l) => l.lineId === lineId ? { ...l, note } : l));
  }, []);

  // ── Computed totals ───────────────────────────────────────────────────────
  // Each exported value is rounded to 2dp so receipts / UI never show
  // 15.000000000000002, and so the same rounded numbers reach the server.
  const subtotalRaw = cart.reduce((sum, l) => sum + cartLineTotal(l), 0);
  const discountAmountRaw = subtotalRaw * (discount.pct / 100);
  const afterDiscount = subtotalRaw - discountAmountRaw;

  const taxAmountRaw = settings.taxInclusive
    ? afterDiscount - afterDiscount / (1 + settings.taxRate / 100)
    : afterDiscount * (settings.taxRate / 100);

  const grandTotalRaw = settings.taxInclusive
    ? afterDiscount + tipAmount
    : afterDiscount + taxAmountRaw + tipAmount;

  const subtotal       = round2(subtotalRaw);
  const discountAmount = round2(discountAmountRaw);
  const taxAmount      = round2(taxAmountRaw);
  const grandTotal     = round2(grandTotalRaw);

  // ── Complete sale ─────────────────────────────────────────────────────────
  const completeSale = useCallback(async (
    paymentMethod: "cash" | "card" | "split" | "gift_card",
    payments: { method: "cash" | "card"; amount: number }[],
    cashTendered?: number,
    giftCard?: { code: string; amount: number }
  ): Promise<{ sale: POSSale | null; error?: string }> => {
    // Compute totals at full precision, then round each money field to 2dp
    // before sending. The server's Money primitive rejects float garbage
    // (15.000000000000002, 13.043478260869563, etc.) — round at the producer
    // so the wire payload is always clean.
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

    // Build the payload. receiptNo is intentionally omitted — the server
    // assigns it atomically from pos_receipt_seq so two tills can't collide.
    const payload = {
      id: uuid(),
      items: [...cart],
      subtotal: round2(sub),
      discountAmount: round2(disc),
      discountNote: discount.note,
      kitchenNote:  kitchenNote.trim() || undefined,
      taxAmount: round2(tax),
      // Snapshot the VAT mode + rate at time of sale so receipts always show
      // the correct label, even if the settings change later.
      taxRate: settings.taxRate,
      taxInclusive: settings.taxInclusive,
      tipAmount: round2(tipAmount),
      total: round2(total),
      paymentMethod,
      payments: payments.map((p) => ({ ...p, amount: round2(p.amount) })),
      cashTendered: cashTendered !== undefined ? round2(cashTendered) : undefined,
      changeGiven: change !== undefined ? round2(change) : undefined,
      // Gift card tender — server clamps the amount to the card balance and
      // the sale total, then stamps + redeems. total stays the full goods
      // value; the gift card covers part/all of what's owed.
      ...(giftCard ? { giftCardCode: giftCard.code, giftCardUsed: round2(giftCard.amount) } : {}),
      staffId: currentStaff?.id ?? "",
      staffName: currentStaff?.name ?? "",
      customerId: assignedCustomer?.id,
      customerName: assignedCustomer?.name,
      date: new Date().toISOString(),
      voided: false,
    };

    let sale: POSSale | null = null;
    let serverError: string | undefined;
    try {
      const res = await fetch("/api/pos/sales", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      // 409 means the outbox / a retry re-sent a sale we already persisted —
      // treat the returned `sale` as authoritative.
      if (res.ok || res.status === 409) {
        const json = await res.json() as { ok: boolean; sale?: POSSale };
        if (json.sale) sale = json.sale;
      } else {
        // Surface the server's actual reason to the caller so the cashier sees
        // "'Burger' is no longer available on the menu" instead of a generic
        // network error. Stock conflicts (409 with no sale), validation 400s,
        // permission 403s all carry a useful message in `error`.
        const json = await res.json().catch(() => ({})) as { error?: string };
        serverError = json.error;
        // 4xx is expected user-input flow (item went away, insufficient stock,
        // permission denied) — log as a warning so Next.js's dev error overlay
        // doesn't trip on it. The cashier already sees the message via alert().
        // 5xx is a real backend problem worth flagging as an error.
        const log = res.status >= 500 ? console.error : console.warn;
        log("completeSale POST failed:", res.status, json.error ?? "(no details)");
      }
    } catch (err) {
      console.error("completeSale network error:", err);
    }

    if (!sale) return { sale: null, error: serverError };

    // Optimistic local state update + downstream effects only run after the
    // sale is durably persisted in the DB.
    setSales((prev) => [sale!, ...prev]);

    if (assignedCustomer) {
      // Bug #11 — loyalty points are now persisted on the customers row,
      // shared with admin. Optimistically bump the in-memory value and
      // PATCH the new total to /api/pos/customers/[id] so the row stays in
      // sync across terminals. totalSpend/visitCount/lastVisit are computed
      // server-side from pos_sales on the next fetch, so we no longer write
      // them client-side.
      const pts = Math.floor(total * settings.loyaltyPointsPerPound);
      const existingPts = assignedCustomer.loyaltyPoints ?? 0;
      const newPts = existingPts + pts;
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === assignedCustomer.id
            ? {
                ...c,
                loyaltyPoints: newPts,
                totalSpend:    (c.totalSpend ?? 0) + total,
                visitCount:    (c.visitCount ?? 0) + 1,
                lastVisit:     new Date().toISOString(),
              }
            : c
        )
      );
      // Fire-and-forget — the receipt has already printed; a stale loyalty
      // total is benign and the next fetch will reconcile if this fails.
      fetch(`/api/pos/customers/${assignedCustomer.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ loyaltyPoints: newPts }),
      }).catch(() => {});
    }

    // Stock decrement now happens server-side inside /api/pos/sales (atomic,
    // race-free across terminals). The local SaleView grid catches up via the
    // menu_items realtime subscription above — the decrement triggers an
    // UPDATE event that maps back into setProducts, so the counter ticks down
    // in the UI within a frame or two. No client-side decrement here, because
    // a client-driven setProducts would also re-trigger the debounced sync
    // and could push our stale value back to the server.

    clearCart();
    return { sale };
  }, [cart, discount, tipAmount, kitchenNote, settings, currentStaff, assignedCustomer, clearCart]);

  const voidSale = useCallback(async (
    saleId: string,
    reason: string,
    refundMethod?: "cash" | "card" | "none",
    refundAmount?: number,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/pos/sales/${saleId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ voidReason: reason, refundMethod, refundAmount }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        // 4xx is expected user-input flow (no permission, already voided,
        // bad refund amount) — warn so Next.js's dev overlay doesn't trip.
        // 5xx is a real backend problem.
        const log = res.status >= 500 ? console.error : console.warn;
        log("voidSale failed:", res.status, json.error ?? "(no details)");
        return { ok: false, error: json.error };
      }
    } catch (err) {
      console.error("voidSale network error:", err);
      return { ok: false };
    }
    setSales((prev) =>
      prev.map((s) => s.id === saleId
        ? { ...s, voided: true, voidReason: reason, refundMethod, refundAmount }
        : s)
    );
    return { ok: true };
  }, []);

  // ── Clock in/out ──────────────────────────────────────────────────────────
  const clockIn = useCallback(async (staffId: string): Promise<boolean> => {
    const member = staff.find((s) => s.id === staffId);
    if (!member) return false;
    try {
      const res = await fetch("/api/pos/clock", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "in", staffId, staffName: member.name }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        // 4xx (already clocked in, missing permission) is expected — warn so
        // Next.js's dev overlay doesn't trip. 5xx is a real backend problem.
        const log = res.status >= 500 ? console.error : console.warn;
        log("clockIn failed:", res.status, json.error ?? "(no details)");
        return false;
      }
      const json = await res.json() as { ok: boolean; entry?: POSClockEntry };
      if (json.entry) setClockEntries((prev) => [json.entry!, ...prev]);
      return true;
    } catch (err) {
      console.error("clockIn network error:", err);
      return false;
    }
  }, [staff]);

  const clockOut = useCallback(async (staffId: string): Promise<boolean> => {
    const member = staff.find((s) => s.id === staffId);
    if (!member) return false;
    try {
      const res = await fetch("/api/pos/clock", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "out", staffId, staffName: member.name }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        // 4xx (not clocked in, missing permission) is expected — warn so
        // Next.js's dev overlay doesn't trip. 5xx is a real backend problem.
        const log = res.status >= 500 ? console.error : console.warn;
        log("clockOut failed:", res.status, json.error ?? "(no details)");
        return false;
      }
      const json = await res.json() as { ok: boolean; entry?: POSClockEntry };
      if (json.entry) {
        const updated = json.entry;
        setClockEntries((prev) => prev.map((e) => e.id === updated.id ? updated : e));
      }
      return true;
    } catch (err) {
      console.error("clockOut network error:", err);
      return false;
    }
  }, [staff]);

  const isClocked = useCallback((staffId: string): boolean => {
    const last = [...clockEntries].reverse().find((e) => e.staffId === staffId);
    return !!last && !last.clockOut;
  }, [clockEntries]);

  // ── Convenience: export sales as JSON for archival / accounting ──────────
  const exportSales = useCallback(() => {
    const blob = new Blob([JSON.stringify(sales, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `pos-sales-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sales]);

  // Dedicated stock writer for POS-admin / manager. Optimistically updates
  // the local product so the SaleView grid reflects the change immediately,
  // then PUTs to the targeted stock endpoint (which accepts POS canManageMenu).
  // We deliberately do NOT route this through setProducts → bulk sync — the
  // bulk sync strips stock fields, so this path is the only way to persist.
  const updateProductStock = useCallback((
    id: string,
    payload: { mode: "qty"; stockQty: number } | { mode: "manual"; stockStatus: "in_stock" | "low_stock" | "out_of_stock" },
  ) => {
    setProducts((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      return payload.mode === "qty"
        ? { ...p, stockQty: payload.stockQty, stockStatus: undefined, trackStock: true }
        : { ...p, stockQty: undefined, stockStatus: payload.stockStatus, trackStock: false };
    }));
    fetch(`/api/admin/menu/${id}/stock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (r) => {
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        console.error("updateProductStock:", j.error);
      }
    }).catch((e) => console.error("updateProductStock:", e));
  }, []);

  return (
    <POSContext.Provider value={{
      currentStaff, login, logout,
      staff, addPosStaff, updatePosStaff, deletePosStaff, refreshPosStaff,
      products, setProducts, updateProductStock,
      categories, setCategories,
      sales,
      customers, setCustomers,
      addCustomer, updateCustomer, deleteCustomer, refreshCustomers: fetchCustomers,
      clockEntries,
      settings, setSettings,
      cart, addToCart, updateCartQty, removeFromCart, clearCart, updateCartNote,
      discount, setDiscount,
      tipAmount, setTipAmount,
      kitchenNote, setKitchenNote,
      assignedCustomer, setAssignedCustomer,
      subtotal, discountAmount, taxAmount, grandTotal,
      completeSale, voidSale,
      clockIn, clockOut, isClocked,
      exportSales,
    }}>
      {children}
    </POSContext.Provider>
  );
}
