# Single-Restaurant Food Ordering System

A full-featured online food ordering system for a single restaurant — combining a customer-facing menu portal and a complete restaurant admin dashboard in one Next.js application.

## Features

### Customer Portal (`/`)
- Browse the full menu with category navigation and live ScrollSpy
- Search by name or description; filter by dietary requirements (Vegetarian, Vegan, Halal, Gluten-free)
- Item customisation: choose variations, add extras, leave special instructions
- Delivery or collection fulfilment toggle with time estimates
- Cart with dynamic subtotal, delivery fee, and service fee calculation
- Geolocation-based delivery zone detection at checkout
- Payment method filtering by delivery distance
- Guest or registered checkout
- Customer account dashboard: order history, live status tracker, quick re-order, profile editing
- Cross-tab real-time order status updates (no page reload required)
- Fully responsive — mobile-first design with bottom-sheet modals and touch-optimised controls

### Admin Dashboard (`/admin`)
- **Menu Management** — full CRUD for categories and items; dietary tags, price variations, add-ons, images, popular flag
- **Delivery Board** — live Kanban order pipeline (Pending → Confirmed → Preparing → Ready → Delivered); new-order toast notifications
- **Customer Management** — customer list, order history, VIP/tag labels, manual order status override
- **Delivery Zones** — concentric km-ring zone editor with per-zone fees and colour coding
- **Operations** — restaurant branding, fees, structured address, GPS coordinates, global SEO settings, custom `<head>` code injection
- **Schedule** — per-day open/close hours with manual override toggle
- **Integrations** — Stripe, PayPal, SMTP credentials; network thermal printer (ESC/POS over TCP)
- **Email Templates** — 6 order lifecycle event templates (confirmation, preparing, ready, delivered, cancelled) with variable substitution and live preview
- **Footer Pages** — rich HTML editor for 6 built-in pages (About, Contact, Terms, Privacy, Cookies, Accessibility)
- **Custom Pages** — create unlimited standalone pages with SEO title, meta description, slug management, and publish toggle
- **Navigation Menus** — assign pages to header and footer navigation; control order, labels, and visibility

---

## Tech Stack

| | |
|---|---|
| Framework | Next.js 15.5 (App Router) |
| Runtime | React 19, TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| State | React Context + `localStorage` |
| Dev bundler | Turbopack |

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm 10+

### Install and run

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the customer portal loads immediately with seed data.

Open [http://localhost:3000/admin](http://localhost:3000/admin) — the admin dashboard, no login required in development.

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
│   ├── layout.tsx              # Root layout — font, AppProvider, SEO
│   ├── page.tsx                # Customer menu page (/)
│   ├── account/page.tsx        # Customer account dashboard (/account)
│   ├── admin/page.tsx          # Admin dashboard (/admin)
│   ├── [footerPage]/page.tsx   # Dynamic page renderer (/[slug])
│   └── api/
│       ├── print/route.ts      # ESC/POS thermal printer proxy
│       └── email/route.ts      # SMTP email proxy
│
├── components/
│   ├── Header.tsx              # Restaurant info card + header nav
│   ├── Footer.tsx              # Site footer with managed nav links
│   ├── Cart.tsx                # Order basket
│   ├── MenuItemCard.tsx        # Menu item row
│   ├── MenuSection.tsx         # Category-grouped item list
│   ├── CategoryNav.tsx         # Desktop sidebar category nav
│   ├── SearchAndFilters.tsx    # Search + dietary filter pills
│   ├── CheckoutModal.tsx       # Checkout — form, geolocation, payment
│   ├── ItemCustomizationModal.tsx  # Variations, add-ons, instructions
│   ├── AuthModal.tsx           # Login / Register
│   ├── SeoHead.tsx             # Reactive <title> + <meta> from settings
│   └── admin/                  # All 11 admin panel components
│
├── context/AppContext.tsx      # Global state, localStorage sync
├── data/                       # Seed data (menu, restaurant, customers)
├── lib/                        # ESC/POS formatter, email template engine
└── types/index.ts              # All TypeScript interfaces
```

---

## How Data Persistence Works

All settings, menu data, customers, and orders are stored in `localStorage` under the key `adminSettings`. There is no backend or database required.

- **First load** — seed data from `data/` is used as defaults
- **Admin changes** — every save writes immediately to `localStorage`
- **Reload** — the stored data is read back and deep-merged with defaults (so new fields added in code updates are automatically grafted in)
- **Cross-tab sync** — the browser's `storage` event keeps the customer portal and admin dashboard in sync without a page reload

> In a production deployment, `localStorage` is replaced by a FastAPI backend + MySQL database. See `system_architecture.md` for the full production architecture plan.

---

## Resetting to Default Data

To wipe all saved data and return to seed defaults, open the browser console and run:

```js
localStorage.removeItem('adminSettings');
location.reload();
```

---

## Delivery Zones and Checkout

The checkout flow detects the customer's delivery distance using the browser Geolocation API and the Haversine formula against the restaurant's GPS coordinates (configured in Admin → Operations).

- Each **Delivery Zone** defines a km radius ring with its own delivery fee
- The smallest matching zone's fee is applied to the order total
- **Payment methods** can be restricted to customers within a specific km range — e.g. card payment only within 5 km, cash on delivery within 2 km

---

## Thermal Printer Integration

Configure a network ESC/POS thermal printer in Admin → Integrations (Epson, Star, or any compatible model):

- **IP address** — the printer's static local network IP
- **Port** — TCP raw port (default: 9100)
- **Auto-print** — automatically send the receipt when a new order is placed
- **Paper width** — 48 chars (80 mm paper) or 32 chars (58 mm paper)

Receipts are formatted and streamed over TCP via the `/api/print` Next.js route.

---

## Email Templates

Six order lifecycle templates can be customised in Admin → Email:

| Event | Sent when |
|---|---|
| Order Confirmation | Customer completes checkout |
| Order Confirmed | Admin advances to Confirmed |
| Order Preparing | Admin advances to Preparing |
| Order Ready | Admin advances to Ready |
| Order Delivered | Admin advances to Delivered |
| Order Cancelled | Admin marks as Cancelled |

Templates support variables: `{{customerName}}`, `{{orderId}}`, `{{items}}`, `{{total}}`, `{{estimatedTime}}`, and more.

---

## Custom Pages and Navigation

1. Create pages in Admin → **Custom Pages** (title, slug, rich content, SEO fields, publish toggle)
2. They are immediately available at `/{slug}` on the frontend
3. Assign them to the **header** or **footer** navigation in Admin → **Menus**
4. Control display order, custom labels, and active/inactive status per link

The 6 built-in footer pages (About Us, Contact, Terms, Privacy, Cookies, Accessibility) are edited in Admin → **Footer Pages** and can also be added to the navigation menus.

---

## Architecture Reference

See [`system_architecture.md`](../system_architecture.md) in the project root for:
- Full component and data flow diagrams
- localStorage persistence and cross-tab sync details
- Delivery zone and payment filtering logic
- Planned production architecture (FastAPI + Celery + Redis + MySQL)
- Security and migration notes
