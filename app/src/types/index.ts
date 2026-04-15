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
  | "order_cancelled";

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
  name: string;         // display label, e.g. "Kitchen Printer"
  ip: string;           // printer's static IP address
  port: number;         // raw TCP port — Epson/Star default: 9100
  autoPrint: boolean;   // send receipt automatically on new order
  paperWidth: number;   // characters per line: 48 = 80 mm, 32 = 58 mm
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

export interface AdminSettings {
  drivers: Driver[];
  coupons: Coupon[];
  taxSettings: TaxSettings;
  restaurant: RestaurantInfo;
  schedule: WeekSchedule;
  manualClosed: boolean;
  stripePublicKey: string;
  stripeSecretKey: string;
  paypalClientId: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
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
}

export type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled";

export type DeliveryStatus = "assigned" | "picked_up" | "on_the_way" | "delivered";

export interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  password: string;   // plaintext for demo
  active: boolean;
  vehicleInfo?: string; // e.g. "Red Honda Civic – AB12 CDE"
  notes?: string;       // internal admin notes
  createdAt: string;    // ISO
}

export interface OrderLine {
  name: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  customerId: string;
  date: string;             // ISO string
  status: OrderStatus;
  fulfillment: "delivery" | "collection";
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
}
