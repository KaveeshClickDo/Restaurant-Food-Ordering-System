# Audit 01 — Folder Structure

**Phase:** 1 — Inventory & structure
**Date:** 2026-05-04
**Scope:** Top-level repo layout, [app/src/](../app/src/) tree, API route organization, comparison to Next.js 15 App Router + clean-architecture conventions.
**Mode:** Read-only

---

## 1. Current layout (high level)

```
Single-Restaurant-Food-Ordering-System/
├── app/                          # Next.js project (nested — see F1)
│   ├── android/, android-src/    # Capacitor Android wrapper
│   ├── public/
│   ├── migrate.mjs               # custom migration runner
│   ├── capacitor.config.ts
│   └── src/
│       ├── app/                  # Next.js App Router
│       │   ├── (site)/           # public site route group
│       │   ├── admin/            # admin SPA shell
│       │   ├── api/              # 67 route.ts files (see §3)
│       │   ├── customer-display/
│       │   ├── driver/
│       │   ├── kitchen/
│       │   ├── pos/
│       │   ├── waiter/
│       │   ├── layout.tsx, page.tsx, error.tsx, global-error.tsx, not-found.tsx
│       │   └── globals.css, favicon.ico
│       ├── components/           # 16 root + admin/ subfolder (27 panels)
│       ├── context/              # AppContext.tsx, POSContext.tsx
│       ├── data/                 # static seed data (menu, customers, restaurant, footerPages)
│       ├── lib/                  # 17 mixed-concern files
│       ├── types/                # index.ts, pos.ts
│       ├── instrumentation.ts
│       └── middleware.ts
├── supabase/                     # 9 SQL files (migrations + RLS + setup)
├── docs/                         # kitchen / order-flow / realtime / security / waiter
├── Food_Ordering_System_Requirements.md
├── system_architecture.md
├── android-setup.sh
└── package.json                  # thin wrapper that proxies scripts to app/
```

## 2. Reference layout (what "industry standard" means here)

For a Next.js 15 App Router project of this scope (multi-role SaaS, Supabase backend, ~67 API routes, ~163 source files), a healthy structure separates:

```
src/
├── app/                          # routing only — pages stay thin
├── features/  OR  modules/       # feature-sliced: auth/, orders/, menu/, reservations/, pos/, kitchen/...
│   └── orders/
│       ├── components/           # UI specific to this feature
│       ├── hooks/
│       ├── services/             # DB / external API calls
│       ├── repositories/         # raw Supabase queries (optional)
│       └── types.ts
├── components/                   # ONLY truly cross-feature UI primitives (Button, Modal, Table)
├── lib/                          # ONLY pure utilities, no business logic
├── server/                       # server-only: db client, auth, email, rate-limit
└── types/                        # shared cross-feature types
```

Key principles:
- **Pages are thin.** A `page.tsx` orchestrates feature components — it does not contain 8000 lines of business logic.
- **Server-only code is isolated.** `supabaseAdmin`, `bcrypt`, email senders, JWT signing all live in a `server/` folder so a stray client import is obvious.
- **Feature folders own their slice.** When you delete "reservations," you delete one folder, not 14 files spread across `components/`, `lib/`, `app/api/`, `data/`, `types/`.

## 3. API route inventory

67 `route.ts` files. Grouped by namespace:

| Namespace | Count | Notes |
|---|---|---|
| `api/admin/*` | 19 | auth, categories, customers, drivers, menu, orders (+ driver/refund/status), reservations, reservation-customers (+ /reservations), seed, settings, users (+ send-reset/set-password) |
| `api/auth/*` | 16 | login, logout, register, me, change-password, resend-verification, verify-email, reset-password (+ confirm), google (+ callback), driver/* mirrors |
| `api/pos/*` | 6 | auth, menu, orders (+ [id]/collected), reservations (+ [id]) |
| `api/waiter/*` | 7 | auth, config, logout, orders, refund, settle, void |
| `api/kitchen/*` | 3 | auth, config, logout |
| `api/kds/*` | 1 | orders/[id]/status |
| `api/customers/*` | 2 | [id], [id]/spend-credit |
| `api/reservations/*` | 2 | route, availability |
| `api/reservation/[token]` | 1 | singular — guest-token reservation |
| `api/orders` | 1 | top-level (customer-facing?) |
| Misc | 5 | email, guest-profile, ping, print, settings/public |

## 4. Findings

> Each finding has an ID (`01-F#`) so we can reference it in later refactor PRs.

### 01-F1 — Double-nested project root (`/app/app/...` cognitive load)
**Severity:** Low (informational)
**Evidence:** Repo root has [package.json](../package.json) that just proxies to [app/package.json](../app/package.json). The actual Next.js app lives at [app/src/app/](../app/src/app/), so absolute paths are `app/src/app/api/...`.
**Why it matters:** Confuses tooling and humans (which `app/` is the route folder?). The root `package.json` is doing very little for the friction it adds.
**Possible action:** Either flatten (move `app/*` to root and delete the proxy `package.json`) or document why the nesting exists (e.g. monorepo plans for a separate mobile app). Capacitor can live alongside Next.js without a wrapper folder.

### 01-F2 — Pages are doing the work of feature modules
**Severity:** High
**Evidence:** Page file sizes (in bytes):
- [pos/page.tsx](../app/src/app/pos/page.tsx) — **394,718** (~10× the next biggest)
- [waiter/page.tsx](../app/src/app/waiter/page.tsx) — 87,054
- [page.tsx](../app/src/app/page.tsx) (home) — 81,996
- [(site)/account/page.tsx](../app/src/app/(site)/account/page.tsx) — 69,787
- [admin/page.tsx](../app/src/app/admin/page.tsx) — 37,286
- [driver/page.tsx](../app/src/app/driver/page.tsx) — 30,750
- [kitchen/page.tsx](../app/src/app/kitchen/page.tsx) — 28,810

A healthy `page.tsx` in App Router is typically <5 KB — it composes feature components.
**Why it matters:** Every page is its own monolith. State, data fetching, modals, business logic, and JSX all coexist. This is the single biggest structural issue.
**Possible action:** Carve each role page into a feature module (e.g. `features/pos/{components,hooks,services}/`) and reduce the page to a shell.
**Cross-ref:** Will be re-examined in detail in `02-large-files.md`.

### 01-F3 — No `features/` or `modules/` layer; business logic leaks into `components/`
**Severity:** High
**Evidence:** [components/admin/](../app/src/components/admin/) holds 27 "Panel" files (BreakfastMenuPanel, ColorSettingsPanel, CouponsPanel, CustomPagesPanel, CustomersPanel, DeliveryPanel, DeliveryZonesPanel, DriversPanel, EmailTemplatesPanel, FooterLogosPanel, FooterPagesPanel, IntegrationsPanel, KitchenStaffPanel, MenuLinksPanel, MenuManagementPanel, OnlineReportsPanel, OperationsPanel, POSReportsPanel, ReceiptSettingsPanel, RefundsPanel, ReservationCustomersPanel, ReservationsPanel, RichEditor, SchedulePanel, TableStatusPanel, TaxSettingsPanel, UserManagementPanel, WaitersPanel). Several are 30–53 KB each and clearly contain CRUD logic + API calls + UI.
**Why it matters:** "Component" implies presentational; these are mini-apps. Mixing them into a flat folder hides ownership and makes deletion / reuse hard.
**Possible action:** Group by domain — `features/menu/`, `features/customers/`, `features/reports/`, etc. Each panel becomes the entry component of its feature module.

### 01-F4 — `lib/` is a kitchen sink (mixes pure utils, server-only code, client adapters)
**Severity:** Medium-High
**Evidence:** [lib/](../app/src/lib/) contents (sizes in bytes):
- Pure utils: `colorUtils.ts` (4007), `taxUtils.ts` (3489), `scheduleUtils.ts` (4897), `stockUtils.ts` (1272)
- Server-only (must never reach the browser): `supabaseAdmin.ts` (2282), `emailServer.ts` (11,674), `emailTemplates.ts` (38,142), `adminAuth.ts` (2999), `waiterAuth.ts` (624), `auth.ts` (4883), `rateLimit.ts` (1686), `apiHandler.ts` (738)
- Client/runtime: `supabase.ts` (1115 — public client), `capacitorBridge.ts` (6056), `connectivity.ts` (2508)
- Hardware integration: `escpos.ts` (21,879 — receipt printer)
- Domain-specific runtime: `posOutbox.ts` (6151)

**Why it matters:** A new contributor can't tell at a glance which file is safe to import client-side. Accidentally importing `supabaseAdmin` from a client component would leak the service-role key. The "rule" is currently the developer's memory.
**Possible action:** Split into `lib/` (pure utils only), `server/` (auth/db-admin/email/rate-limit), and feature-local helpers. Add an ESLint rule preventing `server/` imports from `'use client'` files.
**Cross-ref:** This sets up the Phase 3 security audit (`07-service-role-key.md`).

### 01-F5 — `data/` folder is static seed data, not a data-access layer
**Severity:** Low
**Evidence:** [data/](../app/src/data/) holds `menu.ts` (13 KB), `customers.ts` (6 KB), `footerPages.ts` (7 KB), `restaurant.ts` (1 KB) — these are hardcoded arrays/objects, not fetchers.
**Why it matters:** "data" is an industry-standard name for the data-access layer (repositories/services). Using it for seed data is misleading. Production runtime data comes from Supabase, so what's actually in this folder?
**Possible action:** Rename to `seed/` or `fixtures/`. Verify whether any of these files are still imported at runtime (vs. only by `migrate.mjs` / dev seeding) — if so, that's a data-source bug worth flagging.

### 01-F6 — API namespace inconsistencies (`reservation` vs `reservations`, customer auth split)
**Severity:** Medium
**Evidence:**
- Singular vs plural: [api/reservation/[token]/route.ts](../app/src/app/api/reservation/[token]/route.ts) (guest-token GET) coexists with [api/reservations/route.ts](../app/src/app/api/reservations/route.ts) and [api/reservations/availability/route.ts](../app/src/app/api/reservations/availability/route.ts).
- [api/orders/route.ts](../app/src/app/api/orders/route.ts) sits at the top level with no role prefix, while admin/pos/waiter all have their own `orders` namespaces. Unclear who calls the bare `/api/orders`.
- [api/customers/[id]](../app/src/app/api/customers/[id]/) sits at the top level, parallel to [api/admin/customers/](../app/src/app/api/admin/customers/) — two ways to read/write the same resource, with different auth surfaces.
- Auth scattered: `api/auth/`, `api/admin/auth`, `api/pos/auth`, `api/waiter/auth`, `api/kitchen/auth`, plus `api/auth/driver/*` mirrors of the customer ones.
**Why it matters:** Inconsistent URLs make client code error-prone (which endpoint do I call?), make rate limiting harder to apply uniformly, and make security review harder (which endpoints are authenticated as what?).
**Possible action:** Pick one convention (REST plural recommended), document which routes are public vs role-gated, and consider consolidating per-role auth into one `api/auth/[role]/...` shape.

### 01-F7 — `app/admin/page.tsx` is a 37 KB SPA shell loading 27 client panels
**Severity:** Medium
**Evidence:** [admin/](../app/src/app/admin/) has only `page.tsx` (no nested routes). The admin "section" likely renders all 27 panels via tabs/state. Compare to a typical App Router admin which would use `app/admin/[section]/page.tsx` for each panel.
**Why it matters:** Loses URL-driven navigation, code-splitting per panel, and route-level loading states. All 27 panels must hydrate to view one.
**Possible action:** Convert to `app/admin/layout.tsx` + `app/admin/<section>/page.tsx` per panel.

### 01-F8 — `(site)` route group is fine; other roles aren't grouped
**Severity:** Low (positive observation + asymmetry)
**Evidence:** Public-facing pages live under [(site)/](../app/src/app/(site)/) with a shared `layout.tsx`. Good pattern. But internal roles (pos/waiter/kitchen/driver/admin/customer-display) sit at the top level with no grouping — though they share concepts (login pages, role-scoped layouts, auth gating).
**Why it matters:** Could share a `(staff)/layout.tsx` for auth gating instead of every role page rolling its own.
**Possible action:** Optional consolidation — group e.g. `(staff)/{pos,waiter,kitchen,driver}` with a shared auth layout.

### 01-F9 — Two contexts hold ~104 KB combined; likely overlap with feature concerns
**Severity:** Medium (deferred to Phase 2)
**Evidence:** [context/AppContext.tsx](../app/src/context/AppContext.tsx) 73 KB; [context/POSContext.tsx](../app/src/context/POSContext.tsx) 35 KB.
**Why it matters:** A 73 KB context almost certainly mixes unrelated state slices. Re-examined in `05-context-bloat.md`.

### 01-F10 — `types/` is small and OK; `data/` and `types/` directories exist as both files and folders
**Severity:** Informational
**Evidence:** `find` shows `data` and `types` listed twice (size 0 = directory entry, then files inside). Just a `find` quirk — not an actual issue. Types: `index.ts` (15 KB), `pos.ts` (9 KB) — reasonable.
**Possible action:** None; flag if cross-feature types continue to bloat `index.ts`.

### 01-F11 — `supabase/` SQL files at repo root, not under app
**Severity:** Low
**Evidence:** 9 SQL files (auth_migration, checkin_migration, driver_reset_migration, realtime_migration, reservations_migration, rls_policies, setup_all, v2_features_migration, config.toml). Custom runner at [app/migrate.mjs](../app/migrate.mjs).
**Why it matters:** Acceptable, but SQL versioning is ad-hoc (migration_NN style isn't used; "v2_features_migration" suggests grouping by feature). Hard to know which migration ran and in what order without inspecting `migrate.mjs`. Worth a separate audit pass when we look at DB safety.
**Possible action:** Adopt sequential numbered migrations or migrate to Supabase CLI's standard `supabase/migrations/` timestamp format.

### 01-F12 — Naming case inconsistencies in `components/`
**Severity:** Low
**Evidence:** Components are `PascalCase.tsx` (good), but the [components/](../app/src/components/) folder mixes feature-specific (`BreakfastSection`, `CategoryNav`, `MenuSection`) with generic (`Header`, `Footer`, `Cart`). Two header/footer pairs exist: `Header.tsx` + `SiteMobileHeader.tsx`, `Footer.tsx` + `SiteFooter.tsx`.
**Why it matters:** Suggests duplication or inconsistent migration. Confirmed in `03-dead-code-duplicates.md`.
**Possible action:** Defer to dedup audit.

### 01-F13 — Top-level docs scattered between repo root and `docs/`
**Severity:** Low
**Evidence:** Repo root has `Food_Ordering_System_Requirements.md`, `system_architecture.md`, `README.md`, `android-setup.sh` (a script, not docs but at root). [docs/](../docs/) has feature-flow docs (kitchen, order-flow, realtime, security, waiter).
**Why it matters:** Mixing top-level "what is this project" docs with deeper docs is fine, but `system_architecture.md` arguably belongs in `docs/`.
**Possible action:** Move large docs into `docs/`; keep only `README.md` at root.

## 5. Severity summary

| Severity | IDs |
|---|---|
| **High** | 01-F2 (god pages), 01-F3 (no feature modules) |
| **Medium-High** | 01-F4 (lib mixes server/client) |
| **Medium** | 01-F6 (api inconsistency), 01-F7 (admin SPA), 01-F9 (giant contexts → revisit Phase 2) |
| **Low** | 01-F1 (nested root), 01-F5 (data folder name), 01-F8 (route grouping), 01-F11 (SQL layout), 01-F12 (naming) → revisit dedup, 01-F13 (docs) |
| **Informational** | 01-F10 |

## 6. Recommended target structure (sketch — not a decision yet)

```
src/
├── app/                              # routing shells only; pages <5 KB
│   ├── (site)/                       # already good
│   ├── (staff)/                      # NEW group: pos, waiter, kitchen, driver, customer-display
│   ├── admin/[section]/              # split admin SPA into routed sections
│   └── api/
│       └── (rename inconsistent endpoints; pick singular OR plural)
├── features/                         # NEW
│   ├── auth/, menu/, orders/, reservations/, pos/, waiter/, kitchen/,
│   │   driver/, customers/, reports/, settings/, email/, printer/
│   └── (each: components/, hooks/, services/, types.ts)
├── components/ui/                    # shrink to true primitives
├── lib/                              # pure utils only
├── server/                           # NEW: supabaseAdmin, auth, rate-limit, email
├── types/                            # cross-feature only
└── seed/                             # rename from data/
```

## 7. Open questions for the user

1. Is the `app/` wrapper folder there for a planned monorepo (separate mobile/admin apps)? If not, flatten it (01-F1).
2. Are any [data/](../app/src/data/) files (`menu.ts`, `customers.ts`) imported at runtime, or only by `migrate.mjs`/dev seeding? Answer affects 01-F5 severity.
3. Who calls bare `/api/orders` vs `/api/pos/orders` vs `/api/admin/orders`? (01-F6)
4. Is admin meant to stay a single SPA, or should it become routed? (01-F7)

## 8. What's next

- Resolve open questions 1–4 to firm up the target structure.
- Run **Audit 02 — Large files / god components** ([02-large-files.md](./02-large-files.md), pending) which will quantify what each huge page actually contains and propose split boundaries.
