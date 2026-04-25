# Single-Restaurant Food Ordering System

A full-featured, production-ready web application built on **Next.js 15** that combines six distinct portals into a single codebase: a customer ordering site, a restaurant admin dashboard, a waiter table-service app, a kitchen display system (KDS), a driver delivery portal, and a full Point-of-Sale (POS) terminal.

Online ordering data is persisted in **Supabase (PostgreSQL)** and synchronised in real time across all portals. POS data is stored locally in `localStorage`.

---

## Table of Contents

- [Portals at a Glance](#portals-at-a-glance)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Application Portals](#application-portals)
  - [Customer Portal](#customer-portal-)
  - [Customer Account](#customer-account-account)
  - [Waiter App](#waiter-app-waiter)
  - [Kitchen Display System](#kitchen-display-system-kitchen)
  - [Driver Dashboard](#driver-dashboard-driver)
  - [POS System](#pos-system-pos)
- [Admin Dashboard](#admin-dashboard-admin)
- [Order Status Workflow](#order-status-workflow)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Security Model](#security-model)
- [Project Structure](#project-structure)

---

## Portals at a Glance

| Portal | Route | Authenticated by | Role |
|---|---|---|---|
| Customer menu | `/` | None (guest) | Customers browsing and ordering |
| Customer account | `/account` | Email + password | Customers tracking orders and profile |
| Waiter app | `/waiter` | 4-digit staff PIN | Waiters placing dine-in orders |
| Kitchen display | `/kitchen` | None (trusted screen) | Kitchen staff progressing orders |
| Driver dashboard | `/driver` | Email + bcrypt password | Delivery drivers |
| POS terminal | `/pos` | 4-digit staff PIN | In-restaurant point-of-sale |
| Admin dashboard | `/admin` | `ADMIN_PASSWORD` cookie | Restaurant owner / manager |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS v4, Lucide React |
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime (`postgres_changes`) |
| Auth — admin | `ADMIN_PASSWORD` env var + httpOnly JWT cookie |
| Auth — drivers | bcrypt hash stored in `drivers` table; validated server-side |
| Auth — waiters | 4-digit PIN stored in `app_settings`; validated server-side |
| Auth — POS staff | 4-digit PIN stored in `localStorage` (POS is a trusted local terminal) |
| POS storage | Browser `localStorage` |
| State | `AppContext` (online ordering) + `POSContext` (POS) |
| Printer | ESC/POS over TCP (`/api/print` proxy) |
| Email | SMTP (`/api/email` proxy) |

---

## Getting Started

### Prerequisites

- Node.js 20+, npm 10+
- A Supabase project (any plan)

### Environment Variables

Create `app/.env.local`:

```env
# Supabase — safe to expose to the browser
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Supabase service role — server-side only, never sent to the browser
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Admin dashboard password
ADMIN_PASSWORD=your-secure-admin-password
```

> **SMTP and Stripe/PayPal credentials** are entered through the Admin → Integrations panel and stored in `app_settings`. They are never sent to the browser.

### Database Setup

Run `supabase/rls_policies.sql` in the Supabase SQL Editor. That script:

1. Creates the `drivers` table (if it doesn't exist)
2. Enables Row Level Security on all tables
3. Applies per-table anon policies (read-only where appropriate)
4. Revokes `password` column from anon reads on `customers`
5. Seeds the `pos-walk-in` sentinel customer
6. Adds `voided_by`, `void_reason`, `voided_at` columns to `orders`

See [Database Schema](#database-schema) for the full table definitions.

### Installation

```bash
cd app
npm install
npm run dev          # http://localhost:3000
```

Seed data (categories, menu items, default settings) is written automatically on first load when the database tables are empty.

### Production Build

```bash
npm run build
npm start
```

---

## Application Portals

### Customer Portal (`/`)

- Full menu grouped by category with sticky scrollspy sidebar
- Time-gated **Breakfast Menu** (appears only during configured morning hours)
- Search by name / description; filter by dietary tags (Vegan, Halal, Gluten-Free, etc.)
- Add items with variation, add-on, and special instruction selection
- **Delivery** or **collection** fulfillment at checkout
- Geolocation → Haversine formula → automatic delivery zone detection and fee
- Coupon codes with instant discount validation
- VAT breakdown when tax is enabled
- Payment methods filtered by distance restriction
- Guest or registered checkout; saved delivery addresses
- Schedule orders for a future time slot

### Customer Account (`/account`)

- Full order history sorted newest-first
- Active orders highlighted with a pulsing **Live** badge
- **Kitchen tracker**: step dots for `pending → confirmed → preparing → ready`
- **Driver tracker**: separate progress card for `assigned → picked_up → on_the_way → delivered`
- Status badge reflects `deliveryStatus` in real time
- Quick re-order (copies available items from a past order into the cart)
- Saved address management (add, edit, set default, delete)
- Profile editing (name, phone; email is read-only)
- Store credit balance display

### Waiter App (`/waiter`)

A mobile-friendly table-service companion for dine-in staff. No admin cookie needed — authentication is via a **4-digit PIN** validated server-side by `/api/waiter/auth`.

#### Staff Roles

| Role | Place orders | View bill | Settle bill | Void table | Refund |
|---|---|---|---|---|---|
| `waiter` | Yes | Yes | Yes | No | No |
| `senior` | Yes | Yes | Yes | Yes | Yes |

#### Flow

1. **Login** — select staff profile, enter 4-digit PIN
2. **Tables** — colour-coded grid showing free / occupied tables per section (Main Hall, Terrace, Bar)
3. **Menu** — category-tabbed item grid; add items to cart with optional per-line notes
4. **Order sent** — cart posted to `/api/waiter/orders`; KDS picks it up instantly via Supabase Realtime
5. **Bill view** — aggregates all open order rounds for the table; shows itemised total
6. **Settle** — waiter selects Cash or Card; calls `/api/waiter/settle`; table clears

#### Void & Refund (Senior only)

- **Void** (before settlement) — cancels all active orders for the table with a mandatory reason; sets `status = "cancelled"` and records `void_reason`, `voided_by`, `voided_at`
- **Refund** (after settlement) — full or partial amount; cash or card method; distributes refund proportionally across multiple order rounds; sets `status = "refunded"` or `"partially_refunded"`; appends a `RefundRecord` to `orders.refunds`
- Non-senior staff see an access-denied screen when they attempt either action

#### Receipt

- On-screen HTML receipt modal (printable) with restaurant branding, VAT number, served-by, and table number
- Option to email the receipt to the customer

### Kitchen Display System (`/kitchen`)

Full-screen dark Kanban board for kitchen monitors. **No authentication required** — treated as a trusted in-restaurant screen.

#### Architecture

The KDS page is **self-contained and independent of `AppContext`**. It queries the `orders` table directly with a `customer:customers(name)` JOIN to get customer names without depending on AppContext's customer state array. A dedicated Supabase Realtime channel (`kds-orders-live`) subscribes to all order changes; on INSERT or UPDATE events the KDS re-fetches the full row (with JOIN) to keep display data accurate.

#### Columns

| Column | Statuses | Action |
|---|---|---|
| New Orders | `pending`, `confirmed` | Start Preparing |
| Preparing | `preparing` | Mark Ready |
| Ready | `ready` | Mark as Collected (POS/walk-in) |

#### Display Name resolution

| Order source | `displayName` shown |
|---|---|
| Dine-in (waiter) | `"Table T4"` — parsed from `[WAITER] Table T4 …` note |
| POS walk-in | Customer name from note, or `"Walk-in"` |
| Online order | Customer name from the `customers` JOIN |

Kitchen notes strip all metadata prefixes — staff see only the relevant instruction (e.g. `"No onions"`).

#### Features

- Urgency colour coding: amber at 15 min, red at 30 min with pulse animation
- Fulfillment badge (Dine-In / Delivery / Collection / Scheduled)
- Completed-today counter, live clock, fullscreen mode
- Status advances via `PUT /api/kds/orders/[id]/status` (no admin auth required)
- Mark-as-collected via `PUT /api/pos/orders/[id]/collected`
- Optimistic UI with automatic rollback on API failure

### Driver Dashboard (`/driver`)

- Email + password login (credentials created in Admin → Drivers; passwords stored as bcrypt hashes)
- **Available orders** — unassigned delivery orders at `preparing` or `ready`, sorted by urgency
- Accept an order to claim it; progress: `Assigned → Picked Up → On the Way → Delivered`
- Confirm-before-deliver guard prevents accidental completion
- Call customer and Google Maps navigation links
- Completed deliveries log with total earnings

### POS System (`/pos`)

A fully standalone in-restaurant terminal. Uses `POSContext` backed by `localStorage` — works entirely offline. After each sale, an order is mirrored to Supabase via `POST /api/pos/orders` so it appears on the KDS.

#### Staff Authentication

4-digit PIN login with animated keypad.

| Role | Discount | Void Sale | Dashboard | Staff Mgmt | Menu Mgmt | Settings |
|---|---|---|---|---|---|---|
| Admin | Yes | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes | No | No |
| Cashier | No | No | No | No | No | No |

#### Sale Screen

- Product grid grouped by category, colour-coded tiles, images (base64 in `localStorage`)
- Popular badge, active offer badge with auto-generated label
- Modifier / add-on selection modal
- Cart with +/− controls, discount (% or £), tip, customer assignment, table assignment
- Payment: **Cash** (with change calculator), **Card**, or **Split** (any mix)
- Loyalty points earned display
- Receipt modal: print or email to customer

#### Offers (6 types)

| Type | Description |
|---|---|
| `percent` | % off per unit |
| `fixed` | Fixed £ off per unit |
| `price` | Override to a set price per unit |
| `bogo` | Buy X get Y free |
| `multibuy` | Buy X items for £Y |
| `qty_discount` | Buy ≥ minimum quantity, get X% off each |

#### Void & Refund (POS)

- Requires Manager or Admin role
- Reason capture, refund method (Cash / Card / No Refund), editable refund amount
- Voided sales are excluded from revenue KPIs; visible via "Show voided" toggle

#### Reports

Period selector (Today / Yesterday / This Week / This Month / Last 30 Days / Custom):

- **Overview**: daily bar chart, payment method breakdown, hourly heatmap, financial summary
- **Items**: best-sellers ranked by revenue
- **Staff**: per-staff sales count, revenue, avg order value
- **Transactions**: searchable, sortable, inline void, export CSV

#### KDS Integration

On every completed sale, `POSContext.completeSale()` posts the sale to `POST /api/pos/orders`. The route maps POS cart items to `OrderLine[]`, builds a structured note (`[POS] | Customer: X | Staff: Y | Receipt: R1005`), and inserts the order with `fulfillment = "collection"` and `customer_id = "pos-walk-in"`. The KDS picks it up via Realtime within milliseconds.

#### Dine-In Void & Refund (from POS Dashboard)

The POS Dashboard → Dine-In tab allows Admin/Manager to void or refund dine-in orders that were placed via the waiter app — using the same `/api/waiter/void` and `/api/waiter/refund` endpoints.

---

## Admin Dashboard (`/admin`)

Password-protected (requires `ADMIN_PASSWORD` set in env). 22 tabbed panels grouped into sections.

| Section | Panel | Description |
|---|---|---|
| Orders | Delivery | Live Kanban board with role-aware advance guards and new-order toast |
| Orders | Online Reports | Revenue KPIs, order volume, fulfilment breakdown for online orders |
| Orders | Refunds | Full or partial refund processing; refund history log |
| Menu | Menu Items | Category + item CRUD; dietary tags, variations, add-ons, images, stock |
| Menu | Breakfast | Separate breakfast menu with own categories, items, and time window |
| Customers | Customers | Customer list, order history, VIP/tag labels, manual status override |
| Customers | Drivers | Register driver accounts; toggle active/inactive |
| Finance | Coupons | Percentage and fixed-amount codes with usage limits and expiry |
| Finance | Tax & VAT | VAT rate, inclusive/exclusive mode, breakdown display |
| Finance | POS Reports | Full POS reporting (reads `localStorage`) |
| Settings | Operations | Branding, fees, address, GPS coordinates, global SEO, custom `<head>` |
| Settings | Schedule | Per-day open/close hours with manual override toggle |
| Settings | Delivery Zones | Concentric km-ring zone editor, per-zone fee, colour coding |
| Settings | Integrations | Stripe, PayPal, SMTP, thermal printer config |
| Settings | Email Templates | 6 event-based HTML email templates with variable substitution |
| Settings | Staff & Tables | Waiter staff management (PIN, role, avatar), dining table layout |
| Content | Footer Pages | Rich HTML editor for 6 built-in pages (About, Terms, etc.) |
| Content | Custom Pages | Unlimited custom pages with SEO fields and publish toggle |
| Content | Navigation | Header + footer navigation link management |
| Content | Brand Colors | Brand accent colour + page background with live preview |
| Content | Footer Logos | Partner logos, payment icons, certification badges |
| Content | Receipt Settings | Logo, contact details, VAT number, thank-you message |

---

## Order Status Workflow

### Kitchen / Admin status

```
pending → confirmed → preparing → ready
                                    │
          (collection) ─────────────┴──→ delivered   [admin or KDS marks collected]
          (dine-in)    ─────────────────→ delivered   [waiter settles bill]
          (delivery)   ─────────────────→ [driver picks up]
```

| Status | Set by | Meaning |
|---|---|---|
| `pending` | Customer checkout / Waiter app / POS | Order just placed |
| `confirmed` | Admin | Restaurant acknowledged |
| `preparing` | Admin or KDS | Kitchen is cooking |
| `ready` | KDS | Food ready for collection or driver |
| `delivered` | Admin (collection), Waiter app (dine-in), or Driver | Completed |
| `cancelled` | Admin or Waiter (void) | Order cancelled / voided |
| `refunded` | Admin or Waiter (senior) | Full refund processed |
| `partially_refunded` | Admin or Waiter (senior) | Partial refund processed |

**Role guard**: Admin cannot advance delivery orders past `ready` — only the driver can mark them delivered.

### Driver status (`deliveryStatus`) — delivery orders only

```
assigned → picked_up → on_the_way → delivered
```

Setting `delivered` automatically sets `order.status = "delivered"`.

---

## API Reference

All routes use the **service role key** (`supabaseAdmin`) server-side. The anon key is never used for writes.

### Admin routes (require `admin_session` cookie)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/auth` | Login (sets httpOnly cookie) |
| `GET` | `/api/admin/auth` | Check session status |
| `DELETE` | `/api/admin/auth` | Logout (clears cookie) |
| `POST` | `/api/admin/settings` | Persist `app_settings` |
| `GET` | `/api/admin/categories` | List categories |
| `POST` | `/api/admin/categories` | Create category or batch-reorder |
| `PUT` | `/api/admin/categories/[id]` | Update category |
| `DELETE` | `/api/admin/categories/[id]` | Delete category |
| `POST` | `/api/admin/menu` | Create menu item |
| `PUT` | `/api/admin/menu/[id]` | Update menu item |
| `DELETE` | `/api/admin/menu/[id]` | Delete menu item |
| `PUT` | `/api/admin/orders/[id]/status` | Advance order status |
| `POST` | `/api/admin/orders/[id]/refund` | Process online order refund |
| `PUT` | `/api/admin/orders/[id]/driver` | Assign driver / update delivery status |
| `GET` | `/api/admin/customers` | List customers |
| `POST` | `/api/admin/customers` | Create customer |
| `PUT` | `/api/admin/customers/[id]` | Full customer update |
| `GET` | `/api/admin/drivers` | List drivers |
| `POST` | `/api/admin/drivers` | Create driver (hashes password) |
| `PUT` | `/api/admin/drivers/[id]` | Update driver |
| `DELETE` | `/api/admin/drivers/[id]` | Delete driver |
| `POST` | `/api/admin/seed` | Seed default categories + menu items |

### Customer-facing routes (no auth required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/orders` | Place a new online order |
| `PATCH` | `/api/customers/[id]` | Self-service profile patch (favourites, saved addresses) |
| `POST` | `/api/customers/[id]/spend-credit` | Deduct store credit at checkout |
| `POST` | `/api/auth/register` | Register a new customer account |

### Driver routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/driver` | Driver login (validates bcrypt hash) |

### Waiter routes (no admin cookie — PIN auth is handled separately)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/waiter/config` | Returns active staff (without PINs) and dining tables |
| `POST` | `/api/waiter/auth` | Validate staff PIN; returns staff record without PIN |
| `POST` | `/api/waiter/orders` | Insert a dine-in order into Supabase |
| `POST` | `/api/waiter/settle` | Mark table orders as `delivered`; record payment method |
| `POST` | `/api/waiter/void` | Cancel active orders (senior only enforced client-side) |
| `POST` | `/api/waiter/refund` | Process full/partial refund on settled orders |

### POS routes (no admin cookie — POS is a trusted local terminal)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/pos/orders` | Bridge a POS sale into Supabase so it appears on the KDS |
| `PUT` | `/api/pos/orders/[id]/collected` | Mark a POS/collection order `delivered` (only from `ready`) |
| `GET` | `/api/pos/menu` | Fetch menu categories + items for the POS product grid |

### Kitchen Display route (no auth — trusted in-restaurant screen)

| Method | Path | Description |
|---|---|---|
| `PUT` | `/api/kds/orders/[id]/status` | Advance an order through kitchen stages (`pending→confirmed→preparing→ready`) |

### Utility routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/print` | ESC/POS TCP proxy — forward receipt bytes to a network printer |
| `POST` | `/api/email` | SMTP proxy — send transactional email |

---

## Database Schema

### `app_settings`

```sql
create table app_settings (
  id         integer primary key default 1,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);
```

Single JSONB row containing all admin-configurable settings: restaurant info, schedule, payment methods, delivery zones, email templates, menu links, custom pages, colours, receipt settings, coupons, tax settings, breakfast menu, **waiter staff**, and **dining tables**.

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
  saved_addresses  jsonb not null default '[]',
  store_credit     numeric not null default 0
);
```

The `pos-walk-in` sentinel row (`id = 'pos-walk-in'`) is pre-seeded so POS and waiter orders always have a valid `customer_id` FK.

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
  -- Void / cancel audit
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

### Enable Realtime

```sql
alter publication supabase_realtime add table app_settings;
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table menu_items;
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table orders;
```

---

## Security Model

### Admin dashboard

- `ADMIN_PASSWORD` environment variable — never in the database
- Login via `POST /api/admin/auth` uses timing-safe comparison (`crypto.timingSafeEqual`)
- On success, an httpOnly, SameSite=Lax, Secure (production) cookie is set
- All admin API routes call `isAdminAuthenticated()` before processing
- Session expiry: 24 hours

### Waiter app

- PIN validation is **server-side only** via `POST /api/waiter/auth`
- `/api/waiter/config` returns staff profiles without PINs
- Void and Refund are gated client-side by `waiter.role === "senior"` — the API routes do not re-check role (the waiter app is a trusted in-restaurant screen)

### Driver app

- Passwords stored as **bcrypt hashes** in the `drivers` table (separate from `app_settings`)
- Validated server-side via `POST /api/auth/driver`
- The `drivers` table has an explicit `deny_anon_all` RLS policy

### Supabase RLS

| Table | Anon SELECT | Anon INSERT | Anon UPDATE | Anon DELETE |
|---|---|---|---|---|
| `app_settings` | Yes | No | No | No |
| `categories` | Yes | No | No | No |
| `menu_items` | Yes | No | No | No |
| `customers` | Yes (no `password` col) | No | No | No |
| `orders` | Yes | No | No | No |
| `drivers` | No | No | No | No |

All writes go through Next.js API routes that use the **service role key** (`SUPABASE_SERVICE_ROLE_KEY`), which bypasses RLS entirely. The anon key (exposed in the browser) is read-only.

### Column-level security

```sql
revoke select (password) on customers from anon;
```

The `password` column on `customers` is revoked from the anon role so PostgREST never returns it to browser clients.

---

## Project Structure

```
app/src/
├── app/
│   ├── layout.tsx                    # Root layout — Inter font, AppProvider, SeoHead
│   ├── page.tsx                      # Customer portal (/)
│   ├── account/page.tsx              # Customer account (/account)
│   ├── admin/page.tsx                # Admin dashboard (/admin)
│   ├── waiter/page.tsx               # Waiter app (/waiter)
│   ├── kitchen/page.tsx              # Kitchen display (/kitchen)
│   ├── driver/
│   │   ├── page.tsx                  # Driver dashboard (/driver)
│   │   └── login/page.tsx            # Driver login (/driver/login)
│   ├── customer-display/page.tsx     # Customer-facing order status display
│   ├── pos/
│   │   ├── page.tsx                  # POS terminal (/pos)
│   │   ├── layout.tsx                # POS layout (POSContext provider)
│   │   ├── login/page.tsx            # POS PIN login
│   │   └── error.tsx                 # POS error boundary
│   ├── [footerPage]/page.tsx         # Dynamic footer/custom page renderer
│   └── api/
│       ├── admin/
│       │   ├── auth/route.ts         # Admin login/logout/session check
│       │   ├── settings/route.ts     # Persist app_settings
│       │   ├── categories/           # Category CRUD
│       │   ├── menu/                 # Menu item CRUD
│       │   ├── orders/[id]/
│       │   │   ├── status/route.ts   # Advance order status (admin-only)
│       │   │   ├── refund/route.ts   # Process online order refund
│       │   │   └── driver/route.ts   # Assign driver / update delivery status
│       │   ├── customers/            # Customer CRUD
│       │   ├── drivers/              # Driver CRUD (bcrypt password handling)
│       │   └── seed/route.ts         # Seed default menu data
│       ├── waiter/
│       │   ├── auth/route.ts         # PIN validation (returns staff sans PIN)
│       │   ├── config/route.ts       # Staff list (no PINs) + tables
│       │   ├── orders/route.ts       # Insert dine-in order
│       │   ├── settle/route.ts       # Mark table as paid (delivered)
│       │   ├── void/route.ts         # Cancel active orders (void)
│       │   └── refund/route.ts       # Refund settled orders
│       ├── pos/
│       │   ├── orders/route.ts       # Bridge POS sale → Supabase (KDS)
│       │   ├── orders/[id]/collected/route.ts  # Mark order collected
│       │   └── menu/route.ts         # Fetch menu for POS grid
│       ├── kds/
│       │   └── orders/[id]/status/route.ts     # Kitchen status advance (no auth)
│       ├── orders/route.ts           # Place online order
│       ├── auth/
│       │   ├── register/route.ts     # Register customer
│       │   └── driver/route.ts       # Driver login (bcrypt check)
│       ├── customers/[id]/
│       │   ├── route.ts              # Self-service profile patch
│       │   └── spend-credit/route.ts # Deduct store credit
│       ├── print/route.ts            # ESC/POS TCP proxy
│       └── email/route.ts            # SMTP send proxy
│
├── components/
│   ├── Header.tsx                    # Restaurant info + navigation
│   ├── Footer.tsx                    # Footer with managed nav links
│   ├── Cart.tsx                      # Order basket (desktop sidebar + mobile drawer)
│   ├── BreakfastSection.tsx          # Time-gated breakfast menu card
│   ├── MenuItemCard.tsx              # Individual menu item row
│   ├── MenuSection.tsx               # Category-grouped item list
│   ├── CategoryNav.tsx               # Sidebar category nav (desktop)
│   ├── SearchAndFilters.tsx          # Search + dietary filter pills
│   ├── CheckoutModal.tsx             # Checkout flow — form, geolocation, payment
│   ├── ScheduleOrderModal.tsx        # Future time slot picker
│   ├── ItemCustomizationModal.tsx    # Variations, add-ons, instructions
│   ├── AuthModal.tsx                 # Login / Register modal
│   ├── SeoHead.tsx                   # Reactive <title> + <meta> from admin settings
│   └── admin/
│       ├── DeliveryPanel.tsx         # Live order Kanban
│       ├── OnlineReportsPanel.tsx    # Online order revenue reports
│       ├── RefundsPanel.tsx          # Online order refunds
│       ├── MenuManagementPanel.tsx   # Menu CRUD
│       ├── BreakfastMenuPanel.tsx    # Breakfast menu CRUD
│       ├── CustomersPanel.tsx        # Customer management
│       ├── DriversPanel.tsx          # Driver management
│       ├── CouponsPanel.tsx          # Coupon management
│       ├── TaxSettingsPanel.tsx      # VAT configuration
│       ├── POSReportsPanel.tsx       # POS finance reports (reads localStorage)
│       ├── OperationsPanel.tsx       # Branding, fees, SEO
│       ├── SchedulePanel.tsx         # Opening hours
│       ├── DeliveryZonesPanel.tsx    # Zone editor
│       ├── IntegrationsPanel.tsx     # Stripe, PayPal, SMTP, printer
│       ├── EmailTemplatesPanel.tsx   # Email template editor
│       ├── WaitersPanel.tsx          # Waiter staff + dining table management
│       ├── FooterPagesPanel.tsx      # Built-in footer page editor
│       ├── CustomPagesPanel.tsx      # Custom page CMS
│       ├── MenuLinksPanel.tsx        # Navigation management
│       ├── ColorSettingsPanel.tsx    # Brand colour editor
│       ├── FooterLogosPanel.tsx      # Partner / payment logos
│       ├── ReceiptSettingsPanel.tsx  # Receipt branding
│       └── RichEditor.tsx            # Shared HTML rich-text editor
│
├── context/
│   ├── AppContext.tsx                # Global state — Supabase sync, all online-ordering mutations
│   └── POSContext.tsx                # POS state — sales, cart, staff, products, settings
│
├── data/
│   ├── menu.ts                       # Default category + item seed data
│   ├── restaurant.ts                 # Default restaurant info + schedule
│   ├── customers.ts                  # Mock customer seed data
│   └── footerPages.ts                # 6 default footer pages
│
├── lib/
│   ├── supabase.ts                   # Supabase browser client (anon key)
│   ├── supabaseAdmin.ts              # Supabase server client (service role key)
│   ├── adminAuth.ts                  # Admin JWT cookie helpers
│   ├── escpos.ts                     # ESC/POS receipt formatter
│   ├── emailTemplates.ts             # Email template engine ({{variable}} interpolation)
│   ├── colorUtils.ts                 # Brand colour CSS variable generator
│   ├── scheduleUtils.ts              # Store open/close time helpers
│   ├── stockUtils.ts                 # Stock status resolution
│   └── taxUtils.ts                   # VAT calculation utilities
│
└── types/
    ├── index.ts                      # Online ordering TypeScript interfaces
    └── pos.ts                        # POS TypeScript interfaces and helpers
```

---

*Last updated: April 2026*
