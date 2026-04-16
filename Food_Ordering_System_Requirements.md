# Single-Restaurant Food Ordering System — Requirements & Feature Specification

## Project Overview

A full-stack web application designed for a single restaurant, providing an end-to-end food ordering experience. The system serves four distinct user roles — customers, admin staff, kitchen staff, and delivery drivers — each through a dedicated portal, all powered by a shared Supabase (PostgreSQL) backend with real-time synchronisation.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Language | TypeScript 5 / React 19 |
| Styling | Tailwind CSS v4 |
| Icons | lucide-react |
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime (`postgres_changes`) |
| State | React Context + Supabase |

---

## User Roles & Portals

| Role | Route | Description |
|---|---|---|
| Customer | `/` + `/account` | Browse menu, place orders, track delivery in real time |
| Admin | `/admin` | Manage all restaurant operations via 18-panel dashboard |
| Kitchen | `/kitchen` | View and progress live orders on a full-screen Kanban board |
| Driver | `/driver` + `/driver/login` | Accept and deliver orders; advance delivery status |

---

## 1. Customer Portal (`/`)

### 1.1 Menu Page

- **Header**: Restaurant cover image, logo, name, tagline, food hygiene rating, delivery/collection toggle, estimated delivery and collection times, minimum order value
- **Navigation**: Sticky desktop category sidebar with ScrollSpy (highlights active section as user scrolls); horizontal scrolling category strip on mobile
- **Breakfast Menu**: Separate amber-themed collapsible section shown only during admin-configured time window (e.g. 07:00–11:30)
- **Menu Items**: Grouped by category; each card shows name, description, price, dietary badges, popular flag, and an add-to-cart button
- **Search & Filters**: Real-time search by name and description; dietary filter pills (Vegetarian, Vegan, Halal, Gluten-Free, etc.)
- **Item Customisation Modal**: Opens on item tap; select variations (e.g. size, spice level), add-ons (e.g. extra toppings), and special instructions before adding to cart
- **Cart**: Sticky right sidebar on desktop; floating "View Basket" button → full-screen drawer on mobile. Shows item lines with +/- controls, subtotal, delivery fee, service fee, VAT breakdown, coupon discount, and grand total

### 1.2 Cart & Checkout Rules

- Checkout button is disabled and shows "Add £X more..." when subtotal is below minimum order
- Store closed state disables all add-to-cart buttons and shows a "Closed" banner
- Delivery or collection selection with configurable estimated times
- Scheduled ordering: customer can pick a future time slot

### 1.3 Checkout Flow

1. `CheckoutModal` opens with customer details form
2. Saved delivery addresses can be selected or a new address entered
3. Geolocation (optional): browser fetches coordinates → Haversine formula calculates distance → matching `DeliveryZone` fee applied
4. Coupon code entry with instant validation and discount display
5. VAT displayed as a line item when tax is enabled
6. Payment method list filtered by distance restriction
7. Order placed → receipt printed (if auto-print enabled) → confirmation email sent

### 1.4 Customer Account (`/account`)

- Full order history, sorted newest-first
- Active orders highlighted with pulsing "Live" badge and orange border
- **Kitchen tracker**: step dots for `pending → confirmed → preparing → ready` (delivery) or `→ delivered` (collection)
- **Driver tracker**: separate progress card for `assigned → picked_up → on_the_way → delivered` with live pulse when en route
- Status badge reflects `deliveryStatus` in real time — shows "On the Way" not "Ready for Pickup" when driver is en route
- Re-order: one-click add of all available items from a past order into the current cart
- Saved delivery addresses: add / edit / set default / delete (Home, Work, or custom label)
- Profile editing: name and phone; email is read-only

---

## 2. Admin Dashboard (`/admin`)

### 2.1 Menu Management

- Full CRUD for categories (name, emoji, sort order) and menu items
- Item fields: name, description, price, image (URL or upload), dietary tags, popular flag, variations (groups with named options and price deltas), add-ons (individual extras with prices)
- Stock tracking: quantity-based (`stockQty`) or manual status override (`in_stock`, `low_stock`, `out_of_stock`)
- Category reordering via drag handles or up/down controls

### 2.2 Breakfast Menu

- Separate breakfast menu with its own categories and items (independent of the main menu)
- Configurable time window (start time, end time) and enabled toggle
- Full item management: same fields as main menu (image, dietary, variations, add-ons, stock)

### 2.3 Customer Management

- Customer list with name, email, phone, registration date, and tags (VIP, Regular, etc.)
- Per-customer order history with lifetime value
- Manual order status override (useful for phone orders or corrections)

### 2.4 Delivery Board

- Live Kanban board showing active orders across four statuses: Pending, Confirmed, Preparing, Ready
- **Role-aware advance guard**: admin cannot advance delivery orders past "Ready" — only the driver can mark delivery orders as delivered
- Collection orders can be advanced all the way to "Delivered" by admin
- Completed-today table showing all delivered and collected orders
- New-order toast notification (bell icon in header) when a customer places an order

### 2.5 Delivery Zones

- Concentric km-ring zone editor
- Each zone: name, inner radius (km), outer radius (km), delivery fee (£), enabled toggle, colour (used in UI visualisation)
- Zones matched at checkout via Haversine formula against restaurant GPS coordinates

### 2.6 Operations

- **Branding**: restaurant name (syncs to receipt settings), tagline, logo image, cover image
- **Fees**: delivery fee, service fee (%), minimum order value
- **Timings**: estimated delivery and collection times (minutes)
- **Address**: structured fields (line 1, line 2, city, postcode, country) + GPS coordinates (lat/lng)
- **SEO**: global meta title, meta description, keywords
- **Custom `<head>` code**: raw HTML injected into every page head (analytics, verification tags)

### 2.7 Schedule

- Per-day open/close times for Monday–Sunday
- Per-day "Closed" toggle
- Master manual override: instantly close the restaurant regardless of schedule

### 2.8 Integrations

- **Payment methods**: Stripe, PayPal, Cash — enable/disable, set display name, admin note, and distance restriction (e.g. cash on delivery within 3 km only)
- **API credentials**: Stripe public and secret keys, PayPal client ID, SMTP host/port/username/password
- **Thermal printer**: IP address, TCP port (default 9100), auto-print toggle, paper width (80 mm / 58 mm)

### 2.9 Email Templates

Six order lifecycle event templates, each fully editable:

| Event | Trigger |
|---|---|
| `order_confirmation` | Customer completes checkout |
| `order_confirmed` | Admin advances to Confirmed |
| `order_preparing` | Admin advances to Preparing |
| `order_ready` | Admin advances to Ready |
| `order_delivered` | Order marked Delivered |
| `order_cancelled` | Admin marks Cancelled |

Each template: subject line (supports `{{variables}}`), HTML body with variable interpolation, enabled toggle, last-modified date, and live preview. Receipt settings (logo, VAT number, custom message) are automatically applied to the email wrapper.

### 2.10 Footer Pages

Rich HTML editor for six built-in pages:

| Slug | Page |
|---|---|
| `/about-us` | About Us |
| `/contact-us` | Contact Us |
| `/terms` | Terms & Conditions |
| `/privacy` | Privacy Policy |
| `/cookies` | Cookie Policy |
| `/accessibility` | Accessibility Statement |

Per-page: enabled/disabled visibility toggle. Global copyright text editor.

### 2.11 Custom Pages

- Create unlimited custom pages with rich HTML content
- Fields: title, URL slug (auto-generated, conflict-checked, reserved slug protection), SEO title (≤60 chars), meta description (≤160 chars), published/draft toggle, created/updated timestamps
- Live SERP preview (shows how the page will appear in Google search results)
- Pages served at `/{slug}` via the `[footerPage]` dynamic route

### 2.12 Navigation Menus

- Separate editors for header and footer navigation
- Add any custom page or built-in footer page from a grouped picker
- Customise display label independently of the page title
- Reorder with up/down arrows
- Toggle active/inactive per link

### 2.13 Brand Colours

- Brand accent colour (maps to the full colour scale used across buttons, badges, and interactive elements)
- Page background colour
- Changes apply instantly via CSS custom properties — live preview without saving

### 2.14 Footer Logos

- Partner logos, payment icons, and certification badges
- Per-logo: image URL, alt label, optional click-through href, enabled toggle, display order

### 2.15 Receipt Settings

Applied to all printed ESC/POS receipts and all outgoing lifecycle emails:

| Field | Description |
|---|---|
| Show logo | Toggle — display logo in the receipt header |
| Logo URL | Hosted URL or base64 data URI |
| Restaurant name | Receipt-specific name (can differ from main brand name) |
| Phone | Contact phone on receipt |
| Website | Website URL on receipt |
| Email | Contact email on receipt |
| VAT number | e.g. "GB 123 4567 89" — omitted if blank |
| Thank you message | Bold footer line |
| Custom message | Optional second footer line (promotions, social media, etc.) |

Live thermal-paper-style preview with sprocket hole decoration reflects draft changes in real time.

### 2.16 Coupons

- Create percentage discounts (e.g. 15% off) and fixed-amount discounts (e.g. £5 off)
- Optional: minimum cart subtotal, usage limit (0 = unlimited), expiry date (blank = never)
- Usage count tracked in Supabase; incremented on every successful redemption
- Enable/disable toggle; active coupons shown with remaining usage

### 2.17 Tax (VAT)

- Enable/disable globally
- Rate: configurable percentage (e.g. 20%)
- **Inclusive mode**: prices already include VAT — system extracts and displays the component
- **Exclusive mode**: VAT is added on top of the subtotal at checkout
- Breakdown line optionally shown on cart, checkout, printed receipts, and emails
- VAT amount stored on each order (`vatAmount`, `vatInclusive`)

### 2.18 Drivers

- Register driver accounts: name, email, password, phone, vehicle info (e.g. "Red Honda Civic – AB12 CDE"), internal notes
- Active/inactive toggle — inactive drivers cannot log in
- View orders currently assigned to each driver

---

## 3. Kitchen Display (`/kitchen`)

- Full-screen dark Kanban board optimised for kitchen monitors
- **Three columns**:
  - **New Orders** (pending + confirmed) — "Start Preparing" button
  - **Preparing** — "Mark Ready" button
  - **Ready** — display-only; no action button (kitchen's job ends here)
- Each card shows: order ID, customer name, elapsed time badge (urgency colour-coded), fulfillment type badge, delivery address, scheduled time (if applicable), item list, special note
- "Ready" column shows "Awaiting driver pickup" or "Awaiting customer collection" depending on fulfillment type
- Urgency coding: green < 15 min, amber 15–29 min, red (pulsing) ≥ 30 min
- Completed-today counter (orders moved to ready)
- Fullscreen toggle, live clock, real-time Supabase sync

---

## 4. Driver Portal (`/driver` + `/driver/login`)

- Password-authenticated login using credentials set in Admin → Drivers
- **Available orders section**: unassigned delivery orders at "ready" or "preparing" status, sorted by readiness then age; shows customer name, phone, address, items, payment method
- Accept order → "Accept & Pick Up" button with confirmation dialog
- **My deliveries section**: orders assigned to this driver
- Progress through delivery leg: **Assigned → Picked Up → On the Way → Delivered**
- Confirm-before-deliver guard prevents accidental completion
- Call customer button (tel: link)
- Navigate button (Google Maps link to delivery address)
- Completed deliveries log (collapsible) with total value
- Stats bar: active count, delivered count, total £ value
- Real-time sync — new orders appear without page reload

---

## 5. Order Status Workflow

### Status fields

Each order has two status fields:

| Field | Type | Description |
|---|---|---|
| `status` | `OrderStatus` | Kitchen / admin leg progress |
| `deliveryStatus` | `DeliveryStatus` | Driver leg progress (delivery orders only) |

### OrderStatus values

`"pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled"`

### DeliveryStatus values

`"assigned" | "picked_up" | "on_the_way" | "delivered"`

### Workflow diagram

```
Customer places order
        │
        ▼
    [pending]
        │
   Admin confirms
        │
        ▼
  [confirmed]
        │
  Kitchen starts
        │
        ▼
  [preparing]
        │
  Kitchen marks ready
        │
        ▼
     [ready]
        │
   ┌────┴────┐
   │         │
Collection Delivery
   │         │
Admin marks  Driver accepts order
collected    (deliveryStatus → assigned)
   │         │
   │    Driver picks up
   │    (deliveryStatus → picked_up)
   │         │
   │    Driver on the way
   │    (deliveryStatus → on_the_way)
   │         │
   │    Driver delivers
   │    (deliveryStatus → delivered)
   │         │
   └────┬────┘
        │
    [delivered]
```

### Role responsibilities

| Role | Allowed actions |
|---|---|
| Admin | `pending → confirmed`, `confirmed → preparing`, `preparing → ready`, `ready → delivered` (collection only), cancel any order |
| Kitchen | `pending/confirmed → preparing`, `preparing → ready` |
| Driver | `assigned → picked_up → on_the_way → delivered` |
| Customer | Read-only — tracks order status in real time |

---

## 6. Real-Time Synchronisation

All five Supabase tables (`app_settings`, `categories`, `menu_items`, `customers`, `orders`) have Realtime enabled. `AppContext` subscribes to `postgres_changes` events on a single channel and updates local React state:

- Admin advances an order → customer's tracker updates immediately
- Customer places an order → admin's bell notification fires
- Driver marks "on the way" → customer badge changes from "Ready for Pickup" to "On the Way"
- Admin changes a menu item → customer menu reflects the change instantly

---

## 7. Integrations

### Thermal Printer (ESC/POS)

- Compatible with Epson, Star, or any ESC/POS network printer
- Configured by IP address and TCP port (default 9100)
- Receipt formatted by `lib/escpos.ts` using `receiptSettings` for branding
- Supports 80 mm (48 chars/line) and 58 mm (32 chars/line) paper widths
- Optional auto-print on every new order
- Proxied through `/api/print` (Next.js API route)

### Email (SMTP)

- Configured with SMTP host, port, username, and password in Admin → Integrations
- Email template engine in `lib/emailTemplates.ts` with `{{variable}}` interpolation
- Receipt branding (logo, contact, VAT number, custom message) applied to every outgoing email
- Sent via `/api/email` (Next.js API route) — credentials never exposed to the client

### Stripe & PayPal

- Public/client keys stored in `app_settings`; used client-side via Stripe.js / PayPal SDK
- Card data never touches the application server

### Geolocation

- Browser Geolocation API fetches customer coordinates at checkout
- Haversine formula calculates distance to restaurant GPS coordinates
- Matched zone fee applied; out-of-range payment methods hidden

---

## 8. Data Model Summary

| Entity | Storage | Key fields |
|---|---|---|
| Admin settings | `app_settings` JSONB | Restaurant info, schedule, zones, templates, coupons, tax, receipt, breakfast, drivers |
| Categories | `categories` table | id, name, emoji, sort_order |
| Menu items | `menu_items` table | id, category_id, name, price, dietary, variations (JSONB), add_ons (JSONB), stock |
| Customers | `customers` table | id, name, email, phone, password, tags, favourites, saved_addresses (JSONB) |
| Orders | `orders` table | id, customer_id, status, delivery_status, fulfillment, items (JSONB), driver_id, fees, coupon, VAT |

---

*Last updated: April 2026*
