# System Architecture Document

## 1. Overview

The **Single-Restaurant Food Ordering System** is a full-featured web application combining:

- A customer-facing ordering portal (`/`)
- A restaurant admin control panel (`/admin`)
- A kitchen display system (`/kitchen`)
- A driver delivery portal (`/driver`)
- A full point-of-sale terminal (`/pos`)

All portals are built as a single **Next.js 15** application. Online ordering data is stored in **Supabase (PostgreSQL)** and synchronised in real time via Supabase Realtime's `postgres_changes` subscriptions. POS data is stored entirely in **browser `localStorage`**, making the POS offline-capable with no Supabase dependency.

There is no separate backend server — Next.js API routes proxy print and email side-effects only.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI Library | React 19 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Font | Inter (next/font/google) |
| Online ordering DB | Supabase (PostgreSQL) |
| Real-time sync | Supabase Realtime (`postgres_changes`) |
| POS data storage | Browser `localStorage` |
| State | React Context (`AppContext` + `POSContext`) |
| Printer integration | ESC/POS over TCP (Next.js API route proxy) |
| Email integration | SMTP via Next.js API route |
| Dev server | `next dev --turbopack` |

---

## 3. Database Schema (Supabase — Online Ordering)

Five tables. Supabase Realtime is enabled on all of them.

### `app_settings`

Single-row JSONB table. All admin settings — restaurant info, schedule, zones, payment methods, email templates, pages, nav links, colors, receipt settings, coupons, tax, breakfast menu, printer config, driver list, and refund history — are stored as a single JSON object.

```sql
create table app_settings (
  id         integer primary key default 1,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);
```

### `categories`

```sql
create table categories (
  id         text primary key,
  name       text not null,
  emoji      text not null default '',
  sort_order integer not null default 0
);
```

### `menu_items`

```sql
create table menu_items (
  id           text primary key,
  category_id  text not null references categories(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  price        numeric not null,
  image        text,
  dietary      text[] not null default '{}',
  popular      boolean not null default false,
  variations   jsonb,
  add_ons      jsonb,
  stock_qty    integer,
  stock_status text,
  sort_order   integer not null default 0
);
```

### `customers`

```sql
create table customers (
  id               text primary key,
  name             text not null,
  email            text not null unique,
  phone            text not null default '',
  password         text not null default '',
  created_at       timestamptz not null default now(),
  tags             text[] not null default '{}',
  favourites       text[] not null default '{}',
  saved_addresses  jsonb not null default '[]'
);
```

### `orders`

```sql
create table orders (
  id               text primary key,
  customer_id      text not null references customers(id) on delete cascade,
  date             timestamptz not null default now(),
  status           text not null default 'pending',
  fulfillment      text not null default 'delivery',
  total            numeric not null,
  items            jsonb not null default '[]',
  address          text,
  note             text,
  payment_method   text,
  delivery_fee     numeric,
  service_fee      numeric,
  scheduled_time   text,
  coupon_code      text,
  coupon_discount  numeric,
  vat_amount       numeric,
  vat_inclusive    boolean,
  driver_id        text,
  driver_name      text,
  delivery_status  text
);
```

Enable Realtime on all tables:

```sql
alter publication supabase_realtime add table app_settings;
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table menu_items;
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table orders;
```

---

## 4. POS Data Storage (localStorage)

The POS system uses browser `localStorage` exclusively. No Supabase reads or writes occur from the POS. The admin Finance → POS Reports panel reads these keys from the same browser origin.

| localStorage key | TypeScript type | Contents |
|---|---|---|
| `pos_sales` | `POSSale[]` | All completed POS transactions — items, payment, VAT, tips, discounts, void/refund info |
| `pos_products` | `POSProduct[]` | POS product catalogue with modifiers, offers, images, stock |
| `pos_categories` | `POSCategory[]` | POS product categories |
| `pos_staff` | `POSStaff[]` | Staff records with role, 4-digit PIN, permissions, hourly rate |
| `pos_customers` | `POSCustomer[]` | POS customer records with loyalty points, gift card balance, purchase history |
| `pos_settings` | `POSSettings` | Tax, tip presets, receipt branding, SMTP config, loyalty config, table mode |
| `pos_clock_entries` | `POSClockEntry[]` | Staff clock in/out records with duration |

### Key POS Types (`types/pos.ts`)

```ts
interface POSSale {
  id: string;
  receiptNo: string;
  items: POSCartItem[];
  subtotal: number;
  discountAmount: number;
  discountNote?: string;
  taxAmount: number;
  taxRate: number;
  taxInclusive: boolean;
  tipAmount: number;
  total: number;
  paymentMethod: "cash" | "card" | "split";
  payments: POSSplitPayment[];
  cashTendered?: number;
  changeGiven?: number;
  staffId: string;
  staffName: string;
  customerId?: string;
  customerName?: string;
  tableNumber?: number;
  date: string; // ISO
  voided: boolean;
  voidReason?: string;
  refundMethod?: "cash" | "card" | "none";
  refundAmount?: number;
}

interface POSProduct {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  imageUrl?: string;       // URL or base64 data URI
  color: string;           // hex accent colour for tile
  modifiers?: POSModifier[];
  trackStock: boolean;
  stockQty?: number;
  active: boolean;
  popular?: boolean;
  cost?: number;           // cost price for margin calculation
  offer?: POSOffer;        // active promotional offer
}

interface POSOffer {
  type: "percent" | "fixed" | "price" | "bogo" | "multibuy" | "qty_discount";
  value: number;
  label?: string;
  active: boolean;
  startDate?: string;      // YYYY-MM-DD
  endDate?: string;        // YYYY-MM-DD
  buyQty?: number;         // for bogo and multibuy
  freeQty?: number;        // for bogo
  minQty?: number;         // for qty_discount
}

type POSRole = "admin" | "manager" | "cashier";

interface POSStaff {
  id: string;
  name: string;
  role: POSRole;
  pin: string;             // 4-digit PIN
  active: boolean;
  permissions: POSPermissions;
  hourlyRate?: number;
  avatarColor: string;
}
```

### POS Offer Price Logic

- **Simple per-unit offers** (`percent`, `fixed`, `price`): applied at add-to-cart time. `getOfferPrice(product)` returns the discounted unit price, which is stored as `item.price`.
- **Quantity-based offers** (`bogo`, `multibuy`, `qty_discount`): snapshotted onto `POSCartItem.offer` at add-to-cart time. Computed at subtotal time via `cartLineTotal(item)`.

```ts
// cartLineTotal handles all 6 offer types
export function cartLineTotal(item: POSCartItem): number {
  const o = item.offer;
  if (!o?.active) return item.price * item.quantity;
  switch (o.type) {
    case "bogo": {
      const groupSize = o.buyQty + o.freeQty;
      const paid = Math.floor(item.quantity / groupSize) * o.buyQty
                 + Math.min(item.quantity % groupSize, o.buyQty);
      return paid * item.price;
    }
    case "multibuy": {
      const groups = Math.floor(item.quantity / o.buyQty);
      return groups * o.value + (item.quantity % o.buyQty) * item.price;
    }
    case "qty_discount":
      return item.quantity >= o.minQty
        ? item.price * item.quantity * (1 - o.value / 100)
        : item.price * item.quantity;
    default:
      return item.price * item.quantity;
  }
}
```

---

## 5. Application Structure

```
app/src/
├── app/
│   ├── layout.tsx                  # Root layout — Inter font, AppProvider, SEO
│   ├── page.tsx                    # Customer portal — menu page (/)
│   ├── account/page.tsx            # Customer account dashboard (/account)
│   ├── admin/page.tsx              # Admin dashboard (/admin) — 20 tabbed panels
│   ├── kitchen/page.tsx            # Kitchen display (/kitchen)
│   ├── driver/page.tsx             # Driver dashboard (/driver)
│   ├── driver/login/page.tsx       # Driver login (/driver/login)
│   ├── pos/page.tsx                # POS terminal (/pos)
│   ├── pos/error.tsx               # POS error boundary
│   ├── [footerPage]/page.tsx       # Dynamic page renderer (/[slug])
│   └── api/
│       ├── print/route.ts          # ESC/POS TCP proxy
│       └── email/route.ts          # SMTP send proxy
│
├── components/
│   ├── Header.tsx / Footer.tsx / Cart.tsx
│   ├── BreakfastSection.tsx / MenuItemCard.tsx / MenuSection.tsx
│   ├── CategoryNav.tsx / SearchAndFilters.tsx
│   ├── CheckoutModal.tsx / ItemCustomizationModal.tsx
│   ├── ScheduleOrderModal.tsx / AuthModal.tsx / SeoHead.tsx
│   └── admin/
│       ├── MenuManagementPanel.tsx / BreakfastMenuPanel.tsx
│       ├── DeliveryPanel.tsx / RefundsPanel.tsx
│       ├── CustomersPanel.tsx / DeliveryZonesPanel.tsx
│       ├── OperationsPanel.tsx / SchedulePanel.tsx
│       ├── IntegrationsPanel.tsx / EmailTemplatesPanel.tsx
│       ├── FooterPagesPanel.tsx / CustomPagesPanel.tsx
│       ├── MenuLinksPanel.tsx / ColorSettingsPanel.tsx
│       ├── FooterLogosPanel.tsx / ReceiptSettingsPanel.tsx
│       ├── CouponsPanel.tsx / TaxSettingsPanel.tsx
│       ├── DriversPanel.tsx / POSReportsPanel.tsx
│       └── RichEditor.tsx
│
├── context/
│   ├── AppContext.tsx              # Online ordering — global state, Supabase sync, all mutations
│   └── POSContext.tsx             # POS — sales, cart, staff, products, settings (localStorage)
│
├── data/
│   ├── menu.ts                     # Default categories + menu items seed data
│   ├── restaurant.ts               # Default restaurant settings and schedule
│   ├── customers.ts                # Mock customer seed data
│   └── footerPages.ts              # 6 default footer pages
│
├── lib/
│   ├── supabase.ts                 # Supabase client initialisation
│   ├── escpos.ts                   # ESC/POS receipt formatter
│   ├── emailTemplates.ts           # Email template engine ({{variable}} interpolation)
│   ├── colorUtils.ts               # Brand colour CSS variable generator
│   ├── scheduleUtils.ts            # Store open/close time helpers
│   ├── stockUtils.ts               # Stock status resolution
│   └── taxUtils.ts                 # VAT calculation utilities
│
└── types/
    ├── index.ts                    # Online ordering TypeScript interfaces
    └── pos.ts                      # POS interfaces + getOfferPrice / cartLineTotal / cartLineSaving
```

---

## 6. State Management Architecture

### 6.1 AppContext — Online Ordering (Single Source of Truth)

All online ordering state flows through `context/AppContext.tsx`. No external state library.

```
AppContext provides:
├── Cart state              (ADD / REMOVE / UPDATE_QTY / CLEAR)
├── AdminSettings           (settings, updateSettings, mutateSettings)
├── Categories + MenuItems  (full CRUD, Supabase-persisted)
├── Customers               (CRUD, Supabase-persisted)
├── Orders                  (addOrder, updateOrderStatus, updateDeliveryStatus)
├── Auth — Customer         (login, logout, register)
├── Auth — Driver           (driverLogin, driverLogout, currentDriver)
├── Fulfillment             (delivery | collection)
├── Coupon                  (applyCoupon, removeCoupon, incrementCouponUsage)
├── Driver operations       (assignDriverToOrder, updateDeliveryStatus)
├── Breakfast menu CRUD
└── Derived values          (cartTotal, cartCount, isOpen)
```

### 6.2 POSContext — POS System

All POS state flows through `context/POSContext.tsx`. State is persisted to `localStorage` on every mutation via `useEffect` watchers.

```
POSContext provides:
├── currentStaff            (POSStaff | null — the PIN-authenticated staff member)
├── sales                   (POSSale[] — all completed sales)
├── cart                    (POSCartItem[] — active order being built)
├── products                (POSProduct[] — POS catalogue)
├── categories              (POSCategory[])
├── staff                   (POSStaff[] — all staff records)
├── customers               (POSCustomer[])
├── settings                (POSSettings)
├── clockEntries            (POSClockEntry[])
├── discount                ({type, value, note} | null — applied to current cart)
├── tipAmount               (number)
├── assignedCustomer        (POSCustomer | null)
├── addToCart               (product, modifiers) — applies offer price at add time
├── completeSale            (paymentMethod, payments, ...) → POSSale
├── voidSale                (saleId, reason, refundMethod?, refundAmount?)
├── clockIn / clockOut      (staffId)
└── All CRUD for products, categories, staff, customers, settings
```

### 6.3 Supabase Persistence (AppContext)

Two patterns:

- **`updateSettings(patch)`** — shallow-merges a partial `AdminSettings` and writes to `app_settings`. Used for user-initiated settings changes.
- **`mutateSettings(fn)`** — functional-update pattern that applies a transformation and upserts to Supabase. Used for all mutations inside the provider.
- **Direct table mutations** — categories, menu items, customers, and orders are persisted as individual table rows.

### 6.4 Supabase Realtime

`AppContext` subscribes to a single `postgres_changes` channel (`"restaurant-realtime"`):

```
channel("restaurant-realtime")
  .on(UPDATE, "app_settings", → setSettings)
  .on(*,      "categories",   → update categories state)
  .on(*,      "menu_items",   → update menuItems state)
  .on(*,      "orders",       → update order in customers state)
  .on(*,      "customers",    → update customers state)
  .subscribe()
```

Any write — from any device, any tab, any session — reflects in every connected instance without a page reload.

### 6.5 Initialisation / Seed

On first load, `AppContext` queries all five tables. If any table is empty, seed data from `data/` is inserted:

1. `app_settings` upserted with `DEFAULT_SETTINGS`
2. `categories` populated from `data/menu.ts`
3. `menu_items` populated from `data/menu.ts`
4. `customers` and `orders` populated from `data/customers.ts`

`POSContext` seeds staff, products, categories, and settings into `localStorage` on first run if the keys are absent.

### 6.6 Key TypeScript Types

**Online ordering (`types/index.ts`)**

| Type | Purpose |
|---|---|
| `AdminSettings` | Root settings JSONB object |
| `MenuItem` | Menu item with dietary, variations, add-ons, image, stock |
| `Category` | Category with emoji |
| `CartItem` | Cart line with variation, add-ons, instructions |
| `Order` | Order record with `OrderStatus`, `DeliveryStatus`, driver, fees, coupon |
| `OrderStatus` | `"pending" \| "confirmed" \| "preparing" \| "ready" \| "delivered" \| "cancelled"` |
| `DeliveryStatus` | `"assigned" \| "picked_up" \| "on_the_way" \| "delivered"` |
| `Customer` | Customer with auth, tags, order history, favourites, saved addresses |
| `Driver` | Driver account with auth, vehicle info, active flag |
| `DeliveryZone` | Concentric radius ring with km boundaries and fee |
| `PaymentMethod` | Payment option with distance restriction |
| `EmailTemplate` | HTML email template with variable placeholders |
| `Coupon` | Discount code with type, value, limits, expiry, usage |
| `TaxSettings` | VAT rate, inclusive/exclusive, show breakdown |
| `BreakfastMenuSettings` | Enabled, time window, categories, items |
| `ReceiptSettings` | Logo, contact info, VAT number, footer messages |
| `PrinterSettings` | Thermal printer network config |

**POS (`types/pos.ts`)**

| Type | Purpose |
|---|---|
| `POSRole` | `"admin" \| "manager" \| "cashier"` |
| `POSPermissions` | Boolean map of all capability flags |
| `ROLE_PERMISSIONS` | Record mapping role → default permissions |
| `POSStaff` | Staff record with PIN, role, permissions, hourly rate |
| `POSProduct` | POS catalogue item with offer, image, modifiers, stock, cost |
| `POSOffer` | Promotional offer (6 types) with date window |
| `POSOfferType` | `"percent" \| "fixed" \| "price" \| "bogo" \| "multibuy" \| "qty_discount"` |
| `POSCartItem` | Cart line with offer snapshot for quantity-based pricing |
| `POSSale` | Completed transaction with void/refund fields |
| `POSCustomer` | POS customer with loyalty, gift card, purchase history |
| `POSSettings` | All POS configuration including SMTP and receipt branding |
| `POSClockEntry` | Staff clock in/out record |
| `getOfferPrice(product)` | Returns discounted unit price for simple offers |
| `isOfferActive(product)` | Returns true if offer is active and within date window |
| `cartLineTotal(item)` | Computes line total accounting for quantity-based offers |
| `cartLineSaving(item)` | Returns saving amount vs full price (0 if none) |

---

## 7. Routing Architecture

| Route | Portal | Description |
|---|---|---|
| `/` | Customer | Menu page — browse, filter, add to cart, checkout |
| `/account` | Customer | Order history, live tracking, profile, saved addresses |
| `/admin` | Admin | Full restaurant management dashboard (20 tabs) |
| `/kitchen` | Kitchen | Full-screen Kanban order display |
| `/driver` | Driver | Delivery queue and order progression |
| `/driver/login` | Driver | Driver authentication form |
| `/pos` | POS | In-restaurant point-of-sale terminal |
| `/[footerPage]` | Public | Dynamic renderer for footer pages and custom pages |

### Dynamic Page Resolution (`/[footerPage]`)

Priority order:
1. Match against `settings.footerPages` (6 built-in pages)
2. Match against `settings.customPages` (published only)
3. Render "Page not found"

---

## 8. Order Status Workflow (Online Ordering)

### Kitchen / Admin leg (`status`)

```
pending ──→ confirmed ──→ preparing ──→ ready
                                          │
                 (collection) ────────────┴──→ delivered   [admin action]
                 (delivery)   ────────────────→ [driver takes over]
```

| Status | Set by | Description |
|---|---|---|
| `pending` | Customer checkout | Order placed, awaiting acknowledgement |
| `confirmed` | Admin | Restaurant acknowledged |
| `preparing` | Admin or kitchen | Kitchen cooking |
| `ready` | Kitchen | Food ready; kitchen's job ends here |
| `delivered` | Admin (collection) or driver (delivery) | Order complete |
| `cancelled` | Admin | Order cancelled |

**Role guard in `DeliveryPanel`**: `canAdminAdvance(order)` returns `false` for delivery orders at `"ready"` — the admin button is hidden and `advance()` is a no-op.

### Driver leg (`deliveryStatus`)

```
assigned ──→ picked_up ──→ on_the_way ──→ delivered
```

`updateDeliveryStatus` automatically sets `order.status = "delivered"` when `deliveryStatus` reaches `"delivered"`.

### Customer-visible status

`StatusBadge` checks `order.deliveryStatus` first for delivery orders:

| `deliveryStatus` | Badge label |
|---|---|
| `assigned` | Driver Assigned |
| `picked_up` | Picked Up |
| `on_the_way` | On the Way |
| `delivered` | Delivered |
| *(none)* | Falls back to `order.status` label |

---

## 9. POS System Architecture

### Authentication Flow

```
/pos page load
     │
     ▼
POSContext seeds localStorage if empty (staff, products, categories, settings)
     │
     ▼
PIN entry screen (4-digit animated keypad)
     │
PIN matches active POSStaff?
     ├─ Yes → set currentStaff; show navigation tabs gated by role permissions
     └─ No  → shake animation; clear input
```

### POS Navigation (role-gated)

| Tab | Icon | Required permission |
|---|---|---|
| Sale | ShoppingCart | always |
| Dashboard | LayoutDashboard | canAccessDashboard |
| Customers | Users | canManageCustomers |
| Staff | UserCog | canManageStaff |
| Settings | Settings2 | canAccessSettings |

### Sale Flow

```
Staff selects product tile
     │
Product has required modifiers?
     ├─ Yes → ModifierModal → confirm selections → addToCart()
     └─ No  → addToCart() directly
          │
          ▼
   Cart panel (OrderPanel)
     │
   Apply discount? (Manager/Admin only)
   Assign customer?
   Select tip?
   Set table?
     │
     ▼
   Select payment method: Cash / Card / Split
     │
   completeSale() →
     ├─ Builds POSSale record
     ├─ Appends to pos_sales in localStorage
     ├─ Updates customer loyalty points if assigned
     └─ Opens ReceiptModal (print / email)
```

### Void & Refund Flow

```
Staff clicks "Void" button (Manager/Admin only)
     │
     ▼
Void + Refund modal:
  1. Void reason (required free text)
  2. Refund method: Cash / Card / No Refund
  3. Refund amount (pre-filled with sale total, editable)
     │
Confirm →
  voidSale(saleId, reason, refundMethod, refundAmount)
     │
  POSSale updated: voided=true, voidReason, refundMethod, refundAmount
  localStorage updated
     │
  Transaction appears with VOID badge + refund info in all views
  Excluded from revenue KPIs
```

### POS Reports Data Flow

The Admin Dashboard → Finance → POS Reports tab (`POSReportsPanel`) and the POS Dashboard → Reports tab both read from the same `localStorage` keys:

```
localStorage["pos_sales"]    → filter by date range → compute KPIs → render charts
localStorage["pos_products"] → extract cost data for margin calculation
localStorage["pos_settings"] → read currencySymbol
```

Since both the admin panel and POS terminal run in the same browser origin, `localStorage` access works seamlessly without any API calls.

---

## 10. Customer Portal

### Menu Page (`/`)

```
Header (restaurant info + fulfillment toggle + header nav)
│
├── Mobile category strip (horizontal scroll)
├── Desktop category sidebar (CategoryNav — hidden below lg)
│
├── SearchAndFilters (text search + dietary filter pills)
│
├── BreakfastSection (shown only during configured time window)
│
└── MenuSection (category groups with IntersectionObserver ScrollSpy)
    └── MenuItemCard × N

Cart — desktop sticky sidebar (hidden below xl)
     — mobile floating button → full-screen drawer
```

**Checkout flow:**
1. Cart validates minimum order threshold
2. `CheckoutModal` opens
3. Geolocation detects delivery distance via Haversine formula
4. Matched `DeliveryZone` updates delivery fee in real time
5. `PaymentMethod` list filtered by distance restriction
6. VAT and coupon discounts calculated and displayed
7. Selecting payment creates the `Order`, fires print + email side effects

### Account Dashboard (`/account`)

Tabs: **Orders** | **Profile**

- Orders sorted newest-first; active orders have orange border and pulsing "Live" badge
- `StatusBadge` derives its label from `deliveryStatus` for in-progress delivery orders
- `OrderTracker` — kitchen step dots (4 for delivery, 5 for collection)
- `DeliveryTracker` — driver leg progress with live animation when en route

---

## 11. Admin Dashboard (`/admin`)

20 tabbed panels in 6 groups:

| Group | Tabs |
|---|---|
| Orders | Delivery, Refunds |
| Menu | Menu Items, Breakfast |
| Customers | Customers, Drivers |
| Finance | Coupons, Tax & VAT, POS Reports |
| Settings | Operations, Schedule, Delivery Zones, Integrations, Email Templates |
| Content & SEO | Footer Pages, Custom Pages, Navigation, Brand Colors, Footer Logos, Receipt |

### Admin real-time notifications

- Bell button in header shows count of active (non-terminal) orders with bounce animation
- New order → slide-in toast with "View in Delivery tab →" shortcut
- Delivery tab badge pulses with live active-order count

---

## 12. Kitchen Display (`/kitchen`)

```
COLUMNS:
  New Orders  (status: pending | confirmed)  → "Start Preparing"
  Preparing   (status: preparing)            → "Mark Ready"
  Ready       (status: ready)                → display-only (no action)
```

Urgency colour coding (self-updating every 30 s):
- Green → < 15 min
- Amber → 15–29 min
- Red (pulsing) → ≥ 30 min

---

## 13. Driver Portal (`/driver`)

Authentication:
- `driverLogin()` in `AppContext` matches credentials against `settings.drivers`
- Redirects to `/driver/login` if not authenticated

Order flow:
1. **Available orders** — delivery orders where `(status === "ready" || "preparing") && !driverId`
2. Driver accepts → `assignDriverToOrder()` sets `driverId`, `driverName`, `deliveryStatus = "assigned"`
3. Driver progresses through `assigned → picked_up → on_the_way → delivered`
4. `updateDeliveryStatus()` writes to Supabase; sets `status = "delivered"` on final step

---

## 14. Integrations

### 14.1 Thermal Printer (ESC/POS)

```
New order placed
     │
printOrder() in lib/escpos.ts formats ESC/POS bytes
     │
POST to /api/print
     │
API route opens raw TCP socket → streams bytes to printer IP:port
```

`buildReceipt()` uses `receiptSettings` for header (name, phone, website, email, VAT number) and footer (thank-you, custom message).

### 14.2 Email (SMTP) — Online Ordering

Six lifecycle events:

| Event | Trigger |
|---|---|
| `order_confirmation` | Customer completes checkout |
| `order_confirmed` | Admin advances to Confirmed |
| `order_preparing` | Admin advances to Preparing |
| `order_ready` | Admin advances to Ready |
| `order_delivered` | Order marked as Delivered |
| `order_cancelled` | Admin marks as Cancelled |

`sendOrderEmail()` → interpolates `{{variables}}` → `buildEmailDocument()` wraps with receipt branding → `POST /api/email` → SMTP relay.

### 14.3 Email (SMTP) — POS Receipt

Configured in POS Settings → Hardware. When staff click "Email Receipt" in the receipt modal:

```
buildReceiptHtml(sale, settings) → inline-styled HTML email
     │
POST /api/email with { to, subject, html, smtp: settings.smtp... }
     │
SMTP relay → customer inbox
```

### 14.4 Geolocation + Delivery Zones

At checkout (delivery orders only):
1. `navigator.geolocation.getCurrentPosition()` fetches `(lat, lng)`
2. Haversine formula: `d = 2r · arcsin(√(sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2)))`
3. Smallest matching enabled `DeliveryZone` (`minRadiusKm ≤ d ≤ maxRadiusKm`) selected
4. Zone fee replaces the default delivery fee
5. Payment methods with `deliveryRange.restricted = true` hidden when `d` outside range

If geolocation is denied, all enabled payment methods are shown and the default delivery fee applies.

---

## 15. Content Management

### Footer Pages

Six built-in pages pre-seeded in `data/footerPages.ts`:

| Slug | Page |
|---|---|
| `/about-us` | About Us |
| `/contact-us` | Contact Us |
| `/terms` | Terms & Conditions |
| `/privacy` | Privacy Policy |
| `/cookies` | Cookie Policy |
| `/accessibility` | Accessibility Statement |

### Custom Pages

Admin creates unlimited pages with rich HTML content, SEO title (≤60 chars), meta description (≤160 chars), slug (auto-generated, conflict-checked), published/draft toggle. Served at `/{slug}` via `[footerPage]`.

### Navigation Management

Separate editors for header and footer navigation. Admin can add any page, customise its display label, reorder with up/down arrows, and toggle active/inactive.

---

## 16. VAT / Tax

### Online Ordering

`TaxSettings` fields: `enabled`, `rate`, `inclusive`, `showBreakdown`

VAT calculated in `lib/taxUtils.ts`; stored on order as `vatAmount` and `vatInclusive`. Appears in cart, checkout, ESC/POS receipt, and order lifecycle emails.

### POS

`POSSettings.taxRate` and `POSSettings.taxInclusive` control VAT on POS sales. Tax is computed at sale completion and stored on `POSSale.taxAmount` and `POSSale.taxInclusive`. POS tax is independent of online ordering tax settings.

---

## 17. Receipt Settings

`ReceiptSettings` (online ordering) applied to:

**Thermal printed receipts** (`lib/escpos.ts`):
- Header: `restaurantName`, `phone`, `website`, `email`, `vatNumber`
- Footer: `thankYouMessage`, `customMessage`

**Order lifecycle emails** (`lib/emailTemplates.ts`):
- Email header title, logo block, footer contact line with VAT number, custom message

`POSSettings` receipt fields (`receiptRestaurantName`, `receiptPhone`, etc.) are applied to POS-printed receipts and POS receipt emails independently.

---

## 18. Breakfast Menu

```ts
BreakfastMenuSettings {
  enabled:    boolean;
  startTime:  string;      // "07:00"
  endTime:    string;      // "11:30"
  categories: Category[];  // breakfast-only categories
  items:      MenuItem[];  // breakfast-only items
}
```

Stored inside `app_settings` JSONB. The customer portal evaluates `isBreakfastActive(startTime, endTime)` on every render and conditionally shows `<BreakfastSection>` above the main menu.

---

## 19. Mobile Responsiveness

| Pattern | Implementation |
|---|---|
| Bottom-sheet modals | `items-end sm:items-center` + `rounded-t-2xl sm:rounded-2xl` |
| Horizontal category scroll | `overflow-x-auto` with `flex-shrink-0` pills |
| Responsive admin sidebars | `flex flex-col md:flex-row` |
| Touch-accessible buttons | Minimum `w-10 h-10` (40 px) on all interactive elements |
| Mobile cart | Fixed floating button → full-screen drawer at `z-50` |
| Admin sidebar | Collapsible (icon-only at 68 px width) + mobile overlay |
| POS layout | Single-column on mobile; split sale/cart panel on desktop |

---

## 20. Security Notes

| Area | Current implementation |
|---|---|
| Customer auth | Email + password in `customers` table (plaintext for demo) |
| Driver auth | Email + password in `settings.drivers` inside `app_settings` (plaintext for demo) |
| POS staff auth | 4-digit PIN in `pos_staff` in `localStorage` (client-side only) |
| Admin access | URL-based only (`/admin`) — no server-side authentication in current build |
| Payment credentials | Stored in `app_settings.stripePublicKey` / `stripeSecretKey` in Supabase |
| Card data | Never touches the server — Stripe.js / PayPal SDK tokenise client-side |
| SMTP credentials | Proxied through `/api/email` — not exposed to client bundle |
| POS SMTP | Stored in `pos_settings` in `localStorage` and proxied through `/api/email` |
| Supabase RLS | Not yet configured — anon key has full table access in current build |

**Recommended production hardening:**
- Enable Supabase Row Level Security (RLS) with per-role policies
- Replace plaintext passwords with bcrypt hashing
- Add session-based authentication for `/admin` route
- Move `stripeSecretKey` to a server-side environment variable
- Move POS SMTP password out of `localStorage` and into a server-side secret
- Replace POS PIN auth with a server-side session if the terminal is shared

---

*Last updated: April 2026*
