# Single-Restaurant Food Ordering System

A full-featured, production-ready web application that combines a **customer-facing ordering portal**, a **restaurant admin dashboard**, a **kitchen display system**, a **driver delivery portal**, and a full **Point-of-Sale (POS) system** into a single Next.js 15 application. Ordering data is persisted in **Supabase (PostgreSQL)** and synchronised in real time across all devices and roles. POS data is stored locally in the browser via `localStorage`.

---

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Application Portals](#application-portals)
- [Admin Dashboard Panels](#admin-dashboard-panels)
- [POS System](#pos-system)
- [Order Status Workflow](#order-status-workflow)
- [Key Features](#key-features)
- [Integrations](#integrations)
- [Project Structure](#project-structure)

---

## Overview

The system serves five distinct user roles, each with a dedicated portal:

| Portal | Route | Role |
|---|---|---|
| Customer menu | `/` | Customers browsing and ordering |
| Customer account | `/account` | Customers tracking orders and managing profile |
| Admin dashboard | `/admin` | Restaurant staff managing all operations (20 panels) |
| Kitchen display | `/kitchen` | Kitchen staff viewing and progressing live orders |
| Driver dashboard | `/driver` | Delivery drivers managing assigned deliveries |
| POS system | `/pos` | In-restaurant point-of-sale terminal |

The online ordering system uses Supabase Realtime — a status change made in the admin panel, kitchen, or driver app appears on every other connected screen within milliseconds. The POS system is fully offline-capable, using `localStorage` for all POS data.

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
| Online Ordering DB | Supabase (PostgreSQL) |
| Real-time sync | Supabase Realtime (`postgres_changes`) |
| POS data storage | Browser `localStorage` |
| State | React Context (`AppContext` + `POSContext`) |
| Printer integration | ESC/POS over TCP (Next.js API route proxy) |
| Email integration | SMTP via Next.js API route |
| Dev server | `next dev --turbopack` |

---

## Getting Started

### Prerequisites

| Dependency | Version |
|---|---|
| Node.js | 20+ |
| npm | 10+ |
| Supabase project | Any plan |

### Environment Setup

Create `app/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Database Schema

Run the following SQL in your Supabase SQL editor:

```sql
-- Admin settings (single JSONB row)
create table app_settings (
  id         integer primary key default 1,
  data       jsonb not null default '{}',
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

- Browse the full menu grouped by category with a sticky scrollspy sidebar
- Time-gated **Breakfast Menu** shown only during configured morning hours
- Search by name/description; filter by dietary tags (Vegan, Halal, Gluten-Free, etc.)
- Add items to cart with variation, add-on, and special instruction selection
- Choose **delivery** or **collection** at checkout
- Geolocation detects delivery zone and applies the correct fee
- Coupon codes with instant discount calculation
- VAT breakdown when tax is enabled
- Payment methods filtered by distance restriction
- Guest or registered checkout with saved delivery addresses
- Schedule orders for a future time slot

### Customer Account (`/account`)

- Full order history sorted newest-first
- Active orders highlighted with pulsing "Live" badge
- **Kitchen tracker**: step dots for `pending → confirmed → preparing → ready`
- **Driver tracker**: separate progress card for `assigned → picked_up → on_the_way → delivered`
- Status badge reflects `deliveryStatus` in real time — shows "On the Way" when driver is en route
- Quick re-order copies all available items from a past order into the current cart
- Saved address management (add, edit, set default, delete)
- Profile editing (name, phone; email read-only)

### Kitchen Display (`/kitchen`)

Full-screen dark Kanban board for kitchen monitors:

- **Three columns**: New Orders (pending/confirmed), Preparing, Ready
- Urgency colour coding — amber at 15 min, red at 30 min with pulse animation
- Per-card fulfillment badge (Delivery / Collection)
- **Ready column is display-only** — kitchen's job ends when food is marked ready
- Completed-today counter, fullscreen mode, live clock, real-time sync

### Driver Dashboard (`/driver`)

- Password-authenticated login (credentials set in Admin → Drivers)
- **Available orders** — unassigned delivery orders at "preparing" or "ready", sorted by urgency
- Accept an order to claim it; progress: **Assigned → Picked Up → On the Way → Delivered**
- Confirm-before-deliver guard prevents accidental completion
- Call customer and Google Maps navigation buttons
- Completed deliveries log with total earnings

---

## Admin Dashboard Panels

20 tabbed panels grouped into 6 sections. All changes are persisted immediately to Supabase:

| Section | Tab | Panel | Description |
|---|---|---|---|
| Orders | Delivery | `DeliveryPanel` | Live Kanban board; role-aware advance guards; new-order toast |
| Orders | Refunds | `RefundsPanel` | Process full or partial refunds; choose refund method; refund history |
| Menu | Menu Items | `MenuManagementPanel` | Category + item CRUD; dietary tags, variations, add-ons, images, stock |
| Menu | Breakfast | `BreakfastMenuPanel` | Separate breakfast menu with own categories, items, and time window |
| Customers | Customers | `CustomersPanel` | Customer list, order history, VIP/tag labels, manual status override |
| Customers | Drivers | `DriversPanel` | Register driver accounts, view assignments, toggle active/inactive |
| Finance | Coupons | `CouponsPanel` | Percentage and fixed-amount codes with usage limits and expiry |
| Finance | Tax & VAT | `TaxSettingsPanel` | VAT rate, inclusive/exclusive mode, breakdown display |
| Finance | POS Reports | `POSReportsPanel` | Reads POS localStorage — revenue KPIs, charts, items, staff, transactions |
| Settings | Operations | `OperationsPanel` | Branding, fees, address, GPS coordinates, global SEO, custom `<head>` |
| Settings | Schedule | `SchedulePanel` | Per-day open/close hours with manual override toggle |
| Settings | Delivery Zones | `DeliveryZonesPanel` | Concentric km-ring zone editor, per-zone fee, colour coding |
| Settings | Integrations | `IntegrationsPanel` | Stripe, PayPal, SMTP, thermal printer config |
| Settings | Email Templates | `EmailTemplatesPanel` | 6 event-based HTML email templates with variable substitution |
| Content & SEO | Footer Pages | `FooterPagesPanel` | Rich HTML editor for 6 built-in pages |
| Content & SEO | Custom Pages | `CustomPagesPanel` | Unlimited custom pages with SEO fields and publish toggle |
| Content & SEO | Navigation | `MenuLinksPanel` | Header + footer navigation management |
| Content & SEO | Brand Colors | `ColorSettingsPanel` | Brand accent colour + page background with live preview |
| Content & SEO | Footer Logos | `FooterLogosPanel` | Partner logos, payment icons, and certification badges |
| Content & SEO | Receipt | `ReceiptSettingsPanel` | Logo, contact details, VAT number, messages for all receipts |

---

## POS System

The POS system lives at `/pos` and is a fully standalone in-restaurant terminal. It uses its own React Context (`POSContext`) and persists all data to `localStorage` — it works entirely offline and does not require a Supabase connection.

### Staff Authentication

- 4-digit PIN login with animated keypad
- Three roles with distinct permissions:

| Role | Discount | Void Sale | Dashboard | Staff Mgmt | Menu Mgmt | Settings |
|---|---|---|---|---|---|---|
| Admin | Yes | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes | No | No |
| Cashier | No | No | No | No | No | No |

- Staff are shown with avatar initials and colour-coded role badges
- Role badge displayed in the top bar while logged in

### Sale Screen

- Product grid grouped by category with colour-coded tiles
- Product images (upload file or paste URL; stored as base64 in `localStorage`)
- Popular flag badge
- Active offer badge with auto-generated label (e.g. "20% OFF", "BOGO", "3 for £10")
- Strikethrough original price when a simple offer is active
- Modifier/add-on selection modal before adding to cart

### Cart & Order Panel

- Line items with +/− quantity controls and per-line delete
- Amber highlight and "Save £X" label on lines with active quantity-based offers
- Discount application (% or £) with optional note — requires Manager/Admin
- Tip selection (preset %) or custom amount entry
- Customer search and assignment
- Table number assignment (when table mode is enabled)
- Payment method: **Cash** (with change calculator), **Card**, or **Split** (any mix of cash + card)
- Loyalty points earned display
- Receipt modal with print and email-to-customer options

### Product Offers (6 types)

| Type | Description |
|---|---|
| `percent` | Simple % off per unit |
| `fixed` | Fixed £ off per unit |
| `price` | Override to a set price per unit |
| `bogo` | Buy X get Y free |
| `multibuy` | Buy X items for £Y (bundle price) |
| `qty_discount` | Buy ≥ minimum quantity, get X% off each |

Offers support optional start/end date windows. Simple offers (percent, fixed, price) are applied at add-to-cart time. Quantity-based offers (bogo, multibuy, qty_discount) are computed at subtotal time via `cartLineTotal()`.

### Void & Refund

- Voiding requires Manager or Admin role
- Void modal captures: void reason + refund method + refund amount
- **Refund methods**: Cash (return to customer), Card (process card refund), No Refund
- Refund amount is pre-filled with the sale total and is editable for partial refunds
- Partial refund shows the retained amount as a warning
- Voided transactions are excluded from revenue KPIs but visible via "Show voided" toggle

### Dashboard (Overview tab)

Today's KPIs: revenue, transaction count, average order, tips collected

- Last-7-days revenue bar chart
- Today's payment method mix
- Overall gross margin percentage
- All-time best sellers with relative bar chart
- Recent transactions list with inline void button (role-gated)

### Dashboard (Reports tab)

Full reporting panel with custom date range:

- **Period selector**: Today, Yesterday, This Week, This Month, Last 30 Days, Custom
- **Custom date range**: From/To date pickers appear when "Custom" is selected
- **6 KPI cards**: Revenue, Avg Order, Gross Profit & Margin, VAT Collected, Tips, Discounts
- **Sub-tabs**:
  - **Overview**: Daily revenue bar chart, payment method breakdown with revenue, hourly heatmap, financial summary table (gross sales → discounts → VAT → tips → net → COGS → gross profit → margin)
  - **Items**: Best-selling items ranked by revenue with relative bars
  - **Staff**: Per-staff sales count, revenue, and average order value
  - **Transactions**: Searchable and sortable transaction table; show/hide voided; inline Void button (role-gated); totals footer
- **Export CSV**: Downloads all transactions in the selected period

### Admin Finance Panel (POS Reports)

The Admin Dashboard → Finance → POS Reports tab (`POSReportsPanel`) reads POS data directly from `localStorage` (same browser origin as the POS). It provides the same full reporting interface — period selector, custom date range, KPI cards, and all four sub-tabs — allowing the restaurant owner to review POS performance from the admin panel.

### Staff Management

- Add/edit/delete staff with name, email, role, 4-digit PIN, hourly rate, avatar colour
- Toggle staff active/inactive
- Clock In / Clock Out time tracking with duration logging

### Customer Management (POS)

- Search/add POS customers with name, email, phone
- Loyalty points balance and gift card balance
- Purchase history (total spend, visit count, last visit)
- Tags (VIP, Regular, etc.) and free-text notes

### Settings

- Business name, currency symbol, tax rate (inclusive/exclusive)
- Tip presets, receipt footer
- Loyalty points: points per £ spent, £ value per point
- Gift card enabled toggle
- Maximum discount percentage, require PIN for discount
- Table mode enabled, table count
- Receipt branding: restaurant name, phone, website, email, VAT number, logo, messages
- SMTP settings for emailing receipts to customers
- Hardware: printer configuration

---

## Order Status Workflow

### Kitchen / Admin leg (`status`)

```
pending → confirmed → preparing → ready
                                    │
          (collection) ─────────────┴──→ delivered   [admin marks collected]
          (delivery)   ─────────────────→ [driver takes over]
```

| Status | Set by | Meaning |
|---|---|---|
| `pending` | Customer checkout | Order just placed |
| `confirmed` | Admin | Restaurant acknowledged |
| `preparing` | Admin or kitchen | Kitchen cooking |
| `ready` | Kitchen | Food ready; kitchen's job ends here |
| `delivered` | Admin (collection) or driver (delivery) | Order completed |
| `cancelled` | Admin | Order cancelled |

**Role guard**: Admin cannot advance delivery orders past `ready` — only the driver can mark them delivered.

### Driver leg (`deliveryStatus`) — delivery orders only

```
assigned → picked_up → on_the_way → delivered
```

Setting `delivered` automatically sets `order.status = "delivered"`.

---

## Key Features

### Real-Time Sync (Supabase Realtime)

`AppContext` subscribes to `postgres_changes` on all five tables. Any mutation — admin panel, kitchen display, or driver app — propagates to every connected session within milliseconds.

### Breakfast Menu

A separate breakfast menu with its own categories and items. Admin sets an enabled toggle and a time window (e.g. 07:00–11:30). During those hours the breakfast section appears above the main menu on the customer portal.

### Coupon System

Percentage or fixed-amount codes with optional minimum cart subtotal, usage limit, and expiry date. Usage tracked in Supabase.

### VAT / Tax

Configurable rate with inclusive mode (prices include VAT — system extracts component) or exclusive mode (VAT added on top). VAT breakdown shown on cart, checkout, receipts, and emails.

### Delivery Zones & Geolocation

Browser Geolocation API → Haversine formula → smallest matching enabled zone fee applied. Payment methods with distance restrictions hidden when customer is out of range.

### Thermal Printer (ESC/POS)

Orders formatted as ESC/POS byte sequences and streamed to a network printer via `/api/print`. Supports 80 mm (48 chars/line) and 58 mm (32 chars/line) paper widths.

### Email Templates

Six lifecycle events with fully editable HTML templates. `{{variable}}` interpolation for customer name, order ID, items table, total, fulfillment type, and restaurant details. Receipt branding applied automatically.

### Refunds

Full or partial refund processing with method selection (cash, bank transfer, etc.), reason capture, and a complete refund history log.

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

Configured in Admin → Integrations (online ordering) and POS → Settings → Hardware (POS receipts). SMTP credentials are proxied through `/api/email` and never exposed to the client.

### Stripe & PayPal

API keys stored in `app_settings` in Supabase and used client-side via the Stripe.js / PayPal SDK. Card data never touches the application server.

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
│   │   └── page.tsx                # Admin dashboard (/admin) — 20 tabbed panels
│   ├── kitchen/
│   │   └── page.tsx                # Kitchen display (/kitchen)
│   ├── driver/
│   │   ├── page.tsx                # Driver dashboard (/driver)
│   │   └── login/page.tsx          # Driver login (/driver/login)
│   ├── pos/
│   │   ├── page.tsx                # POS terminal (/pos) — sale, dashboard, staff, settings
│   │   └── error.tsx               # POS error boundary
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
│       ├── RefundsPanel.tsx
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
│       ├── POSReportsPanel.tsx     # POS finance reports (reads localStorage)
│       └── RichEditor.tsx
│
├── context/
│   ├── AppContext.tsx              # Global state, Supabase sync, all mutations
│   └── POSContext.tsx              # POS state — sales, cart, staff, products, settings
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
    ├── index.ts                    # Online ordering TypeScript interfaces
    └── pos.ts                      # POS system TypeScript interfaces and helpers
```

---

*Last updated: April 2026*
