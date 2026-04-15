# Single-Restaurant Food Ordering System

A full-featured, self-contained web application that combines a **customer-facing ordering portal** and a **restaurant admin control panel** into a single Next.js 15 application. All data is persisted in `localStorage` and synchronised across browser tabs in real time — no backend required to run it.

---

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Application Portals](#application-portals)
- [Admin Dashboard Panels](#admin-dashboard-panels)
- [Key Features](#key-features)
- [Integrations](#integrations)
- [Project Structure](#project-structure)
- [Production Architecture (v2)](#production-architecture-v2)

---

## Overview

### Current Implementation (v1 — localStorage)

The v1 system is a **zero-backend, client-rendered** application. All data is stored in the browser's `localStorage` and synchronised across tabs using the Web Storage API. No external database, message queue, or API server is required to run it.

### Planned Production Evolution (v2 — full backend)

The target production architecture uses a FastAPI backend, Celery task queue, Redis broker, and MySQL database — built on top of the current frontend foundation. See [Production Architecture (v2)](#production-architecture-v2) for details.

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
| State / Persistence | React Context + localStorage |
| Printer Integration | ESC/POS over TCP (Next.js API route proxy) |
| Email Integration | SMTP via Next.js API route |
| Dev Server | `next dev --turbopack` |

---

## Getting Started

### Prerequisites

| Dependency | Version |
|---|---|
| Node.js | 20+ |
| npm / yarn / pnpm | Latest |

### Installation

```bash
cd app
npm install
```

### Development

```bash
npm run dev
```

The app starts at `http://localhost:3000`.

| URL | Portal |
|---|---|
| `http://localhost:3000/` | Customer menu and ordering |
| `http://localhost:3000/account` | Customer account and order history |
| `http://localhost:3000/admin` | Restaurant admin dashboard |

### Production Build

```bash
npm run build
npm start
```

---

## Application Portals

### Customer Portal (`/`)

- Browse menu items grouped by category with a scrollspy sidebar
- Search by name and filter by dietary tags (Vegan, Gluten-Free, etc.)
- Add items to cart with variation and add-on selection
- Checkout with optional geolocation — automatically detects delivery zone and fee
- Payment method selection (Stripe, PayPal, Cash) with distance-based filtering
- Real-time order status tracking on the `/account` page
- Cross-tab live updates — status changes in the admin panel instantly appear in the customer view
- Re-order past orders with a single click

### Admin Dashboard (`/admin`)

Full restaurant management with 14 tabbed panels. All changes are persisted instantly to `localStorage` and reflected across all open tabs.

---

## Admin Dashboard Panels

| Tab | Panel | Description |
|---|---|---|
| Menu Items | `MenuManagementPanel` | Category and item CRUD, dietary tags, variations, add-ons, image URL, stock tracking |
| Customers | `CustomersPanel` | Customer list, order history, VIP/tag management, manual status override |
| Delivery | `DeliveryPanel` | Live Kanban order board, status advancement, completed-today table |
| Zones | `DeliveryZonesPanel` | Concentric zone editor, per-zone fee, enable/disable toggle, colour coding |
| Operations | `OperationsPanel` | Branding, fees, timings, structured address, GPS coordinates, SEO settings, custom `<head>` code |
| Schedule | `SchedulePanel` | Per-day open/close hours, manual closed override |
| Integrations | `IntegrationsPanel` | Payment methods, Stripe/PayPal/SMTP API keys, thermal printer configuration |
| Email | `EmailTemplatesPanel` | 6 event-based HTML email templates with variable substitution and live preview |
| Footer Pages | `FooterPagesPanel` | Rich HTML editor for 6 built-in pages, visibility toggle, copyright text |
| Custom Pages | `CustomPagesPanel` | Unlimited custom pages with slug management, SEO title/description, publish toggle |
| Menus | `MenuLinksPanel` | Header and footer navigation management — add, reorder, label override, toggle |
| Colors | `ColorSettingsPanel` | Brand accent colour and page background — live preview across the entire site |
| Logos | `FooterLogosPanel` | Partner logos, payment icons, and certification badges for the footer |
| Receipt | `ReceiptSettingsPanel` | Custom receipt branding — logo, contact details, VAT number, and footer messages applied to all printed and emailed receipts |

---

## Key Features

### Real-Time Cross-Tab Sync

`AppContext` listens to the browser's `storage` event. When an admin advances an order status in one tab, the customer's order tracker in another tab updates automatically — no page reload required. The admin new-order bell uses the same mechanism to detect orders placed from the customer portal.

### Receipt Settings

Configurable via the **Receipt** admin tab. Settings apply to:

- **Thermal / ESC·POS printed receipts** — restaurant name, phone, website, email, and VAT number in the header; custom thank-you and promotional messages in the footer
- **Order lifecycle emails** — logo displayed in the email header, additional contact details and VAT number in the email footer, custom message below the footer

Fields:

| Section | Fields |
|---|---|
| Logo | Show/hide toggle, logo URL (hosted or base64) |
| Top | Restaurant Name, Phone, Website, Email, VAT Number |
| Bottom | Thank You Message, Custom Message |

A live **receipt preview** (thermal-paper style with sprocket holes) reflects draft changes instantly before saving.

### Delivery Zones & Geolocation

At checkout, the browser Geolocation API retrieves the customer's coordinates. The Haversine formula calculates the straight-line distance to the restaurant's GPS coordinates and matches the closest enabled delivery zone, applying its fee automatically. Payment methods with distance restrictions are hidden when the customer is out of range.

### Thermal Printer (ESC/POS)

Orders are formatted as ESC/POS byte sequences and streamed to a network thermal printer via a Next.js API route TCP proxy. Auto-print on new order can be toggled in the Integrations panel. Supports 80 mm (48 chars/line) and 58 mm (32 chars/line) paper widths.

### Email Templates

Six order lifecycle events each have a fully editable HTML email template:

| Event | Trigger |
|---|---|
| `order_confirmation` | Customer places an order |
| `order_confirmed` | Admin confirms the order |
| `order_preparing` | Kitchen starts preparing |
| `order_ready` | Order is ready |
| `order_delivered` | Order has been delivered |
| `order_cancelled` | Order is cancelled |

Templates support `{{variable}}` interpolation for customer name, order ID, items table, total, fulfillment type, estimated time, and restaurant details. Receipt settings (logo, VAT number, custom message) are automatically applied to the email wrapper.

### Custom Pages & Navigation

Admins can create unlimited custom pages with rich HTML content, SEO title and meta description, and a custom URL slug. Built-in footer pages (About Us, Terms, Privacy, etc.) are editable. Both can be assigned to the header or footer navigation via the Menus panel.

---

## Integrations

### Thermal Printer

Configure in **Integrations → Thermal Printer**:

| Setting | Description |
|---|---|
| IP address | Static IP of the ESC/POS-compatible network printer |
| TCP port | Default `9100` |
| Paper width | 80 mm (48 chars) or 58 mm (32 chars) |
| Auto-print | Print automatically on every new order |

### Email (SMTP)

Configure in **Integrations → API Keys & Email**:

| Setting | Description |
|---|---|
| SMTP Host | e.g. `smtp.gmail.com` |
| Port | Default `587` |
| Username | SMTP login email |
| Password | SMTP login password |

### Stripe & PayPal

API keys are stored in `localStorage` (admin-only) and used client-side via the Stripe.js / PayPal SDK. Card data never touches the server.

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
│   │   └── page.tsx                # Admin dashboard (/admin) — 14 tabbed panels
│   ├── [footerPage]/
│   │   └── page.tsx                # Dynamic page renderer (/[slug])
│   └── api/
│       ├── print/route.ts          # ESC/POS TCP proxy
│       └── email/route.ts          # SMTP send proxy
│
├── components/
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── Cart.tsx
│   ├── MenuItemCard.tsx
│   ├── MenuSection.tsx
│   ├── CategoryNav.tsx
│   ├── SearchAndFilters.tsx
│   ├── CheckoutModal.tsx
│   ├── ItemCustomizationModal.tsx
│   ├── AuthModal.tsx
│   ├── SeoHead.tsx
│   └── admin/
│       ├── MenuManagementPanel.tsx
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
│       ├── ReceiptSettingsPanel.tsx    # NEW — custom receipt branding
│       └── RichEditor.tsx
│
├── context/
│   └── AppContext.tsx               # Global state, localStorage sync, all mutations
│
├── data/
│   ├── menu.ts                     # Default categories and menu items seed data
│   ├── restaurant.ts               # Default restaurant settings and schedule
│   ├── customers.ts                # Mock customer seed data
│   └── footerPages.ts              # 6 default footer pages
│
├── lib/
│   ├── escpos.ts                   # ESC/POS receipt formatter (uses receiptSettings)
│   ├── emailTemplates.ts           # Email template engine with variable interpolation
│   └── colorUtils.ts               # Brand colour CSS variable generator
│
└── types/
    └── index.ts                    # All TypeScript interfaces and types
```

---

## Production Architecture (v2)

When deployed for real-world use, the `localStorage` persistence layer is replaced with a proper backend. The customer and admin portals continue to run as the existing Next.js app; only the data layer changes.

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

| v1 (current) | v2 (production) |
|---|---|
| `localStorage` settings | MySQL `admin_settings` table |
| `localStorage` customers + orders | MySQL `customers` + `orders` tables |
| In-process cart | Unchanged (client-side) |
| `/api/print` route | Unchanged |
| `/api/email` route | Replaced by Celery `SEND_EMAIL` task |
| Cross-tab `storage` event | WebSocket / Server-Sent Events from FastAPI |
| Mock auth (plaintext) | JWT with bcrypt-hashed passwords |
| `receiptSettings` in localStorage | MySQL `receipt_settings` table |

---

*Last updated: April 2026*
