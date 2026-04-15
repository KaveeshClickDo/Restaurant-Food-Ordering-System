# System Architecture Document

## 1. Overview

This document describes the architecture of the **Single-Restaurant Food Ordering System** — a full-featured, self-contained web application that combines a customer-facing ordering portal and a restaurant admin control panel into a single Next.js application.

### Current Implementation (v1 — localStorage)

The v1 system is a **zero-backend, client-rendered** application. All data is persisted in the browser's `localStorage` and synchronised across tabs using the Web Storage API. No external database, message queue, or API server is required to run it.

### Planned Production Evolution (v2 — full backend)

Section 9 of this document outlines the target production architecture with a FastAPI backend, Celery task queue, Redis broker, and MySQL database — to be built on top of the current frontend foundation.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI Library | React 19 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Font | Inter (next/font/google) |
| State / Persistence | React Context + localStorage |
| Printer Integration | ESC/POS over TCP (Next.js API route proxy) |
| Email Integration | SMTP via Next.js API route (nodemailer-compatible) |
| Dev Server | `next dev --turbopack` |

---

## 3. Application Structure

The entire application lives under `app/src/` and is split into two distinct portals served from the same Next.js process:

```
app/src/
├── app/
│   ├── layout.tsx              # Root layout — Inter font, AppProvider, SEO
│   ├── page.tsx                # Customer portal — menu page (/)
│   ├── account/
│   │   └── page.tsx            # Customer account dashboard (/account)
│   ├── admin/
│   │   └── page.tsx            # Admin dashboard (/admin) — 14 tabbed panels
│   ├── [footerPage]/
│   │   └── page.tsx            # Dynamic page renderer (/[slug])
│   └── api/
│       ├── print/route.ts      # ESC/POS TCP proxy
│       └── email/route.ts      # SMTP send proxy
│
├── components/
│   ├── Header.tsx              # Restaurant info card + header nav
│   ├── Footer.tsx              # Footer with managed nav links
│   ├── Cart.tsx                # Order basket (desktop sidebar + mobile drawer)
│   ├── MenuItemCard.tsx        # Individual menu item row
│   ├── MenuSection.tsx         # Category-grouped item list
│   ├── CategoryNav.tsx         # Sidebar category navigation (desktop)
│   ├── SearchAndFilters.tsx    # Search input + dietary filter pills
│   ├── CheckoutModal.tsx       # Checkout flow — form, geolocation, payment
│   ├── ItemCustomizationModal.tsx  # Add-ons, variations, instructions
│   ├── AuthModal.tsx           # Login / Register modal
│   ├── SeoHead.tsx             # Reactive <title> + <meta> from admin settings
│   └── admin/
│       ├── MenuManagementPanel.tsx   # Menu item + category CRUD
│       ├── DeliveryPanel.tsx         # Live order Kanban board
│       ├── CustomersPanel.tsx        # Customer list + order management
│       ├── DeliveryZonesPanel.tsx    # Zone editor with fee configuration
│       ├── OperationsPanel.tsx       # Branding, fees, address, SEO
│       ├── SchedulePanel.tsx         # Per-day open/close hours
│       ├── IntegrationsPanel.tsx     # Stripe, PayPal, SMTP, printer keys
│       ├── EmailTemplatesPanel.tsx   # Email template editor (6 events)
│       ├── FooterPagesPanel.tsx      # 6 built-in footer pages editor
│       ├── CustomPagesPanel.tsx      # Custom page CRUD with SEO
│       ├── MenuLinksPanel.tsx        # Header + footer nav management
│       ├── ColorSettingsPanel.tsx    # Brand colour + background customisation
│       ├── FooterLogosPanel.tsx      # Partner / badge logos for the footer
│       ├── ReceiptSettingsPanel.tsx  # Custom receipt branding (logo, contact, VAT, messages)
│       └── RichEditor.tsx            # contenteditable rich text editor
│
├── context/
│   └── AppContext.tsx          # Global state, localStorage sync, all mutations
│
├── data/
│   ├── menu.ts                 # Default categories and menu items seed data
│   ├── restaurant.ts           # Default restaurant settings + schedule
│   ├── customers.ts            # Mock customer seed data
│   └── footerPages.ts          # 6 default footer pages (About, Terms, etc.)
│
├── lib/
│   ├── escpos.ts               # ESC/POS receipt formatter (uses receiptSettings)
│   ├── emailTemplates.ts       # Email template engine with variable interpolation
│   └── colorUtils.ts           # Brand colour CSS variable generator
│
└── types/
    └── index.ts                # All TypeScript interfaces and types
```

---

## 4. State Management Architecture

### 4.1 AppContext (Single Source of Truth)

All application state flows through a single React Context (`AppContext`) defined in `context/AppContext.tsx`. There is no external state library.

```
AppContext provides:
├── Cart state (cartReducer — ADD / REMOVE / UPDATE_QTY / CLEAR)
├── AdminSettings (settings, updateSettings)
├── Menu (categories, menuItems — full CRUD operations)
├── Customers (customers, addOrder, updateOrderStatus, updateCustomer)
├── Auth (currentUser, login, logout, registerCustomer)
├── Store state (isOpen — computed from schedule + manualClosed)
├── Fulfillment (delivery | collection)
└── Derived values (cartTotal, cartCount)
```

### 4.2 localStorage Persistence

Everything in `AdminSettings` (restaurant info, menu, customers, orders, zones, payment methods, email templates, pages, nav links, schedule) is persisted to `localStorage` under a single key: `adminSettings`.

**Hydration pattern:**
1. On mount, AppContext reads `localStorage.adminSettings`
2. A deep-merge migration is applied — new fields from `DEFAULT_SETTINGS` are grafted onto existing saved data, ensuring backward compatibility after app updates
3. Every `updateSettings()` call immediately writes back to localStorage

**Cross-tab synchronisation:**
- AppContext listens for the browser's `storage` event
- When the admin advances an order status in one tab, the customer portal in another tab automatically receives the update without a page reload
- The admin dashboard's new-order notification bell uses the same mechanism — it detects when `customers` grows (new order placed in the customer tab) and shows a toast

### 4.3 Data Types

All TypeScript interfaces live in `types/index.ts`. Key types:

| Type | Purpose |
|---|---|
| `AdminSettings` | Root settings object — everything persisted to localStorage |
| `MenuItem` | Menu item with dietary tags, variations, add-ons, image, stock status |
| `Category` | Category with emoji and display name |
| `CartItem` | Cart line with selected variation, add-ons, instructions |
| `Order` | Order record with status, items, fees, fulfillment type |
| `Customer` | Customer with auth fields, tags, order history, and favourites |
| `DeliveryZone` | Concentric radius ring with km boundaries and fee |
| `PaymentMethod` | Payment option with distance-based delivery restriction |
| `EmailTemplate` | HTML email template with variable placeholders |
| `FooterPage` | Built-in page (About, Terms, etc.) with rich HTML content |
| `CustomPage` | Admin-created standalone page with SEO fields |
| `MenuLink` | Header or footer nav link pointing to any page |
| `ColorSettings` | Brand accent colour and page background hex values |
| `FooterLogo` | Partner/badge logo with URL, href, label, and enabled flag |
| `ReceiptSettings` | Custom receipt branding — logo, contact info, VAT number, and footer messages |
| `PrinterSettings` | Thermal printer network config — IP, port, paper width, auto-print |

---

## 5. Routing Architecture

The Next.js App Router provides all routing. No external router is used.

| Route | Portal | Description |
|---|---|---|
| `/` | Customer | Menu page — browse, filter, add to cart, checkout |
| `/account` | Customer | Order history, live status, profile management |
| `/admin` | Admin | Full restaurant management dashboard |
| `/[footerPage]` | Public | Dynamic page renderer for footer pages and custom pages |

### Dynamic Page Resolution (`/[footerPage]`)

The `[footerPage]` catch-all route resolves pages in this priority order:

1. Match against `settings.footerPages` (6 built-in pages: about-us, contact-us, terms, privacy, cookies, accessibility)
2. Match against `settings.customPages` (admin-created pages, published only)
3. Render a "Page not found" state if neither matches

Custom pages inject their `seoTitle` and `seoDescription` into the document `<head>`.

---

## 6. Customer Portal

### 6.1 Menu Page (`/`)

```
Header (restaurant info card + fulfillment toggle + header nav links)
│
├── Mobile category strip (horizontal scroll, hidden lg:)
├── Desktop category sidebar (CategoryNav, hidden below lg:)
│
├── SearchAndFilters (text search + dietary filter pills)
│
├── MenuSection (category groups with ScrollSpy observer)
│   └── MenuItemCard × N (image, dietary badges, price, + button)
│
├── Cart (desktop sticky sidebar hidden below xl:)
├── Mobile floating cart button (fixed bottom, hidden xl:)
└── Mobile cart drawer (full-screen overlay)
```

**ScrollSpy:** An `IntersectionObserver` watches category section elements inside the scrollable container. As the user scrolls, the active category in the sidebar updates automatically.

**Checkout flow:**
1. Cart validates minimum order threshold
2. `CheckoutModal` opens as bottom sheet on mobile, centred modal on desktop
3. Optional geolocation detects delivery distance via Haversine formula
4. Matched `DeliveryZone` updates the displayed delivery fee in real time
5. `PaymentMethod` list is filtered by distance restrictions if geolocation ran
6. Selecting a payment method creates the `Order` record and fires print + email side effects

### 6.2 Account Dashboard (`/account`)

Tabs: **Orders** | **Profile**

- Orders tab shows full order history sorted by date descending, with live status tracking via the `OrderTracker` step indicator
- Active orders are highlighted with an orange border and pulsing "Live" badge
- Re-order: adds all deliverable items from a past order to the current cart, skipping any items no longer on the menu
- Cross-tab status update banner: when the admin advances an order, a blue toast appears automatically without a page reload
- Profile tab allows editing name and phone; email is read-only

---

## 7. Admin Dashboard (`/admin`)

The admin dashboard is a single-page tab application with 11 panels:

| Tab | Panel | Key Features |
|---|---|---|
| Menu Items | `MenuManagementPanel` | Category + item CRUD, dietary tags, variations, add-ons, image URL, stock tracking, popular flag |
| Customers | `CustomersPanel` | Customer list, order history, VIP/tag management, manual order status override |
| Delivery | `DeliveryPanel` | Live Kanban order board, status advancement, completed today table |
| Zones | `DeliveryZonesPanel` | Concentric zone editor, per-zone fee, enable/disable toggle, colour coding |
| Operations | `OperationsPanel` | Branding, fees, address, GPS coordinates, SEO global settings, custom head code |
| Schedule | `SchedulePanel` | Per-day open/close times, manual closed override toggle |
| Integrations | `IntegrationsPanel` | Stripe keys, PayPal client ID, SMTP credentials, thermal printer config |
| Email | `EmailTemplatesPanel` | 6 event-based HTML email templates with variable substitution and live preview |
| Footer Pages | `FooterPagesPanel` | Rich HTML editor for 6 built-in pages, visibility toggle, copyright text |
| Custom Pages | `CustomPagesPanel` | Create/edit unlimited pages, slug management, SEO title/description, publish toggle |
| Menus | `MenuLinksPanel` | Assign pages to header and footer navigation, reorder, label override, active toggle |
| Colors | `ColorSettingsPanel` | Brand accent colour and page background — live preview across the entire site |
| Logos | `FooterLogosPanel` | Partner logos, payment icons, and certification badges for the footer |
| Receipt | `ReceiptSettingsPanel` | Logo toggle + URL, restaurant name, phone, website, email, VAT number, thank-you and custom messages — applied to all printed and emailed receipts; live thermal-style preview |

### Admin real-time notifications

- A `Bell` button in the admin header shows the count of active (non-terminal) orders
- When a new order arrives from the customer portal (detected via the `storage` event), a slide-in toast appears with an option to jump to the Delivery tab
- The Delivery tab badge pulses with the live active order count

---

## 8. Integrations

### 8.1 Thermal Printer (ESC/POS)

The admin Integrations panel allows configuring a network thermal printer (Epson/Star or compatible) by IP address and TCP port (default 9100).

Flow:
1. A new order is placed → `printOrder()` in `lib/escpos.ts` formats the ESC/POS byte sequence
2. The formatted receipt is `POST`ed to `/api/print`
3. The Next.js API route opens a raw TCP socket to the printer's IP:port and streams the bytes
4. Auto-print can be enabled/disabled in admin settings

### 8.2 Email (SMTP)

Six order lifecycle events trigger email sends:

| Event | Trigger |
|---|---|
| `order_confirmation` | Immediately when an order is placed |
| `order_confirmed` | Admin advances status to Confirmed |
| `order_preparing` | Admin advances status to Preparing |
| `order_ready` | Admin advances status to Ready |
| `order_delivered` | Admin advances status to Delivered |
| `order_cancelled` | Admin marks an order as Cancelled |

Each template is fully editable in the admin Email tab. Templates support variable interpolation: `{{customerName}}`, `{{orderId}}`, `{{total}}`, `{{items}}`, `{{estimatedTime}}`, etc.

Email sends are proxied through `/api/email` to keep SMTP credentials server-side.

### 8.3 Geolocation + Delivery Zones

At checkout (delivery orders only):
1. Browser Geolocation API retrieves `(lat, lng)` with user permission
2. Haversine formula calculates the straight-line distance to the restaurant's GPS coordinates
3. The smallest matching enabled `DeliveryZone` (where `minRadiusKm ≤ distance ≤ maxRadiusKm`) is selected
4. That zone's `fee` replaces the default delivery fee in the order total
5. Payment methods with `deliveryRange.restricted = true` are hidden if the customer's distance falls outside `[minKm, maxKm]`

If geolocation is denied or unavailable, all enabled payment methods are shown and the default delivery fee applies.

---

## 9. Content Management (Pages + Navigation)


### 9.1 Footer Pages

Six built-in pages are pre-seeded and always available:

| Slug | Page |
|---|---|
| `/about-us` | About Us |
| `/contact-us` | Contact Us |
| `/terms` | Terms & Conditions |
| `/privacy` | Privacy Policy |
| `/cookies` | Cookie Policy |
| `/accessibility` | Accessibility Statement |

Each page has a rich HTML editor in the admin Footer Pages tab, an enabled/disabled visibility toggle, and a preview link.

### 9.2 Custom Pages

Admin can create unlimited custom pages with:
- Title, URL slug (auto-generated, conflict-checked, reserved slug protection)
- Rich HTML content via `RichEditor`
- SEO title (≤60 chars) and meta description (≤160 chars) with live character counters and SERP preview
- Published/draft toggle
- Created/updated timestamps

Custom pages are served at `/{slug}` via the `[footerPage]` dynamic route.

### 9.3 Navigation Management

The Menus tab (`MenuLinksPanel`) provides separate editors for:
- **Header navigation** — links appear in the nav bar below the restaurant info card on the customer portal
- **Footer navigation** — links appear in the site footer

For each location the admin can:
- Add any custom page or built-in footer page from a grouped picker
- Customise the display label independently of the page title
- Reorder with up/down arrows
- Toggle active/inactive without removing the link
- Remove links permanently

The `Footer.tsx` component uses `settings.menuLinks[location=footer]` when any managed links exist, falling back to the legacy `settings.footerPages[enabled]` list for zero-config backward compatibility.

---

## 10. Custom Receipt Settings

### 10.1 Overview

The **Receipt** admin tab (`ReceiptSettingsPanel`) lets the restaurant owner configure the branding and contact information that appears on every printed and emailed receipt. Settings are stored in `AdminSettings.receiptSettings` and persisted to `localStorage` alongside all other admin settings.

### 10.2 ReceiptSettings Type

```ts
interface ReceiptSettings {
  showLogo:        boolean;  // whether to display the logo
  logoUrl:         string;   // hosted URL or base64 data URI
  restaurantName:  string;   // receipt-specific name (can differ from main brand)
  phone:           string;   // contact phone number
  website:         string;   // website URL shown on receipt
  email:           string;   // contact email shown on receipt
  vatNumber:       string;   // e.g. "GB 123 4567 89" — omitted if blank
  thankYouMessage: string;   // bold footer line
  customMessage:   string;   // optional second footer line (promotions, social)
}
```

### 10.3 Admin UI

The `ReceiptSettingsPanel` provides:

- **Logo section** — toggle to show/hide, URL input with inline thumbnail, base64 support
- **Top section** — Restaurant Name, Phone, Website, Email, VAT Number
- **Bottom section** — Thank You Message and Custom Message (textarea)
- **Live receipt preview** — toggleable side-by-side pane rendering a monospaced thermal-paper style preview (with sprocket hole strips) that reflects draft changes in real time, before saving
- **Save button** — writes to `settings.receiptSettings` via `updateSettings()`, immediately persisted to localStorage

### 10.4 Thermal Receipt Integration (`lib/escpos.ts`)

`buildReceipt()` reads `settings.receiptSettings` for the header and footer blocks:

**Header block (printed after restaurant address):**
- Restaurant name from `receiptSettings.restaurantName` (falls back to `restaurant.name`)
- Phone from `receiptSettings.phone` (falls back to `restaurant.phone`)
- Website — printed only when non-empty
- Email — printed only when non-empty
- VAT number — printed as `VAT: <value>` only when non-empty

**Footer block (printed after totals):**
- `thankYouMessage` in bold (falls back to `"Thank you for your order!"`)
- `customMessage` on a second line if non-empty

### 10.5 Email Receipt Integration (`lib/emailTemplates.ts`)

`buildEmailDocument()` accepts an optional `receiptSettings` parameter used to enhance the email wrapper:

| Email element | Source |
|---|---|
| Header title | `receiptSettings.restaurantName` → falls back to `restaurant.name` |
| Header logo | `<img>` block rendered when `showLogo = true` and `logoUrl` is non-empty |
| Footer contact line | `restaurantName · address · phone · website · email` |
| Footer VAT | Appended to contact line when `vatNumber` is non-empty |
| Footer custom message | Second `<p>` below the contact line when `customMessage` is non-empty |

`sendOrderEmail()` automatically forwards `settings.receiptSettings` to `buildEmailDocument()` for every outgoing email.

### 10.6 Data Migration

The hydration migration in `AppContext.tsx` backfills `receiptSettings` for localStorage snapshots that predate this feature:

```ts
merged.receiptSettings = { ...DEFAULT_RECEIPT_SETTINGS, ...(parsed.receiptSettings ?? {}) };
```

`DEFAULT_RECEIPT_SETTINGS` seeds the restaurant name and phone from `restaurantInfo` so receipts display sensible defaults on first load.

---

## 11. Mobile Responsiveness



The application is built mobile-first throughout. Key patterns used:

| Pattern | Implementation |
|---|---|
| Bottom-sheet modals | `items-end sm:items-center` + `rounded-t-2xl sm:rounded-2xl` |
| Horizontal category scroll | `overflow-x-auto scrollbar-hide` with `flex-shrink-0` pills |
| Responsive admin sidebars | `flex flex-col md:flex-row md:divide-x` with `max-h-40 md:max-h-none` |
| Touch-accessible buttons | Minimum `w-10 h-10` (40px) touch targets on interactive elements |
| Mobile cart | Fixed floating button → full-screen drawer at `z-50` |
| Always-visible action buttons | `md:opacity-0 md:group-hover:opacity-100` (hidden on hover on desktop, always visible on mobile) |
| Content clearance | `pb-28 xl:pb-6` bottom padding to prevent floating cart button from obscuring content |
| Admin tab bar | `hidden sm:inline` labels — icons only on smallest screens |

---

## 12. Planned Production Architecture (v2)

When the system is deployed for real-world use, the localStorage persistence layer is replaced with a proper backend. The customer and admin portals continue to run as the existing Next.js app; only the data layer changes.

### 12.1 High-Level Target Architecture

```
                Internet
                    │
                Nginx (HTTPS termination)
                    │
      ┌─────────────┼──────────────┐
      │             │              │
Customer Portal  Admin Portal  FastAPI API
 (Next.js)        (Next.js)        │
                                   │
                         ┌─────────┴──────────┐
                         │                    │
                   Celery Worker         Celery Beat
                         │                    │
                         └────────┬───────────┘
                                  │
                                Redis
                                  │
                             MySQL Server
                                  │
                     ┌────────────┴────────────┐
                     │                         │
                Stripe API             PayPal / SMTP
```

### 12.2 Backend Service Responsibilities

**FastAPI** — REST API for order placement, menu queries, auth, and order status patching. Delegates all async work to Celery.

**Celery Worker** — Handles the full fulfilment pipeline: payment charging, kitchen notification, email sending, inventory update, delivery dispatch.

**Celery Beat** — Scheduled tasks: daily analytics snapshots, weekly revenue summaries, nightly session cleanup.

**Redis** — Message broker for two logical queues:
- `orders` — core fulfilment pipeline
- `notifications` — emails and admin alerts

**MySQL** — Persistent store for all orders, customers, menu, zones, settings, and audit logs.

### 12.3 Order Fulfilment Flow (v2)

```
Customer Portal → FastAPI
                     │
              Enrich: zone, fees, price lock
              Persist: INSERT orders (status=pending)
              Queue → Redis (orders queue)
                     │
              Celery Worker
                     │
    VALIDATE → CHARGE → NOTIFY_KITCHEN → EMAIL → DISPATCH → COMPLETE
```

### 12.4 Migration Path

| v1 (current) | v2 (production) |
|---|---|
| `localStorage` settings | MySQL `admin_settings` table |
| `localStorage` customers + orders | MySQL `customers` + `orders` tables |
| `receiptSettings` in localStorage | MySQL `receipt_settings` table |
| In-process cart | Unchanged (client-side) |
| `/api/print` route | Unchanged |
| `/api/email` route | Replaced by Celery `SEND_EMAIL` task |
| Cross-tab `storage` event | WebSocket or Server-Sent Events from FastAPI |
| Mock auth (plaintext) | JWT with bcrypt-hashed passwords |

---

## 13. Security Notes

| Area | Current (v1) | Production (v2) |
|---|---|---|
| Auth | Mock — email/password stored in localStorage | JWT tokens, bcrypt passwords, httpOnly cookies |
| Payment credentials | Stored in localStorage (admin only) | Environment variables, never in the repository |
| Card data | Never touches the server (Stripe.js / PayPal SDK tokenise client-side) | Same |
| Admin access | URL-based only (`/admin`) | Session-based auth with RBAC |
| SMTP credentials | Proxied through `/api/email` — not exposed to client | Server-side only via environment variables |
| HTTPS | Local dev (HTTP) | Nginx TLS termination (Let's Encrypt) |

---

*Last updated: April 2026 — added Custom Receipt Settings (section 10), updated admin panel table (14 tabs), component tree, and data types table.*
