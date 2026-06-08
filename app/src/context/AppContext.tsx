"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import {
  AdminSettings, AuditEntry, CartItem, Category, Coupon,
  DeliveryStatus, DeliveryZone, Driver, MealPeriod, MenuItem, Customer, Order, OrderStatus, PaymentMethod,
  PaymentStatus, Refund, SavedAddress, StockStatus,
} from "@/types";
import { buildColorCss } from "@/lib/colorUtils";
import { cartSubtotal } from "@/lib/menuOfferUtils";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { DEFAULT_SETTINGS, DEFAULT_COLORS } from "@/data/defaultSettings";
import SeoHead from "@/components/SeoHead";
import EmailVerificationBanner from "@/components/EmailVerificationBanner";

// ─── Email template merge ─────────────────────────────────────────────────────
// Keeps existing edited templates and fills in any new default events that are
// not yet stored (e.g. new reservation events added after initial setup).
function mergeEmailTemplates(stored: typeof DEFAULT_EMAIL_TEMPLATES | undefined | null) {
  if (!stored || stored.length === 0) return DEFAULT_EMAIL_TEMPLATES;
  const storedEvents = new Set(stored.map((t) => t.event));
  const missing = DEFAULT_EMAIL_TEMPLATES.filter((t) => !storedEvents.has(t.event));
  return missing.length > 0 ? [...stored, ...missing] : stored;
}

// ─── Dining table row mapping ─────────────────────────────────────────────────
// dining_tables rows come back snake_case; the DiningTable type the whole app
// consumes is camelCase. Most columns coincide (id/label/seats/section/active),
// but the VIP fields don't — map them so the crown + booking fee surface in the
// POS / waiter / reservation views that read settings.diningTables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDiningRow(r: any) {
  return {
    ...r,
    isVip:    r.is_vip ?? false,
    vipPrice: Number(r.vip_price ?? 0),
    posX:     r.pos_x ?? null,
    posY:     r.pos_y ?? null,
  };
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
  /** Re-fetch dining tables into settings.diningTables (no server write).
   *  Poll this on surfaces that gate UI on the table list (POS, waiter) so
   *  admin add/remove-table changes show without a full reload. */
  refreshDiningTables: () => Promise<void>;
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
  /** Dedicated stock-only update. Use this when the admin explicitly changes
   *  stock fields (qty or status) — it routes to /api/admin/menu/[id]/stock
   *  so the general menu PUT can keep its hands off the live counter. */
  updateMenuItemStock: (
    id: string,
    payload: { mode: "qty"; stockQty: number } | { mode: "manual"; stockStatus: "in_stock" | "low_stock" | "out_of_stock" },
  ) => void;
  deleteMenuItem: (id: string) => void;
  reorderCategories: (cats: Category[]) => void;
  customers: Customer[];
  addOrder: (customerId: string, order: Order) => Promise<{ ok: boolean; error?: string }>;
  updateOrderStatus: (customerId: string, orderId: string, status: OrderStatus) => void;
  addCustomer: (customer: Customer, password?: string) => Promise<void>;
  updateCustomer: (customer: Customer) => void;
  currentUser: Customer | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; needsVerification?: boolean; email?: string; error?: string }>;
  register: (name: string, email: string, phone: string, password: string) => Promise<{ success: boolean; error?: string; needsVerification?: boolean; email?: string }>;
  logout: () => Promise<void>;
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
  /** False until the first /api/auth/driver(/me) check resolves on mount.
   *  The driver page uses this to distinguish "still checking" from "checked
   *  and confirmed signed-out" so it can redirect to /driver/login without
   *  a fixed-delay fallback timer. */
  driverAuthChecked: boolean;
  /** Validates credentials via the server-side /api/auth/driver route. */
  driverLogin: (email: string, password: string) => Promise<boolean>;
  driverLogout: () => void;
  addDriver: (data: Omit<Driver, "id" | "createdAt"> & { password: string }) => Promise<Driver>;
  updateDriver: (id: string, data: Partial<Omit<Driver, "id" | "createdAt">> & { password?: string }) => Promise<Driver>;
  deleteDriver: (id: string) => Promise<void>;
  toggleDriver: (id: string, active: boolean) => Promise<void>;
  assignDriverToOrder: (customerId: string, orderId: string, driverId: string | null) => void;
  updateDeliveryStatus: (
    customerId: string,
    orderId: string,
    status: DeliveryStatus,
    code?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Record a refund on an order. Pass `newStatus` to also flip the order's
   * fulfillment status in the same atomic write — used by the Delivery panel's
   * "refund + cancel" flow so the refund and the cancellation can't race each
   * other on the `status` column. Omit it for a plain refund (the order keeps
   * its current fulfillment status; only payment state changes).
   */
  addRefund: (customerId: string, orderId: string, refund: Refund, newStatus?: OrderStatus) => void;
  spendStoreCredit: (customerId: string, amount: number, orderId: string) => void;
  /** Local-only optimistic deduction. Use when the deduction is being handled
   *  server-side elsewhere (e.g. Stripe/PayPal webhooks deduct after order
   *  insert) — there's no order id yet on the client, so calling
   *  `spendStoreCredit` would 404 against an order that doesn't exist. */
  applyStoreCreditOptimistic: (customerId: string, amount: number) => void;
  // ─── Meal periods ─────────────────────────────────────────────────────────
  // Time-bounded customer-menu sections (Breakfast, Lunch, Dinner…). Items
  // reference these via MenuItem.mealPeriodIds. Many-to-many.
  mealPeriods: MealPeriod[];
  addMealPeriod: (period: Omit<MealPeriod, "id"> & { id?: string }) => Promise<{ ok: boolean; mealPeriod?: MealPeriod; error?: string }>;
  updateMealPeriod: (id: string, patch: Partial<Omit<MealPeriod, "id">>) => Promise<{ ok: boolean; error?: string }>;
  deleteMealPeriod: (id: string) => Promise<{ ok: boolean; error?: string }>;
  reorderMealPeriods: (periods: MealPeriod[]) => Promise<{ ok: boolean; error?: string }>;
  /** Re-fetches the logged-in customer from the server and syncs state. */
  refreshCurrentUser: () => Promise<void>;
  /**
   * Admin/driver surfaces only — populates the `customers` array from the
   * admin-gated /api/admin/customers/list endpoint. Customer-facing pages
   * MUST NOT call this; they use `currentUser` instead. Returns ok=false
   * when the admin session is missing (anyone else gets an empty result).
   */
  loadAllCustomers: () => Promise<{ ok: boolean; error?: string }>;
}

const AppContext = createContext<AppContextValue | null>(null);

// ─── Defaults ─────────────────────────────────────────────────────────────────
// DEFAULT_SETTINGS and its sub-constants live in @/data/defaultSettings so the
// same defaults can be loaded by the post-migrate seed-settings script. Don't
// re-add inline defaults here — edit the data file.

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

function validateCouponCode(code: string, subtotal: number, coupons: Coupon[], sym = "£") {
  const coupon = coupons.find((c) => c.code.toUpperCase() === code.trim().toUpperCase());
  if (!coupon)         return { valid: false as const, error: "Invalid coupon code." };
  if (!coupon.active)  return { valid: false as const, error: "This coupon is no longer active." };
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date())
    return { valid: false as const, error: "This coupon has expired." };
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit)
    return { valid: false as const, error: "This coupon has reached its usage limit." };
  if (coupon.minOrderAmount > 0 && subtotal < coupon.minOrderAmount)
    return { valid: false as const, error: `Minimum order of ${sym}${coupon.minOrderAmount.toFixed(2)} required.` };
  const discountAmount =
    coupon.type === "percentage"
      ? parseFloat((subtotal * (coupon.value / 100)).toFixed(2))
      : parseFloat(Math.min(coupon.value, subtotal).toFixed(2));
  return { valid: true as const, coupon, discountAmount };
}

// ─── DB row → TypeScript mappers ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCategory(row: any): Category {
  return { id: row.id, name: row.name, emoji: row.emoji, parentId: row.parent_id || null, sort_order: row.sort_order ?? 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMenuItem(row: any, mealPeriodIds: string[] = []): MenuItem {
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
    // Bug #2 — POS parity columns. Defaults match the schema (active=true,
    // trackStock=false) so older snapshots without the columns still render.
    cost:   row.cost  !== null && row.cost  !== undefined ? Number(row.cost) : undefined,
    sku:    row.sku   ?? undefined,
    emoji:  row.emoji ?? undefined,
    color:  row.color ?? undefined,
    active: row.active === undefined || row.active === null ? true : !!row.active,
    trackStock: !!row.track_stock,
    offer:  row.offer ?? undefined,
    mealPeriodIds,
    // Channel split. Legacy rows that pre-date the column come back as
    // null/undefined → fall back to both channels so they stay visible
    // everywhere until admin curates them.
    channels: Array.isArray(row.channels) && row.channels.length > 0
      ? (row.channels as ("in_store" | "online")[])
      : ["in_store", "online"],
    priceOnline: row.price_online !== null && row.price_online !== undefined
      ? Number(row.price_online)
      : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMealPeriod(row: any): MealPeriod {
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    startTime: row.start_time,
    endTime: row.end_time,
    daysOfWeek: row.days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
    sortOrder: row.sort_order ?? 0,
    themeColor: row.theme_color ?? "#f59e0b",
  };
}

// mapOrder (row → Order) + mapCustomer + customersRef were used by the old
// client-side anon SELECT on `customers`/`orders` and the matching realtime
// hydration. Both paths are gone — orders/customers now arrive already shaped
// from /api/auth/me (logged-in user only) and /api/admin/customers/list (admin
// tree), so no client-side row mapping is needed.

// ─── TypeScript → DB row mappers ─────────────────────────────────────────────

function categoryToRow(c: Category, order: number) {
  return { id: c.id, name: c.name, emoji: c.emoji, sort_order: order, parent_id: c.parentId || null };
}

function menuItemToRow(m: MenuItem) {
  // mealPeriodIds is intentionally NOT included — those go to the
  // menu_item_meal_periods join table, handled separately by the admin API.
  //
  // Stock fields ARE included here so a new-item POST sets the initial
  // counter atomically (no separate stock PUT needed, no insert/update
  // race). The general /api/admin/menu/[id] PUT route strips stock fields
  // before update, so unrelated edits cannot clobber the live counter that
  // sales are decrementing. Live stock changes go through
  // updateMenuItemStock → /api/admin/menu/[id]/stock instead.
  return {
    id: m.id, category_id: m.categoryId,
    name: m.name, description: m.description ?? "",
    price: m.price, image: m.image ?? "",
    dietary: m.dietary, popular: m.popular ?? false,
    variations: m.variations ?? [], add_ons: m.addOns ?? [],
    stock_qty: m.stockQty ?? null,
    stock_status: typeof m.stockQty === "number" ? null : (m.stockStatus ?? "in_stock"),
    track_stock: typeof m.stockQty === "number",
    cost: m.cost ?? null,
    sku:  m.sku  ?? null,
    emoji: m.emoji ?? null,
    color: m.color ?? null,
    active: m.active ?? true,
    offer: m.offer ?? null,
    // Channel split + online price override. Omitting `channels` from the
    // payload would let the DB default re-assert `{in_store, online}`; we
    // pass the explicit value so admin can save in_store-only items.
    channels: m.channels && m.channels.length > 0 ? m.channels : ["in_store", "online"],
    price_online: m.priceOnline ?? null,
  };
}

function orderToRow(o: Order) {
  return {
    id: o.id, customer_id: o.customerId, date: o.date,
    status: o.status, fulfillment: o.fulfillment, total: o.total,
    items: o.items,
    address: o.address ?? "", note: o.note ?? "",
    // Customer pin coordinates captured at checkout — null when the customer
    // didn't drop a pin. Server-side validateAndNormaliseOrder re-checks bounds
    // and prefers these over re-geocoding the address when computing the fee.
    customer_lat: o.customerLat ?? null,
    customer_lng: o.customerLng ?? null,
    payment_method: o.paymentMethod ?? "",
    delivery_fee: o.deliveryFee ?? 0, service_fee: o.serviceFee ?? 0,
    scheduled_time: o.scheduledTime ?? "", coupon_code: o.couponCode ?? "",
    coupon_discount: o.couponDiscount ?? 0,
    vat_amount: o.vatAmount ?? 0, vat_inclusive: o.vatInclusive ?? true,
    driver_id: o.driverId ?? "", driver_name: o.driverName ?? "",
    delivery_status: o.deliveryStatus ?? "",
    delivery_code: o.deliveryCode ?? null,
    refunds: o.refunds ?? [],
    refunded_amount: o.refundedAmount ?? 0,
    store_credit_used: o.storeCreditUsed ?? 0,
    // Gift card — the server looks up the code, validates + clamps the amount,
    // and stamps gift_card_id on the row. We forward the transient code +
    // proposed amount; empty string when no card was applied.
    gift_card_code: o.giftCardCode ?? "",
    gift_card_used: o.giftCardUsed ?? 0,
  };
}

function customerToRow(c: Customer) {
  return {
    id: c.id, name: c.name, email: c.email,
    phone: c.phone ?? "",
    created_at: c.createdAt,
    tags: c.tags ?? [], favourites: c.favourites ?? [],
    saved_addresses: c.savedAddresses ?? [],
    store_credit: c.storeCredit ?? 0,
  };
}

// ─── Settings builder ─────────────────────────────────────────────────────────
// Shared by: AppProvider initial state, init useEffect, and Realtime subscription.
//
// Reads the raw `data` column from app_settings and returns it as-is — no
// per-field merging with DEFAULT_SETTINGS. Fresh DBs are populated by
// `npm run db:migrate` (which chains seed-settings), so every field is
// guaranteed to be present. If you add a new field to AdminSettings, also:
//   1. Add the default to src/data/defaultSettings.ts
//   2. Write a one-line `update app_settings set data = data || $1::jsonb ...`
//      migration for existing installs.
//
// The only fallback kept is "raw is null" → return DEFAULT_SETTINGS, which
// covers the brief SSR window before the first DB query resolves.
 
function buildSettingsFromData(raw: Record<string, unknown> | null): AdminSettings {
  if (!raw) return DEFAULT_SETTINGS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;

  // ── One-time footerPages → customPages migration ──────────────────────────
  // Footer Pages and Custom Pages have been unified into a single "Pages"
  // concept (CustomPage). Any installs that still carry legacy `footerPages`
  // entries have them converted to `customPages` here (preserving slug/title/
  // content, mapping `enabled` → `published`). Existing `customPages` win on
  // slug collision, and `footerPages` is reset to `[]` so the migration is
  // safe to re-run on every load.
  const legacyFooterPages: import("@/types").FooterPage[] = Array.isArray(d.footerPages) ? d.footerPages : [];
  const existingCustomPages: import("@/types").CustomPage[] = Array.isArray(d.customPages) ? d.customPages : [];
  let mergedCustomPages = existingCustomPages;
  if (legacyFooterPages.length > 0) {
    const existingSlugs = new Set(existingCustomPages.map((p) => p.slug));
    const nowIso = new Date().toISOString();
    const converted: import("@/types").CustomPage[] = legacyFooterPages
      .filter((fp) => fp && fp.slug && !existingSlugs.has(fp.slug))
      .map((fp) => ({
        id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `fp-${fp.slug}`,
        title: fp.title ?? "",
        slug: fp.slug,
        content: fp.content ?? "",
        seoTitle: "",
        seoDescription: "",
        published: !!fp.enabled,
        createdAt: fp.lastModified && new Date(fp.lastModified).getTime() > 0
          ? fp.lastModified
          : nowIso,
        updatedAt: fp.lastModified && new Date(fp.lastModified).getTime() > 0
          ? fp.lastModified
          : nowIso,
      }));
    mergedCustomPages = [...existingCustomPages, ...converted];
  }

  return {
    ...DEFAULT_SETTINGS,
    ...d,
    // emailTemplates is the one legit forward-compat shim: it auto-fills any
    // event templates added in code that aren't yet in the stored array, so
    // existing installs surface new email events without a manual migration.
    emailTemplates: mergeEmailTemplates(d.emailTemplates),
    // Moved-out keys: read from DB tables, not JSONB. Empty arrays here so
    // the legacy panels that haven't been switched (CouponsPanel) keep
    // rendering something sensible — those panels are scheduled for the
    // /api/admin/coupons switch in a follow-up.
    coupons:      d.coupons      ?? [],
    waiters:      [],   // managed via /api/admin/waiters; ignore JSONB copy
    kitchenStaff: [],   // managed via /api/admin/kitchen-staff
    diningTables: [],   // managed via /api/admin/dining-tables
    // Footer Pages have been merged into Custom Pages — see migration above.
    // We always reset footerPages to [] so a re-run is a no-op.
    customPages: mergedCustomPages,
    footerPages: [],
    // Sensitive fields are explicitly excluded — never reach client state:
    // drivers, stripeSecretKey, paypalClientId, smtpHost/Port/User/Password
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({
  children,
  initialData,
}: {
  children:     React.ReactNode;
  initialData?: Record<string, unknown> | null;
}) {
  const [cart, dispatch]         = useReducer(cartReducer, []);
  // Initialise from server-passed data so the color useEffect writes the same
  // CSS as the server already injected — eliminates the FOUC/theme-flicker.
  const [settings, setSettings]  = useState<AdminSettings>(
    () => buildSettingsFromData(initialData ?? null),
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems]   = useState<MenuItem[]>([]);
  const [mealPeriods, setMealPeriods] = useState<MealPeriod[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  // Tracks orders with an in-flight optimistic status change so the 8 s
  // loadAllCustomers poll doesn't briefly flip cards back to their old column
  // when a GET issued before the PUT committed returns stale data.
  // Entry is cleared when the server view catches up or when TTL expires.
  const pendingOrderStatusRef = useRef<Map<string, { status: OrderStatus; until: number }>>(new Map());
  // Mirror of customers state accessible from inside Realtime callbacks without
  // closure staleness — callbacks capture the ref value, not the state snapshot.
  // Drivers are fetched from the server-side /api/admin/drivers endpoint —
  // they are NOT part of app_settings so they are never exposed to customers.
  const [drivers, setDrivers]       = useState<Driver[]>([]);
  const [currentUser, setCurrentUser]   = useState<Customer | null>(null);
  const [currentDriver,      setCurrentDriver]      = useState<Driver | null>(null);
  const [driverAuthChecked,  setDriverAuthChecked]  = useState(false);
  const [fulfillment, setFulfillment] = useState<"delivery" | "collection">("delivery");
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    couponId: string; code: string; discountAmount: number;
  } | null>(null);
  // isOpen is client-only: start false on both server and client to prevent
  // hydration mismatches caused by timezone differences between the server
  // (UTC) and the browser (local timezone). Updated after mount via useEffect.
  const [isOpen, setIsOpen] = useState(false);


  // ── Session data: cart, user, driver stay in localStorage ─────────────────

  useEffect(() => {
    // Scope the session probes to the surface that actually uses each session,
    // so we don't fire (and 401) on pages that have no business with that role.
    //  • driver session  → only /driver (currentDriver is read only there)
    //  • customer session → only the storefront (site) routes (currentUser is
    //    never read on pos / kitchen / driver / admin)
    // The cart restore below runs everywhere (it's role-agnostic, no network).
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const isDriverRoute  = path.startsWith("/driver");
    const isCustomerSite = !isDriverRoute
      && !path.startsWith("/admin")
      && !path.startsWith("/pos")
      && !path.startsWith("/kitchen");

    try {
      const c = localStorage.getItem("sg_cart");
      if (c) (JSON.parse(c) as CartItem[]).forEach((item) => dispatch({ type: "ADD", item }));

      if (isDriverRoute) {
        const d = localStorage.getItem("sg_driver_session");
        if (d) {
          setCurrentDriver(JSON.parse(d));
          // Verify the cookie is still valid; clear stale localStorage AND the
          // server cookie if not (fresh DB / deactivated / session_version bump).
          // Without the server-side clear the cookie keeps fooling middleware
          // on the next nav, looping the driver into a slow auth retry.
          fetch("/api/auth/driver", { method: "GET" })
            .then(async (r) => {
              if (!r.ok) {
                setCurrentDriver(null);
                localStorage.removeItem("sg_driver_session");
                await fetch("/api/auth/driver/logout", { method: "POST" }).catch(() => {});
              }
            })
            .catch(() => {})
            .finally(() => setDriverAuthChecked(true));
        } else {
          // No localStorage — try fetching the driver profile from the session cookie.
          // This restores currentDriver when localStorage has been cleared but the
          // cookie is still valid (e.g. after clearing site data or on a new tab).
          fetch("/api/auth/driver/me")
            .then(async (r) => {
              if (r.ok) return r.json() as Promise<{ ok: boolean; driver?: import("@/types").Driver }>;
              // 401 with a present cookie = stale signed token (fresh DB, deleted
              // driver, etc.). Drop it now so the driver lands on /driver/login
              // immediately instead of after the legacy 4 s fallback timer.
              await fetch("/api/auth/driver/logout", { method: "POST" }).catch(() => {});
              return null;
            })
            .then((json) => {
              if (json?.ok && json.driver) {
                setCurrentDriver(json.driver);
                localStorage.setItem("sg_driver_session", JSON.stringify(json.driver));
              }
            })
            .catch(() => {})
            .finally(() => setDriverAuthChecked(true));
        }
      }

      // Restore last-known customer instantly so the account page renders on first
      // click without waiting for the network. The fetch below verifies the session
      // and merges fresh data (stale-while-revalidate pattern). Storefront only.
      if (isCustomerSite) {
        const u = localStorage.getItem("sg_current_user");
        if (u) setCurrentUser(JSON.parse(u) as Customer);
      }
    } catch { /* ignore */ }

    // Verify customer session via httpOnly cookie — storefront routes only.
    if (isCustomerSite) {
      fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => r.ok ? r.json() : null)
        .then((json: { ok: boolean; customer?: Customer } | null) => {
          if (!json?.ok || !json.customer) {
            // Session invalid or expired — clear any stale cached user.
            setCurrentUser(null);
            return;
          }
          const serverOrders: Order[] = json.customer.orders ?? [];
          const serverIds = new Set(serverOrders.map((o) => o.id));
          setCurrentUser((prev) => {
            const localOnly: Order[] = (prev && prev.id === json.customer!.id)
              ? prev.orders.filter((o) => !serverIds.has(o.id))
              : [];
            return {
              ...json.customer!,
              orders: [...localOnly, ...serverOrders].sort(
                (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
              ),
            };
          });
        })
        .catch(() => {});
    }
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
          setSettings(buildSettingsFromData(settingsData.data));
        } else if (!settingsData) {
          // First run — seed settings into the DB
          await supabase.from("app_settings").insert({ id: 1, data: DEFAULT_SETTINGS });
        }

        // Drivers — admin-only data (DriversPanel + admin dashboard are the
        // only consumers). Skip on every other surface so we don't fire a 401
        // on pos / kitchen / driver / storefront pages that never read it.
        const onAdminRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
        if (onAdminRoute) {
          try {
            const driversRes = await fetch("/api/admin/drivers");
            if (driversRes.ok) {
              const { drivers: loaded } = await driversRes.json() as { drivers: Driver[] };
              setDrivers(loaded ?? []);
            }
          } catch (err) {
            console.error("AppContext: failed to load drivers:", err);
          }
        }

        // dining_tables — moved out of app_settings.data.diningTables.
        // GET is anon-accessible, so this works on customer pages too
        // (reservations booking UI reads it). Other panels (TableStatusPanel,
        // ReservationsPanel) read `settings.diningTables` via context — we
        // hydrate that field here once on mount so those panels Just Work.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: tableRows } = await (supabase as any)
            .from("dining_tables")
            .select("id, label, number, seats, section, active, sort_order, is_vip, vip_price, pos_x, pos_y")
            .order("sort_order", { ascending: true });
          if (Array.isArray(tableRows)) {
            setSettings((prev) => ({ ...prev, diningTables: tableRows.map(mapDiningRow) }));
          }
        } catch (err) {
          console.error("AppContext: failed to load dining_tables:", err);
        }

        // Categories — no runtime seed and no fallback to bundled defaults.
        // An empty DB shows an empty UI; populate via `npm run db:seed-menu` or
        // through the admin panel.
        const { data: catsData, error: catsErr } = await supabase
          .from("categories").select("*").order("sort_order", { ascending: true });
        if (catsErr) console.error("AppContext: failed to load categories:", catsErr.message);
        else setCategories((catsData ?? []).map(mapCategory));

        // Menu items + their meal-period join rows (fetched in parallel).
        const [menuRes, mimpRes] = await Promise.all([
          supabase.from("menu_items").select("*"),
          supabase.from("menu_item_meal_periods").select("menu_item_id, meal_period_id"),
        ]);
        if (menuRes.error) console.error("AppContext: failed to load menu items:", menuRes.error.message);
        if (mimpRes.error) console.error("AppContext: failed to load menu_item_meal_periods:", mimpRes.error.message);
        if (!menuRes.error) {
          const tagsByItem = new Map<string, string[]>();
          for (const row of (mimpRes.data ?? []) as { menu_item_id: string; meal_period_id: string }[]) {
            const arr = tagsByItem.get(row.menu_item_id) ?? [];
            arr.push(row.meal_period_id);
            tagsByItem.set(row.menu_item_id, arr);
          }
          setMenuItems((menuRes.data ?? []).map((r) => mapMenuItem(r, tagsByItem.get(r.id) ?? [])));
        }

        // Meal periods
        const { data: mpData, error: mpErr } = await supabase
          .from("meal_periods").select("*").order("sort_order", { ascending: true });
        if (mpErr) console.error("AppContext: failed to load meal_periods:", mpErr.message);
        else setMealPeriods((mpData ?? []).map(mapMealPeriod));

        // NOTE: customers + their orders are NOT loaded here. The previous
        // anon-key SELECT on customers leaked every customer's PII to every
        // browser visitor (F-DATA-1). The customer site uses `currentUser`
        // (fetched via /api/auth/me with cookie auth). Admin/driver/POS
        // surfaces fetch via `loadAllCustomers()` after their own auth
        // check passes.
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
          setSettings((prev) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const next = buildSettingsFromData((row as any).data ?? null);
            // diningTables / waiters / kitchenStaff live in their own DB
            // tables, not in app_settings.data. buildSettingsFromData blanks
            // them to [] by design — without preserving them here every realtime
            // app_settings UPDATE would wipe the POS table grid (the QA bug:
            // "when admin adds a table, all tables vanish then reappear").
            return {
              ...next,
              diningTables: prev.diningTables,
              waiters:      prev.waiters,
              kitchenStaff: prev.kitchenStaff,
            };
          });
          // Admin's table CRUD writes diningTables back through updateSettings
          // (which persists to app_settings.data and triggers this realtime),
          // so use that signal to refresh the dedicated dining_tables table.
          // refreshDiningTables is no-op-if-unchanged, so this is cheap, and
          // when it does update it appends the new row instead of replacing
          // — existing cards stay in place via React key reconciliation.
          refreshDiningTables();
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
        async ({ eventType, new: newRow, old: oldRow, errors }: any) => {
          if (eventType === "DELETE") {
            setMenuItems((prev) => prev.filter((m) => m.id !== oldRow.id));
            return;
          }
          // Supabase Realtime drops oversized columns and sets `errors`
          // ("Payload Too Large") when a row exceeds its ~1 MB cap — e.g. a
          // legacy base64 image still stored inline. Trusting that truncated
          // row would blank the image, so refetch the full row (SELECT is not
          // size-capped) instead of mapping the partial payload. New images go
          // through Supabase Storage (lib/uploadImage.ts) so rows stay tiny and
          // this branch only fires for not-yet-migrated rows.
          if (errors) {
            const id = newRow?.id ?? oldRow?.id;
            if (!id) return;
            const { data, error } = await supabase.from("menu_items").select("*").eq("id", id).single();
            if (error || !data) return;
            newRow = data;
          }
          setMenuItems((prev) => {
            const existing = prev.find((m) => m.id === newRow.id);
            // Preserve mealPeriodIds — those live in a separate table and
            // arrive via the menu_item_meal_periods subscription below.
            const item = mapMenuItem(newRow, existing?.mealPeriodIds ?? []);
            const idx = prev.findIndex((m) => m.id === item.id);
            return idx >= 0 ? prev.map((m) => (m.id === item.id ? item : m)) : [...prev, item];
          });
        })
      // Meal periods
      .on("postgres_changes", { event: "*", schema: "public", table: "meal_periods" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ eventType, new: newRow, old: oldRow }: any) => {
          if (eventType === "DELETE") {
            setMealPeriods((prev) => prev.filter((p) => p.id !== oldRow.id));
          } else {
            const period = mapMealPeriod(newRow);
            setMealPeriods((prev) => {
              const idx = prev.findIndex((p) => p.id === period.id);
              const next = idx >= 0 ? prev.map((p) => (p.id === period.id ? period : p)) : [...prev, period];
              return [...next].sort((a, b) => a.sortOrder - b.sortOrder);
            });
          }
        })
      // Menu item ↔ meal period assignments
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_item_meal_periods" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ eventType, new: newRow, old: oldRow }: any) => {
          const row = (eventType === "DELETE" ? oldRow : newRow) as { menu_item_id: string; meal_period_id: string };
          setMenuItems((prev) => prev.map((m) => {
            if (m.id !== row.menu_item_id) return m;
            const tags = new Set(m.mealPeriodIds ?? []);
            if (eventType === "DELETE") tags.delete(row.meal_period_id);
            else tags.add(row.meal_period_id);
            return { ...m, mealPeriodIds: Array.from(tags) };
          }));
        })
      // Orders + Customers realtime subscriptions removed. The anon client
      // no longer has SELECT on these tables (RLS revoke), so the channel
      // would deliver no events anyway. Customer-side freshness is handled
      // by polling /api/auth/me on the account page; admin/driver/kitchen
      // surfaces poll their own dedicated endpoints.
      // Drivers
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ eventType, new: newRow, old: oldRow }: any) => {
          if (eventType === "DELETE") {
            setDrivers((prev) => prev.filter((d) => d.id !== oldRow.id));
          } else {
            const driver: Driver = {
              id: newRow.id, name: newRow.name, email: newRow.email,
              phone: newRow.phone ?? "",
              active: newRow.active ?? true,
              vehicleInfo: newRow.vehicle_info || undefined,
              notes: newRow.notes || undefined,
              createdAt: typeof newRow.created_at === "string" ? newRow.created_at : new Date(newRow.created_at).toISOString(),
            };
            setDrivers((prev) => {
              const idx = prev.findIndex((d) => d.id === driver.id);
              return idx >= 0 ? prev.map((d) => (d.id === driver.id ? driver : d)) : [driver, ...prev];
            });
          }
        })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("AppContext: Realtime subscription lost (%s) — changes from other sessions will not sync until page refresh.", status);
        }
      });

    return () => { supabase.removeChannel(channel); };
    // Mount-only: the channel must be subscribed exactly once for the
    // component's lifetime. refreshDiningTables is a stable useCallback([]),
    // so it never actually changes; it's also declared after this effect,
    // so listing it in the deps would hit the temporal dead zone at render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Color theme injection ──────────────────────────────────────────────────

  useEffect(() => {
    const { primaryColor, backgroundColor } = settings.colors ?? DEFAULT_COLORS;
    const css = buildColorCss(primaryColor, backgroundColor);
    if (!css) return;
    let el = document.getElementById("color-theme-vars");
    if (!el) { el = document.createElement("style"); el.id = "color-theme-vars"; document.head.appendChild(el); }
    el.textContent = css;
    // Keep localStorage in sync so the layout's fallback script has current
    // colors if the server-side DB fetch ever fails (e.g. DB unreachable).
    try { localStorage.setItem("sg_color_theme", css); } catch { /* private browsing */ }
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

  // Memoized so consumers can safely list this in useEffect / useCallback
  // dependency arrays without re-triggering on every AppContext render.
  // The body only uses setSettings (stable) and persistSettings (no closure
  // deps — its fetch body comes from the `next` argument), so freezing it to
  // the first render is safe.
  const updateSettings = useCallback((patch: Partial<AdminSettings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      persistSettings(next);
      return next;
    }),
  []);

  // Re-fetch dining_tables into settings.diningTables WITHOUT a server write.
  // dining_tables has no realtime subscription (and anon realtime is dead post
  // RLS-revoke), so surfaces that gate UI on the table list — the POS Table
  // Service / Reservations tabs, the waiter grid — go stale after an admin
  // adds/removes a table until a full reload. Callers poll this to stay live.
  // No-op-if-unchanged so it never causes a spurious re-render.
  const refreshDiningTables = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tableRows } = await (supabase as any)
        .from("dining_tables")
        .select("id, label, number, seats, section, active, sort_order, is_vip, vip_price")
        .order("sort_order", { ascending: true });
      if (!Array.isArray(tableRows)) return;
      const mapped = tableRows.map(mapDiningRow);
      setSettings((prev) => {
        if (JSON.stringify(prev.diningTables ?? []) === JSON.stringify(mapped)) return prev;
        return { ...prev, diningTables: mapped };
      });
    } catch { /* keep last-known */ }
  }, []);

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

  // The fetch is intentionally OUTSIDE the setState updater. React StrictMode
  // (default in Next dev) invokes setState updaters twice to surface impurity
  // — when the fetch lived inside the updater that meant two POSTs with the
  // same id, and the second one failed with "duplicate key value violates
  // unique constraint". Mirror addMenuItem's pattern: optimistic update first,
  // single fire-and-forget fetch second.
  const addCategory = (cat: Category) => {
    const order = categories.length;
    const row = categoryToRow(cat, order);
    // Stamp sort_order on the optimistic row too — getParents/getChildren sort
    // by it, so an unset value would float the new category to the top.
    setCategories((prev) => [...prev, { ...cat, sort_order: order }]);
    fetch("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("addCategory:", j.error); }
    }).catch((e) => console.error("addCategory:", e));
  };

  const updateCategory = (cat: Category) => {
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)));
    fetch(`/api/admin/categories/${cat.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cat.name, emoji: cat.emoji, parent_id: cat.parentId || null }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("updateCategory:", j.error); }
    }).catch((e) => console.error("updateCategory:", e));
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
    // Re-stamp sort_order to match the new positions so the optimistic order
    // sticks — getParents/getChildren sort by sort_order, which would otherwise
    // revert the reorder (to the stale values) until the next reload.
    const reindexed = cats.map((c, i) => ({ ...c, sort_order: i }));
    setCategories(reindexed);
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
      body: JSON.stringify({ ...menuItemToRow(item), mealPeriodIds: item.mealPeriodIds ?? [] }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("addMenuItem:", j.error); }
    }).catch((e) => console.error("addMenuItem:", e));
  };

  const updateMenuItem = (item: MenuItem) => {
    setMenuItems((prev) => prev.map((m) => (m.id === item.id ? item : m)));
    fetch(`/api/admin/menu/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...menuItemToRow(item), mealPeriodIds: item.mealPeriodIds ?? [] }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("updateMenuItem:", j.error); }
    }).catch((e) => console.error("updateMenuItem:", e));
  };

  // Dedicated stock writer. The general PUT above strips stock fields, so
  // admin's stale form snapshot can't clobber the live counter that sales
  // are decrementing. Stock changes must go through this path.
  const updateMenuItemStock = (
    id: string,
    payload: { mode: "qty"; stockQty: number } | { mode: "manual"; stockStatus: "in_stock" | "low_stock" | "out_of_stock" },
  ) => {
    // Optimistic local update so the admin grid reflects the change immediately.
    setMenuItems((prev) => prev.map((m) => {
      if (m.id !== id) return m;
      return payload.mode === "qty"
        ? { ...m, stockQty: payload.stockQty, stockStatus: undefined, trackStock: true }
        : { ...m, stockQty: undefined, stockStatus: payload.stockStatus, trackStock: false };
    }));
    fetch(`/api/admin/menu/${id}/stock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("updateMenuItemStock:", j.error); }
    }).catch((e) => console.error("updateMenuItemStock:", e));
  };

  const deleteMenuItem = (id: string) => {
    setMenuItems((prev) => prev.filter((m) => m.id !== id));
    fetch(`/api/admin/menu/${id}`, { method: "DELETE" })
      .then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("deleteMenuItem:", j.error); }
      }).catch((e) => console.error("deleteMenuItem:", e));
  };

  // ─── Customer & order actions ──────────────────────────────────────────────

  const addCustomer = async (customer: Customer, password?: string): Promise<void> => {
    // Optimistic insert so the new row appears immediately (admin realtime does
    // not receive customer INSERTs — anon has no SELECT on the table).
    setCustomers((prev) => [...prev, customer]);
    // Mark admin-created customers verified so they can sign in straight away;
    // the create schema doesn't accept a password, so it's set via the
    // dedicated route below.
    const res = await fetch("/api/admin/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...customerToRow(customer), email_verified: true }),
    });
    const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!res.ok || !j.ok) {
      // Roll back the optimistic add so a failed create doesn't linger in the UI.
      setCustomers((prev) => prev.filter((c) => c.id !== customer.id));
      throw new Error(j.error ?? "Failed to add customer.");
    }
    if (password && password.trim()) {
      const pr = await fetch(`/api/admin/customers/${customer.id}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const pj = await pr.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!pr.ok || !pj.ok) {
        // The customer exists; only the password failed. Surface it so the admin
        // can retry via the per-customer "Set password" control.
        throw new Error(pj.error ?? "Customer created, but setting the password failed. Use “Set password” on the customer to try again.");
      }
    }
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

  const addOrder = async (customerId: string, order: Order): Promise<{ ok: boolean; error?: string }> => {
    // Optimistic insert — also handles the race where the customer isn't in state
    // yet (e.g. new registration before the Realtime INSERT event fires).
    setCustomers((prev) => {
      const exists = prev.some((c) => c.id === customerId);
      if (exists) {
        return prev.map((c) => (c.id === customerId ? { ...c, orders: [order, ...c.orders] } : c));
      }
      // Customer missing from state — add using currentUser snapshot so the
      // account page can read the order immediately without waiting for Realtime.
      const snap = currentUser && currentUser.id === customerId ? currentUser : null;
      return snap ? [...prev, { ...snap, orders: [order, ...(snap.orders ?? [])] }] : prev;
    });
    setCurrentUser((prev) =>
      prev && prev.id === customerId ? { ...prev, orders: [order, ...prev.orders] } : prev
    );

    const rollback = () => {
      setCustomers((prev) =>
        prev.map((c) => c.id !== customerId ? c : { ...c, orders: c.orders.filter((o) => o.id !== order.id) })
      );
      setCurrentUser((prev) =>
        prev && prev.id === customerId ? { ...prev, orders: prev.orders.filter((o) => o.id !== order.id) } : prev
      );
    };

    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderToRow(order)),
      });
      const j = await r.json() as { ok: boolean; error?: string; orderId?: string; total?: number };
      if (!j.ok) { rollback(); return { ok: false, error: j.error }; }
      // Patch the optimistic entry with the server-authoritative total so the UI
      // shows the correct amount immediately — no need to wait for refreshCurrentUser.
      if (j.total !== undefined) {
        const patch = (orders: Order[]) =>
          orders.map((o) => o.id === order.id ? { ...o, total: j.total! } : o);
        setCurrentUser((prev) =>
          prev && prev.id === customerId ? { ...prev, orders: patch(prev.orders) } : prev
        );
        setCustomers((prev) =>
          prev.map((c) => c.id !== customerId ? c : { ...c, orders: patch(c.orders) })
        );
      }
      // Background sync — pulls the full server representation (items, fees, etc.)
      // and merges with any local-only optimistic entries.
      refreshCurrentUser().catch(() => {});
      return { ok: true };
    } catch {
      rollback();
      return { ok: false, error: "Connection error. Please try again." };
    }
  };

  const addRefund = (customerId: string, orderId: string, refund: Refund, newStatus?: OrderStatus) => {
    const currentOrder = customers
      .find((c) => c.id === customerId)
      ?.orders.find((o) => o.id === orderId);
    if (!currentOrder) return;

    const newRefunds = [...(currentOrder.refunds ?? []), refund];
    const newRefundedAmount = (currentOrder.refundedAmount ?? 0) + refund.amount;
    // A refund updates payment state only — the order keeps its fulfillment
    // status. `paymentStatus` is the source of truth for refunds.
    const newPaymentStatus: PaymentStatus =
      newRefundedAmount >= currentOrder.total ? "refunded" : "partially_refunded";
    // Callers can flip the fulfillment status in the same write (refund + cancel).
    // Default: preserve the current status — a refund alone never moves it.
    const nextStatus: OrderStatus = newStatus ?? currentOrder.status;

    const patchOrder = (o: Order): Order =>
      o.id !== orderId
        ? o
        : { ...o, status: nextStatus, refunds: newRefunds, refundedAmount: newRefundedAmount, paymentStatus: newPaymentStatus };

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
        // Usually preserves fulfillment status (the refund is reflected in
        // payment_status); refund + cancel passes "cancelled" here so the two
        // changes land in one atomic order update.
        newStatus:       nextStatus,
        refunds:         newRefunds,
        refundedAmount:  newRefundedAmount,
        ...storeCreditPayload,
      }),
    }).then(async (r) => {
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; console.error("addRefund:", j.error); }
    }).catch((e) => console.error("addRefund:", e));
  };

  // Pure-local mirror of the optimistic-update half of spendStoreCredit.
  // Used by the card / PayPal checkout paths where the order hasn't been
  // inserted yet (the webhook does that asynchronously) — calling the
  // server-side endpoint here would 404. The actual balance deduction is
  // handled by the webhook on insert; this just keeps the UI in sync.
  const applyStoreCreditOptimistic = (customerId: string, amount: number) => {
    setCurrentUser((prev) => {
      if (!prev || prev.id !== customerId) return prev;
      const newBalance = Math.max(0, (prev.storeCredit ?? 0) - amount);
      return { ...prev, storeCredit: newBalance };
    });
    setCustomers((prev) => prev.map((c) => {
      if (c.id !== customerId) return c;
      const newBalance = Math.max(0, (c.storeCredit ?? 0) - amount);
      return { ...c, storeCredit: newBalance };
    }));
  };

  const spendStoreCredit = (customerId: string, amount: number, orderId: string) => {
    // Optimistic local update: use currentUser as the source of truth on the
    // customer site (customers[] may be empty for non-admin surfaces now).
    setCurrentUser((prev) => {
      if (!prev || prev.id !== customerId) return prev;
      const newBalance = Math.max(0, (prev.storeCredit ?? 0) - amount);
      return { ...prev, storeCredit: newBalance };
    });
    setCustomers((prev) => prev.map((c) => {
      if (c.id !== customerId) return c;
      const newBalance = Math.max(0, (c.storeCredit ?? 0) - amount);
      return { ...c, storeCredit: newBalance };
    }));
    // Server is authoritative: it verifies ownership, idempotency (per-order),
    // and caps the deduction at order.total and customer.storeCredit.
    fetch(`/api/customers/${customerId}/spend-credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, order_id: orderId }),
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
    // Guard against the next poll(s) overwriting our optimistic value with a
    // stale snapshot whose GET was issued before the PUT below commits. The
    // entry stays until loadAllCustomers sees the server reflect this status,
    // or the TTL expires (12 s — one full 8 s poll cycle plus margin).
    pendingOrderStatusRef.current.set(orderId, { status, until: Date.now() + 12_000 });
    fetch(`/api/admin/orders/${orderId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(async (r) => {
      if (!r.ok) {
        // Drop the guard so the next poll reconciles to the real server state.
        pendingOrderStatusRef.current.delete(orderId);
        const j = await r.json().catch(() => ({})) as { error?: string };
        console.error("updateOrderStatus:", j.error);
      }
    }).catch((e) => {
      pendingOrderStatusRef.current.delete(orderId);
      console.error("updateOrderStatus:", e);
    });
  };

  // ─── Refresh current user from server ────────────────────────────────────
  // Merges server orders with any optimistic orders not yet confirmed in the DB.
  // This prevents a race where an in-flight optimistic order is overwritten by a
  // server response that was fetched before the DB commit landed.

  const refreshCurrentUser = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; customer?: Customer };
      if (!json?.ok || !json.customer) return;
      const serverOrders: Order[] = json.customer.orders ?? [];
      const serverIds = new Set(serverOrders.map((o) => o.id));

      // Functional update: merge server state with any local-only optimistic orders
      setCurrentUser((prev) => {
        const localOnly: Order[] = prev
          ? prev.orders.filter((o) => !serverIds.has(o.id))
          : [];
        return {
          ...json.customer!,
          orders: [...localOnly, ...serverOrders].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          ),
        };
      });

      setCustomers((prev) => {
        const idx = prev.findIndex((c) => c.id === json.customer!.id);
        if (idx >= 0) {
          return prev.map((c) => c.id !== json.customer!.id ? c : {
            ...c,
            orders:        serverOrders,
            storeCredit:   json.customer!.storeCredit,
            tags:          json.customer!.tags,
            savedAddresses: json.customer!.savedAddresses,
          });
        }
        return [...prev, { ...json.customer!, orders: serverOrders }];
      });
    } catch { /* network error — silently ignore */ }
  }, []); // setCurrentUser / setCustomers are stable setState refs

  // ─── Admin/driver/staff: load the full customers list via authenticated API.
  // The customer site MUST NOT call this — it's gated server-side to admin.
  const loadAllCustomers = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch("/api/admin/customers/list", { cache: "no-store" });
      if (!r.ok) {
        return { ok: false, error: r.status === 401 ? "Unauthorized" : `HTTP ${r.status}` };
      }
      const json = await r.json() as { ok: boolean; customers?: Customer[]; error?: string };
      if (!json.ok || !json.customers) return { ok: false, error: json.error ?? "Bad response" };
      // Preserve in-flight optimistic status changes when the server snapshot
      // is still stale. Without this, the kanban card briefly jumps back to
      // its previous column before the next poll arrives with fresh data.
      const pending = pendingOrderStatusRef.current;
      const now = Date.now();
      const merged = pending.size === 0 ? json.customers : json.customers.map((c) => ({
        ...c,
        orders: c.orders.map((o) => {
          const p = pending.get(o.id);
          if (!p) return o;
          if (p.until < now || o.status === p.status) {
            // TTL elapsed, or server caught up — drop the guard and trust server.
            pending.delete(o.id);
            return o;
          }
          // Server is still serving pre-mutation data — keep optimistic status.
          return { ...o, status: p.status };
        }),
      }));
      setCustomers(merged);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }, []);

  // ─── Auth ─────────────────────────────────────────────────────────────────

  const login = async (
    email: string, password: string,
  ): Promise<{ ok: boolean; needsVerification?: boolean; email?: string; error?: string }> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json() as {
        ok: boolean;
        customer?: Customer;
        error?: string;
        needsVerification?: boolean;
        email?: string;
      };
      if (json.ok && json.customer) {
        setCurrentUser({ ...json.customer, orders: json.customer.orders ?? [] });
        return { ok: true };
      }
      return {
        ok: false,
        needsVerification: json.needsVerification,
        email: json.email,
        error: json.error,
      };
    } catch {
      return { ok: false, error: "Connection error. Please try again." };
    }
  };

  const register = async (
    name: string, email: string, phone: string, password: string,
  ): Promise<{ success: boolean; error?: string; needsVerification?: boolean; email?: string }> => {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name, email, phone, password, createdAt }),
      });
      const json = await res.json() as {
        ok: boolean;
        error?: string;
        requiresVerification?: boolean;
        email?: string;
      };
      if (!json.ok) return { success: false, error: json.error ?? "Registration failed." };

      // When the migration is in place the server holds back the session
      // cookie until /api/auth/verify-email is hit — do NOT auto-login the
      // user here, just surface needsVerification so the UI can show
      // "check your inbox".
      if (json.requiresVerification) {
        return { success: true, needsVerification: true, email: json.email ?? email };
      }

      // Pre-migration fallback path — cookie was set server-side, mirror the
      // user into local state so the account page can render immediately.
      const newCustomer: Customer = {
        id, name, email, phone, createdAt, tags: [], orders: [], favourites: [], savedAddresses: [],
      };
      setCustomers((prev) => [...prev, newCustomer]);
      setCurrentUser(newCustomer);
      return { success: true };
    } catch {
      return { success: false, error: "Connection error. Please try again." };
    }
  };

  const logout = async (): Promise<void> => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
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
    const result = validateCouponCode(code, subtotal, settings.coupons ?? [], settings.currency?.symbol ?? "£");
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

  const driverLogout = () => {
    fetch("/api/auth/driver/logout", { method: "POST" }).catch(() => {});
    setCurrentDriver(null);
    localStorage.removeItem("sg_driver_session");
  };

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

  const updateDeliveryStatus = async (
    customerId: string,
    orderId: string,
    status: DeliveryStatus,
    code?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    const orderPatch: Partial<Order> = {
      deliveryStatus: status,
      ...(status === "delivered" ? { status: "delivered" as OrderStatus } : {}),
    };
    const patchOrders = (orders: Order[]) =>
      orders.map((o) => (o.id === orderId ? { ...o, ...orderPatch } : o));
    const applyOptimistic = () => {
      setCustomers((prev) => prev.map((c) =>
        c.id !== customerId ? c : { ...c, orders: patchOrders(c.orders) }
      ));
      setCurrentUser((prev) =>
        prev && prev.id === customerId ? { ...prev, orders: patchOrders(prev.orders) } : prev
      );
    };

    // For pickup / on-the-way, the optimistic update is safe — the server
    // can only reject these for the "kitchen not ready" guard, which the UI
    // already prevents. For "delivered" we wait for the server first because
    // it may reject the delivery code; flipping the row to delivered locally
    // before confirmation would leave a stale UI on a wrong-PIN attempt.
    if (status !== "delivered") applyOptimistic();

    const body: Record<string, string> = { delivery_status: status };
    if (status === "delivered") body.status = "delivered";
    if (code) body.delivery_code = code;

    try {
      const r = await fetch(`/api/admin/orders/${orderId}/driver`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        console.error("updateDeliveryStatus:", j.error);
        return { ok: false, error: j.error ?? "Failed to update delivery status." };
      }
      if (status === "delivered") applyOptimistic();
      return { ok: true };
    } catch (e) {
      console.error("updateDeliveryStatus:", e);
      return { ok: false, error: "Network error — please try again." };
    }
  };

  // ─── Meal periods ──────────────────────────────────────────────────────────
  // CRUD methods talk to the /api/admin/meal-periods routes. Local state is
  // updated optimistically; the Realtime subscription on `meal_periods`
  // reconciles any divergence.

  function periodToRow(p: MealPeriod | (Omit<MealPeriod, "id"> & { id?: string })) {
    const row: Record<string, unknown> = {
      name: p.name,
      enabled: p.enabled,
      start_time: p.startTime,
      end_time: p.endTime,
      days_of_week: p.daysOfWeek,
      sort_order: p.sortOrder,
      theme_color: p.themeColor,
    };
    if ("id" in p && p.id) row.id = p.id;
    return row;
  }

  const addMealPeriod = async (
    period: Omit<MealPeriod, "id"> & { id?: string },
  ): Promise<{ ok: boolean; mealPeriod?: MealPeriod; error?: string }> => {
    try {
      const r = await fetch("/api/admin/meal-periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(periodToRow(period)),
      });
      const j = await r.json().catch(() => ({})) as { ok: boolean; mealPeriod?: unknown; error?: string };
      if (!r.ok || !j.ok) return { ok: false, error: j.error ?? "Failed to add meal period" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = mapMealPeriod(j.mealPeriod as any);
      setMealPeriods((prev) => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder));
      return { ok: true, mealPeriod: created };
    } catch (e) {
      console.error("addMealPeriod:", e);
      return { ok: false, error: "Network error" };
    }
  };

  const updateMealPeriod = async (
    id: string,
    patch: Partial<Omit<MealPeriod, "id">>,
  ): Promise<{ ok: boolean; error?: string }> => {
    setMealPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    try {
      const body: Record<string, unknown> = {};
      if (patch.name        !== undefined) body.name         = patch.name;
      if (patch.enabled     !== undefined) body.enabled      = patch.enabled;
      if (patch.startTime   !== undefined) body.start_time   = patch.startTime;
      if (patch.endTime     !== undefined) body.end_time     = patch.endTime;
      if (patch.daysOfWeek  !== undefined) body.days_of_week = patch.daysOfWeek;
      if (patch.sortOrder   !== undefined) body.sort_order   = patch.sortOrder;
      if (patch.themeColor  !== undefined) body.theme_color  = patch.themeColor;
      const r = await fetch(`/api/admin/meal-periods/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({})) as { ok: boolean; error?: string };
      if (!r.ok || !j.ok) return { ok: false, error: j.error ?? "Failed to update meal period" };
      return { ok: true };
    } catch (e) {
      console.error("updateMealPeriod:", e);
      return { ok: false, error: "Network error" };
    }
  };

  const deleteMealPeriod = async (id: string): Promise<{ ok: boolean; error?: string }> => {
    setMealPeriods((prev) => prev.filter((p) => p.id !== id));
    // Cascade in DB drops the join rows, but the optimistic state needs the
    // same cleanup so the customer page stops sectioning by the dead period.
    setMenuItems((prev) => prev.map((m) => ({
      ...m,
      mealPeriodIds: (m.mealPeriodIds ?? []).filter((x) => x !== id),
    })));
    try {
      const r = await fetch(`/api/admin/meal-periods/${id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({})) as { ok: boolean; error?: string };
      if (!r.ok || !j.ok) return { ok: false, error: j.error ?? "Failed to delete meal period" };
      return { ok: true };
    } catch (e) {
      console.error("deleteMealPeriod:", e);
      return { ok: false, error: "Network error" };
    }
  };

  const reorderMealPeriods = async (
    periods: MealPeriod[],
  ): Promise<{ ok: boolean; error?: string }> => {
    const renumbered = periods.map((p, i) => ({ ...p, sortOrder: i }));
    setMealPeriods(renumbered);
    try {
      await Promise.all(renumbered.map((p) =>
        fetch(`/api/admin/meal-periods/${p.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: p.sortOrder }),
        })
      ));
      return { ok: true };
    } catch (e) {
      console.error("reorderMealPeriods:", e);
      return { ok: false, error: "Network error" };
    }
  };

  // ─── Derived values ────────────────────────────────────────────────────────

  // Cart-level offers (bogo/multibuy/qty_discount) snapshotted on each line
  // adjust the line total; per-unit offers are already in i.price. See
  // src/lib/menuOfferUtils.ts. Falls back to plain qty*price when no offer.
  const cartTotal = cartSubtotal(cart);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  return (
    <AppContext.Provider
      value={{
        cart, addToCart, removeFromCart, updateQty, clearCart, cartTotal, cartCount,
        settings, updateSettings, refreshDiningTables, isOpen,
        fulfillment, setFulfillment, scheduledTime, setScheduledTime,
        categories, menuItems,
        addCategory, updateCategory, deleteCategory, reorderCategories,
        addMenuItem, updateMenuItem, updateMenuItemStock, deleteMenuItem,
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
        currentDriver, driverAuthChecked, driverLogin, driverLogout,
        addDriver, updateDriver, deleteDriver, toggleDriver,
        assignDriverToOrder, updateDeliveryStatus, addRefund, spendStoreCredit, applyStoreCreditOptimistic,
        mealPeriods, addMealPeriod, updateMealPeriod, deleteMealPeriod, reorderMealPeriods,
        refreshCurrentUser,
        loadAllCustomers,
      }}
    >
      <SeoHead settings={settings} />
      <div className="flex flex-col h-[100dvh] w-full overflow-hidden">
        <EmailVerificationBanner currentUser={currentUser} />
        <div className="flex-1 w-full min-h-0 relative">
          {children}
        </div>
      </div>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
