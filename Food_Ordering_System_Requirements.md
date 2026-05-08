# Single-Restaurant Food Ordering System — Requirements & Feature Specification

## Project Overview

A full-stack web application for a single restaurant providing an end-to-end food ordering and point-of-sale experience. The system serves six distinct user roles — customers, admin staff, kitchen staff, delivery drivers, waiter staff, and POS staff — each through a dedicated portal, all powered by a shared Next.js 15 codebase.

Online ordering data is stored in **Supabase (PostgreSQL)** with real-time synchronisation. POS data is stored primarily in **browser `localStorage`** and is fully offline-capable, with automatic background sync to Supabase when connectivity is available.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Language | TypeScript 5 / React 19 |
| Styling | Tailwind CSS v4 |
| Icons | lucide-react |
| Online ordering DB | Supabase (PostgreSQL + Realtime) |
| POS storage | Browser `localStorage` (primary) + Supabase (background sync) |
| Offline sync | `lib/posOutbox.ts` — localStorage outbox with retry |
| State | React Context (`AppContext` + `POSContext`) |

---

## User Roles & Portals

| Role | Route | Description |
|---|---|---|
| Customer | `/` + `/login` + `/verify-email` | Browse menu, place orders, favourites, track delivery in real time |
| Admin | `/admin` | Manage all restaurant operations via 24-panel dashboard |
| Kitchen | `/kitchen` | View and progress live orders on a full-screen Kanban board |
| Driver | `/driver` + `/driver/login` | Accept and deliver orders; advance delivery status |
| Waiter | `/waiter` | Table-service app — place dine-in orders, settle bills, void, refund |
| POS Staff | `/pos` | In-restaurant point-of-sale terminal with PIN authentication |

---

## 1. Customer Portal (`/`)

### 1.1 Menu Page

- **Header**: Restaurant cover image, logo, name, tagline, food hygiene rating, delivery/collection toggle, estimated times, minimum order value
- **Delivery / Collection toggle**: Visible pill switch in the hero section — Delivery or Collection. Updates estimated time display, delivery fee visibility, and checkout fulfillment. State managed globally via `AppContext.fulfillment`.
- **Navigation**: Sticky desktop category sidebar with ScrollSpy; horizontal scrolling category strip on mobile (shown only when viewing the menu screen)
- **Breakfast Menu**: Separate amber-themed collapsible section shown only during admin-configured time window (e.g. 07:00–11:30)
- **Menu Items**: Grouped by category; each card shows name, description, price, dietary badges, popular flag, and add-to-cart button. Heart icon visible to signed-in customers for adding to Favourites.
- **Search & Filters**: Real-time search by name and description; dietary filter pills (Vegetarian, Vegan, Halal, Gluten-Free, etc.)
- **Item Customisation Modal**: Select variations (size, spice level, etc.), add-ons (extras with prices), and special instructions before adding to cart
- **Cart**: Sticky right sidebar on desktop; full-screen drawer triggered from mobile bottom nav Cart tab. Shows subtotal, delivery fee (hidden for collection), service fee, VAT breakdown, coupon discount, store credit applied, and grand total
- **Favourites screen**: Heart icon on food cards (signed-in customers only); dedicated Favourites screen accessible from sidebar and mobile nav; persisted to `customers.favourites` via Supabase; one-tap "Add to order" for each saved item
- **My Orders screen**: Active order shown as a dark card with Live badge and status; past orders list with Reorder button; **Track Order modal** with step-by-step SVG progress bar and driver details
- **Reserve a Table**: Button in the left sidebar Navigate section, shown when `settings.reservationSystem.enabled` is true; opens the reservation booking modal
- **Mobile bottom navigation**: Fixed tab bar at viewport bottom — Menu, Saved (Favourites), Cart (elevated orange circle with badge), Orders, Profile; iOS safe-area insets; active tab highlighted with orange top bar

### 1.2 Cart & Checkout Rules

- Checkout disabled and shows "Add £X more..." when below minimum order
- Store-closed state disables all add-to-cart and shows a "Closed" banner
- Delivery or collection selection with configurable estimated times
- Scheduled ordering: customer picks a future time slot
- Store credit applied automatically when balance is available

### 1.3 Checkout Flow

1. `CheckoutModal` opens with customer details form
2. Saved delivery addresses selectable or new address entered
3. Geolocation (optional): browser fetches coordinates → Haversine formula calculates distance → matching `DeliveryZone` fee applied
4. Coupon code entry with instant validation and discount display
5. Store credit deducted at checkout via `POST /api/customers/[id]/spend-credit`
6. VAT displayed as a line item when tax is enabled
7. Payment method list filtered by distance restriction
8. Order placed → receipt printed (if auto-print enabled) → confirmation email sent
9. **Guest profile auto-capture**: fire-and-forget `POST /api/guest-profile` saves name, email, phone, and order total to `reservation_customers` — no account required, no impact on order completion if it fails

### 1.4 Customer Authentication

All customer authentication uses **bcrypt passwords** and **httpOnly session cookies**. No passwords or session tokens are stored in `localStorage`.

| Method | Endpoint | Outcome |
|---|---|---|
| Email + password registration | `POST /api/auth/register` | bcrypt hash stored; verification email sent; `customer_session` cookie set |
| Email + password login | `POST /api/auth/login` | bcrypt compare; `customer_session` cookie set (30-day expiry) |
| Google OAuth (Sign in with Google) | `GET /api/auth/google` → callback | Authorization code flow; finds or creates account; sets `customer_session` cookie |
| Email verification | `POST /api/auth/verify-email` | Sets `email_verified = true` on the customer row |
| Resend verification email | `POST /api/auth/resend-verification` | Sends new verification link |
| Forgot / reset password | `POST /api/auth/reset-password` | Signed reset token emailed; new password hashed on confirmation |
| Session check | `GET /api/auth/me` | Returns current customer from cookie |
| Logout | `POST /api/auth/logout` | Clears the `customer_session` cookie |

The `AuthModal` component provides login/register within a modal overlay on `/`. The `/login` page provides the same flows as a full-page experience (also handles forgot-password flow). The `EmailVerificationBanner` component prompts unverified customers in the page header.

### 1.5 Customer Account (screen within `/`)

- Full order history, sorted newest-first; active orders highlighted with pulsing "Live" badge
- **Kitchen tracker**: step dots for `pending → confirmed → preparing → ready`
- **Driver tracker**: separate progress card for `assigned → picked_up → on_the_way → delivered` with live pulse when en route
- **Track Order modal**: step-by-step SVG progress bar across all stages; driver name and phone when assigned
- Status badge reflects `deliveryStatus` in real time
- Re-order: one-click Reorder button copies all available items from a past order into the cart
- Saved delivery addresses: add / edit / set default / delete
- Profile editing: name and phone; email is read-only
- Store credit balance displayed on profile
- Saved favourites count — click to jump to Favourites screen

---

## 2. Admin Dashboard (`/admin`)

24 tabbed panels grouped into 7 sections.

### 2.1 Orders — Delivery Board

- Live Kanban board: Pending → Confirmed → Preparing → Ready
- **Role-aware advance guard**: admin cannot advance delivery orders past "Ready"
- Collection orders can be advanced all the way to "Delivered" by admin
- Completed-today table for all delivered and collected orders
- New-order toast notification (bell icon) on every new customer order

### 2.2 Orders — Online Reports

- Revenue KPIs: total revenue, order volume, avg order value, fulfilment breakdown
- Period selector with date range support
- Payment method breakdown chart

### 2.3 Orders — Refunds

- Process full or partial refunds for any completed order
- Capture: refund reason, method (cash, bank transfer, etc.), amount
- Partial refund shows the retained amount
- Full refund history log with timestamps and amounts

### 2.4 Menu — Menu Items

- Full CRUD for categories (name, emoji, sort order) and menu items
- Item fields: name, description, price, image (URL or upload), dietary tags, popular flag
- **Variations**: groups with named options and price deltas (e.g. Small/Medium/Large)
- **Add-ons**: individual extras with individual prices (e.g. extra cheese +£1)
- **Stock tracking**: quantity-based (`stockQty`) or manual status override (`in_stock`, `low_stock`, `out_of_stock`)
- Category reordering

### 2.5 Menu — Breakfast Menu

- Separate breakfast menu independent of the main menu
- Configurable time window (start time, end time) and enabled toggle
- Same item management as main menu (image, dietary, variations, add-ons, stock)

### 2.6 Customers — Customers

- Customer list with name, email, phone, registration date, tags (VIP, Regular, etc.)
- Per-customer order history with lifetime spend and store credit balance
- Manual order status override (phone orders or corrections)

### 2.7 Customers — Guest Profiles

CRM view combining guests from both table reservations and online food orders.

- List of all `reservation_customers` records sorted by most recent activity
- Per-guest: name, email, phone, visit count, first/last visit, online order count, total online spend, last order date, tags, notes, marketing opt-in
- **Filters**: all guests / has reservations / has online orders / marketing opt-in
- Tag assignment (VIP, Regular, Newsletter, etc.) and free-text notes
- Marketing opt-in toggle
- **CSV export**: includes all CRM fields for use in email campaigns
- Empty state explains both reservation check-ins and online checkouts as data sources

### 2.8 Customers — Drivers

- Register driver accounts: name, email, password, phone, vehicle info, internal notes
- Active/inactive toggle — inactive drivers cannot log in
- View orders currently assigned to each driver

### 2.9 Finance — Coupons

- Create percentage discounts (e.g. 15% off) and fixed-amount discounts (e.g. £5 off)
- Optional: minimum cart subtotal, usage limit (0 = unlimited), expiry date (blank = never)
- Usage count tracked in Supabase; enable/disable toggle

### 2.10 Finance — Tax & VAT

- Enable/disable globally; configurable rate (e.g. 20%)
- **Inclusive mode**: prices already include VAT — system extracts and displays the component
- **Exclusive mode**: VAT added on top at checkout
- Breakdown line optionally shown on cart, checkout, printed receipts, and emails
- VAT amount stored on each order (`vatAmount`, `vatInclusive`)

### 2.11 Finance — POS Reports

- Reads POS data from `localStorage` (same browser origin as the POS terminal)
- Period selector: Today, Yesterday, This Week, This Month, Last 30 Days, Custom date range
- 6 KPI cards: Revenue, Avg Order, Gross Profit & Margin, VAT Collected, Tips, Discounts Given
- 4 tabs:
  - **Overview**: daily revenue chart, payment method breakdown, hourly heatmap, financial summary table
  - **Items**: best-selling items by revenue with relative bar chart
  - **Staff**: per-staff sales count, revenue, and average order
  - **Transactions**: searchable/sortable table, show voided toggle, totals footer
- Export CSV

### 2.12 Settings — Operations

- **Branding**: restaurant name, tagline, logo, cover image — changes propagate to POS, receipts, emails, and KDS automatically (single source of truth via `AppContext.settings.restaurant`)
- **Fees**: delivery fee, service fee (%), minimum order value
- **Timings**: estimated delivery and collection times (minutes)
- **Address**: structured fields + GPS coordinates (lat/lng) for geolocation
- **SEO**: global meta title, meta description, keywords
- **Custom `<head>` code**: raw HTML injected into every page head

### 2.13 Settings — Schedule

- Per-day open/close times for Monday–Sunday
- Per-day "Closed" toggle
- Master manual override: instantly close the restaurant regardless of schedule

### 2.14 Settings — Delivery Zones

- Concentric km-ring zone editor
- Each zone: name, inner radius (km), outer radius (km), delivery fee (£), enabled toggle, colour
- Zones matched at checkout via Haversine formula

### 2.15 Settings — Integrations

- **Payment methods**: Stripe, PayPal, Cash — enable/disable, display name, distance restriction
- **API credentials**: Stripe public and secret keys, PayPal client ID, SMTP host/port/user/password
- **Thermal printer**: IP address, TCP port (default 9100), auto-print toggle, paper width (80 mm / 58 mm)

### 2.16 Settings — Email Templates

Ten lifecycle event templates:

| Event | Trigger |
|---|---|
| `order_confirmation` | Customer completes checkout |
| `order_confirmed` | Admin advances to Confirmed |
| `order_preparing` | Admin advances to Preparing |
| `order_ready` | Admin advances to Ready |
| `order_delivered` | Order marked Delivered |
| `order_cancelled` | Admin marks Cancelled |
| `reservation_confirmation` | Reservation created |
| `reservation_update` | Reservation modified |
| `reservation_cancellation` | Reservation cancelled |
| `reservation_review_request` | Sent after check-out (links to review URL) |

Each template: subject line (supports `{{variables}}`), HTML body with variable interpolation, enabled toggle, live preview.

### 2.17 Settings — Staff & Tables

- **Staff tab**: Add, edit, or delete waiter accounts. Fields: name, PIN (4 digits), role (`senior` or `waiter`), avatar colour, active toggle.
- **Tables tab**: Add, edit, or delete dining tables. Fields: label (e.g. T4, B1), seats, section, active toggle.

### 2.18 Settings — Reservations

Configuration for the table reservation system:

- Enable / disable reservation booking
- Slot duration (minutes) — how long a booking occupies the table
- Max advance booking (days)
- Restaurant open/close times for reservations
- Slot interval (minutes) — step between bookable time slots
- Maximum party size
- Blackout dates (specific dates when reservations are unavailable)
- Review URL (Google Maps / TripAdvisor link sent in post-visit email)

### 2.19 Content — Footer Pages

Rich HTML editor for six built-in pages: About Us, Contact Us, Terms & Conditions, Privacy Policy, Cookie Policy, Accessibility Statement. Per-page visibility toggle; global copyright text.

### 2.20 Content — Custom Pages

- Unlimited custom pages with rich HTML content
- Fields: title, URL slug (auto-generated, conflict-checked), SEO title (≤60 chars), meta description (≤160 chars), publish toggle, timestamps
- Served at `/{slug}` via the `[footerPage]` dynamic route

### 2.21 Content — Navigation Menus

- Separate header and footer navigation editors
- Add any custom or built-in page; customise display label; reorder; toggle active/inactive

### 2.22 Content — Brand Colours

- Brand accent colour (full Tailwind colour scale) and page background
- Changes apply instantly via CSS custom properties

### 2.23 Content — Footer Logos

Partner logos, payment icons, and certification badges. Per-logo: image URL, alt label, optional click-through href, enabled toggle, display order.

### 2.24 Content — Receipt Settings

Applied to all ESC/POS printed receipts and all outgoing lifecycle emails:

| Field | Description |
|---|---|
| Show logo | Toggle — display logo in receipt header |
| Logo URL | Hosted URL or base64 data URI |
| Restaurant name | Receipt-specific override (leave blank to use branding name) |
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
  - **Ready** — display-only; "Mark as Collected" for POS/collection orders only
- Each card: display name, elapsed time, fulfillment badge, delivery address, item list, special note
- Urgency coding: amber at 15 min, red (pulsing) at 30 min
- Completed-today counter, fullscreen toggle, live clock, real-time sync
- No authentication required — trusted in-restaurant screen

---

## 4. Waiter App (`/waiter`)

A mobile-first table-service companion for front-of-house staff. Authenticated by 4-digit PIN — no admin credentials required.

### 4.1 Staff Roles

| Role | Place orders | View bill | Settle bill | Void table | Refund |
|---|---|---|---|---|---|
| `waiter` | Yes | Yes | Yes | No | No |
| `senior` | Yes | Yes | Yes | Yes | Yes |

### 4.2 Flow

1. Select name → enter PIN → validated server-side
2. Table grid: colour-coded free / occupied per section
3. Select table → menu (category-tabbed) → add items with notes
4. "Send to Kitchen" → KDS shows order instantly via Realtime
5. Multiple rounds per table are supported
6. Bill view: aggregated total → Settle (Cash or Card) → table clears

### 4.3 Void & Refund (Senior only)

- **Void** (before settlement): cancel all active orders; mandatory reason; sets `status = "cancelled"` with audit fields
- **Refund** (after settlement): full or partial; cash or card; distributed proportionally across rounds; appends `RefundRecord` to `orders.refunds`

### 4.4 Receipt

- On-screen HTML receipt with restaurant branding, VAT number, served-by, table number
- Print or email to customer via SMTP

---

## 5. Driver Portal (`/driver` + `/driver/login`)

- Email + bcrypt password login via `/driver/login`; issues an httpOnly `driver_session` cookie (30-day expiry)
- All `/driver/*` routes are protected by `middleware.ts` — unauthenticated requests redirect to `/driver/login`
- Logout: `POST /api/auth/driver/logout` → clears the `driver_session` cookie and redirects to `/driver/login`
- **Available orders**: unassigned delivery orders at "ready" or "preparing"
- Accept order → "Accept & Pick Up" confirmation dialog
- **Delivery leg**: Assigned → Picked Up → On the Way → Delivered
- Confirm-before-deliver guard
- Call customer (tel: link); Navigate button (Google Maps)
- Completed deliveries log with total earnings
- Stats bar: active count, delivered count, total value
- Real-time sync — new orders appear without page reload

---

## 6. POS System (`/pos`)

A fully standalone in-restaurant point-of-sale terminal. All data is stored in browser `localStorage`. No Supabase connection is required to process sales — the system is fully offline-capable.

### 6.1 Staff Authentication & Roles

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

### 6.2 Offline Mode

The POS is designed to keep operating without internet connectivity:

- **Connectivity probe**: `HEAD /api/ping` polled every 30 s (online) or 5 s (offline) — more reliable than `navigator.onLine`
- **Amber offline banner**: shown below the header with pending-sync count and retry button
- **Cash-only mode**: Card and Split payment buttons are disabled when offline — card terminals require internet
- **Outbox queue** (`lib/posOutbox.ts`): KDS sync failures are saved to `localStorage` under `pos_outbox` and retried automatically when connectivity restores, with exponential back-off (2 s → 4 s → 8 s → 16 s → 32 s, up to 5 attempts)
- **Blue sync indicator**: shown when reconnected and draining the outbox
- **`beforeunload` warning**: browser warns before tab close when unsynced sales remain
- **Data safety**: every sale is committed to `localStorage` before any network call — no data is ever lost due to a network failure

### 6.3 Sale Screen

- Product grid grouped by category; each tile shows name, price, emoji or image, popular badge
- Active offer badge with auto-generated label (e.g. "20% OFF", "BOGO 2+1", "3 for £10")
- Modifier modal opens when a product has required modifiers

### 6.4 Product Offers

6 offer types, all supporting optional start/end date windows:

| Type | Mechanism |
|---|---|
| `percent` | % off per unit — applied at add-to-cart time |
| `fixed` | £ off per unit — applied at add-to-cart time |
| `price` | Override to a set price per unit — applied at add-to-cart time |
| `bogo` | Buy X get Y free — computed at subtotal time |
| `multibuy` | Buy X for £Y (bundle price) — computed at subtotal time |
| `qty_discount` | Buy ≥ minimum quantity, get X% off each — computed at subtotal time |

### 6.5 Cart & Order Panel

- Line items with +/− quantity controls and per-line delete
- Lines with active quantity-based offers shown with amber background and "Save £X" label
- Discount application (Manager/Admin only): percentage or fixed amount with optional note
- Tip selection (admin-configurable presets) or custom tip entry
- Customer search and assignment (linked to POS customer records)
- Table number assignment (when table mode is enabled)
- **Payment methods**:
  - **Cash**: enter amount tendered; change calculated automatically (available offline)
  - **Card**: single card payment (disabled when offline — requires internet)
  - **Split**: any mix of cash and card (disabled when offline)
- Loyalty points earned shown pre-completion
- Receipt modal: print and/or email to customer via SMTP

### 6.6 Void & Refund

- Requires Manager or Admin role
- **Void modal** captures: void reason (required), refund method (Cash / Card / No Refund), refund amount (pre-filled, editable)
- Voided transactions: marked with "VOID" badge, struck through in red, excluded from revenue KPIs

### 6.7 Dashboard — Overview Tab

- Revenue, transaction count, average order value, tips collected for today
- Last-7-days revenue bar chart
- Today's payment method mix (cash / card / split)
- All-time gross margin percentage and best sellers
- Recent 10 transactions with inline void (role-gated)

### 6.8 Dashboard — Reports Tab

- **Period selector**: Today, Yesterday, This Week, This Month, Last 30 Days, Custom
- **6 KPI cards**: Total Revenue, Average Order, Gross Profit (+ margin %), VAT Collected, Tips, Discounts Given
- **Sub-tabs**:
  - **Overview**: daily revenue bar chart, payment method breakdown, hourly heatmap (24-cell), financial summary table
  - **Items**: best-selling items by revenue with relative bars and qty sold
  - **Staff**: per-staff revenue, sales count, average order
  - **Transactions**: searchable, sortable, show voided toggle, inline void (role-gated), totals footer
- **Export CSV**: all transactions in the selected period

### 6.9 POS Customers

- Search, add, edit, delete POS customer records
- Loyalty points balance, gift card balance, total spend, visit count, last visit date
- Purchase history view

### 6.10 POS Staff Management

- Add/edit/delete staff; toggle active/inactive; set hourly rate
- Clock In / Clock Out time tracking per staff member
- Clock entries log with total minutes per shift

### 6.11 POS Settings

- Business name (override; leave blank to use admin branding name automatically)
- Currency symbol, tax rate and inclusive/exclusive mode, receipt footer
- Loyalty points rate, gift card toggle, max discount percentage
- Table mode enabled, table count
- **Receipt branding**: restaurant name, phone, website, VAT number, logo, thank-you message
- **SMTP**: host, port, username, password, from-name
- **Hardware**: thermal printer IP, port, auto-print, paper width

### 6.12 POS Reservations Tab

Front-of-house reservation management directly from the POS:

- View all reservations for any selected date
- Check-in and check-out guests (updates `reservation_customers` visit counts)
- Create walk-in reservations
- Waitlist management
- Table occupancy overview across sections

### 6.13 KDS Integration

Every completed POS sale is pushed to `POST /api/pos/orders` so it appears on the kitchen display. The Supabase orders table uses `ON CONFLICT DO NOTHING` so re-sent entries from the outbox are idempotent.

---

## 7. Order Status Workflow (Online Ordering)

### Status fields

| Field | Type | Description |
|---|---|---|
| `status` | `OrderStatus` | Kitchen / admin leg progress |
| `deliveryStatus` | `DeliveryStatus` | Driver leg progress (delivery orders only) |

### OrderStatus values

`"pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled" | "refunded" | "partially_refunded"`

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

## 8. Reservation System

### Guest flow

1. Customer selects date, time, party size, and enters contact details
2. System checks slot availability against existing reservations and blackout dates
3. Confirmation email sent via the `reservation_confirmation` template
4. Guest cancels via a unique cancel link (if `cancelToken` is set)

### Reservation statuses

| Status | Description |
|---|---|
| `pending` | Awaiting confirmation |
| `confirmed` | Restaurant confirmed the booking |
| `checked_in` | Guest arrived; updates `reservation_customers` visit count |
| `checked_out` | Guest departed; `last_visit_at` updated; review request email sent |
| `cancelled` | Booking cancelled |
| `no_show` | Guest did not arrive |

### CRM integration

Every reservation check-in / check-out updates the corresponding `reservation_customers` row (matched by email). Combined with the guest profile auto-capture from online orders, this gives a unified view of every customer across both reservation and online ordering channels in **Admin → Customers → Guest Profiles**.

---

## 9. Real-Time Synchronisation (Online Ordering)

All five main Supabase tables have Realtime enabled. `AppContext` subscribes to `postgres_changes` events:

- Admin advances an order → customer's tracker updates immediately
- Customer places an order → admin's bell notification fires
- Driver marks "on the way" → customer badge changes from "Ready for Pickup" to "On the Way"
- Admin changes a menu item → customer menu reflects the change instantly

---

## 10. Integrations

### Thermal Printer (ESC/POS)

- Compatible with Epson, Star, or any ESC/POS network printer
- Receipt formatted by `lib/escpos.ts`; proxied through `/api/print`
- Supports 80 mm (48 chars/line) and 58 mm (32 chars/line)

### Email (SMTP)

- Ten lifecycle event templates (6 order + 4 reservation)
- Template engine in `lib/emailTemplates.ts` with `{{variable}}` interpolation
- Sent via `/api/email` — SMTP credentials never exposed to the client bundle

### Stripe & PayPal

- Public/client keys stored in `app_settings`; used client-side via Stripe.js / PayPal SDK
- Card data never touches the application server

### Geolocation

- Browser Geolocation API fetches customer coordinates at checkout
- Haversine formula calculates distance to restaurant GPS coordinates
- Matched zone fee applied; out-of-range payment methods hidden

---

## 11. Data Model Summary

### Online Ordering (Supabase)

| Entity | Storage | Key fields |
|---|---|---|
| Admin settings | `app_settings` JSONB | Restaurant info, schedule, zones, templates, coupons, tax, receipt, breakfast, drivers, reservation config |
| Categories | `categories` table | id, name, emoji, sort_order |
| Menu items | `menu_items` table | id, category_id, name, price, dietary, variations, add_ons, stock |
| Customers | `customers` table | id, name, email, phone, password_hash (bcrypt), email_verified, tags, favourites, saved_addresses, store_credit |
| Orders | `orders` table | id, customer_id, status, delivery_status, fulfillment, items, driver_id, fees, coupon, VAT, store_credit_used, refunds, void fields |
| Drivers | `drivers` table | id, name, email, password_hash, active, vehicle_info |
| Guest CRM | `reservation_customers` table | id, email, name, phone, visit_count, order_count, total_spend, tags, notes, marketing_opt_in |

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
| `pos_outbox` | Array of `OutboxEntry` — failed KDS syncs awaiting retry |

---

---

## 12. Auth Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_JWT_SECRET` | Yes | HMAC secret for signing customer and driver session cookies |
| `NEXT_PUBLIC_SITE_URL` | Yes | Canonical site URL — used in OAuth callback URLs and password-reset email links |
| `GOOGLE_CLIENT_ID` | Optional | Enables "Sign in with Google" OAuth button |
| `GOOGLE_CLIENT_SECRET` | Optional | Required alongside `GOOGLE_CLIENT_ID` |

---

*Last updated: May 2026*
