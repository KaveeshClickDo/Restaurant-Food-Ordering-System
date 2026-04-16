# Single-Restaurant Food Ordering System

A full-featured, production-ready web application that combines a **customer-facing ordering portal**, a **restaurant admin dashboard**, a **kitchen display system**, and a **driver delivery portal** into a single Next.js 15 application. Data is persisted in **Supabase (PostgreSQL)** and synchronised in real time across all devices and roles via Supabase Realtime.

---

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Application Portals](#application-portals)
- [Admin Dashboard Panels](#admin-dashboard-panels)
- [Order Status Workflow](#order-status-workflow)
- [Key Features](#key-features)
- [Integrations](#integrations)
- [Project Structure](#project-structure)

---

## Overview

The system serves four distinct user roles, each with a dedicated portal:

| Portal | Route | Role |
|---|---|---|
| Customer menu | `/` | Customers browsing and ordering |
| Customer account | `/account` | Customers tracking orders and managing profile |
| Admin dashboard | `/admin` | Restaurant staff managing all operations |
| Kitchen display | `/kitchen` | Kitchen staff viewing and progressing live orders |
| Driver dashboard | `/driver` | Delivery drivers managing their assigned deliveries |

All portals share a single React context backed by Supabase. A status change made by the admin (or driver, or kitchen) appears on every other connected screen within milliseconds — no page reload required.

---

## Technology Stack

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
| Printer Integration | ESC/POS over TCP (Next.js API route proxy) |
| Email Integration | SMTP via Next.js API route |
| Dev Server | `next dev --turbopack` |

---

## Getting Started

### Prerequisites

| Dependency | Version |
|---|---|
| Node.js | 20+ |
| npm | 10+ |
| Supabase project | Any plan |

### Environment Setup

Create `app/.env.local` with your Supabase project credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Database Schema

Run the following SQL in your Supabase SQL editor to create the required tables:

```sql
-- Admin settings (single JSONB row)
create table app_settings (
  id      integer primary key default 1,
  data    jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- Menu categories
create table categories (
  id         text primary key,
  name       text not null,
  emoji      text not null default '',
  sort_order integer not null default 0
);

-- Menu items
create table menu_items (
  id          text primary key,
  category_id text not null references categories(id) on delete cascade,
  name        text not null,
  description text not null default '',
  price       numeric not null,
  image       text,
  dietary     text[] not null default '{}',
  popular     boolean not null default false,
  variations  jsonb,
  add_ons     jsonb,
  stock_qty   integer,
  stock_status text,
  sort_order  integer not null default 0
);

-- Customers
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

-- Orders
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

-- Enable Realtime on all tables
alter publication supabase_realtime add table app_settings;
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table menu_items;
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table orders;
```

### Installation

```bash
cd app
npm install
```

### Development

```bash
npm run dev
```

The app starts at `http://localhost:3000`. Seed data is written automatically on first load if the database tables are empty.

### Production Build

```bash
npm run build
npm start
```

---

## Application Portals

### Customer Portal (`/`)

- Browse the full menu grouped by category with a scrollspy sidebar
- Time-gated **Breakfast Menu** shown only during configured morning hours
- Search by name/description and filter by dietary tags (Vegan, Halal, Gluten-Free, etc.)
- Add items to cart with variation and add-on selection, special instructions
- Choose delivery or collection at checkout
- Geolocation detects delivery zone and applies the correct fee
- Coupon codes with instant discount calculation
- VAT breakdown displayed when tax is enabled
- Payment method list filtered by distance restriction
- Guest or registered checkout with saved delivery addresses
- Schedule orders for a future time slot

### Customer Account (`/account`)

- Full order history sorted newest-first
- Live status tracking: kitchen step tracker + driver leg tracker for delivery orders
- Status badge reflects `deliveryStatus` in real time — shows "On the Way" when driver is en route, not "Ready for Pickup"
- Quick re-order button copies all available items from a past order into the current cart
- Saved addresses management (add, edit, set default, delete)
- Profile editing (name, phone; email is read-only)

### Kitchen Display (`/kitchen`)

Full-screen dark Kanban board for kitchen monitors:

- **Three columns**: New Orders (pending/confirmed), Preparing, Ready
- Urgency colour coding — amber at 15 min, red at 30 min with pulse animation
- Per-card fulfillment badge (Delivery / Collection)
- **Ready column is display-only** — kitchen's job ends when an order is marked ready; driver handles delivery, admin handles collection
- Completed-today counter increments each time an order moves to ready
- Fullscreen mode, live clock, real-time Supabase sync

### Driver Dashboard (`/driver`)

- Password-authenticated login (credentials set in Admin → Drivers)
- **Available orders** section — unassigned delivery orders at "preparing" or "ready" status, sorted by urgency
- Accept an order to claim it; it moves to your active deliveries
- Progress through the delivery leg: **Assigned → Picked Up → On the Way → Delivered**
- Confirm-before-deliver guard prevents accidental completion
- Completed deliveries log with total earnings value

---

## Admin Dashboard Panels

18 tabbed panels, all changes persisted immediately to Supabase:

| Tab | Panel | Description |
|---|---|---|
| Menu Items | `MenuManagementPanel` | Category + item CRUD; dietary tags, variations, add-ons, image, popular flag, stock tracking |
| Breakfast | `BreakfastMenuPanel` | Separate breakfast menu with own categories, items, and time-window config |
| Customers | `CustomersPanel` | Customer list, order history, VIP/tag labels, manual status override |
| Delivery | `DeliveryPanel` | Live Kanban board; role-aware advance guards; new-order toast notification |
| Zones | `DeliveryZonesPanel` | Concentric km-ring zone editor, per-zone fee, colour coding |
| Operations | `OperationsPanel` | Branding, fees, address, GPS coordinates, global SEO, custom `<head>` code |
| Schedule | `SchedulePanel` | Per-day open/close hours with manual override toggle |
| Integrations | `IntegrationsPanel` | Stripe, PayPal, SMTP credentials; thermal printer configuration |
| Email | `EmailTemplatesPanel` | 6 event-based HTML email templates with variable substitution and live preview |
| Footer Pages | `FooterPagesPanel` | Rich HTML editor for 6 built-in pages, visibility toggle, copyright text |
| Custom Pages | `CustomPagesPanel` | Unlimited custom pages, slug management, SEO fields, publish toggle |
| Menus | `MenuLinksPanel` | Header + footer navigation management — assign pages, reorder, toggle |
| Colors | `ColorSettingsPanel` | Brand accent colour + page background — live preview across the entire site |
| Logos | `FooterLogosPanel` | Partner logos, payment icons, certification badges for the footer |
| Receipt | `ReceiptSettingsPanel` | Logo, contact details, VAT number, messages — applied to all printed/emailed receipts |
| Coupons | `CouponsPanel` | Percentage and fixed-amount discount codes with usage limits and expiry dates |
| Tax | `TaxSettingsPanel` | VAT rate, inclusive/exclusive mode, breakdown display on cart and receipts |
| Drivers | `DriversPanel` | Register driver accounts, view assignments, toggle active/inactive |

---

## Order Status Workflow

The order lifecycle uses two separate fields on the `Order` record — one for the kitchen/admin leg and one for the driver leg:

### Kitchen / Admin leg (`status: OrderStatus`)

```
pending → confirmed → preparing → ready
                                    │
              (collection) ─────────┴──→ delivered   [admin marks collected]
              (delivery)   ─────────────→ [driver takes over]
```

| Status | Set by | Meaning |
|---|---|---|
| `pending` | Customer checkout | Order just placed |
| `confirmed` | Admin | Restaurant has acknowledged the order |
| `preparing` | Admin or kitchen | Kitchen has started cooking |
| `ready` | Kitchen | Food is ready; kitchen's job ends here |
| `delivered` | Admin (collection) or driver (delivery) | Order completed |
| `cancelled` | Admin | Order cancelled |

**Role guard**: Admin cannot advance delivery orders past `ready` — only the driver can mark them delivered.

### Driver leg (`deliveryStatus: DeliveryStatus`) — delivery orders only

```
assigned → picked_up → on_the_way → delivered
```

When the driver marks `delivered`, `order.status` is automatically set to `"delivered"`.

### What each role controls

| Role | Allowed transitions |
|---|---|
| Admin | `pending → confirmed → preparing → ready`; `ready → delivered` for collection orders only |
| Kitchen | `pending/confirmed → preparing`; `preparing → ready` |
| Driver | `assigned → picked_up → on_the_way → delivered` |
| Customer | Read-only |

---

## Key Features

### Real-Time Sync (Supabase Realtime)

`AppContext` subscribes to `postgres_changes` events on all five tables (`app_settings`, `categories`, `menu_items`, `customers`, `orders`). Any mutation — whether made by the admin panel, kitchen display, or driver app — propagates to every connected session within milliseconds.

### Breakfast Menu

A separate breakfast menu can be configured with its own categories and items. The admin sets an enabled toggle and a time window (e.g. 07:00–11:30). During those hours, a collapsible amber-themed "Breakfast Menu" card appears above the main menu on the customer portal.

### Coupon System

Admins create coupon codes with:
- **Type**: percentage (e.g. 15% off) or fixed amount (e.g. £5 off)
- **Minimum order**: optional cart subtotal threshold
- **Usage limit**: maximum redemptions (0 = unlimited)
- **Expiry date**: optional ISO date (blank = never expires)

Usage count is incremented in Supabase on every successful redemption.

### VAT / Tax

Configurable in Admin → Tax:
- Enable/disable globally
- Set rate (e.g. 20%)
- **Inclusive mode**: prices already include VAT — the system extracts and displays the VAT component
- **Exclusive mode**: VAT is added on top at checkout
- Optional VAT breakdown line shown on cart, checkout modal, printed receipts, and order emails

### Delivery Zones & Geolocation

At checkout (delivery orders only):
1. Browser Geolocation API fetches `(lat, lng)` with user permission
2. Haversine formula calculates distance to the restaurant's GPS coordinates (set in Admin → Operations)
3. The smallest matching enabled `DeliveryZone` is selected and its fee applied
4. Payment methods with distance restrictions are hidden when the customer is out of range

### Thermal Printer (ESC/POS)

Configured in Admin → Integrations. Orders are formatted as ESC/POS byte sequences and streamed to a network printer via the `/api/print` route. Supports 80 mm (48 chars/line) and 58 mm (32 chars/line) paper widths.

### Email Templates

Six lifecycle events each have a fully editable HTML email template in Admin → Email. Templates use `{{variable}}` interpolation for customer name, order ID, items table, total, fulfillment type, estimated time, and restaurant details. Receipt settings (logo, VAT number, custom message) are automatically applied to every outgoing email.

### Custom Pages & Navigation

- Create unlimited custom pages (Admin → Custom Pages) with rich HTML content, SEO title/description, and a custom slug
- Assign any page — custom or built-in footer page — to the header or footer navigation (Admin → Menus)
- Built-in footer pages: About Us, Contact Us, Terms, Privacy, Cookies, Accessibility

---

## Integrations

### Thermal Printer

| Setting | Description |
|---|---|
| IP address | Static IP of the ESC/POS-compatible network printer |
| TCP port | Default `9100` |
| Paper width | 80 mm (48 chars) or 58 mm (32 chars) |
| Auto-print | Print automatically on every new order |

### Email (SMTP)

| Setting | Description |
|---|---|
| SMTP Host | e.g. `smtp.gmail.com` |
| Port | Default `587` |
| Username | SMTP login email |
| Password | SMTP login password |

SMTP credentials are proxied through `/api/email` and never exposed to the client.

### Stripe & PayPal

API keys are stored in `app_settings` in Supabase and used client-side via the Stripe.js / PayPal SDK. Card data never touches the application server.

---

## Project Structure

```
app/src/
├── app/
│   ├── layout.tsx                  # Root layout — Inter font, AppProvider, SEO
│   ├── page.tsx                    # Customer portal — menu page (/)
│   ├── account/
│   │   └── page.tsx                # Customer account dashboard (/account)
│   ├── admin/
│   │   └── page.tsx                # Admin dashboard (/admin) — 18 tabbed panels
│   ├── kitchen/
│   │   └── page.tsx                # Kitchen display (/kitchen)
│   ├── driver/
│   │   ├── page.tsx                # Driver dashboard (/driver)
│   │   └── login/page.tsx          # Driver login (/driver/login)
│   ├── [footerPage]/
│   │   └── page.tsx                # Dynamic page renderer (/[slug])
│   └── api/
│       ├── print/route.ts          # ESC/POS TCP proxy
│       └── email/route.ts          # SMTP send proxy
│
├── components/
│   ├── Header.tsx                  # Restaurant info card + header nav
│   ├── Footer.tsx                  # Footer with managed nav links
│   ├── Cart.tsx                    # Order basket (desktop sidebar + mobile drawer)
│   ├── BreakfastSection.tsx        # Time-gated breakfast menu card
│   ├── MenuItemCard.tsx            # Individual menu item row
│   ├── MenuSection.tsx             # Category-grouped item list
│   ├── CategoryNav.tsx             # Sidebar category navigation (desktop)
│   ├── SearchAndFilters.tsx        # Search input + dietary filter pills
│   ├── CheckoutModal.tsx           # Checkout flow — form, geolocation, payment
│   ├── ScheduleOrderModal.tsx      # Future time slot picker
│   ├── ItemCustomizationModal.tsx  # Variations, add-ons, instructions
│   ├── AuthModal.tsx               # Login / Register modal
│   ├── SeoHead.tsx                 # Reactive <title> + <meta> from admin settings
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
├── context/
│   └── AppContext.tsx              # Global state, Supabase sync, all mutations
│
├── data/
│   ├── menu.ts                     # Default categories and menu items seed data
│   ├── restaurant.ts               # Default restaurant settings and schedule
│   ├── customers.ts                # Mock customer seed data
│   └── footerPages.ts              # 6 default footer pages
│
├── lib/
│   ├── supabase.ts                 # Supabase client initialisation
│   ├── escpos.ts                   # ESC/POS receipt formatter
│   ├── emailTemplates.ts           # Email template engine with variable interpolation
│   ├── colorUtils.ts               # Brand colour CSS variable generator
│   ├── scheduleUtils.ts            # Store open/close time helpers
│   ├── stockUtils.ts               # Stock status resolution
│   └── taxUtils.ts                 # VAT calculation utilities
│
└── types/
    └── index.ts                    # All TypeScript interfaces and types
```

---

*Last updated: April 2026*
