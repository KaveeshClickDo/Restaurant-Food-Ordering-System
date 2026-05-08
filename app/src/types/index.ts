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
  options: { id: string; label: string; price: number }[];
}

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  image?: string;
  dietary: string[];
  popular?: boolean;
  variations?: Variation[];
  addOns?: AddOn[];
  /** When set, stock is quantity-tracked. 0 = out of stock. */
  stockQty?: number;
  /** Manual status override — used when stockQty is not set. */
  stockStatus?: StockStatus;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
}

export interface CartItem {
  id: string; // unique uuid per cart line
  menuItemId: string;
  name: string;
  price: number; // base + selected variation + add-ons
  quantity: number;
  selectedVariation?: { variationId: string; optionId: string; label: string };
  selectedAddOns?: { id: string; name: string; price: number }[];
  specialInstructions?: string;
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
}

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
  | "reservation_review_request";

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
  ip: string;                // printer IP (network mode)
  port: number;              // TCP port — Epson/Star default: 9100
  bluetoothAddress: string;  // BT device MAC, e.g. "AA:BB:CC:DD:EE:FF"
  bluetoothName: string;     // BT device display name
  autoPrint: boolean;        // send receipt automatically on new order
  paperWidth: number;        // chars per line: 48 = 80 mm, 32 = 58 mm
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

export interface BreakfastMenuSettings {
  enabled: boolean;
  startTime: string;     // "07:00"
  endTime: string;       // "11:30"
  categories: Category[];
  items: MenuItem[];
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
  number: number;
  label: string;    // e.g. "T1", "Bar 2", "Terrace A"
  seats: number;
  section: string;  // e.g. "Main Hall", "Terrace"
  active: boolean;
}

export interface AdminSettings {
  coupons: Coupon[];
  taxSettings: TaxSettings;
  restaurant: RestaurantInfo;
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
  footerPages: FooterPage[];
  footerCopyright: string;
  customPages: CustomPage[];
  menuLinks: MenuLink[];
  colors: ColorSettings;
  footerLogos: FooterLogo[];
  receiptSettings: ReceiptSettings;
  breakfastMenu: BreakfastMenuSettings;
  waiters: WaiterStaff[];
  kitchenStaff: KitchenStaff[];
  diningTables: DiningTable[];
  reservationSystem: ReservationSystem;
}

export type OrderStatus =
  | "pending" | "confirmed" | "preparing" | "ready"
  | "delivered" | "cancelled"
  | "refunded" | "partially_refunded";

export type DeliveryStatus = "assigned" | "picked_up" | "on_the_way" | "delivered";

export type RefundMethod = "original_payment" | "store_credit" | "cash";

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
  selectedVariation?: { variationId: string; optionId: string; label: string };
  selectedAddOns?: { id: string; name: string; price: number }[];
  specialInstructions?: string;
}

export interface Order {
  id: string;
  customerId: string;
  date: string;             // ISO string
  status: OrderStatus;
  fulfillment: "delivery" | "collection" | "dine-in";
  total: number;
  items: OrderLine[];
  address?: string;
  note?: string;
  paymentMethod?: string;   // display name of payment method used
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
  // Refunds
  refunds?: Refund[];
  refundedAmount?: number;  // cumulative £ refunded so far
  storeCreditUsed?: number; // £ of store credit applied at checkout
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
}
