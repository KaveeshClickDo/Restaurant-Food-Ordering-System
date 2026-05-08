# System Architecture Document

## 1. Overview

The **Single-Restaurant Food Ordering System** is a full-featured web application combining:

- A customer-facing ordering portal (`/`) with Favourites, My Orders, and Track Order
- A stand-alone customer login and password-reset flow (`/login`, `/verify-email`)
- A restaurant admin control panel (`/admin`)
- A waiter table-service app (`/waiter`)
- A kitchen display system (`/kitchen`)
- A driver delivery portal (`/driver`)
- A full point-of-sale terminal (`/pos`)

All portals are built as a single **Next.js 15** application. Online ordering data is stored in **Supabase (PostgreSQL)** and synchronised in real time via Supabase Realtime's `postgres_changes` subscriptions. POS data is stored primarily in **browser `localStorage`**, making the POS offline-capable — sales are committed locally first, then pushed to Supabase in the background via an outbox queue.

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
| POS data storage | Browser `localStorage` (primary) + Supabase (background sync) |
| POS offline sync | `lib/posOutbox.ts` — localStorage outbox with exponential back-off |
| State | React Context (`AppContext` + `POSContext`) |
| Auth — customers | bcrypt + HMAC-signed httpOnly `customer_session` cookie; Google OAuth 2.0 |
| Auth — drivers | bcrypt + HMAC-signed httpOnly `driver_session` cookie; `middleware.ts` route protection |
| Auth — admin | `ADMIN_PASSWORD` env var + httpOnly JWT cookie |
| Auth — waiters | 4-digit PIN; server-side validation via `POST /api/waiter/auth` |
| Auth — POS | 4-digit PIN; client-side validation in `POSContext` |
| Printer integration | ESC/POS over TCP (Next.js API route proxy) |
| Email integration | SMTP via Next.js API route |
| Dev server | `next dev --turbopack` |

---

## 3. Database Schema (Supabase)

Six tables. Supabase Realtime is enabled on five of them (`drivers` and `reservation_customers` are fetched on demand).

### `app_settings`

Single-row JSONB table. All admin settings — restaurant info, schedule, zones, payment methods, email templates, pages, nav links, colors, receipt settings, coupons, tax, breakfast menu, printer config, waiter staff, dining tables, and reservation system config — are stored as a single JSON object.

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
  password_hash    text not null default '',   -- bcrypt hash (cost factor 10)
  email_verified   boolean not null default false,
  created_at       timestamptz not null default now(),
  tags             text[] not null default '{}',
  favourites       text[] not null default '{}',
  saved_addresses  jsonb not null default '[]',
  store_credit     numeric not null default 0
);
```

The `pos-walk-in` sentinel row (`id = 'pos-walk-in'`) is pre-seeded so POS and waiter orders always have a valid `customer_id` FK.

Both `password` (legacy) and `password_hash` columns are revoked from the anon PostgREST role — neither is ever returned to the browser via the Supabase client.

### `orders`

```sql
create table orders (
  id                text primary key,
  customer_id       text not null references customers(id) on delete cascade,
  date              timestamptz not null default now(),
  status            text not null default 'pending',
  fulfillment       text not null default 'delivery',  -- delivery | collection | dine-in
  total             numeric not null,
  items             jsonb not null default '[]',
  address           text,
  note              text,
  payment_method    text,
  delivery_fee      numeric,
  service_fee       numeric,
  scheduled_time    text,
  coupon_code       text,
  coupon_discount   numeric,
  vat_amount        numeric,
  vat_inclusive     boolean,
  driver_id         text,
  driver_name       text,
  delivery_status   text,
  refunds           jsonb not null default '[]',
  refunded_amount   numeric not null default 0,
  store_credit_used numeric not null default 0,
  voided_by         text,
  void_reason       text,
  voided_at         timestamptz
);
```

**Fulfillment values:**
- `"delivery"` — online delivery order
- `"collection"` — online click-and-collect or POS sale
- `"dine-in"` — waiter-placed table order

**Note format by source:**
- Waiter: `"[WAITER] Table T4 · 2 covers · Staff: Alex · No onions"`
- POS: `"[POS] | Customer: John | Staff: Sarah | Receipt: R1005"`
- Online: free-form customer note

### `drivers`

```sql
create table drivers (
  id            text primary key,
  name          text not null,
  email         text not null unique,
  phone         text not null default '',
  password_hash text not null,
  active        boolean not null default true,
  vehicle_info  text,
  notes         text,
  created_at    timestamptz not null default now()
);
```

Passwords are stored as bcrypt hashes and validated server-side via `/api/auth/driver`. The anon role has no SELECT access on this table.

### `reservation_customers`

Unified CRM table for all restaurant guests — populated from both reservation check-ins and online order checkouts.

```sql
create table reservation_customers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  name             text not null default '',
  phone            text not null default '',
  visit_count      integer not null default 0,
  first_visit_at   timestamptz,
  last_visit_at    timestamptz,
  order_count      integer not null default 0,
  total_spend      numeric(10,2) not null default 0,
  last_order_at    timestamptz,
  tags             text[] not null default '{}',
  notes            text not null default '',
  marketing_opt_in boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
```

| Field group | Updated by |
|---|---|
| `visit_count`, `first/last_visit_at` | Reservation check-in / check-out |
| `order_count`, `total_spend`, `last_order_at` | `POST /api/guest-profile` (fire-and-forget from CheckoutModal) |

### Enable Realtime

```sql
alter publication supabase_realtime add table app_settings;
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table menu_items;
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table orders;
```

---

## 4. POS Data Storage

The POS system uses browser `localStorage` as its primary data store. After each sale, the data is also pushed to Supabase via an outbox queue so it appears on the KDS and in admin reports.

### localStorage keys

| Key | TypeScript type | Contents |
|---|---|---|
| `pos_sales` | `POSSale[]` | All completed POS transactions — items, payment, VAT, tips, discounts, void/refund info |
| `pos_products` | `POSProduct[]` | POS product catalogue with modifiers, offers, images, stock |
| `pos_categories` | `POSCategory[]` | POS product categories |
| `pos_staff` | `POSStaff[]` | Staff records with role, 4-digit PIN, permissions, hourly rate |
| `pos_customers` | `POSCustomer[]` | POS customer records with loyalty points, gift card balance, purchase history |
| `pos_settings` | `POSSettings` | Tax, tip presets, receipt branding, SMTP config, loyalty config, table mode |
| `pos_clock_entries` | `POSClockEntry[]` | Staff clock in/out records with duration |
| `pos_outbox` | `OutboxEntry[]` | Failed KDS sync queue — retried automatically when connectivity restores |

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
```

### POS Offer Price Logic

- **Simple per-unit offers** (`percent`, `fixed`, `price`): applied at add-to-cart time. `getOfferPrice(product)` returns the discounted unit price.
- **Quantity-based offers** (`bogo`, `multibuy`, `qty_discount`): snapshotted onto `POSCartItem.offer` at add-to-cart time. Computed at subtotal time via `cartLineTotal(item)`.

---

## 5. Application Structure

```
app/src/
├── middleware.ts                       # Edge route protection — customer + driver sessions
├── instrumentation.ts                  # Next.js instrumentation hook
├── app/
│   ├── layout.tsx                      # Root layout — Inter font, AppProvider, SEO, verification banner
│   ├── page.tsx                        # Customer portal (/) — menu, favourites, my orders, mobile nav
│   ├── login/page.tsx                  # Stand-alone login/forgot-password page
│   ├── verify-email/page.tsx           # Email verification landing
│   ├── admin/page.tsx                  # Admin dashboard (/admin) — 24 tabbed panels
│   ├── waiter/page.tsx                 # Waiter app (/waiter)
│   ├── kitchen/page.tsx                # Kitchen display (/kitchen)
│   ├── driver/page.tsx                 # Driver dashboard (/driver)
│   ├── driver/login/page.tsx           # Driver login (/driver/login)
│   ├── customer-display/page.tsx       # Customer-facing order status display
│   ├── pos/page.tsx                    # POS terminal (/pos)
│   ├── pos/error.tsx                   # POS error boundary
│   ├── [footerPage]/page.tsx           # Dynamic page renderer (/[slug])
│   └── api/
│       ├── ping/route.ts               # Connectivity probe (204) for POS offline detection
│       ├── admin/
│       │   ├── auth/route.ts
│       │   ├── settings/route.ts
│       │   ├── categories/
│       │   ├── menu/
│       │   ├── orders/[id]/status|refund|driver
│       │   ├── customers/
│       │   ├── drivers/
│       │   ├── reservation-customers/route.ts
│       │   └── seed/route.ts
│       ├── auth/
│       │   ├── login/route.ts          # Customer login (bcrypt + HMAC cookie)
│       │   ├── logout/route.ts         # Customer logout
│       │   ├── me/route.ts             # Session refresh
│       │   ├── register/route.ts       # Customer registration
│       │   ├── verify-email/route.ts   # Email verification token
│       │   ├── resend-verification/route.ts
│       │   ├── reset-password/route.ts # Password reset
│       │   ├── google/route.ts         # OAuth initiation
│       │   ├── google/callback/route.ts # OAuth code exchange
│       │   └── driver/route.ts|logout/route.ts
│       ├── waiter/auth|config|orders|settle|void|refund|logout
│       ├── pos/orders|menu|reservations
│       ├── kds/orders/[id]/status
│       ├── orders/route.ts
│       ├── guest-profile/route.ts
│       ├── customers/[id]/route|spend-credit
│       ├── print/route.ts
│       └── email/route.ts
│
├── components/
│   ├── AuthModal.tsx                   # Login / Register modal (with Google OAuth)
│   ├── EmailVerificationBanner.tsx     # Unverified-email prompt bar
│   ├── Header.tsx / Footer.tsx / Cart.tsx
│   ├── BreakfastSection.tsx / MenuItemCard.tsx / MenuSection.tsx
│   ├── CategoryNav.tsx / SearchAndFilters.tsx
│   ├── CheckoutModal.tsx / ItemCustomizationModal.tsx
│   ├── ScheduleOrderModal.tsx / SeoHead.tsx
│   └── admin/ (24 panel components + RichEditor)
│
├── context/
│   ├── AppContext.tsx                  # Online ordering — global state, Supabase sync, auth, all mutations
│   └── POSContext.tsx                 # POS — sales, cart, staff, products, settings (localStorage)
│
├── data/
│   ├── menu.ts / restaurant.ts / customers.ts / footerPages.ts
│
├── lib/
│   ├── auth.ts                         # HMAC session token helpers (createSessionToken, verifySessionToken, setSessionCookie)
│   ├── apiHandler.ts                   # Shared API route wrapper
│   ├── supabase.ts                     # Supabase browser client (anon key)
│   ├── supabaseAdmin.ts                # Supabase server client (service role key)
│   ├── adminAuth.ts                    # Admin JWT cookie helpers
│   ├── emailServer.ts                  # Server-side SMTP email dispatcher
│   ├── connectivity.ts                 # useConnectivity() — probe-based online/offline detection
│   ├── posOutbox.ts                    # POS offline outbox queue (localStorage) with retry
│   ├── escpos.ts                       # ESC/POS receipt formatter
│   ├── emailTemplates.ts               # Email template engine ({{variable}} interpolation)
│   ├── colorUtils.ts                   # Brand colour CSS variable generator
│   ├── scheduleUtils.ts                # Store open/close time helpers
│   ├── stockUtils.ts                   # Stock status resolution
│   └── taxUtils.ts                     # VAT calculation utilities
│
└── types/
    ├── index.ts                        # Online ordering TypeScript interfaces
    └── pos.ts                          # POS interfaces + getOfferPrice / cartLineTotal / cartLineSaving
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
├── Auth — Customer         (login, logout, register, currentUser)
├── Auth — Driver           (driverLogin, driverLogout, currentDriver)
├── Favourites              (toggleFavourite, isFavourite — persisted to customers.favourites)
├── Fulfillment             (delivery | collection; setFulfillment)
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
├── discount                ({pct, note} — applied to current cart)
├── tipAmount               (number)
├── assignedCustomer        (POSCustomer | null)
├── addToCart               (product, modifiers) — applies offer price at add time
├── completeSale            (paymentMethod, payments, ...) → POSSale
│     └─ saves to localStorage → attempts POST /api/pos/orders
│          → on failure: outboxEnqueue(sale) for later retry
├── voidSale                (saleId, reason, refundMethod?, refundAmount?)
├── clockIn / clockOut      (staffId)
└── All CRUD for products, categories, staff, customers, settings
```

### 6.3 Supabase Persistence (AppContext)

Two patterns:

- **`updateSettings(patch)`** — shallow-merges a partial `AdminSettings` and writes to `app_settings`.
- **`mutateSettings(fn)`** — functional-update pattern that applies a transformation and upserts to Supabase.
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

On first load, `AppContext` queries all five tables. If any table is empty, seed data from `data/` is inserted.

`POSContext` seeds staff, products, categories, and settings into `localStorage` on first run if the keys are absent.

### 6.6 Branding — Single Source of Truth

Restaurant name and branding set in **Admin → Operations** propagate everywhere via `AppContext.settings.restaurant`. The POS, KDS, receipts, and all lifecycle emails read from this single source — no separate per-portal branding configuration is needed.

### 6.7 Key TypeScript Types

**Online ordering (`types/index.ts`)**

| Type | Purpose |
|---|---|
| `AdminSettings` | Root settings JSONB object |
| `MenuItem` | Menu item with dietary, variations, add-ons, image, stock |
| `Category` | Category with emoji |
| `CartItem` | Cart line with variation, add-ons, instructions |
| `Order` | Order record with status, delivery status, driver, fees, coupon, VAT, store credit, refunds |
| `OrderStatus` | `"pending" \| "confirmed" \| "preparing" \| "ready" \| "delivered" \| "cancelled" \| "refunded" \| "partially_refunded"` |
| `DeliveryStatus` | `"assigned" \| "picked_up" \| "on_the_way" \| "delivered"` |
| `Customer` | Customer with bcrypt auth, email_verified, tags, order history, favourites, saved addresses, store credit |
| `Driver` | Driver account with bcrypt auth, vehicle info, active flag |
| `DeliveryZone` | Concentric radius ring with km boundaries and fee |
| `PaymentMethod` | Payment option with distance restriction |
| `EmailTemplate` | HTML email template with variable placeholders |
| `Coupon` | Discount code with type, value, limits, expiry, usage |
| `TaxSettings` | VAT rate, inclusive/exclusive, show breakdown |
| `ReservationCustomer` | Guest CRM profile combining reservation visits and online orders |
| `Reservation` | Individual table reservation with status, party size, notes |
| `ReservationSystem` | System config — slot duration, advance days, blackout dates, review URL |

**POS (`types/pos.ts`)**

| Type | Purpose |
|---|---|
| `POSRole` | `"admin" \| "manager" \| "cashier"` |
| `POSPermissions` | Boolean map of all capability flags |
| `ROLE_PERMISSIONS` | Record mapping role → default permissions |
| `POSStaff` | Staff record with PIN, role, permissions, hourly rate |
| `POSProduct` | POS catalogue item with offer, image, modifiers, stock, cost |
| `POSOffer` | Promotional offer (6 types) with date window |
| `POSCartItem` | Cart line with offer snapshot for quantity-based pricing |
| `POSSale` | Completed transaction with void/refund fields |
| `POSCustomer` | POS customer with loyalty, gift card, purchase history |
| `POSSettings` | All POS configuration including SMTP and receipt branding |
| `POSClockEntry` | Staff clock in/out record |
| `getOfferPrice(product)` | Returns discounted unit price for simple offers |
| `isOfferActive(product)` | Returns true if offer is active and within date window |
| `cartLineTotal(item)` | Computes line total accounting for quantity-based offers |
| `cartLineSaving(item)` | Returns saving amount vs full price |

---

## 7. Routing Architecture

| Route | Portal | Description |
|---|---|---|
| `/` | Customer | Menu page — browse, filter, favourites, my orders, delivery/collection toggle |
| `/login` | Customer | Stand-alone login, register, forgot-password, Google OAuth |
| `/verify-email` | Customer | Email verification landing page |
| `/account` | Customer | Order history, live tracking, profile, saved addresses (middleware-protected) |
| `/admin` | Admin | Full restaurant management dashboard (24 panels) |
| `/waiter` | Waiter | Table-service app — PIN authenticated |
| `/kitchen` | Kitchen | Full-screen Kanban order display |
| `/driver` | Driver | Delivery queue and order progression (middleware-protected) |
| `/driver/login` | Driver | Driver authentication form |
| `/pos` | POS | In-restaurant point-of-sale terminal |
| `/[footerPage]` | Public | Dynamic renderer for footer pages and custom pages |

### Middleware Route Protection

`middleware.ts` runs at the Next.js edge and enforces session requirements:

| Pattern | Cookie required | Redirect on failure |
|---|---|---|
| `/driver/*` (except `/driver/login`) | `driver_session` | `/driver/login` |
| `/account` | `customer_session` | `/login` |

Session tokens are HMAC-verified in the middleware without a database round-trip.

---

## 8. Authentication Architecture

### Customer Auth (`lib/auth.ts`)

The HMAC session token system is shared between customer and driver sessions:

```typescript
// Payload embedded in each token
interface SessionPayload { id: string; role: "customer" | "driver" }

// Creates a signed token: base64url(JSON.stringify(payload)) + "." + HMAC_SHA256
createSessionToken(payload): string

// Verifies signature and returns payload; null if invalid or tampered
verifySessionToken(token): SessionPayload | null

// Sets the httpOnly session cookie on a NextResponse
setSessionCookie(res, cookieName, token)

// Cookie names
COOKIE_CUSTOMER = "customer_session"   // 30-day expiry
COOKIE_DRIVER   = "driver_session"     // 30-day expiry
```

The HMAC secret is read from `AUTH_JWT_SECRET` (falls back to `ADMIN_JWT_SECRET`).

### Customer Login Flow

```
POST /api/auth/login { email, password }
  → Fetch customer by email (service role)
  → bcrypt.compare(password, customer.password_hash)
  → createSessionToken({ id: customer.id, role: "customer" })
  → setSessionCookie(res, COOKIE_CUSTOMER, token)
  → return { id, name, email, ... } (no hash)
```

### Google OAuth Flow

```
GET /api/auth/google
  → raw = randomBytes(16).toString("hex")
  → sig = HMAC_SHA256(raw, AUTH_JWT_SECRET)
  → state = `${raw}.${sig}`
  → Set httpOnly cookie "google_oauth_state" (10 min)
  → Redirect to accounts.google.com/o/oauth2/v2/auth?...

GET /api/auth/google/callback?code=...&state=...
  → Validate CSRF state (signature + cookie match)
  → POST https://oauth2.googleapis.com/token → access_token
  → GET https://www.googleapis.com/oauth2/v3/userinfo → { email, name }
  → Find or create customer in Supabase (email_verified = true)
  → createSessionToken + setSessionCookie
  → Redirect to /
```

### Driver Auth Flow

```
POST /api/auth/driver { email, password }
  → Fetch driver by email (service role)
  → bcrypt.compare(password, driver.password_hash)
  → createSessionToken({ id: driver.id, role: "driver" })
  → setSessionCookie(res, COOKIE_DRIVER, token)
  → return { id, name, email, active }

POST /api/auth/driver/logout
  → Clear driver_session cookie
  → Redirect to /driver/login
```

---

## 9. Order Status Workflow

### Kitchen / Admin leg (`status`)

```
pending ──→ confirmed ──→ preparing ──→ ready
                                          │
                 (collection) ────────────┴──→ delivered   [admin action]
                 (dine-in)    ────────────────→ delivered   [waiter settle]
                 (delivery)   ────────────────→ [driver takes over]
```

| Status | Set by | Description |
|---|---|---|
| `pending` | Customer checkout / Waiter / POS | Order placed |
| `confirmed` | Admin | Restaurant acknowledged |
| `preparing` | Admin or KDS | Kitchen cooking |
| `ready` | KDS | Food ready |
| `delivered` | Admin (collection), Waiter (dine-in), Driver | Completed |
| `cancelled` | Admin or Waiter void | Cancelled |
| `refunded` | Admin or Senior Waiter | Full refund |
| `partially_refunded` | Admin or Senior Waiter | Partial refund |

### Driver leg (`deliveryStatus`)

```
assigned ──→ picked_up ──→ on_the_way ──→ delivered
```

`updateDeliveryStatus` automatically sets `order.status = "delivered"` when `deliveryStatus` reaches `"delivered"`.

---

## 10. POS System Architecture

### Offline Mode

The POS is designed to remain operational when the internet is unavailable.

#### Connectivity Detection (`lib/connectivity.ts`)

```
useConnectivity() hook:
  ├── probes HEAD /api/ping every 30 s when online
  ├── probes every 5 s when offline (fast recovery)
  ├── reacts immediately to browser online/offline events
  └── returns { isOnline, checking, recheck }
```

#### Outbox Queue (`lib/posOutbox.ts`)

```
completeSale():
  1. Saves POSSale to pos_sales in localStorage  ← never lost
  2. Attempts POST /api/pos/orders
       ├── Success → KDS shows order immediately
       └── Failure → outboxEnqueue(sale)
             ├── Stores entry in pos_outbox (localStorage)
             └── On reconnect: drainOutbox()
                   ├── Retries each pending entry
                   ├── 409 Conflict = already synced → dequeue
                   ├── Failure → increment attempts
                   └── After 5 failures → status = "failed"
```

Back-off schedule: 2 s → 4 s → 8 s → 16 s → 32 s.

---

## 11. Customer Portal

### Menu Page (`/`)

```
Header (restaurant info + delivery/collection toggle pill)
│
├── Mobile bottom navigation bar (Menu / Saved / Cart / Orders / Profile)
├── Mobile category strip (horizontal scroll — shown when screen = "menu")
├── Desktop category sidebar (CategoryNav with scrollspy)
│
├── SearchAndFilters (text search + dietary filter pills)
│
├── BreakfastSection (shown only during configured time window)
│
└── MenuSection (category groups with IntersectionObserver ScrollSpy)
    └── MenuItemCard × N (with heart/favourite button for signed-in users)

Screens (managed by `screen` state — no page navigation):
├── "menu"       → main menu (default)
├── "favourites" → saved items grid (signed-in users)
├── "orders"     → My Orders — active card + past orders + Track Order modal
└── "profile"    → account details and saved addresses

Cart — desktop sticky sidebar / mobile full-screen drawer
```

**Delivery / Collection toggle:**
- Segmented pill in the hero section: Delivery | Collection
- `fulfillment` state from `AppContext`; persisted across checkout
- Delivery: shows estimated delivery time and delivery fee in cart
- Collection: shows estimated collection time; delivery fee row hidden

**Favourites:**
- Heart icon on `FoodCard` — visible only to signed-in customers
- `toggleFavourite(itemId)` in `AppContext` patches `customers.favourites` via `PATCH /api/customers/[id]`
- Favourites screen: grid of saved items with unfavourite button and "Add to order"

**My Orders:**
- Active order: dark zinc-900 card with pulsing Live badge and Track Order button
- Past orders: condensed list with Reorder button (re-adds all available items)
- Track Order modal: SVG progress bar across `pending → preparing → ready → delivered`; driver name/phone when assigned

**Reserve a Table:**
- Button in left sidebar Navigate section
- Gated by `settings.reservationSystem?.enabled`
- Opens the existing reservation modal

**Mobile Bottom Nav:**
- Fixed at bottom of viewport; iOS safe-area `env(safe-area-inset-bottom, 0px)` padding
- 5 tabs: Menu / Saved / Cart / Orders / Profile
- Cart tab: elevated orange circle with red badge for item count
- Active tab: orange text + 2.5 px orange top bar

**Checkout flow:**
1. Cart validates minimum order threshold
2. `CheckoutModal` opens
3. Geolocation detects delivery distance via Haversine formula
4. Matched `DeliveryZone` updates delivery fee in real time
5. Payment method list filtered by distance restriction
6. VAT, coupon, and store credit applied and displayed
7. Order created, print + email side effects fired
8. Fire-and-forget `POST /api/guest-profile` captures guest data for CRM

---

## 12. Admin Dashboard (`/admin`)

24 tabbed panels in 7 groups:

| Group | Panels |
|---|---|
| Orders | Delivery, Online Reports, Refunds |
| Menu | Menu Items, Breakfast |
| Customers | Customers, Guest Profiles, Drivers |
| Finance | Coupons, Tax & VAT, POS Reports |
| Settings | Operations, Schedule, Delivery Zones, Integrations, Email Templates, Staff & Tables, Reservations |
| Content & SEO | Footer Pages, Custom Pages, Navigation, Brand Colors, Footer Logos, Receipt |

---

## 13. Kitchen Display (`/kitchen`)

```
COLUMNS:
  New Orders  (status: pending | confirmed)  → "Start Preparing"
  Preparing   (status: preparing)            → "Mark Ready"
  Ready       (status: ready)                → display-only (+ "Mark as Collected" for POS/collection)
```

Urgency colour coding (self-updating every 30 s):
- Normal → < 15 min
- Amber → 15–29 min
- Red (pulsing) → ≥ 30 min

---

## 14. Driver Portal (`/driver`)

Order flow:
1. **Available orders** — delivery orders where `(status === "ready" || "preparing") && !driverId`
2. Driver accepts → `assignDriverToOrder()` sets `driverId`, `driverName`, `deliveryStatus = "assigned"`
3. Driver progresses through `assigned → picked_up → on_the_way → delivered`
4. `updateDeliveryStatus()` writes to Supabase; sets `status = "delivered"` on final step

Route protection: `middleware.ts` checks the `driver_session` cookie on every `/driver/*` request.

---

## 15. Integrations

### 15.1 Thermal Printer (ESC/POS)

```
New order placed
     │
printOrder() in lib/escpos.ts formats ESC/POS bytes
     │
POST to /api/print
     │
API route opens raw TCP socket → streams bytes to printer IP:port
```

### 15.2 Email (SMTP)

Six online order lifecycle events (`order_confirmation`, `order_confirmed`, `order_preparing`, `order_ready`, `order_delivered`, `order_cancelled`) plus four reservation events (`reservation_confirmation`, `reservation_update`, `reservation_cancellation`, `reservation_review_request`).

`sendOrderEmail()` → interpolates `{{variables}}` → `buildEmailDocument()` wraps with receipt branding → `POST /api/email` → SMTP relay.

`lib/emailServer.ts` handles server-side SMTP dispatch for auth emails (verification, password reset).

### 15.3 Geolocation + Delivery Zones

At checkout (delivery orders only):
1. `navigator.geolocation.getCurrentPosition()` fetches `(lat, lng)`
2. Haversine formula calculates distance to restaurant GPS coordinates
3. Smallest matching enabled `DeliveryZone` selected
4. Zone fee replaces the default delivery fee
5. Payment methods with distance restrictions applied

---

## 16. Security

### Authentication Summary

| Portal | Mechanism | Session storage | Expiry |
|---|---|---|---|
| Admin | httpOnly JWT cookie (`ADMIN_PASSWORD`, timing-safe compare) | httpOnly cookie | 24 hours |
| Customer | bcrypt + HMAC-signed `customer_session` cookie; Google OAuth | httpOnly cookie | 30 days |
| Driver | bcrypt + HMAC-signed `driver_session` cookie | httpOnly cookie | 30 days |
| Waiter | Server-side 4-digit PIN via `POST /api/waiter/auth` | In-memory React state | Page session |
| POS | Client-side 4-digit PIN in `localStorage` | In-memory React state | Page session |

### RLS Policy Summary

RLS is **enabled on every table**. The anon key — exposed in the browser — has read-only access on select tables.

| Table | Anon SELECT | Anon INSERT | Anon UPDATE | Anon DELETE |
|---|---|---|---|---|
| `app_settings` | Yes | No | No | No |
| `categories` | Yes | No | No | No |
| `menu_items` | Yes | No | No | No |
| `customers` | Yes (no auth columns) | No | No | No |
| `orders` | Yes | No | No | No |
| `drivers` | **No** | No | No | No |
| `reservation_customers` | **No** | No | No | No |

All write operations go through Next.js API routes using `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely and is never sent to the browser.

Full security details: [`docs/security.md`](docs/security.md)

---

*Last updated: May 2026*
