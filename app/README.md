# Single-Restaurant Food Ordering System — App

A full-stack restaurant platform built on Next.js 15. Combines a customer ordering portal, admin dashboard, waiter app, kitchen display, driver app, and a full in-restaurant POS terminal — all in a single codebase.

---

## Portals

| URL | Who uses it | Description |
|---|---|---|
| `/` | Customers | Menu browsing, cart, checkout |
| `/account` | Customers | Order history, live tracking, profile |
| `/admin` | Restaurant staff | Full management dashboard (24 panels) |
| `/waiter` | Waiter staff | Table-service app — PIN authenticated |
| `/kitchen` | Kitchen staff | Live order Kanban display |
| `/driver` | Drivers | Delivery queue and order progression |
| `/driver/login` | Drivers | Driver authentication |
| `/pos` | POS staff | In-restaurant point-of-sale terminal |

---

## Quick Start

### Prerequisites

- Node.js 20+, npm 10+
- A Supabase project with the schema applied (see `../system_architecture.md`)

### Environment variables

Create `app/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_PASSWORD=your-admin-password
```

### Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000` — the customer portal.

### Other commands

```bash
npm run build      # Production build
npm start          # Serve the production build
npm run lint       # ESLint check
npx tsc --noEmit   # TypeScript type check
```

---

## Feature Summary

### Customer Portal (`/`)

- Full menu with sticky category nav and live ScrollSpy
- Search by name/description; dietary filter pills (Vegan, Halal, Gluten-Free…)
- Time-gated Breakfast Menu (admin-configured time window)
- Item customisation: variations, add-ons, special instructions
- Delivery or collection toggle with time estimates
- Cart: subtotal, delivery fee, service fee, VAT, coupon discount, store credit, grand total
- Geolocation-based delivery zone detection at checkout
- Payment method filtering by delivery distance
- Guest or registered checkout with saved addresses
- Scheduled ordering for a future time slot
- **Guest profile auto-capture**: name, email, phone, and spend saved to CRM after checkout (non-blocking)

### Customer Account (`/account`)

- Full order history sorted newest-first, with live status tracking
- Active orders highlighted with pulsing "Live" badge
- Kitchen progress tracker (Pending → Confirmed → Preparing → Ready)
- Driver leg tracker (Assigned → Picked Up → On the Way → Delivered)
- Status badge updates in real time — no page reload needed
- Re-order with one click
- Manage saved delivery addresses; edit profile
- Store credit balance display

### Admin Dashboard (`/admin`) — 24 panels

**Orders**
- **Delivery** — live Kanban board with role-aware advance guards and new-order toast
- **Online Reports** — revenue KPIs and fulfilment breakdown
- **Refunds** — full or partial refund processing with method selection and history

**Menu**
- **Menu Items** — category and item CRUD; dietary tags, price variations, add-ons, images, popular flag, stock tracking
- **Breakfast** — separate breakfast menu with own categories, items, and time window

**Customers**
- **Customers** — customer list, order history, VIP tags, manual status override, store credit
- **Guest Profiles** — CRM view of all guests from reservations and online orders; visit counts, online spend, tags, notes, marketing opt-in, CSV export
- **Drivers** — register and manage driver accounts, view assignments

**Finance**
- **Coupons** — percentage and fixed-amount discount codes with limits and expiry
- **Tax & VAT** — rate, inclusive/exclusive mode, breakdown display
- **POS Reports** — reads POS localStorage data; revenue KPIs, charts, staff, transactions

**Settings**
- **Operations** — branding (single source of truth for POS, receipts, and emails), fees, address, GPS, SEO, custom `<head>` injection
- **Schedule** — per-day hours with manual closed override
- **Delivery Zones** — concentric km-ring editor with per-zone fees
- **Integrations** — Stripe, PayPal, SMTP, thermal printer (ESC/POS over TCP)
- **Email Templates** — 10 lifecycle event templates (6 order + 4 reservation) with variable substitution
- **Staff & Tables** — waiter staff management (PIN, role, avatar) and dining table layout
- **Reservations** — reservation system config: slot duration, advance days, blackout dates, review URL

**Content & SEO**
- **Footer Pages** — rich HTML editor for 6 built-in pages
- **Custom Pages** — unlimited pages with slug management, SEO fields, publish toggle
- **Navigation** — header and footer nav link management
- **Brand Colors** — accent colour and page background with live preview
- **Footer Logos** — partner logos, payment icons, certification badges
- **Receipt** — logo, contact details, VAT number, and footer messages

### Waiter App (`/waiter`)

- 4-digit PIN authentication (validated server-side)
- Two roles: `waiter` and `senior` (senior can void and refund)
- Table grid with colour-coded occupancy per section
- Category-tabbed menu; add items with per-line kitchen notes
- Multiple order rounds per table
- Bill view with aggregated total; Cash or Card settlement
- Void (before settlement) and Refund (after settlement) — senior only
- Receipt with print and email options

### Kitchen Display (`/kitchen`)

- Full-screen dark Kanban: New Orders / Preparing / Ready
- Urgency colour coding (amber at 15 min, red at 30 min with pulse)
- Per-card fulfillment badge; fullscreen toggle; live clock; real-time sync
- No authentication required

### Driver Portal (`/driver`)

- Driver login (bcrypt password — credentials set in Admin → Drivers)
- Available orders queue, accept to claim
- Delivery progression: Assigned → Picked Up → On the Way → Delivered
- Call customer and Google Maps navigation links

### POS System (`/pos`)

A fully standalone in-restaurant POS terminal. All data stored in browser `localStorage` — works without internet, no Supabase dependency for processing sales.

**Offline mode**
- Probe-based connectivity detection (`HEAD /api/ping`) — reliable where `navigator.onLine` is not
- Amber offline banner with pending-sync count and retry button
- Card and Split payments disabled when offline — cash only
- Outbox queue (`lib/posOutbox.ts`): failed KDS syncs saved to localStorage, retried with exponential back-off on reconnect
- `beforeunload` warning when unsynced sales remain

**Staff & access control**
- 4-digit PIN login with animated keypad
- Three roles: Admin, Manager, Cashier — each with distinct permission sets
- Staff management: add/edit/delete, toggle active, clock in/out time tracking

**Sale screen**
- Product grid with categories, images, popular flags, and offer badges
- Modifier/add-on selection before adding to cart
- 6 offer types: percent off, fixed off, set price, BOGO, multibuy (X for £Y), qty discount

**Cart & payment**
- Line items with quantity controls; amber savings highlight for quantity offers
- Discount application (Manager/Admin only)
- Tip selection and custom tip entry
- Customer assignment and loyalty points
- Cash (with change calculation), Card (requires internet), or Split payment
- Receipt printing and email to customer via SMTP

**Void & refund**
- Void any transaction (Manager/Admin only)
- Capture void reason + refund method (Cash / Card / No Refund) + refund amount
- Partial refunds with retained-amount warning

**Reservations tab**
- View, check-in, and check-out table reservations
- Create walk-in reservations
- Updates guest CRM records automatically on check-in/out

**Dashboard — Overview tab**
- Today's KPIs: revenue, transactions, avg order, tips
- Last-7-days revenue chart; payment mix; overall gross margin
- Best sellers list; recent transactions with inline void

**Dashboard — Reports tab**
- Period selector: Today, Yesterday, This Week, This Month, Last 30 Days, Custom date range
- 6 KPI cards: Revenue, Avg Order, Gross Profit & Margin, VAT, Tips, Discounts
- Sub-tabs: Overview (daily chart + payment mix + hourly heatmap + financial summary) / Items / Staff / Transactions
- Export CSV for any selected period

---

## Tech Stack

| | |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Runtime | React 19, TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Online ordering DB | Supabase (PostgreSQL + Realtime) |
| POS storage | Browser `localStorage` (primary) + Supabase (background sync via outbox) |
| State | React Context (`AppContext` + `POSContext`) |

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root layout — font, AppProvider, SEO
│   ├── page.tsx                      # Customer menu page (/)
│   ├── account/page.tsx              # Customer account (/account)
│   ├── admin/page.tsx                # Admin dashboard (/admin)
│   ├── waiter/page.tsx               # Waiter app (/waiter)
│   ├── kitchen/page.tsx              # Kitchen display (/kitchen)
│   ├── driver/page.tsx               # Driver dashboard (/driver)
│   ├── driver/login/page.tsx         # Driver login (/driver/login)
│   ├── customer-display/page.tsx     # Customer-facing order status display
│   ├── pos/page.tsx                  # POS terminal (/pos)
│   ├── pos/error.tsx                 # POS error boundary
│   ├── [footerPage]/page.tsx         # Dynamic page renderer (/[slug])
│   └── api/
│       ├── ping/route.ts             # Connectivity probe — 204 response (POS offline detection)
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
│       ├── waiter/auth|config|orders|settle|void|refund
│       ├── pos/orders|menu|reservations
│       ├── kds/orders/[id]/status/route.ts
│       ├── orders/route.ts           # Place online order
│       ├── guest-profile/route.ts    # Upsert guest CRM profile after checkout
│       ├── auth/register|driver
│       ├── customers/[id]/route|spend-credit
│       ├── print/route.ts
│       └── email/route.ts
│
├── components/
│   ├── Header.tsx / Footer.tsx / Cart.tsx
│   ├── BreakfastSection.tsx / MenuItemCard.tsx / MenuSection.tsx
│   ├── CategoryNav.tsx / SearchAndFilters.tsx
│   ├── CheckoutModal.tsx / ItemCustomizationModal.tsx
│   ├── ScheduleOrderModal.tsx / AuthModal.tsx / SeoHead.tsx
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
│   ├── AppContext.tsx                # Online ordering state + Supabase sync
│   └── POSContext.tsx               # POS state (localStorage) + KDS outbox enqueue
│
├── data/                             # Seed data for menu, settings, customers, footer pages
│
├── lib/
│   ├── supabase.ts                   # Supabase browser client (anon key)
│   ├── supabaseAdmin.ts              # Supabase server client (service role key)
│   ├── adminAuth.ts                  # Admin JWT cookie helpers
│   ├── connectivity.ts               # useConnectivity() — probe-based online/offline detection
│   ├── posOutbox.ts                  # POS offline outbox — localStorage queue with retry
│   ├── escpos.ts                     # ESC/POS receipt formatter
│   ├── emailTemplates.ts             # Email template engine ({{variable}} interpolation)
│   ├── colorUtils.ts                 # Brand colour CSS variable generator
│   ├── scheduleUtils.ts              # Store open/close time helpers
│   ├── stockUtils.ts                 # Stock status resolution
│   └── taxUtils.ts                   # VAT calculation utilities
│
└── types/
    ├── index.ts                      # Online ordering types
    └── pos.ts                        # POS types + cartLineTotal / getOfferPrice helpers
```

---

## Order Status Workflow

### `status` — Kitchen / Admin leg

```
pending → confirmed → preparing → ready
```

- **Collection** orders: admin advances `ready → delivered` when customer collects
- **Dine-in** orders: waiter settlement advances to `delivered`
- **Delivery** orders: driver takes over after `ready` (admin cannot advance past ready)

### `deliveryStatus` — Driver leg (delivery orders only)

```
assigned → picked_up → on_the_way → delivered
```

Setting `delivered` automatically sets `status = "delivered"`.

### Role responsibilities

| Role | Actions |
|---|---|
| Admin | `pending → confirmed → preparing → ready`; `ready → delivered` for collection only; cancel any order |
| Kitchen | `pending/confirmed → preparing → ready` |
| Waiter | Settle (→ delivered), Void (→ cancelled), Refund (senior only) |
| Driver | `assigned → picked_up → on_the_way → delivered` |
| Customer | Read-only status tracking |

---

## Architecture Reference

See [`../system_architecture.md`](../system_architecture.md) for full architecture documentation including Supabase schema, AppContext data flow, POS offline mode, outbox queue, order workflow diagrams, geolocation logic, and security notes.
