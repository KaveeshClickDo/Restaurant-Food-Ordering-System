# System Architecture Document

## 1. Overview

This document describes the architecture of the **Single-Restaurant Food Ordering System** — a full-featured web application combining a customer-facing ordering portal, a restaurant admin control panel, a kitchen display system, and a driver delivery portal in a single Next.js 15 application.

All data is stored in **Supabase (PostgreSQL)** and synchronised in real time across all connected sessions via Supabase Realtime's `postgres_changes` subscriptions. There is no separate backend server — Next.js API routes proxy print and email side-effects only.

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
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime (`postgres_changes`) |
| State | React Context + Supabase |
| Printer | ESC/POS over TCP (Next.js API route proxy) |
| Email | SMTP via Next.js API route |
| Dev Server | `next dev --turbopack` |

---

## 3. Database Schema

Five tables are used. Supabase Realtime is enabled on all of them.

### `app_settings`

Single-row JSONB table. All admin settings — restaurant info, schedule, zones, payment methods, email templates, pages, nav links, colors, receipt settings, coupons, tax, breakfast menu, printer config, and driver list — are stored as a single JSON object.

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

## 4. Application Structure

```
app/src/
├── app/
│   ├── layout.tsx                  # Root layout — Inter font, AppProvider, SEO
│   ├── page.tsx                    # Customer portal — menu page (/)
│   ├── account/page.tsx            # Customer account dashboard (/account)
│   ├── admin/page.tsx              # Admin dashboard (/admin) — 18 tabbed panels
│   ├── kitchen/page.tsx            # Kitchen display (/kitchen)
│   ├── driver/page.tsx             # Driver dashboard (/driver)
│   ├── driver/login/page.tsx       # Driver login (/driver/login)
│   ├── [footerPage]/page.tsx       # Dynamic page renderer (/[slug])
│   └── api/
│       ├── print/route.ts          # ESC/POS TCP proxy
│       └── email/route.ts          # SMTP send proxy
│
├── components/
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── Cart.tsx
│   ├── BreakfastSection.tsx
│   ├── MenuItemCard.tsx
│   ├── MenuSection.tsx
│   ├── CategoryNav.tsx
│   ├── SearchAndFilters.tsx
│   ├── CheckoutModal.tsx
│   ├── ScheduleOrderModal.tsx
│   ├── ItemCustomizationModal.tsx
│   ├── AuthModal.tsx
│   ├── SeoHead.tsx
│   └── admin/
│       ├── MenuManagementPanel.tsx
│       ├── BreakfastMenuPanel.tsx
│       ├── DeliveryPanel.tsx
│       ├── CustomersPanel.tsx
│       ├── DeliveryZonesPanel.tsx
│       ├── OperationsPanel.tsx
│       ├── SchedulePanel.tsx
│       ├── IntegrationsPanel.tsx
│       ├── EmailTemplatesPanel.tsx
│       ├── FooterPagesPanel.tsx
│       ├── CustomPagesPanel.tsx
│       ├── MenuLinksPanel.tsx
│       ├── ColorSettingsPanel.tsx
│       ├── FooterLogosPanel.tsx
│       ├── ReceiptSettingsPanel.tsx
│       ├── CouponsPanel.tsx
│       ├── TaxSettingsPanel.tsx
│       ├── DriversPanel.tsx
│       └── RichEditor.tsx
│
├── context/AppContext.tsx           # Global state, Supabase sync, all mutations
├── data/                            # Seed data (menu, restaurant, customers, footer pages)
├── lib/
│   ├── supabase.ts                  # Supabase client
│   ├── escpos.ts                    # ESC/POS receipt formatter
│   ├── emailTemplates.ts            # Email template engine
│   ├── colorUtils.ts                # Brand colour CSS variable generator
│   ├── scheduleUtils.ts             # Store open/close time helpers
│   ├── stockUtils.ts                # Stock status resolution
│   └── taxUtils.ts                  # VAT calculation utilities
└── types/index.ts                   # All TypeScript interfaces
```

---

## 5. State Management Architecture

### 5.1 AppContext (Single Source of Truth)

All application state flows through a single React Context (`AppContext`) defined in `context/AppContext.tsx`. There is no external state library.

```
AppContext provides:
├── Cart state (ADD / REMOVE / UPDATE_QTY / CLEAR)
├── AdminSettings (settings, updateSettings, mutateSettings)
├── Categories + MenuItems (full CRUD, Supabase-persisted)
├── Customers (CRUD, Supabase-persisted)
├── Orders (addOrder, updateOrderStatus, updateDeliveryStatus)
├── Auth — Customer (login, logout, register)
├── Auth — Driver (driverLogin, driverLogout, currentDriver)
├── Fulfillment (delivery | collection)
├── Coupon (applyCoupon, removeCoupon, incrementCouponUsage)
├── Driver operations (assignDriverToOrder, updateDeliveryStatus)
├── Breakfast menu CRUD
└── Derived values (cartTotal, cartCount, isOpen)
```

### 5.2 Supabase Persistence

**Two persistence patterns are used:**

**`updateSettings(patch)`** — shallow-merges a partial `AdminSettings` object and writes it to `app_settings` in Supabase. Used exclusively for user-initiated settings changes (Operations, Schedule, Integrations, etc.).

**`mutateSettings(fn)`** — functional-update pattern that applies a transformation function to the current settings and immediately upserts to Supabase. Used for all mutations that happen inside the provider (addCoupon, updateDriver, addDeliveryZone, etc.) to avoid triggering re-renders or Realtime loops.

**Direct table mutations** — Categories, menu items, customers, and orders are persisted as individual table rows rather than inside the JSONB blob. Each CRUD function writes to the appropriate Supabase table immediately.

### 5.3 Supabase Realtime

`AppContext` subscribes to a single `postgres_changes` channel (`"restaurant-realtime"`) that watches all five tables:

```
channel("restaurant-realtime")
  .on(UPDATE, "app_settings", → setSettings)
  .on(*, "categories",        → update categories state)
  .on(*, "menu_items",        → update menuItems state)
  .on(*, "orders",            → update order in customers state)
  .on(*, "customers",         → update customers state)
  .subscribe()
```

This means any write to Supabase — from any device, any tab, any session — immediately reflects in every connected instance. The admin advancing an order status and the customer's live tracker both update without a page reload.

### 5.4 Initialisation / Seed

On first load, `AppContext` queries all five tables. If any table is empty, seed data from `data/` is inserted:

1. `app_settings` is upserted with `DEFAULT_SETTINGS`
2. `categories` is populated from `data/menu.ts`
3. `menu_items` is populated from `data/menu.ts`
4. `customers` and `orders` are populated from `data/customers.ts`

### 5.5 Key TypeScript Types

All types live in `types/index.ts`:

| Type | Purpose |
|---|---|
| `AdminSettings` | Root settings object — everything in the `app_settings` JSONB row |
| `MenuItem` | Menu item with dietary tags, variations, add-ons, image, stock |
| `Category` | Category with emoji and display name |
| `CartItem` | Cart line with selected variation, add-ons, instructions |
| `Order` | Order record with `OrderStatus`, `DeliveryStatus`, driver fields, fees, coupon |
| `OrderStatus` | `"pending" \| "confirmed" \| "preparing" \| "ready" \| "delivered" \| "cancelled"` |
| `DeliveryStatus` | `"assigned" \| "picked_up" \| "on_the_way" \| "delivered"` |
| `Customer` | Customer with auth fields, tags, order history, favourites, saved addresses |
| `Driver` | Driver account with auth, vehicle info, active flag |
| `DeliveryZone` | Concentric radius ring with km boundaries and fee |
| `PaymentMethod` | Payment option with distance-based delivery restriction |
| `EmailTemplate` | HTML email template with variable placeholders |
| `Coupon` | Discount code with type, value, limits, expiry, usage tracking |
| `TaxSettings` | VAT rate, inclusive/exclusive mode, show breakdown flag |
| `BreakfastMenuSettings` | Enabled toggle, time window, separate categories + items |
| `ReceiptSettings` | Logo, contact info, VAT number, footer messages |
| `FooterPage` | Built-in page (About, Terms, etc.) with rich HTML content |
| `CustomPage` | Admin-created standalone page with SEO fields |
| `MenuLink` | Header or footer nav link pointing to any page |
| `ColorSettings` | Brand accent colour and page background hex values |
| `FooterLogo` | Partner/badge logo with URL, href, label, enabled flag |
| `PrinterSettings` | Thermal printer network config — IP, port, paper width, auto-print |
| `SavedAddress` | Customer-saved delivery address with label, phone override, notes |

---

## 6. Routing Architecture

| Route | Portal | Description |
|---|---|---|
| `/` | Customer | Menu page — browse, filter, add to cart, checkout |
| `/account` | Customer | Order history, live tracking, profile, saved addresses |
| `/admin` | Admin | Full restaurant management dashboard (18 tabs) |
| `/kitchen` | Kitchen | Full-screen Kanban order display |
| `/driver` | Driver | Delivery queue and order progression |
| `/driver/login` | Driver | Driver authentication form |
| `/[footerPage]` | Public | Dynamic renderer for footer pages and custom pages |

### Dynamic Page Resolution (`/[footerPage]`)

Priority order:

1. Match against `settings.footerPages` (6 built-in pages)
2. Match against `settings.customPages` (published only)
3. Render "Page not found"

---

## 7. Order Status Workflow

The order lifecycle uses two fields: `status` (kitchen/admin leg) and `deliveryStatus` (driver leg).

### Kitchen / Admin leg

```
pending ──→ confirmed ──→ preparing ──→ ready
                                          │
                 (collection) ────────────┴──→ delivered   [admin action]
                 (delivery)   ────────────────→ [driver takes over]
```

| Status | Set by | Description |
|---|---|---|
| `pending` | Customer checkout | Order placed, awaiting acknowledgement |
| `confirmed` | Admin | Restaurant has acknowledged |
| `preparing` | Admin or kitchen | Kitchen is cooking |
| `ready` | Kitchen | Food is ready; kitchen's job ends here |
| `delivered` | Admin (collection) or driver (delivery) | Order complete |
| `cancelled` | Admin | Order cancelled at any stage |

**Role guard in `DeliveryPanel`**: `canAdminAdvance(order)` returns `false` for delivery orders at `"ready"` status — the admin button is hidden and `advance()` is a no-op for those orders. Only the driver can mark delivery orders as delivered.

**Kitchen guard**: The kitchen's "Ready" column in `/kitchen` has no action button. Kitchen staff can only advance orders to `"ready"`; they cannot touch `"delivered"`.

### Driver leg

```
assigned ──→ picked_up ──→ on_the_way ──→ delivered
```

`updateDeliveryStatus` in `AppContext` automatically sets `order.status = "delivered"` when `deliveryStatus` reaches `"delivered"`. Both fields are written to Supabase in the same update.

### Customer-visible status

The customer's `StatusBadge` component checks `order.deliveryStatus` first for delivery orders:

| `deliveryStatus` | Badge label |
|---|---|
| `assigned` | Driver Assigned |
| `picked_up` | Picked Up |
| `on_the_way` | On the Way |
| `delivered` | Delivered |
| *(none)* | Falls back to `order.status` label |

The `OrderTracker` uses separate step arrays:
- **Delivery**: 4 kitchen steps (`pending → confirmed → preparing → ready`)
- **Collection**: 5 steps including `delivered`

The `DeliveryTracker` component shows the driver leg progress separately, with a live pulse indicator when `deliveryStatus === "on_the_way"`.

---

## 8. Customer Portal

### 8.1 Menu Page (`/`)

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
    └── MenuItemCard × N (image, dietary, price, + button)

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

### 8.2 Account Dashboard (`/account`)

Tabs: **Orders** | **Profile**

- Orders are sorted newest-first; active orders have an orange border and pulsing "Live" badge
- `StatusBadge` derives its label from `deliveryStatus` for in-progress delivery orders
- `OrderTracker` — kitchen step dots (4 for delivery, 5 for collection)
- `DeliveryTracker` — driver leg progress with live animation when en route
- Re-order: copies all currently-available items from a past order into the current cart

---

## 9. Admin Dashboard (`/admin`)

18 tabbed panels:

| Tab | Panel | Key Features |
|---|---|---|
| Menu Items | `MenuManagementPanel` | Category + item CRUD, dietary, variations, add-ons, image, stock, popular flag |
| Breakfast | `BreakfastMenuPanel` | Separate breakfast categories/items, time-window (start/end), enabled toggle |
| Customers | `CustomersPanel` | Customer list, order history, VIP/tag management, manual status override |
| Delivery | `DeliveryPanel` | Kanban board, role-aware advance guard, completed-today table, new-order toast |
| Zones | `DeliveryZonesPanel` | Concentric km-ring editor, per-zone fee, colour coding, enable/disable |
| Operations | `OperationsPanel` | Branding (name synced to receiptSettings), fees, address, GPS, SEO, `<head>` injection |
| Schedule | `SchedulePanel` | Per-day open/close times, manual closed override |
| Integrations | `IntegrationsPanel` | Stripe, PayPal, SMTP, thermal printer, payment methods with distance rules |
| Email | `EmailTemplatesPanel` | 6 lifecycle HTML templates, variable substitution, live preview |
| Footer Pages | `FooterPagesPanel` | 6 built-in pages with rich HTML editor, visibility toggle, copyright |
| Custom Pages | `CustomPagesPanel` | Unlimited pages, slug management, SEO fields, publish toggle, SERP preview |
| Menus | `MenuLinksPanel` | Header + footer nav — add, label, reorder, toggle active |
| Colors | `ColorSettingsPanel` | Brand accent + page background — CSS custom property injection, live preview |
| Logos | `FooterLogosPanel` | Partner logos, payment icons, certification badges, enable/disable, reorder |
| Receipt | `ReceiptSettingsPanel` | Logo, contact info, VAT number, messages — applied to all print + email receipts |
| Coupons | `CouponsPanel` | Percentage and fixed codes, usage limits, min order, expiry, usage counter |
| Tax | `TaxSettingsPanel` | VAT rate, inclusive/exclusive, breakdown display |
| Drivers | `DriversPanel` | Driver CRUD, toggle active, view assigned orders |

### Admin real-time notifications

- Bell button in header shows the count of active (non-terminal) orders with a bounce animation
- When a new order arrives, a slide-in toast appears with a "View in Delivery tab →" shortcut
- The Delivery tab badge pulses with the live active-order count

---

## 10. Kitchen Display (`/kitchen`)

Full-screen dark Kanban board:

```
COLUMNS:
  New Orders  (status: pending | confirmed)  → "Start Preparing"
  Preparing   (status: preparing)            → "Mark Ready"
  Ready       (status: ready)                → display-only (no action button)
```

The "Ready" column shows:
- Delivery orders: "Awaiting driver pickup" badge
- Collection orders: "Awaiting customer collection" badge

Urgency colour coding (self-updating every 30 s):
- Green → < 15 min
- Amber → 15–29 min
- Red (pulsing) → ≥ 30 min

`completedToday` counter increments each time an order moves to `ready` (kitchen's final action).

---

## 11. Driver Portal (`/driver`)

Authentication:
- Driver credentials (email + password) are set by admin in Admin → Drivers
- `driverLogin()` in `AppContext` matches against `settings.drivers` and sets `currentDriver` state
- Redirect to `/driver/login` if not authenticated

Order flow:
1. **Available orders** — delivery orders with `status === "ready" || "preparing"` and no `driverId`, sorted by readiness then age
2. Driver accepts → `assignDriverToOrder()` sets `driverId`, `driverName`, and `deliveryStatus = "assigned"`
3. Driver progresses: `assigned → picked_up → on_the_way → delivered`
4. `updateDeliveryStatus()` writes to Supabase and sets `status = "delivered"` on the final step

---

## 12. Integrations

### 12.1 Thermal Printer (ESC/POS)

Flow:
1. New order placed → `printOrder()` in `lib/escpos.ts` formats ESC/POS bytes
2. Receipt is `POST`ed to `/api/print`
3. API route opens a raw TCP socket to the printer's IP:port and streams the bytes
4. Auto-print toggle in admin settings

`buildReceipt()` uses `receiptSettings` for the header (restaurant name, phone, website, email, VAT number) and footer (thank-you message, custom message). Falls back to `restaurant.*` fields when receipt-specific values are not set.

### 12.2 Email (SMTP)

Six lifecycle events trigger email sends:

| Event | Trigger |
|---|---|
| `order_confirmation` | Customer completes checkout |
| `order_confirmed` | Admin advances to Confirmed |
| `order_preparing` | Admin advances to Preparing |
| `order_ready` | Admin advances to Ready |
| `order_delivered` | Order marked as Delivered |
| `order_cancelled` | Admin marks as Cancelled |

`sendOrderEmail()` → interpolates `{{variables}}` into the template → `buildEmailDocument()` wraps it with receipt branding (logo, contact, VAT, custom message) → `POST /api/email` → SMTP relay.

### 12.3 Geolocation + Delivery Zones

At checkout (delivery only):
1. `navigator.geolocation.getCurrentPosition()` fetches `(lat, lng)`
2. Haversine formula: `d = 2r · arcsin(√(sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2)))`
3. Smallest matching enabled `DeliveryZone` (`minRadiusKm ≤ d ≤ maxRadiusKm`) is selected
4. Zone fee replaces the default delivery fee
5. Payment methods with `deliveryRange.restricted = true` are hidden when `d` falls outside `[minKm, maxKm]`

If geolocation is denied, all enabled payment methods are shown and the default delivery fee applies.

---

## 13. Content Management

### 13.1 Footer Pages

Six built-in pages pre-seeded in `data/footerPages.ts`:

| Slug | Page |
|---|---|
| `/about-us` | About Us |
| `/contact-us` | Contact Us |
| `/terms` | Terms & Conditions |
| `/privacy` | Privacy Policy |
| `/cookies` | Cookie Policy |
| `/accessibility` | Accessibility Statement |

### 13.2 Custom Pages

Admin creates unlimited pages with rich HTML content, SEO title (≤60 chars), meta description (≤160 chars), slug (auto-generated, conflict-checked), and a published/draft toggle. Served at `/{slug}` via `[footerPage]`.

### 13.3 Navigation Management

Separate editors for header and footer navigation. Admin can add any page, customise its display label, reorder with up/down arrows, and toggle active/inactive. `Footer.tsx` uses managed links when any exist, falling back to enabled footer pages for backward compatibility.

---

## 14. Receipt Settings

`ReceiptSettings` is stored inside the `app_settings` JSONB and applied to:

**Thermal printed receipts** (`lib/escpos.ts`):
- Header: `restaurantName`, `phone`, `website`, `email`, `vatNumber`
- Footer: `thankYouMessage`, `customMessage`

**Order lifecycle emails** (`lib/emailTemplates.ts`):
- Email header title: `restaurantName`
- Logo block: shown when `showLogo = true` and `logoUrl` is set
- Footer: contact line with VAT number, `customMessage`

---

## 15. VAT / Tax

`TaxSettings` fields:

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Master on/off switch |
| `rate` | number | VAT percentage (e.g. 20) |
| `inclusive` | boolean | `true` = prices include VAT; `false` = VAT added on top |
| `showBreakdown` | boolean | Whether to show the VAT line to the customer |

VAT is calculated in `lib/taxUtils.ts` and stored on the order as `vatAmount` and `vatInclusive`. It appears in:
- Cart sidebar
- Checkout modal order summary
- Printed ESC/POS receipt
- Order lifecycle emails

---

## 16. Breakfast Menu

`BreakfastMenuSettings`:

```ts
{
  enabled:    boolean;
  startTime:  string;      // "07:00"
  endTime:    string;      // "11:30"
  categories: Category[];  // breakfast-specific categories
  items:      MenuItem[];  // breakfast-specific items
}
```

Stored inside `app_settings` JSONB alongside the main settings. The customer portal evaluates `isBreakfastActive(startTime, endTime)` on every render and conditionally shows `<BreakfastSection>` above the main menu.

---

## 17. Mobile Responsiveness

| Pattern | Implementation |
|---|---|
| Bottom-sheet modals | `items-end sm:items-center` + `rounded-t-2xl sm:rounded-2xl` |
| Horizontal category scroll | `overflow-x-auto scrollbar-hide` with `flex-shrink-0` pills |
| Responsive admin sidebars | `flex flex-col md:flex-row` with `max-h-40 md:max-h-none` |
| Touch-accessible buttons | Minimum `w-10 h-10` (40px) on all interactive elements |
| Mobile cart | Fixed floating button → full-screen drawer at `z-50` |
| Content clearance | `pb-28 xl:pb-6` bottom padding |
| Admin tab bar | `hidden sm:inline` labels — icon-only on small screens |

---

## 18. Security Notes

| Area | Current implementation |
|---|---|
| Customer auth | Email + password stored in `customers` table (plaintext for demo) |
| Driver auth | Email + password in `settings.drivers` inside `app_settings` (plaintext for demo) |
| Admin access | URL-based only (`/admin`) — no authentication in current build |
| Payment credentials | Stored in `app_settings.stripePublicKey` / `stripeSecretKey` in Supabase |
| Card data | Never touches the server — Stripe.js / PayPal SDK tokenise client-side |
| SMTP credentials | Proxied through `/api/email` — not exposed to client bundle |
| Supabase RLS | Not yet configured — anon key has full table access in current build |

**Recommended production hardening:**
- Enable Supabase Row Level Security (RLS) with per-role policies
- Replace plaintext passwords with bcrypt hashing
- Add session-based authentication for the `/admin` route
- Move `stripeSecretKey` to a server-side environment variable

---

*Last updated: April 2026*
