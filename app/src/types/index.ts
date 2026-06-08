export interface DietaryTag {
  label: string;
  color: string;
}

export interface AddOn {
  id: string;
  name: string;
  price: number;
}

export interface Variation {
  id: string;
  name: string;
  /** When false the customer can skip this variation. Defaults to true for
   *  backward-compat with existing data that pre-dates this field. */
  required?: boolean;
  options: { id: string; label: string; price: number }[];
}

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

/** A time-bounded section on the customer menu (e.g. Breakfast, Lunch,
 *  Dinner, Sunday Brunch). Admin-managed; many-to-many with menu items. */
export interface MealPeriod {
  id: string;
  name: string;
  enabled: boolean;
  startTime: string;        // "HH:MM"
  endTime: string;          // "HH:MM"
  daysOfWeek: number[];     // 0=Sun..6=Sat
  sortOrder: number;
  themeColor: string;
}

// ─── Menu item offers (POS + customer site) ─────────────────────────────────
// Six offer types mirror the original POSOffer model so the offer system is
// shared between admin and POS. Per-unit offers (percent/fixed/price) discount
// each unit; cart-level offers (bogo/multibuy/qty_discount) discount based on
// quantity. See `getOfferPrice` / `cartLineTotal` in src/types/pos.ts.
export type MenuItemOfferType =
  | "percent"       // % off per unit
  | "fixed"         // fixed amount off per unit
  | "price"         // override to a special price per unit
  | "bogo"          // buy X get Y free
  | "multibuy"      // buy X for a bundle price
  | "qty_discount"; // buy ≥ minQty, get value% off each

/** Channel the item / offer applies to. POS + waiter both use 'in_store'. */
export type MenuChannel = "in_store" | "online";

export interface MenuItemOffer {
  type: MenuItemOfferType;
  value: number;        // % for percent/qty_discount; £ for fixed/price/multibuy
  label?: string;       // custom badge text, e.g. "Happy Hour"
  active: boolean;
  startDate?: string;   // YYYY-MM-DD (inclusive)
  endDate?: string;     // YYYY-MM-DD (inclusive)
  buyQty?: number;      // bogo, multibuy
  freeQty?: number;     // bogo
  minQty?: number;      // qty_discount
  /** Channels the offer applies to. Undefined / empty = "wherever the item
   *  appears" (i.e. inherits the item's own channels). Use this to run an
   *  online-only promo on an item that's sold both online and in-store. */
  channels?: MenuChannel[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  /** POS-only cost price for margin tracking. Optional. */
  cost?: number;
  /** Stock keeping unit — surfaced in both admin + POS. Optional. */
  sku?: string;
  /** Image URL or data URI. Maps to `imageUrl` on the POS side. */
  image?: string;
  /** POS tile fallback when no image is set. */
  emoji?: string;
  /** POS tile accent colour (hex). */
  color?: string;
  dietary: string[];
  popular?: boolean;
  /** When false the item is hidden from the menu (POS toggle). Defaults to
   *  true if undefined so legacy rows without the column stay visible. */
  active?: boolean;
  variations?: Variation[];
  addOns?: AddOn[];
  /** When set, stock is quantity-tracked. 0 = out of stock. */
  stockQty?: number;
  /** Manual status override — used when stockQty is not set. */
  stockStatus?: StockStatus;
  /** Explicit POS "track stock" flag. When true, stockQty drives availability;
   *  when false/undefined, stockStatus does. Defaults to false. */
  trackStock?: boolean;
  /** Optional product offer (shared between POS and customer site). */
  offer?: MenuItemOffer;
  /** IDs of the meal periods this item appears in. Empty = "anytime" item,
   *  shown in the main grid regardless of time of day. Admin-only — POS
   *  intentionally does not surface meal-period editing. */
  mealPeriodIds?: string[];
  /** Which storefronts surface this item. POS + waiter share 'in_store';
   *  the customer site is 'online'. Defaults to both for legacy rows. */
  channels?: MenuChannel[];
  /** Optional override for the customer site only. POS / waiter always use
   *  `price`. Null / undefined → customer site falls back to `price` too. */
  priceOnline?: number;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  parentId?: string | null;
  sort_order?: number;
}

export interface CartItem {
  id: string; // unique uuid per cart line
  menuItemId: string;
  name: string;
  price: number; // base + selected variation + add-ons (per-unit offer already applied)
  quantity: number;
  /**
   * @deprecated Use `selectedVariations[]` for new data — a menu item can have
   * multiple variation groups (e.g. Size + Spice level). Kept here so older
   * persisted carts / orders that only ever recorded one selection still work.
   */
  selectedVariation?: { variationId: string; optionId: string; label: string };
  /** All variation-group selections for this cart line. New code should write
   *  to this field; legacy `selectedVariation` is read as a fallback. */
  selectedVariations?: { variationId: string; optionId: string; label: string }[];
  selectedAddOns?: { id: string; name: string; price: number }[];
  specialInstructions?: string;
  /** Snapshot of the menu item's offer at add-to-cart time. Used for
   *  cart-level offers (bogo/multibuy/qty_discount) so a mid-cart admin
   *  change does not retroactively rewrite an existing line. Per-unit
   *  offers are already baked into `price` and don't need the snapshot. */
  offer?: MenuItemOffer;
}

export interface DaySchedule {
  open: string;  // "09:00"
  close: string; // "22:00"
  closed: boolean;
}

export type WeekSchedule = {
  [day: string]: DaySchedule;
};

export interface RestaurantInfo {
  name: string;
  tagline: string;
  coverImage: string;
  logoImage: string;
  hygieneRating: number;
  /** When false, the hygiene badge is hidden from the customer site. Defaults to true. */
  hygieneRatingVisible?: boolean;
  deliveryTime: number;   // minutes
  collectionTime: number; // minutes
  minOrder: number;       // £
  deliveryFee: number;    // £
  serviceFee: number;     // %
  // Structured address (used for display, distance calculations, and admin editing)
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postcode: string;
  country: string;
  /** @deprecated use structured fields above — kept for backward compat with old localStorage snapshots */
  address?: string;
  phone: string;
  lat: number;            // GPS latitude  (for distance calculations)
  lng: number;            // GPS longitude
}

// Delivery distance restriction attached to each payment method
export interface PaymentMethodDeliveryRange {
  restricted: boolean;   // false = available everywhere
  minKm: number;
  maxKm: number;
}

// A named concentric delivery zone around the restaurant
export interface DeliveryZone {
  id: string;
  name: string;
  minRadiusKm: number;   // inner boundary (0 for the closest zone)
  maxRadiusKm: number;   // outer boundary
  fee: number;           // delivery fee for this zone (£)
  enabled: boolean;
  color: string;         // hex, used in visualisation and UI
}

export type PaymentMethodId = "stripe" | "paypal" | "cash" | string;

export interface PaymentMethod {
  id: PaymentMethodId;
  name: string;
  description: string;               // shown to customer at checkout
  adminNote: string;                 // internal note (e.g. "Pay on delivery")
  enabled: boolean;
  builtIn: boolean;                  // true = cannot be deleted
  order: number;                     // display order (lower = first)
  deliveryRange: PaymentMethodDeliveryRange; // distance restriction at checkout
}

export interface AuditEntry {
  id: string;
  timestamp: string;         // ISO
  action: string;            // e.g. "Enabled Stripe", "Disabled Cash"
  actor: string;             // "Admin"
}

export interface SeoSettings {
  metaTitle: string;        // page <title> — recommended ≤ 60 chars
  metaDescription: string;  // meta description — recommended ≤ 160 chars
  metaKeywords: string;     // comma-separated keywords
  ogImage: string;          // absolute URL for og:image (social share preview)
  siteUrl: string;          // canonical base URL, e.g. https://demo.directdine.tech
  faviconUrl: string;       // custom favicon — data URL or absolute URL
  faviconVersion?: string;  // cache-bust token for favicon (forces browser to re-read on change)
}

/**
 * @deprecated Footer pages have been merged into `CustomPage`. New code should
 * use `CustomPage` exclusively. This shape is kept for backward compatibility
 * with old localStorage snapshots and the one-time migration in
 * `buildSettingsFromData` (AppContext) that converts any remaining
 * `footerPages` entries into `customPages`.
 */
export interface FooterPage {
  slug: string;         // URL segment: "about-us", "terms", etc.
  title: string;        // Displayed in footer nav and as page heading
  content: string;      // Rich HTML — editable in admin
  enabled: boolean;     // Whether the link appears in the footer
  lastModified: string; // ISO date
}

export type EmailTemplateEvent =
  | "order_confirmation"
  | "order_confirmed"
  | "order_preparing"
  | "order_ready"
  | "order_delivered"
  | "order_cancelled"
  | "reservation_confirmation"
  | "reservation_update"
  | "reservation_cancellation"
  | "reservation_check_in"
  | "reservation_review_request"
  | "gift_card_delivered";

export interface EmailTemplate {
  event: EmailTemplateEvent;
  name: string;
  subject: string;        // may contain {{variables}}
  body: string;           // HTML; may contain {{variables}}
  enabled: boolean;
  lastModified: string;   // ISO date
}

export interface MenuLink {
  id: string;
  label: string;       // display text shown in nav
  href: string;        // root-relative path, e.g. "/our-story"
  location: "header" | "footer";
  order: number;       // ascending sort index within that location
  active: boolean;     // hidden when false
}

export interface CustomPage {
  id: string;           // uuid
  title: string;        // Page heading and nav label
  slug: string;         // URL segment — no leading slash, e.g. "our-story"
  content: string;      // Rich HTML — editable in admin
  seoTitle: string;     // <title> override for this page (≤ 60 chars)
  seoDescription: string; // <meta description> (≤ 160 chars)
  published: boolean;   // false = not accessible on the frontend
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
}

export interface PrinterSettings {
  enabled: boolean;
  name: string;              // display label, e.g. "Kitchen Printer"
  connection: "network" | "usb" | "bluetooth" | "browser";
  ip: string;                // primary printer IP (network mode)
  port: number;              // TCP port — Epson/Star default: 9100
  bluetoothAddress: string;  // BT device MAC, e.g. "AA:BB:CC:DD:EE:FF"
  bluetoothName: string;     // BT device display name
  autoPrint: boolean;        // send receipt automatically on new order
  paperWidth: number;        // chars per line: 48 = 80 mm, 32 = 58 mm
  /**
   * Optional allowlist of IPs the /api/print server proxy is permitted to
   * forward bytes to. When empty, /api/print falls back to allowing only
   * the primary `ip` field. Set this to add extra printers (e.g. kitchen
   * bar printer + counter receipt printer) without weakening the proxy.
   */
  allowedIps?: string[];
}

export interface FooterLogo {
  id: string;
  label: string;     // alt text / tooltip
  imageUrl: string;  // hosted URL or base64 data URI
  href?: string;     // optional click-through link
  enabled: boolean;
  order: number;
}

export interface ColorSettings {
  primaryColor: string;    // hex — brand accent (maps to the full orange-* scale)
  backgroundColor: string; // hex — page background
}

export interface TaxSettings {
  enabled: boolean;       // master on/off
  rate: number;           // VAT percentage, e.g. 20
  inclusive: boolean;     // true  = prices already include VAT (show extracted amount)
                          // false = VAT is added on top at checkout
  showBreakdown: boolean; // show the VAT line on cart, checkout, receipts, and emails
}

export interface CurrencySettings {
  code: string;   // ISO 4217 — "GBP", "USD", "EUR", "LKR"…
  symbol: string; // "£", "$", "€", "Rs."
}

export type CouponType = "percentage" | "fixed";

export interface Coupon {
  id: string;
  code: string;           // uppercase, alphanumeric-dash
  type: CouponType;
  value: number;          // % (0–100) for percentage; £ amount for fixed
  minOrderAmount: number; // minimum cart subtotal — 0 = no minimum
  expiryDate: string;     // ISO date string — "" = never expires
  usageLimit: number;     // 0 = unlimited
  usageCount: number;     // number of times successfully redeemed
  active: boolean;
  createdAt: string;      // ISO
}

export interface ReceiptSettings {
  showLogo: boolean;
  logoUrl: string;            // URL / base64 shown on printed & on-screen receipts
  restaurantName: string;     // receipt-specific name (can differ from main brand)
  phone: string;
  website: string;
  email: string;
  vatNumber: string;          // e.g. "GB 123 4567 89"
  thankYouMessage: string;    // bottom of receipt
  customMessage: string;      // optional extra line at bottom
}


export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export interface Reservation {
  id: string;
  tableId: string;
  tableLabel: string;
  tableSeats: number;
  section: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  date: string;           // "YYYY-MM-DD"
  time: string;           // "HH:MM"
  partySize: number;
  status: ReservationStatus;
  note?: string;
  createdAt: string;
  checkedInAt?: string;   // ISO timestamp set when staff check-in
  checkedOutAt?: string;  // ISO timestamp set when staff check-out
  source?: string;        // "online" | "walk-in" | "phone" | "other"
  cancelToken?: string;   // UUID for guest self-service cancel link
  vipFee?: number;        // booking fee charged for a VIP table (0 / absent for normal tables)
  paymentStatus?: "none" | "paid";  // "paid" once the VIP booking fee is collected
  paymentMethod?: string; // "stripe" | "paypal" (online) | "cash" | "card" (POS/admin)
  paymentRef?: string;    // gateway id or till receipt reference
}

export interface ReservationCustomer {
  id: string;
  email: string;
  name: string;
  phone: string;
  visitCount: number;
  firstVisitAt?: string;
  lastVisitAt?: string;
  /** Number of online food orders placed */
  orderCount: number;
  /** Cumulative spend from online food orders (£) */
  totalSpend: number;
  /** ISO timestamp of the most recent online order */
  lastOrderAt?: string;
  tags: string[];
  notes: string;
  marketingOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationSystem {
  enabled: boolean;
  slotDurationMinutes: number;   // how long one booking occupies the table
  maxAdvanceDays: number;        // how far ahead customers can book
  openTime: string;              // "12:00"
  closeTime: string;             // "22:00"
  slotIntervalMinutes: number;   // step between bookable slots, e.g. 30
  maxPartySize: number;          // maximum guests per booking (default 10)
  blackoutDates: string[];       // "YYYY-MM-DD" dates the restaurant is closed
  reviewUrl?: string;            // Google Maps / TripAdvisor review link
  floorPlanImageUrl?: string;    // public URL of the floor-plan map shown on the booking page (Storage bucket "floor-plan"); empty = no map, booking uses the card list
  floorPlanMarkerScale?: number; // admin-chosen size multiplier for the table markers on the floor-plan map (1 = default). Applies to the editor + customer map.
}

export interface WaitlistEntry {
  id: string;
  date: string;
  time: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
  notifiedAt?: string;
  createdAt: string;
}

export interface WaiterStaff {
  id: string;
  name: string;
  pin: string;
  role: "senior" | "waiter";
  active: boolean;
  avatarColor: string;
  createdAt: string;
}

export type KitchenRole = "chef" | "head_chef" | "kitchen_manager";

export interface KitchenStaff {
  id: string;
  name: string;
  pin: string;
  role: KitchenRole;
  active: boolean;
  avatarColor: string;
  createdAt: string;
}

export interface DiningTable {
  id: string;
  /** Legacy numeric identifier — kept for DB compatibility but not surfaced in the UI. `label` is the human-readable identifier used everywhere. */
  number?: number | null;
  label: string;    // e.g. "T1", "Bar 2", "Terrace A"
  seats: number;
  section: string;  // e.g. "Main Hall", "Terrace"
  active: boolean;
  /** Premium table — shows a crown + special styling everywhere and charges a non-refundable booking fee at reservation time. */
  isVip?: boolean;
  /** The booking fee (in the store currency) charged to reserve this table. 0 / absent for normal tables. */
  vipPrice?: number;
  /** Position on the customer-facing floor-plan map, as a 0..1 fraction of the plan image's width/height. null / absent = not placed yet (falls back to the card list). */
  posX?: number | null;
  posY?: number | null;
}

export interface AdminSettings {
  coupons: Coupon[];
  taxSettings: TaxSettings;
  restaurant: RestaurantInfo;
  loyaltyPointsPerPound: number; // points per £ spent
  loyaltyPointsValue: number;    // £ value per point (e.g. 0.01)
  schedule: WeekSchedule;
  manualClosed: boolean;
  /** Stripe publishable key — safe to expose to the browser. */
  stripePublicKey: string;
  // stripeSecretKey → STRIPE_SECRET_KEY env var (server-side only)
  // paypalClientId  → PAYPAL_CLIENT_ID env var  (server-side only)
  // smtpHost/Port/User/Password → SMTP_HOST/PORT/USER/PASS env vars
  paymentMethods: PaymentMethod[];
  paymentAuditLog: AuditEntry[];
  deliveryZones: DeliveryZone[];
  seo: SeoSettings;
  customHeadCode: string;   // raw HTML injected into <head> (analytics, verification tags, etc.)
  printer: PrinterSettings;
  emailTemplates: EmailTemplate[];
  /**
   * @deprecated Merged into `customPages`. The AppContext migration converts
   * any remaining entries into `customPages` and resets this to `[]` on load,
   * so consumers should treat this as always empty in new code.
   */
  footerPages: FooterPage[];
  footerCopyright: string;
  customPages: CustomPage[];
  menuLinks: MenuLink[];
  colors: ColorSettings;
  footerLogos: FooterLogo[];
  receiptSettings: ReceiptSettings;
  waiters: WaiterStaff[];
  kitchenStaff: KitchenStaff[];
  diningTables: DiningTable[];
  reservationSystem: ReservationSystem;
  currency: CurrencySettings;
  giftCardSettings: GiftCardSettings;
}

export interface GiftCardSettings {
  /** Master switch — when false, the public purchase page + checkout option
   *  are hidden and /api/gift-cards/intent rejects with 503. */
  enabled: boolean;
  /** Quick-pick amounts on the purchase page. */
  presets: number[];
  /** Min / max custom amount a customer can buy. */
  minAmount: number;
  maxAmount: number;
  /** Months until a freshly-issued card expires. */
  expiryMonths: number;
}

export type OrderStatus =
  | "pending" | "confirmed" | "preparing" | "ready"
  | "delivered" | "cancelled"
  | "refunded" | "partially_refunded";

export type DeliveryStatus = "assigned" | "picked_up" | "on_the_way" | "delivered";

export type RefundMethod = "original_payment" | "store_credit" | "cash" | "gift_card";

export type PaymentStatus = "unpaid" | "paid" | "refunded" | "partially_refunded" | "failed";

export interface Refund {
  id: string;
  orderId: string;
  amount: number;          // £ amount refunded
  type: "full" | "partial";
  reason: string;          // human-readable reason
  method: RefundMethod;
  note?: string;           // internal admin note
  processedAt: string;     // ISO
  processedBy: string;     // e.g. "Admin"
  /** Stripe refund id when the refund was processed through Stripe. */
  stripeRefundId?: string | null;
  /** PayPal refund id when the refund was processed through PayPal. */
  paypalRefundId?: string | null;
}

export interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  // password is never sent to the browser — stored as a bcrypt hash in the
  // drivers Supabase table and validated server-side via /api/auth/driver.
  active: boolean;
  vehicleInfo?: string; // e.g. "Red Honda Civic – AB12 CDE"
  notes?: string;       // internal admin notes
  createdAt: string;    // ISO
}

export interface OrderLine {
  name: string;
  qty: number;
  price: number;
  menuItemId?: string;
  /** @deprecated Single-group form; new code writes `selectedVariations`. */
  selectedVariation?: { variationId: string; optionId: string; label: string };
  /** All variation-group selections recorded for this order line. */
  selectedVariations?: { variationId: string; optionId: string; label: string }[];
  selectedAddOns?: { id: string; name: string; price: number }[];
  specialInstructions?: string;
}

export interface Order {
  id: string;
  /** Null when the customer account has been deleted (FK set null). The order
   *  row is preserved for financial audit; UI shows "Deleted customer". */
  customerId: string | null;
  date: string;             // ISO string
  status: OrderStatus;
  fulfillment: "delivery" | "collection" | "dine-in";
  total: number;
  items: OrderLine[];
  address?: string;
  note?: string;
  /** Customer pin coordinates captured at checkout. Present only when the
   *  customer placed a pin / used "Detect location" / picked a saved address
   *  that already had coords. Driver UI prefers these over geocoding. */
  customerLat?: number;
  customerLng?: number;
  paymentMethod?: string;   // display name of payment method used
  /** Distinct from `status` (fulfillment). 'unpaid' = cash/COD; 'paid' = Stripe authorised+captured. */
  paymentStatus?: PaymentStatus;
  /** Stripe PaymentIntent id — present on card orders, null on cash. */
  stripePaymentIntentId?: string | null;
  /** Stripe Charge id — pinned at webhook time so refunds know which charge to reverse. */
  stripeChargeId?: string | null;
  deliveryFee?: number;     // delivery fee applied at checkout
  serviceFee?: number;      // service fee (£) applied at checkout
  scheduledTime?: string;   // "ASAP" or a human-readable future slot, e.g. "Monday at 12:30"
  couponCode?: string;      // code that was applied at checkout
  couponDiscount?: number;  // £ discount applied to this order
  vatAmount?: number;       // VAT charged on this order (0 or absent = no VAT)
  vatInclusive?: boolean;   // true = VAT was already in the item prices
  // Driver / delivery leg
  driverId?: string;
  driverName?: string;
  deliveryStatus?: DeliveryStatus;
  /** 4-digit PIN emailed to the customer; driver must enter it to confirm
   *  delivery. Populated only for delivery fulfillment. */
  deliveryCode?: string;
  // Refunds
  refunds?: Refund[];
  refundedAmount?: number;  // cumulative £ refunded so far
  storeCreditUsed?: number; // £ of store credit applied at checkout
  // Gift card redemption — stamped at order insert when the customer typed
  // a code at checkout. The actual balance decrement on gift_cards happens
  // server-side after the order commits.
  giftCardId?: string;
  giftCardUsed?: number;
  /** Transient — set only at checkout so the order POST can forward the code
   *  to the server for lookup. Never persisted/loaded (the server resolves it
   *  to gift_card_id at insert time). */
  giftCardCode?: string;
  // POS-only fields (not set on online orders)
  tipAmount?: number;      // tip collected at the POS terminal
  changeGiven?: number;    // cash change given back to the customer
}

export interface SavedAddress {
  id: string;
  label: string;       // e.g. "Home", "Work"
  address: string;     // full street address
  postcode: string;
  phone?: string;      // optional phone override for this address
  note?: string;       // delivery note / access instructions
  isDefault: boolean;
  createdAt: string;   // ISO
  /** Optional pinned coordinates — set when the customer drops a pin on the map. */
  lat?: number;
  lng?: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  password?: string;      // stored for mock auth (plaintext for demo)
  createdAt: string;      // ISO string
  tags: string[];         // e.g. ["VIP", "Regular"]
  orders: Order[];
  favourites?: string[];      // array of MenuItem ids
  savedAddresses?: SavedAddress[];
  storeCredit?: number;   // £ store credit balance (from refunds)
  emailVerified?: boolean;
  active?: boolean;       // false → login is blocked; admin-toggled
  // ── POS-shared fields ───────────────────────────────────────────────────
  // Persisted on the customers row so admin + POS share the same source of
  // truth. totalSpend/visitCount/lastVisit are computed server-side by the
  // /api/admin/customers/list and /api/pos/customers endpoints (joining
  // orders + pos_sales) and are NOT stored.
  loyaltyPoints?: number;
  giftCardBalance?: number;
  notes?: string;
  totalSpend?: number;       // computed by API (orders + POS sales)
  visitCount?: number;       // computed
  lastVisit?: string;        // ISO, computed
  // This customer's in-person POS sales. Returned by /api/admin/customers/list
  // so admin can see an all-channel order history; the customer site only gets
  // posSpend (the net total) to fold into "Total spent". Both computed, not stored.
  posSales?: CustomerPosSale[];
  posSpend?: number;         // net £ spent at the till (computed), for combining with online spend
}

// A trimmed view of a pos_sales row for display in the admin customer history.
// Mirrors the fields CustomersPanel renders — not the full POSSale.
export interface CustomerPosSale {
  id: string;
  receiptNo?: string;
  date: string;              // ISO
  staffName?: string;
  tableNumber?: number;
  items: { name: string; qty: number; price: number }[];
  total: number;
  paymentMethod?: string;
  voided?: boolean;
  voidReason?: string;
  refundAmount?: number;
}

// ─── Gift cards (code-based / transferable) ──────────────────────────────────
// Phase 1: anyone holding a code can redeem it at online checkout, POS, or
// waiter settle. The balance lives on the `gift_cards` row (NOT on the
// customer), so the same code can be redeemed across surfaces and over
// multiple orders until depleted. See plan in plans/zesty-petting-pumpkin.md.

export type GiftCardStatus = "active" | "redeemed" | "voided" | "expired";

export interface GiftCard {
  id: string;
  code: string;
  initialAmount: number;
  balance: number;
  status: GiftCardStatus;
  /** Recipient details captured at purchase time. Email is used for the
   *  delivery message; name is shown on the card display. */
  issuedToEmail?: string;
  issuedToName?: string;
  /** Buyer's customer id — present only when the purchase was made by a
   *  logged-in customer. Lets us show "cards I've bought" on /account. */
  issuedByCustomerId?: string;
  personalMessage?: string;
  expiresAt?: string;        // ISO
  stripePaymentIntentId?: string;
  deliveredAt?: string;      // ISO — set when the delivery email was sent
  createdAt: string;         // ISO
}

export type GiftCardTransactionType =
  | "issue"
  | "redeem"
  | "refund"
  | "void"
  | "adjust";

export interface GiftCardTransaction {
  id: string;
  giftCardId: string;
  type: GiftCardTransactionType;
  /** Positive = credit (issue, refund), negative = debit (redeem, void). */
  amount: number;
  /** Snapshot of the card's balance after this txn — kept for reconciliation
   *  so an auditor never has to replay the entire ledger to verify history. */
  balanceAfter: number;
  /** Exactly one of these is set for redeem/refund rows; both null for
   *  issue/void/adjust. Lets the audit view link straight to the source. */
  orderId?: string;
  posSaleId?: string;
  /** Free-form actor label: "customer:<id>", "admin", "pos:<staff_id>",
   *  "system" (for webhook-driven issuance). */
  performedBy: string;
  notes?: string;
  createdAt: string;         // ISO
}
