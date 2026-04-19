# Single-Restaurant Food Ordering System — Requirements & Feature Specification

## Project Overview

A full-stack web application for a single restaurant providing an end-to-end food ordering and point-of-sale experience. The system serves five distinct user roles — customers, admin staff, kitchen staff, delivery drivers, and POS staff — each through a dedicated portal, all powered by a shared Next.js 15 codebase.

Online ordering data is stored in **Supabase (PostgreSQL)** with real-time synchronisation. POS data is stored in **browser `localStorage`** and is fully offline-capable.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Language | TypeScript 5 / React 19 |
| Styling | Tailwind CSS v4 |
| Icons | lucide-react |
| Online ordering DB | Supabase (PostgreSQL + Realtime) |
| POS storage | Browser `localStorage` |
| State | React Context (`AppContext` + `POSContext`) |

---

## User Roles & Portals

| Role | Route | Description |
|---|---|---|
| Customer | `/` + `/account` | Browse menu, place orders, track delivery in real time |
| Admin | `/admin` | Manage all restaurant operations via 20-panel dashboard |
| Kitchen | `/kitchen` | View and progress live orders on a full-screen Kanban board |
| Driver | `/driver` + `/driver/login` | Accept and deliver orders; advance delivery status |
| POS Staff | `/pos` | In-restaurant point-of-sale terminal with PIN authentication |

---

## 1. Customer Portal (`/`)

### 1.1 Menu Page

- **Header**: Restaurant cover image, logo, name, tagline, food hygiene rating, delivery/collection toggle, estimated times, minimum order value
- **Navigation**: Sticky desktop category sidebar with ScrollSpy; horizontal scrolling category strip on mobile
- **Breakfast Menu**: Separate amber-themed collapsible section shown only during admin-configured time window (e.g. 07:00–11:30)
- **Menu Items**: Grouped by category; each card shows name, description, price, dietary badges, popular flag, and add-to-cart button
- **Search & Filters**: Real-time search by name and description; dietary filter pills (Vegetarian, Vegan, Halal, Gluten-Free, etc.)
- **Item Customisation Modal**: Select variations (size, spice level, etc.), add-ons (extras with prices), and special instructions before adding to cart
- **Cart**: Sticky right sidebar on desktop; floating "View Basket" button → full-screen drawer on mobile. Shows subtotal, delivery fee, service fee, VAT breakdown, coupon discount, and grand total

### 1.2 Cart & Checkout Rules

- Checkout disabled and shows "Add £X more..." when below minimum order
- Store-closed state disables all add-to-cart and shows a "Closed" banner
- Delivery or collection selection with configurable estimated times
- Scheduled ordering: customer picks a future time slot

### 1.3 Checkout Flow

1. `CheckoutModal` opens with customer details form
2. Saved delivery addresses selectable or new address entered
3. Geolocation (optional): browser fetches coordinates → Haversine formula calculates distance → matching `DeliveryZone` fee applied
4. Coupon code entry with instant validation and discount display
5. VAT displayed as a line item when tax is enabled
6. Payment method list filtered by distance restriction
7. Order placed → receipt printed (if auto-print enabled) → confirmation email sent

### 1.4 Customer Account (`/account`)

- Full order history, sorted newest-first; active orders highlighted with pulsing "Live" badge and orange border
- **Kitchen tracker**: step dots for `pending → confirmed → preparing → ready` (delivery) or `→ delivered` (collection)
- **Driver tracker**: separate progress card for `assigned → picked_up → on_the_way → delivered` with live pulse when en route
- Status badge reflects `deliveryStatus` in real time — shows "On the Way" not "Ready for Pickup" when driver is en route
- Re-order: one-click add of all available items from a past order
- Saved delivery addresses: add / edit / set default / delete
- Profile editing: name and phone; email is read-only

---

## 2. Admin Dashboard (`/admin`)

20 tabbed panels grouped into 6 sections.

### 2.1 Orders — Delivery Board

- Live Kanban board: Pending → Confirmed → Preparing → Ready
- **Role-aware advance guard**: admin cannot advance delivery orders past "Ready"
- Collection orders can be advanced all the way to "Delivered" by admin
- Completed-today table for all delivered and collected orders
- New-order toast notification (bell icon) on every new customer order

### 2.2 Orders — Refunds

- Process full or partial refunds for any completed order
- Capture: refund reason, method (cash, bank transfer, etc.), amount
- Partial refund shows the retained amount
- Full refund history log with timestamps and amounts

### 2.3 Menu — Menu Items

- Full CRUD for categories (name, emoji, sort order) and menu items
- Item fields: name, description, price, image (URL or upload), dietary tags, popular flag
- **Variations**: groups with named options and price deltas (e.g. Small/Medium/Large)
- **Add-ons**: individual extras with individual prices (e.g. extra cheese +£1)
- **Stock tracking**: quantity-based (`stockQty`) or manual status override (`in_stock`, `low_stock`, `out_of_stock`)
- Category reordering

### 2.4 Menu — Breakfast Menu

- Separate breakfast menu independent of the main menu
- Configurable time window (start time, end time) and enabled toggle
- Same item management as main menu (image, dietary, variations, add-ons, stock)

### 2.5 Customers — Customers

- Customer list with name, email, phone, registration date, tags (VIP, Regular, etc.)
- Per-customer order history with lifetime spend
- Manual order status override (phone orders or corrections)

### 2.6 Customers — Drivers

- Register driver accounts: name, email, password, phone, vehicle info, internal notes
- Active/inactive toggle — inactive drivers cannot log in
- View orders currently assigned to each driver

### 2.7 Finance — Coupons

- Create percentage discounts (e.g. 15% off) and fixed-amount discounts (e.g. £5 off)
- Optional: minimum cart subtotal, usage limit (0 = unlimited), expiry date (blank = never)
- Usage count tracked in Supabase; enable/disable toggle

### 2.8 Finance — Tax & VAT

- Enable/disable globally; configurable rate (e.g. 20%)
- **Inclusive mode**: prices already include VAT — system extracts and displays the component
- **Exclusive mode**: VAT added on top at checkout
- Breakdown line optionally shown on cart, checkout, printed receipts, and emails
- VAT amount stored on each order (`vatAmount`, `vatInclusive`)

### 2.9 Finance — POS Reports

- Reads POS data from `localStorage` (same browser origin as the POS terminal)
- Period selector: Today, Yesterday, This Week, This Month, Last 30 Days, Custom date range
- 6 KPI cards: Revenue, Avg Order, Gross Profit & Margin, VAT Collected, Tips, Discounts Given
- 4 tabs:
  - **Overview**: daily revenue chart, payment method breakdown, hourly heatmap, financial summary table
  - **Items**: best-selling items by revenue with relative bar chart
  - **Staff**: per-staff sales count, revenue, and average order
  - **Transactions**: searchable/sortable table, show voided toggle, totals footer
- Export CSV

### 2.10 Settings — Operations

- **Branding**: restaurant name (syncs to receipt settings), tagline, logo, cover image
- **Fees**: delivery fee, service fee (%), minimum order value
- **Timings**: estimated delivery and collection times (minutes)
- **Address**: structured fields + GPS coordinates (lat/lng) for geolocation
- **SEO**: global meta title, meta description, keywords
- **Custom `<head>` code**: raw HTML injected into every page head

### 2.11 Settings — Schedule

- Per-day open/close times for Monday–Sunday
- Per-day "Closed" toggle
- Master manual override: instantly close the restaurant regardless of schedule

### 2.12 Settings — Delivery Zones

- Concentric km-ring zone editor
- Each zone: name, inner radius (km), outer radius (km), delivery fee (£), enabled toggle, colour
- Zones matched at checkout via Haversine formula

### 2.13 Settings — Integrations

- **Payment methods**: Stripe, PayPal, Cash — enable/disable, display name, distance restriction
- **API credentials**: Stripe public and secret keys, PayPal client ID, SMTP host/port/user/password
- **Thermal printer**: IP address, TCP port (default 9100), auto-print toggle, paper width (80 mm / 58 mm)

### 2.14 Settings — Email Templates

Six order lifecycle event templates:

| Event | Trigger |
|---|---|
| `order_confirmation` | Customer completes checkout |
| `order_confirmed` | Admin advances to Confirmed |
| `order_preparing` | Admin advances to Preparing |
| `order_ready` | Admin advances to Ready |
| `order_delivered` | Order marked Delivered |
| `order_cancelled` | Admin marks Cancelled |

Each template: subject line (supports `{{variables}}`), HTML body with variable interpolation, enabled toggle, live preview.

### 2.15 Content — Footer Pages

Rich HTML editor for six built-in pages: About Us, Contact Us, Terms & Conditions, Privacy Policy, Cookie Policy, Accessibility Statement. Per-page visibility toggle; global copyright text.

### 2.16 Content — Custom Pages

- Unlimited custom pages with rich HTML content
- Fields: title, URL slug (auto-generated, conflict-checked), SEO title (≤60 chars), meta description (≤160 chars), publish toggle, timestamps
- Live SERP preview
- Served at `/{slug}` via the `[footerPage]` dynamic route

### 2.17 Content — Navigation Menus

- Separate header and footer navigation editors
- Add any custom or built-in page; customise display label; reorder; toggle active/inactive

### 2.18 Content — Brand Colours

- Brand accent colour (full Tailwind colour scale) and page background
- Changes apply instantly via CSS custom properties — live preview without saving

### 2.19 Content — Footer Logos

Partner logos, payment icons, and certification badges. Per-logo: image URL, alt label, optional click-through href, enabled toggle, display order.

### 2.20 Content — Receipt Settings

Applied to all ESC/POS printed receipts and all outgoing lifecycle emails:

| Field | Description |
|---|---|
| Show logo | Toggle — display logo in receipt header |
| Logo URL | Hosted URL or base64 data URI |
| Restaurant name | Receipt-specific name |
| Phone / Website / Email | Contact details on receipt |
| VAT number | e.g. "GB 123 4567 89" |
| Thank you message | Bold footer line |
| Custom message | Optional second footer line |

Live thermal-paper-style preview reflects draft changes in real time.

---

## 3. Kitchen Display (`/kitchen`)

- Full-screen dark Kanban board optimised for kitchen monitors
- **Three columns**:
  - **New Orders** (pending + confirmed) — "Start Preparing" button
  - **Preparing** — "Mark Ready" button
  - **Ready** — display-only; no action button (kitchen's job ends here)
- Each card: order ID, customer name, elapsed time, fulfillment badge, delivery address, item list, special note
- "Ready" column shows "Awaiting driver pickup" or "Awaiting customer collection"
- Urgency coding: green < 15 min, amber 15–29 min, red (pulsing) ≥ 30 min
- Completed-today counter, fullscreen toggle, live clock, real-time sync

---

## 4. Driver Portal (`/driver` + `/driver/login`)

- Password-authenticated login (credentials set in Admin → Drivers)
- **Available orders**: unassigned delivery orders at "ready" or "preparing" sorted by readiness then age; shows customer name, phone, address, items, payment method
- Accept order → "Accept & Pick Up" confirmation dialog
- **My deliveries**: orders assigned to this driver; progression through delivery leg
- Delivery leg: **Assigned → Picked Up → On the Way → Delivered**
- Confirm-before-deliver guard
- Call customer (tel: link); Navigate button (Google Maps to delivery address)
- Completed deliveries log with total earnings
- Stats bar: active count, delivered count, total value
- Real-time sync — new orders appear without page reload

---

## 5. POS System (`/pos`)

A fully standalone in-restaurant point-of-sale terminal. All data is stored in browser `localStorage`. No Supabase connection required — fully offline-capable.

### 5.1 Staff Authentication & Roles

- Animated 4-digit PIN keypad login
- Three roles with distinct permission sets:

| Permission | Admin | Manager | Cashier |
|---|---|---|---|
| Apply discount | Yes | Yes | No |
| Void sale | Yes | Yes | No |
| Access dashboard | Yes | Yes | No |
| Manage staff | Yes | Yes | No |
| Manage menu | Yes | No | No |
| Manage customers | Yes | Yes | Yes |
| Access settings | Yes | No | No |

- Role badge displayed in top navigation bar
- All nav tabs and actions are gated by role permissions
- Staff management: add, edit, delete staff; toggle active; set hourly rate

### 5.2 Sale Screen

- Product grid grouped by category; each tile shows name, price, emoji or image, popular badge
- **Product images**: upload a file (stored as base64) or paste a URL; shown as 4:3 cover on the tile
- Active offer badge with auto-generated label per type (e.g. "20% OFF", "BOGO 2+1", "3 for £10", "Buy 2+ save 15%")
- Strikethrough original price when a simple (per-unit) offer is active
- Cart-level offer types show price in amber to indicate quantity-based pricing
- Modifier modal opens before adding to cart when a product has required modifiers

### 5.3 Product Offers

6 offer types, all support optional start/end date windows:

| Type | Mechanism |
|---|---|
| `percent` | % off per unit — applied at add-to-cart time |
| `fixed` | £ off per unit — applied at add-to-cart time |
| `price` | Override to a set price per unit — applied at add-to-cart time |
| `bogo` | Buy X get Y free — computed at subtotal time |
| `multibuy` | Buy X for £Y (bundle price) — computed at subtotal time |
| `qty_discount` | Buy ≥ minimum quantity, get X% off each — computed at subtotal time |

### 5.4 Cart & Order Panel

- Line items with +/− quantity controls and per-line delete
- Lines with active quantity-based offers shown with amber background and "Save £X" label
- Discount application (Manager/Admin only): percentage or fixed amount with optional note
- Tip selection (admin-configurable presets) or custom tip entry
- Customer search and assignment (linked to POS customer records)
- Table number assignment (when table mode is enabled in settings)
- **Payment methods**:
  - **Cash**: enter amount tendered; change calculated automatically
  - **Card**: single card payment
  - **Split**: any mix of cash and card amounts
- Loyalty points earned shown pre-completion
- Receipt modal: print and/or email to customer via SMTP

### 5.5 Void & Refund

- Requires Manager or Admin role
- **Void modal** captures:
  1. Void reason (free text, required)
  2. Refund method: **Cash** (return cash to customer) / **Card** (process card refund) / **No Refund**
  3. Refund amount (pre-filled with sale total, editable for partial refunds)
  4. Partial refund warning showing retained amount
- Confirm button label dynamically shows: "Void & Refund £X" or "Void & No Refund"
- Voided transactions: marked with "VOID" badge, struck through in red, excluded from revenue KPIs
- Refund info displayed on voided rows: method badge + amount

### 5.6 Dashboard — Overview Tab

Displayed KPIs for today:
- Revenue, transaction count, average order value, tips collected
- Last-7-days revenue bar chart (today highlighted in orange)
- Today's payment method mix (cash / card / split)
- Overall all-time gross margin percentage
- All-time best sellers ranked by quantity sold with relative bar chart
- Recent transactions list (10 most recent) with inline void button (role-gated)

### 5.7 Dashboard — Reports Tab

Full reporting panel embedded in the POS dashboard:

- **Period selector**: Today, Yesterday, This Week, This Month, Last 30 Days, Custom
- **Custom date range**: From/To date pickers (shown when "Custom" is selected)
- **6 KPI cards**: Total Revenue, Average Order, Gross Profit (+ margin %), VAT Collected, Tips, Discounts Given
- **Sub-tabs**:
  - **Overview**: daily revenue bar chart, payment method breakdown with revenue amounts, hourly sales heatmap (24-cell, colour-coded by intensity), financial summary table (Gross Sales → Discounts → VAT → Tips → Total Revenue → Est. COGS → Gross Profit → Gross Margin)
  - **Items**: best-selling items by revenue with relative bars and qty sold
  - **Staff**: per-staff revenue, sales count, average order with relative bars
  - **Transactions**: searchable (receipt no, staff, customer), sortable (date/total), show voided toggle, inline void button (role-gated), totals footer
- **Export CSV**: downloads all transactions in the period as a CSV file

### 5.8 POS Customers

- Search, add, edit, delete POS customer records
- Fields: name, email, phone, tags, notes
- Loyalty points balance, gift card balance, total spend, visit count, last visit date
- Purchase history view

### 5.9 POS Staff Management

- Add staff: name, email, role, 4-digit PIN, hourly rate, avatar colour
- Edit/delete staff; toggle active/inactive
- Clock In / Clock Out time tracking per staff member
- Clock entries log with total minutes per shift

### 5.10 POS Settings

- Business name, currency symbol
- Tax rate and inclusive/exclusive mode
- Default tip option presets
- Receipt footer message
- Loyalty points rate (points per £ spent, £ value per point)
- Gift card enabled toggle
- Max discount percentage, require PIN for discount toggle
- Table mode enabled, table count
- Location (for receipt)
- **Receipt branding**: restaurant name, phone, website, email, VAT number, show logo toggle, logo URL, thank-you message, custom message
- **SMTP**: host, port, username, password, from-name (for emailing receipts to customers)
- **Hardware**: thermal printer configuration

---

## 6. Order Status Workflow (Online Ordering)

### Status fields

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
| Admin | `pending → confirmed → preparing → ready`; `ready → delivered` (collection only); cancel any order |
| Kitchen | `pending/confirmed → preparing`; `preparing → ready` |
| Driver | `assigned → picked_up → on_the_way → delivered` |
| Customer | Read-only status tracking |

---

## 7. Real-Time Synchronisation (Online Ordering)

All five Supabase tables have Realtime enabled. `AppContext` subscribes to `postgres_changes` events:

- Admin advances an order → customer's tracker updates immediately
- Customer places an order → admin's bell notification fires
- Driver marks "on the way" → customer badge changes from "Ready for Pickup" to "On the Way"
- Admin changes a menu item → customer menu reflects the change instantly

---

## 8. Integrations

### Thermal Printer (ESC/POS)

- Compatible with Epson, Star, or any ESC/POS network printer
- Configured by IP address and TCP port (default 9100)
- Receipt formatted by `lib/escpos.ts`
- Supports 80 mm (48 chars/line) and 58 mm (32 chars/line)
- Auto-print on every new order (online ordering)
- Proxied through `/api/print` (Next.js API route)

### Email (SMTP)

- Configured in Admin → Integrations (online ordering lifecycle emails)
- Also configured in POS → Settings → Hardware (POS receipt emails to customers)
- Email template engine in `lib/emailTemplates.ts` with `{{variable}}` interpolation
- Sent via `/api/email` — SMTP credentials never exposed to the client bundle

### Stripe & PayPal

- Public/client keys stored in `app_settings`; used client-side via Stripe.js / PayPal SDK
- Card data never touches the application server

### Geolocation

- Browser Geolocation API fetches customer coordinates at checkout
- Haversine formula calculates distance to restaurant GPS coordinates
- Matched zone fee applied; out-of-range payment methods hidden

---

## 9. Data Model Summary

### Online Ordering (Supabase)

| Entity | Storage | Key fields |
|---|---|---|
| Admin settings | `app_settings` JSONB | Restaurant info, schedule, zones, templates, coupons, tax, receipt, breakfast, drivers |
| Categories | `categories` table | id, name, emoji, sort_order |
| Menu items | `menu_items` table | id, category_id, name, price, dietary, variations, add_ons, stock |
| Customers | `customers` table | id, name, email, phone, password, tags, favourites, saved_addresses |
| Orders | `orders` table | id, customer_id, status, delivery_status, fulfillment, items, driver_id, fees, coupon, VAT |

### POS (localStorage)

| Key | Contents |
|---|---|
| `pos_sales` | Array of `POSSale` — all completed sales with items, payments, void/refund info |
| `pos_products` | Array of `POSProduct` — POS menu items with offers, images, modifiers |
| `pos_categories` | Array of `POSCategory` |
| `pos_staff` | Array of `POSStaff` — staff records with role, PIN, permissions |
| `pos_customers` | Array of `POSCustomer` — loyalty, gift card, purchase history |
| `pos_settings` | `POSSettings` — tax, tip presets, receipt branding, SMTP, printer |
| `pos_clock_entries` | Array of `POSClockEntry` — staff clock in/out records |

---

*Last updated: April 2026*
