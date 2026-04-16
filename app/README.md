# Single-Restaurant Food Ordering System

A full-featured online food ordering system for a single restaurant — combining a customer-facing menu portal, a restaurant admin dashboard, a kitchen display system, and a driver delivery portal in one Next.js application. Data is persisted in Supabase (PostgreSQL) with real-time cross-device sync via Supabase Realtime.

## Portals

| URL | Who uses it | Description |
|---|---|---|
| `http://localhost:3000/` | Customers | Menu browsing, cart, checkout |
| `http://localhost:3000/account` | Customers | Order history, live tracking, profile |
| `http://localhost:3000/admin` | Restaurant staff | Full management dashboard (18 tabs) |
| `http://localhost:3000/kitchen` | Kitchen staff | Live order Kanban display |
| `http://localhost:3000/driver` | Drivers | Delivery queue, pick-up, delivery progression |
| `http://localhost:3000/driver/login` | Drivers | Driver authentication |

---

## Features

### Customer Portal (`/`)
- Browse the full menu with sticky category navigation and live ScrollSpy
- Search by name or description; filter by dietary requirements (Vegetarian, Vegan, Halal, Gluten-free, etc.)
- Time-gated Breakfast Menu displayed only during configured morning hours
- Item customisation: choose variations, add extras, leave special instructions
- Delivery or collection fulfilment toggle with time estimates
- Cart with dynamic subtotal, delivery fee, service fee, VAT, and coupon discount
- Geolocation-based delivery zone detection at checkout
- Payment method filtering by delivery distance
- Guest or registered checkout with saved addresses
- Schedule ordering for a future time slot

### Customer Account (`/account`)
- Full order history sorted by date, with live status tracking
- Active orders highlighted with pulsing "Live" badge
- Kitchen progress tracker (4-step for delivery: Pending → Confirmed → Preparing → Ready)
- Driver leg tracker (4-step: Driver Assigned → Picked Up → On the Way → Delivered)
- Status badge updates in real time as driver progresses — no page reload needed
- Re-order past orders with a single click
- Manage saved delivery addresses (Home, Work, custom)
- Edit profile (name, phone)

### Admin Dashboard (`/admin`) — 18 tabs
- **Menu Items** — category and item CRUD; dietary tags, price variations, add-ons, images, popular flag, stock tracking
- **Breakfast** — separate breakfast menu with its own categories and items; time-window configuration
- **Customers** — customer list, order history, VIP/tag labels, manual order status override
- **Delivery** — live Kanban board (Pending → Confirmed → Preparing → Ready); role-aware advance guards; new-order toast notifications
- **Zones** — concentric km-ring zone editor with per-zone fees and colour coding
- **Operations** — restaurant branding, fees, structured address, GPS coordinates, global SEO settings, custom `<head>` code injection
- **Schedule** — per-day open/close hours with manual override toggle
- **Integrations** — Stripe, PayPal, SMTP credentials; network thermal printer (ESC/POS over TCP)
- **Email** — 6 order lifecycle event templates with variable substitution and live preview
- **Footer Pages** — rich HTML editor for 6 built-in pages (About, Contact, Terms, Privacy, Cookies, Accessibility)
- **Custom Pages** — create unlimited standalone pages with SEO title, meta description, slug management, and publish toggle
- **Menus** — assign pages to header and footer navigation; control order, labels, and visibility
- **Colors** — brand accent colour and page background with live preview
- **Logos** — partner logos, payment icons, and certification badges for the footer
- **Receipt** — custom receipt branding (logo, contact details, VAT number, messages) applied to all printed and emailed receipts
- **Coupons** — create percentage and fixed-amount discount codes with usage limits, minimum order requirements, and expiry dates
- **Tax** — VAT configuration (rate, inclusive/exclusive mode, breakdown display)
- **Drivers** — register and manage driver accounts; assign orders and track deliveries

### Kitchen Display (`/kitchen`)
- Full-screen dark Kanban board optimised for kitchen monitors
- Three columns: New Orders, Preparing, Ready
- Urgency colour coding — orders turn amber at 15 min, red at 30 min
- Per-card fulfillment badge (Delivery / Collection)
- "Ready" column shows "Awaiting driver pickup" or "Awaiting customer collection" — kitchen's job ends at ready
- Fullscreen toggle, live clock, real-time sync

### Driver Portal (`/driver`)
- Driver authentication (email + password set by admin)
- Available orders queue — delivery orders at "ready" or "preparing" status with no assigned driver
- Accept order → progresses through: Assigned → Picked Up → On the Way → Delivered
- Confirm-before-deliver guard
- Completed deliveries log with total value
- Live sync — new orders appear automatically

---

## Tech Stack

| | |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Runtime | React 19, TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Database | Supabase (PostgreSQL) |
| Realtime | Supabase Realtime (postgres_changes) |
| State | React Context + Supabase |
| Dev bundler | Turbopack |

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm 10+
- A Supabase project with the schema applied (see `system_architecture.md`)

### Environment variables

Create `app/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Install and run

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the customer portal.

### Other commands

```bash
npm run build      # Production build
npm start          # Serve the production build
npm run lint       # ESLint check
npx tsc --noEmit   # TypeScript type check
```

---

## Project Structure

```
app/src/
├── app/
│   ├── layout.tsx                  # Root layout — font, AppProvider, SEO
│   ├── page.tsx                    # Customer menu page (/)
│   ├── account/page.tsx            # Customer account dashboard (/account)
│   ├── admin/page.tsx              # Admin dashboard (/admin) — 18 tabs
│   ├── kitchen/page.tsx            # Kitchen display (/kitchen)
│   ├── driver/page.tsx             # Driver dashboard (/driver)
│   ├── driver/login/page.tsx       # Driver login (/driver/login)
│   ├── [footerPage]/page.tsx       # Dynamic page renderer (/[slug])
│   └── api/
│       ├── print/route.ts          # ESC/POS thermal printer proxy
│       └── email/route.ts          # SMTP email proxy
│
├── components/
│   ├── Header.tsx                  # Restaurant info card + header nav
│   ├── Footer.tsx                  # Site footer with managed nav links
│   ├── Cart.tsx                    # Order basket (desktop + mobile drawer)
│   ├── BreakfastSection.tsx        # Time-gated breakfast menu card
│   ├── MenuItemCard.tsx            # Menu item row
│   ├── MenuSection.tsx             # Category-grouped item list
│   ├── CategoryNav.tsx             # Desktop sidebar category nav
│   ├── SearchAndFilters.tsx        # Search + dietary filter pills
│   ├── CheckoutModal.tsx           # Checkout — form, geolocation, payment
│   ├── ItemCustomizationModal.tsx  # Variations, add-ons, instructions
│   ├── ScheduleOrderModal.tsx      # Future time slot picker
│   ├── AuthModal.tsx               # Login / Register
│   ├── SeoHead.tsx                 # Reactive <title> + <meta> from settings
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
├── context/AppContext.tsx          # Global state, Supabase sync, all mutations
├── data/                           # Seed data (menu, restaurant, customers)
├── lib/
│   ├── supabase.ts                 # Supabase client
│   ├── escpos.ts                   # ESC/POS receipt formatter
│   ├── emailTemplates.ts           # Email template engine
│   ├── colorUtils.ts               # Brand colour CSS variable generator
│   ├── scheduleUtils.ts            # Store open/close time helpers
│   ├── stockUtils.ts               # Stock status resolution helpers
│   └── taxUtils.ts                 # VAT calculation helpers
└── types/index.ts                  # All TypeScript interfaces
```

---

## Order Status Workflow

The order lifecycle uses two separate fields:

### `status` (OrderStatus) — Kitchen / Admin leg

```
pending → confirmed → preparing → ready
```

- **pending** — order just placed by customer
- **confirmed** — admin acknowledges the order
- **preparing** — kitchen starts cooking
- **ready** — food is ready; kitchen's job ends here

For **collection** orders: admin advances `ready → delivered` when the customer collects.
For **delivery** orders: driver takes over after `ready` (admin cannot advance past ready for delivery orders).

### `deliveryStatus` (DeliveryStatus) — Driver leg (delivery orders only)

```
assigned → picked_up → on_the_way → delivered
```

Setting `deliveryStatus = "delivered"` automatically sets `status = "delivered"`.

### Role responsibilities

| Role | Actions |
|---|---|
| Admin | `pending → confirmed → preparing → ready`; `ready → delivered` for collection only |
| Kitchen | `pending/confirmed → preparing → ready` |
| Driver | `assigned → picked_up → on_the_way → delivered` |
| Customer | Read-only status tracking |

---

## Data Persistence (Supabase)

All data is stored in Supabase (PostgreSQL) and synced in real time:

| Table | Contents |
|---|---|
| `app_settings` | Single JSONB row — all admin settings, menu config, zones, templates, etc. |
| `categories` | Menu categories (id, name, emoji, sort_order) |
| `menu_items` | Menu items with full JSONB for variations, add-ons, dietary tags |
| `customers` | Customer accounts, saved addresses, favourites |
| `orders` | Order records with status, delivery status, driver assignment |

Real-time updates use Supabase's `postgres_changes` subscription — all open sessions (customer tab, admin tab, kitchen display, driver app) stay in sync automatically.

---

## Delivery Zones and Geolocation

At checkout, the browser Geolocation API retrieves the customer's coordinates. The Haversine formula calculates distance to the restaurant's GPS coordinates (set in Admin → Operations):

- Each **Delivery Zone** defines a km radius ring with its own delivery fee
- The smallest matching enabled zone's fee is applied to the order total
- **Payment methods** can be restricted to customers within a specific km range

---

## Coupon System

Create discount codes in Admin → Coupons:

- **Percentage** discounts (e.g. 10% off)
- **Fixed amount** discounts (e.g. £5 off)
- Optional: minimum order amount, usage limit, expiry date
- Applied at checkout; usage count tracked automatically

---

## Thermal Printer Integration

Configure in Admin → Integrations:

- IP address + TCP port (default: 9100) of a network ESC/POS printer
- Auto-print on new order
- 80 mm (48 chars/line) or 58 mm (32 chars/line) paper width

---

## Email Templates

Six order lifecycle templates (Admin → Email):

| Event | Sent when |
|---|---|
| Order Confirmation | Customer completes checkout |
| Order Confirmed | Admin advances to Confirmed |
| Order Preparing | Admin advances to Preparing |
| Order Ready | Admin advances to Ready |
| Order Delivered | Order marked as Delivered |
| Order Cancelled | Admin marks as Cancelled |

Variables: `{{customerName}}`, `{{orderId}}`, `{{items}}`, `{{total}}`, `{{estimatedTime}}`, and more.

---

## Architecture Reference

See [`../system_architecture.md`](../system_architecture.md) for full architecture documentation including:
- Supabase schema and real-time sync details
- Complete AppContext data flow
- Order status workflow diagrams
- Geolocation and payment filtering logic
- Security notes
