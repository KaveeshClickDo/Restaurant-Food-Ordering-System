# Single-Restaurant Food Ordering System

A full-featured, production-ready web application built on **Next.js 15** that combines seven distinct portals into a single codebase: a customer ordering site, a restaurant admin dashboard, a waiter table-service app, a kitchen display system (KDS), a driver delivery portal, a full Point-of-Sale (POS) terminal, and a customer display screen.

Online ordering data is persisted in **Supabase (PostgreSQL)** and synchronised in real time across all portals. The POS stores its working data in `localStorage` and is fully offline-capable — completed sales are saved locally first, then synced to Supabase in the background when connectivity is available.

---

## Table of Contents

- [Portals at a Glance](#portals-at-a-glance)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Application Portals](#application-portals)
  - [Customer Portal](#customer-portal-)
  - [Customer Account](#customer-account)
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
| Customer menu | `/` | None required (guest) or `customer_session` cookie | Customers browsing and ordering |
| Customer login | `/login` | — | Email + bcrypt, or Google OAuth |
| Customer account | `/account` | `customer_session` cookie (middleware-protected) | Logged-in customers |
| Waiter app | `/waiter` | 4-digit staff PIN (server-side) | Waiters placing dine-in orders |
| Kitchen display | `/kitchen` | None (trusted screen) | Kitchen staff progressing orders |
| Driver dashboard | `/driver` | `driver_session` cookie (middleware-protected) | Delivery drivers |
| Driver login | `/driver/login` | — | Email + bcrypt password |
| POS terminal | `/pos` | 4-digit staff PIN (client-side) | In-restaurant point-of-sale |
| Admin dashboard | `/admin` | `ADMIN_PASSWORD` env var + httpOnly cookie | Restaurant owner / manager |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS v4, Lucide React |
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime (`postgres_changes`) |
| Auth — customers | bcrypt + HMAC-signed httpOnly `customer_session` cookie; Google OAuth 2.0 |
| Auth — drivers | bcrypt + HMAC-signed httpOnly `driver_session` cookie; middleware route protection |
| Auth — admin | `ADMIN_PASSWORD` env var + httpOnly JWT cookie |
| Auth — waiters | 4-digit PIN in `app_settings`; validated server-side |
| Auth — POS staff | 4-digit PIN in `localStorage` (trusted local terminal) |
| POS storage | Browser `localStorage` (primary) + Supabase (background sync via outbox) |
| Offline sync | `lib/posOutbox.ts` — localStorage outbox with exponential back-off retry |
| State | `AppContext` (online ordering) + `POSContext` (POS) |
| Printer | ESC/POS over TCP (`/api/print` proxy) |
| Email | SMTP (`/api/email` proxy) |

---

## Getting Started

### Prerequisites

- Node.js 20+, npm 10+
- A Supabase project (any plan)

### Environment Variables

Copy `app/example.env` to `app/.env.local` and fill in your values:

```bash
cd app
cp example.env .env.local
```

The required variables:

```env
# Supabase — safe to expose to the browser
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Supabase service role — server-side only, never sent to the browser
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Admin dashboard password
ADMIN_PASSWORD=your-secure-admin-password

# HMAC secret for customer + driver session cookies (generate with: openssl rand -hex 64)
AUTH_JWT_SECRET=your-long-random-secret

# Canonical site URL (used for OAuth callbacks and password-reset links)
NEXT_PUBLIC_SITE_URL=https://yourdomain.com

# Google OAuth — optional; enables "Sign in with Google"
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Postgres connection string — only used by `npm run db:migrate`
# Get it from Supabase Dashboard → Connect → "Direct" or "Session pooler"
# Special chars in the password MUST be URL-encoded (e.g. `!` → `%21`, `^` → `%5E`)
DATABASE_URL=postgresql://postgres.<project-ref>:<encoded-password>@<host>:5432/postgres
```

Where to find each value in Supabase:

| Variable | Supabase location |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API Keys → URL (or top of Connect modal) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API Keys → **Legacy** tab → `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API Keys → **Legacy** tab → `service_role secret` |
| `DATABASE_URL` | Top-of-page **Connect** button → "Direct" or "Session pooler" tab |

> **SMTP and Stripe/PayPal credentials** are entered through the Admin → Integrations panel and stored in `app_settings`. They are never sent to the browser.

### Database Setup

A single command bootstraps an empty Supabase project — creating every table, applying RLS policies, and adding the auth columns:

```bash
cd app
npm install
npm run db:migrate
```

This runs [`app/migrate.mjs`](app/migrate.mjs), which executes (in order):

1. **Inline base schema** — creates `app_settings`, `categories`, `menu_items`, `customers`, `orders`, the `pos-walk-in` sentinel customer, and adds the core tables to the realtime publication
2. [`supabase/setup_all.sql`](supabase/setup_all.sql) — reservation tables (`reservations`, `reservation_customers`, `reservation_waitlist`)
3. [`supabase/rls_policies.sql`](supabase/rls_policies.sql) — `drivers` table + Row Level Security on every table
4. [`supabase/auth_migration.sql`](supabase/auth_migration.sql) — adds `password_hash`, `email_verified`, and password-reset columns to `customers`

Every step is idempotent — safe to re-run after schema changes. Requires `DATABASE_URL` in `.env.local`.

> **Heads up — don't run the SQL files individually in the Supabase SQL Editor.** They depend on each other and on the inline base schema in `migrate.mjs`. Use `npm run db:migrate` instead.

See [Database Schema](#database-schema) for full table definitions.

### Run the App

```bash
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

- Full menu grouped by category with sticky ScrollSpy sidebar
- Time-gated **Breakfast Menu** (appears only during configured morning hours)
- Search by name / description; filter by dietary tags (Vegan, Halal, Gluten-Free, etc.)
- Add items with variation, add-on, and special instruction selection
- **Delivery / Collection toggle** — visible pill switch in the hero section; updates estimated times, fee display, and checkout flow in real time
- Geolocation → Haversine formula → automatic delivery zone detection and fee
- Coupon codes with instant discount validation
- VAT breakdown when tax is enabled
- Payment methods filtered by distance restriction
- Guest or registered checkout; saved delivery addresses
- Schedule orders for a future time slot
- Store credit balance applied at checkout
- **Guest profile auto-capture**: after checkout, customer details are saved to `reservation_customers` for CRM use — no account required

**Customer-specific features (requires sign-in):**
- **Favourites** — heart icon on food cards; dedicated Favourites screen accessible via sidebar and mobile nav; persisted to `customers.favourites` in Supabase; one-tap "Add to order"
- **My Orders** — dark active order card with real-time status; past orders with Reorder button; **Track Order modal** showing step-by-step progress and driver information
- **Reserve a Table** — button in the sidebar Navigate section (gated by reservation system enabled setting)

**Mobile experience:**
- **Bottom navigation bar** — fixed tab bar with Menu, Saved, Cart, Orders, and Profile tabs; elevated cart button with badge; iOS safe-area insets

### Customer Authentication

Customers sign in via the `AuthModal` (modal overlay on `/`) or the dedicated `/login` page.

| Method | Flow |
|---|---|
| Email + password | `POST /api/auth/login` → bcrypt compare → sets `customer_session` httpOnly cookie |
| Google OAuth | `GET /api/auth/google` → consent screen → `GET /api/auth/google/callback` → session cookie |
| Registration | `POST /api/auth/register` → bcrypt hash stored; verification email sent |
| Password reset | "Forgot password?" → `POST /api/auth/reset-password` → signed link emailed |
| Email verification | `POST /api/auth/resend-verification` → `/api/auth/verify-email?token=...` |
| Logout | `POST /api/auth/logout` → clears cookie |

### Customer Account (screen within `/`)

- Full order history sorted newest-first
- Active orders highlighted with a pulsing **Live** badge
- **Kitchen tracker**: step dots for `pending → confirmed → preparing → ready`
- **Driver tracker**: separate progress for `assigned → picked_up → on_the_way → delivered`
- Track Order modal with progress bar and driver details
- Quick re-order (copies available items from a past order)
- Saved address management (add, edit, set default, delete)
- Profile editing (name, phone; email read-only)
- Store credit balance display
- Saved favourites count — click to jump to Favourites screen

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

#### Receipt

- On-screen HTML receipt modal (printable) with restaurant branding, VAT number, served-by, and table number
- Option to email the receipt to the customer

### Kitchen Display System (`/kitchen`)

Full-screen dark Kanban board for kitchen monitors. **No authentication required** — treated as a trusted in-restaurant screen.

#### Architecture

The KDS is **self-contained and independent of `AppContext`**. It queries the `orders` table directly with a `customer:customers(name)` JOIN. A dedicated Supabase Realtime channel (`kds-orders-live`) subscribes to all order changes; on each event the KDS re-fetches the full row (with JOIN) to keep display data accurate.

#### Columns

| Column | Statuses | Action |
|---|---|---|
| New Orders | `pending`, `confirmed` | Start Preparing |
| Preparing | `preparing` | Mark Ready |
| Ready | `ready` | Mark as Collected (POS/walk-in) |

#### Features

- Urgency colour coding: amber at 15 min, red at 30 min with pulse animation
- Fulfillment badge (Dine-In / Delivery / Collection / Scheduled)
- Completed-today counter, live clock, fullscreen mode
- Status advances via `PUT /api/kds/orders/[id]/status` (no admin auth required)
- Optimistic UI with automatic rollback on API failure

### Driver Dashboard (`/driver`)

- Email + bcrypt password login via `/driver/login`; issues an httpOnly `driver_session` cookie
- Middleware protects all `/driver` routes — unauthenticated requests redirect to `/driver/login`
- **Available orders** — unassigned delivery orders at `preparing` or `ready`, sorted by urgency
- Accept an order to claim it; progress: `Assigned → Picked Up → On the Way → Delivered`
- Confirm-before-deliver guard prevents accidental completion
- Call customer and Google Maps navigation links
- Completed deliveries log with total earnings
- Logout: `POST /api/auth/driver/logout`

### POS System (`/pos`)

A fully standalone in-restaurant terminal. Uses `POSContext` backed by `localStorage` — works entirely without an internet connection. After each sale, an order is pushed to Supabase via `POST /api/pos/orders` so it appears on the KDS.

#### Offline Mode

- **Connectivity probe**: a silent `HEAD /api/ping` request runs every 30 s (and every 5 s when offline) to detect real connectivity
- **Amber offline banner**: appears below the header with a count of pending-sync sales and a retry button
- **Card/split payments disabled**: when offline, only cash payments are accepted
- **Outbox queue** (`lib/posOutbox.ts`): any KDS sync that fails is saved to localStorage and retried automatically when connectivity restores, with exponential back-off (up to 5 attempts, base 2 s)
- **`beforeunload` guard**: warns staff before closing the browser tab if unsynced sales remain

#### Staff Authentication

4-digit PIN login with animated keypad.

| Role | Discount | Void Sale | Dashboard | Staff Mgmt | Menu Mgmt | Settings |
|---|---|---|---|---|---|---|
| Admin | Yes | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes | No | No |
| Cashier | No | No | No | No | No | No |

#### Sale Screen, Offers, Void & Refund, Reservations, Reports

See [`app/README.md`](app/README.md#pos-system-pos) for the full POS feature list.

---

## Admin Dashboard (`/admin`)

Password-protected (requires `ADMIN_PASSWORD` set in env). **24 tabbed panels** grouped into sections.

| Section | Panel | Description |
|---|---|---|
| Orders | Delivery | Live Kanban board with role-aware advance guards and new-order toast |
| Orders | Online Reports | Revenue KPIs, order volume, fulfilment breakdown for online orders |
| Orders | Refunds | Full or partial refund processing; refund history log |
| Menu | Menu Items | Category + item CRUD; dietary tags, variations, add-ons, images, stock |
| Menu | Breakfast | Separate breakfast menu with own categories, items, and time window |
| Customers | Customers | Customer list, order history, VIP/tag labels, manual status override |
| Customers | Guest Profiles | CRM view of all guests — reservations and online orders — with visit counts, spend, marketing opt-in, and CSV export |
| Customers | Drivers | Register driver accounts; toggle active/inactive |
| Finance | Coupons | Percentage and fixed-amount codes with usage limits and expiry |
| Finance | Tax & VAT | VAT rate, inclusive/exclusive mode, breakdown display |
| Finance | POS Reports | Full POS reporting (reads `localStorage`) |
| Settings | Operations | Branding, fees, address, GPS coordinates, global SEO, custom `<head>` |
| Settings | Schedule | Per-day open/close hours with manual override toggle |
| Settings | Delivery Zones | Concentric km-ring zone editor, per-zone fee, colour coding |
| Settings | Integrations | Stripe, PayPal, SMTP, thermal printer config |
| Settings | Email Templates | Event-based HTML email templates with variable substitution |
| Settings | Staff & Tables | Waiter staff management (PIN, role, avatar), dining table layout |
| Settings | Reservations | Reservation system config — slot duration, advance days, blackout dates, review URL |
| Content | Footer Pages | Rich HTML editor for 6 built-in pages (About, Terms, etc.) |
| Content | Custom Pages | Unlimited custom pages with SEO fields and publish toggle |
| Content | Navigation | Header + footer navigation link management |
| Content | Brand Colors | Brand accent colour + page background with live preview |
| Content | Footer Logos | Partner logos, payment icons, certification badges |
| Content | Receipt Settings | Logo, contact details, VAT number, thank-you message |

### Branding Single Source of Truth

The restaurant name, logo, and contact details set in **Admin → Operations** propagate automatically everywhere — POS header, POS receipts, POS email from-name, kitchen display, and all lifecycle emails. No separate branding configuration is needed per portal.

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

### Customer auth routes (no session required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new customer account (bcrypt hash, verification email) |
| `POST` | `/api/auth/login` | Login — bcrypt compare → sets `customer_session` cookie |
| `POST` | `/api/auth/logout` | Logout — clears `customer_session` cookie |
| `GET` | `/api/auth/me` | Return current customer from session cookie |
| `POST` | `/api/auth/verify-email` | Validate email verification token |
| `POST` | `/api/auth/resend-verification` | Resend verification email |
| `POST` | `/api/auth/reset-password` | Request or confirm password reset |
| `GET` | `/api/auth/google` | Initiate Google OAuth (CSRF state + redirect to Google) |
| `GET` | `/api/auth/google/callback` | Complete Google OAuth (code exchange + session cookie) |

### Driver auth routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/driver` | Driver login — bcrypt compare → sets `driver_session` cookie |
| `POST` | `/api/auth/driver/logout` | Driver logout — clears `driver_session` cookie |

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
| `GET` | `/api/admin/reservation-customers` | List all guest CRM profiles |
| `POST` | `/api/admin/seed` | Seed default categories + menu items |

### Customer-facing routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/orders` | Place a new online order |
| `POST` | `/api/guest-profile` | Upsert guest profile in `reservation_customers` after checkout |
| `PATCH` | `/api/customers/[id]` | Self-service profile patch (favourites, saved addresses) |
| `POST` | `/api/customers/[id]/spend-credit` | Deduct store credit at checkout |

### Waiter routes (no admin cookie — PIN auth handled separately)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/waiter/config` | Returns active staff (without PINs) and dining tables |
| `POST` | `/api/waiter/auth` | Validate staff PIN; returns staff record without PIN |
| `POST` | `/api/waiter/orders` | Insert a dine-in order into Supabase |
| `POST` | `/api/waiter/settle` | Mark table orders as `delivered`; record payment method |
| `POST` | `/api/waiter/void` | Cancel active orders (senior only enforced client-side) |
| `POST` | `/api/waiter/refund` | Process full/partial refund on settled orders |
| `POST` | `/api/waiter/logout` | Clear waiter session |

### POS routes (no admin cookie — trusted local terminal)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/pos/orders` | Bridge a POS sale into Supabase so it appears on the KDS |
| `PUT` | `/api/pos/orders/[id]/collected` | Mark a POS/collection order `delivered` (only from `ready`) |
| `GET` | `/api/pos/menu` | Fetch menu categories + items for the POS product grid |
| `GET` | `/api/pos/reservations` | Fetch reservations for POS Reservations tab |
| `POST` | `/api/pos/reservations` | Create a reservation from the POS |
| `PATCH` | `/api/pos/reservations/[id]` | Update reservation status (check-in / check-out / cancel) |

### Kitchen Display route (no auth — trusted in-restaurant screen)

| Method | Path | Description |
|---|---|---|
| `PUT` | `/api/kds/orders/[id]/status` | Advance an order through kitchen stages |

### Utility routes

| Method | Path | Description |
|---|---|---|
| `HEAD` | `/api/ping` | Connectivity probe — returns 204 (used by POS offline detection) |
| `POST` | `/api/print` | ESC/POS TCP proxy — forward receipt bytes to a network printer |
| `POST` | `/api/email` | SMTP proxy — send transactional email |

---

## Database Schema

### `app_settings`

Single JSONB row containing all admin-configurable settings: restaurant info, schedule, payment methods, delivery zones, email templates, menu links, custom pages, colours, receipt settings, coupons, tax settings, breakfast menu, **waiter staff**, **dining tables**, and **reservation system config**.

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
  password_hash    text not null default '',   -- bcrypt hash
  email_verified   boolean not null default false,
  created_at       timestamptz not null default now(),
  tags             text[] not null default '{}',
  favourites       text[] not null default '{}',
  saved_addresses  jsonb not null default '[]',
  store_credit     numeric not null default 0
);
```

The `pos-walk-in` sentinel row (`id = 'pos-walk-in'`) is pre-seeded so POS and waiter orders always have a valid `customer_id` FK.

The `password` (legacy) and `password_hash` columns are revoked from the anon PostgREST role — neither is ever returned to the browser.

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

### `reservation_customers`

Unified CRM table for all guests — populated from both table reservation bookings and online food orders.

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

### Customer authentication

Customers register with email + password; passwords are stored as **bcrypt hashes** (`password_hash` column). Login is handled server-side by `POST /api/auth/login` — the browser never touches the hash. Sessions are HMAC-signed tokens in httpOnly cookies (30-day expiry). Google OAuth is supported via the authorization code flow (`/api/auth/google` + callback).

Full details: [`docs/security.md`](docs/security.md)

### Admin dashboard

- `ADMIN_PASSWORD` environment variable — never in the database
- Login uses timing-safe comparison (`crypto.timingSafeEqual`)
- Session in an httpOnly, SameSite=Lax, Secure (production) cookie; 24-hour expiry
- All admin API routes call `isAdminAuthenticated()` before processing

### Driver app

- bcrypt password hash in the `drivers` table
- Session cookie issued on login; middleware protects all `/driver` routes
- `drivers` table has an explicit `deny_anon_all` RLS policy

### Waiter app

- PIN validation is **server-side only** via `POST /api/waiter/auth`
- `/api/waiter/config` returns staff profiles without PINs

### Supabase RLS

RLS is **enabled on every table**.

| Table | Anon SELECT | Anon INSERT | Anon UPDATE | Anon DELETE |
|---|---|---|---|---|
| `app_settings` | Yes | No | No | No |
| `categories` | Yes | No | No | No |
| `menu_items` | Yes | No | No | No |
| `customers` | Yes (no auth columns) | No | No | No |
| `orders` | Yes | No | No | No |
| `drivers` | **No** | No | No | No |
| `reservation_customers` | **No** | No | No | No |

All writes go through Next.js API routes using `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely and is never sent to the browser.

---

## Project Structure

```
app/src/
├── middleware.ts                         # Edge route protection — customer + driver sessions
├── instrumentation.ts                    # Next.js instrumentation hook
├── app/
│   ├── layout.tsx                        # Root layout — Inter font, AppProvider, SeoHead
│   ├── page.tsx                          # Customer portal (/) — menu, favourites, my orders, mobile nav
│   ├── login/page.tsx                    # Stand-alone login/forgot-password page (/login)
│   ├── verify-email/page.tsx             # Email verification landing (/verify-email)
│   ├── admin/page.tsx                    # Admin dashboard (/admin)
│   ├── waiter/page.tsx                   # Waiter app (/waiter)
│   ├── kitchen/page.tsx                  # Kitchen display (/kitchen)
│   ├── driver/
│   │   ├── page.tsx                      # Driver dashboard (/driver)
│   │   └── login/page.tsx                # Driver login (/driver/login)
│   ├── customer-display/page.tsx         # Customer-facing order status display
│   ├── pos/
│   │   ├── page.tsx                      # POS terminal (/pos)
│   │   ├── layout.tsx                    # POS layout (POSContext provider)
│   │   ├── login/page.tsx                # POS PIN login
│   │   └── error.tsx                     # POS error boundary
│   ├── [footerPage]/page.tsx             # Dynamic footer/custom page renderer
│   └── api/
│       ├── ping/route.ts                 # Connectivity probe — 204 response
│       ├── admin/
│       │   ├── auth/route.ts             # Admin login/logout/session check
│       │   ├── settings/route.ts         # Persist app_settings
│       │   ├── categories/               # Category CRUD
│       │   ├── menu/                     # Menu item CRUD
│       │   ├── orders/[id]/
│       │   │   ├── status/route.ts       # Advance order status
│       │   │   ├── refund/route.ts       # Process online order refund
│       │   │   └── driver/route.ts       # Assign driver / update delivery status
│       │   ├── customers/                # Customer CRUD
│       │   ├── drivers/                  # Driver CRUD (bcrypt password handling)
│       │   ├── reservation-customers/route.ts
│       │   └── seed/route.ts             # Seed default menu data
│       ├── auth/
│       │   ├── login/route.ts            # Customer login (bcrypt + cookie)
│       │   ├── logout/route.ts           # Customer logout
│       │   ├── me/route.ts               # Session refresh
│       │   ├── register/route.ts         # Customer registration
│       │   ├── verify-email/route.ts     # Email verification token
│       │   ├── resend-verification/route.ts
│       │   ├── reset-password/route.ts   # Password reset (request + confirm)
│       │   ├── google/route.ts           # OAuth initiation
│       │   ├── google/callback/route.ts  # OAuth code exchange
│       │   └── driver/
│       │       ├── route.ts              # Driver login
│       │       └── logout/route.ts       # Driver logout
│       ├── waiter/
│       │   ├── auth/route.ts             # PIN validation
│       │   ├── config/route.ts           # Staff list + tables
│       │   ├── orders/route.ts           # Insert dine-in order
│       │   ├── settle/route.ts           # Mark table paid
│       │   ├── void/route.ts             # Cancel active orders
│       │   ├── refund/route.ts           # Refund settled orders
│       │   └── logout/route.ts           # Waiter session clear
│       ├── pos/
│       │   ├── orders/route.ts           # Bridge POS sale → Supabase
│       │   ├── orders/[id]/collected/route.ts
│       │   ├── menu/route.ts             # Fetch menu for POS grid
│       │   └── reservations/
│       │       ├── route.ts              # GET all / POST create
│       │       └── [id]/route.ts         # PATCH status
│       ├── kds/orders/[id]/status/route.ts
│       ├── orders/route.ts               # Place online order
│       ├── guest-profile/route.ts        # Upsert guest CRM profile
│       ├── customers/[id]/
│       │   ├── route.ts                  # Self-service profile patch
│       │   └── spend-credit/route.ts     # Deduct store credit
│       ├── print/route.ts                # ESC/POS TCP proxy
│       └── email/route.ts                # SMTP send proxy
│
├── components/
│   ├── AuthModal.tsx                     # Login / Register modal (with Google OAuth)
│   ├── EmailVerificationBanner.tsx       # Unverified-email prompt bar
│   ├── Header.tsx / Footer.tsx / Cart.tsx
│   ├── BreakfastSection.tsx / MenuItemCard.tsx / MenuSection.tsx
│   ├── CategoryNav.tsx / SearchAndFilters.tsx
│   ├── CheckoutModal.tsx / ItemCustomizationModal.tsx
│   ├── ScheduleOrderModal.tsx / SeoHead.tsx
│   └── admin/
│       ├── DeliveryPanel.tsx / OnlineReportsPanel.tsx / RefundsPanel.tsx
│       ├── MenuManagementPanel.tsx / BreakfastMenuPanel.tsx
│       ├── CustomersPanel.tsx / ReservationCustomersPanel.tsx / DriversPanel.tsx
│       ├── CouponsPanel.tsx / TaxSettingsPanel.tsx / POSReportsPanel.tsx
│       ├── OperationsPanel.tsx / SchedulePanel.tsx / DeliveryZonesPanel.tsx
│       ├── IntegrationsPanel.tsx / EmailTemplatesPanel.tsx
│       ├── WaitersPanel.tsx / ReservationSystemPanel.tsx
│       ├── FooterPagesPanel.tsx / CustomPagesPanel.tsx / MenuLinksPanel.tsx
│       ├── ColorSettingsPanel.tsx / FooterLogosPanel.tsx / ReceiptSettingsPanel.tsx
│       └── RichEditor.tsx
│
├── context/
│   ├── AppContext.tsx                    # Global state — Supabase sync, auth, all online-ordering mutations
│   └── POSContext.tsx                   # POS state — sales, cart, staff, products, settings
│
├── data/
│   ├── menu.ts                          # Default category + item seed data
│   ├── restaurant.ts                    # Default restaurant info + schedule
│   ├── customers.ts                     # Mock customer seed data
│   └── footerPages.ts                   # 6 default footer pages
│
├── lib/
│   ├── auth.ts                          # HMAC session token helpers (shared by customer + driver)
│   ├── apiHandler.ts                    # Shared API route wrapper
│   ├── supabase.ts                      # Supabase browser client (anon key)
│   ├── supabaseAdmin.ts                 # Supabase server client (service role key)
│   ├── adminAuth.ts                     # Admin JWT cookie helpers
│   ├── emailServer.ts                   # Server-side SMTP email dispatcher
│   ├── connectivity.ts                  # useConnectivity() hook — probe-based online/offline detection
│   ├── posOutbox.ts                     # POS offline outbox — localStorage queue with retry
│   ├── escpos.ts                        # ESC/POS receipt formatter
│   ├── emailTemplates.ts                # Email template engine ({{variable}} interpolation)
│   ├── colorUtils.ts                    # Brand colour CSS variable generator
│   ├── scheduleUtils.ts                 # Store open/close time helpers
│   ├── stockUtils.ts                    # Stock status resolution
│   └── taxUtils.ts                      # VAT calculation utilities
│
└── types/
    ├── index.ts                         # Online ordering TypeScript interfaces
    └── pos.ts                           # POS TypeScript interfaces and helpers
```

---

*Last updated: May 2026*
