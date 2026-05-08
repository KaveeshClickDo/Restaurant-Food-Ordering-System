# Audit 03 — Dead Code & Duplicates

**Phase:** 1 — Inventory & structure
**Date:** 2026-05-04
**Scope:** Orphaned components/files, duplicate functions across the codebase, near-duplicate panels, duplicate API routes.
**Mode:** Read-only

---

## 1. Methodology

For each candidate orphan I grep'd both the alias path (`@/components/Foo`) and relative paths (`./Foo`, `../Foo`) across [app/src/](../app/src/). For duplicates I grep'd `function <name>(` declarations and listed every site that defines the same name with similar signatures. A finding is **confirmed dead** only if zero non-self imports exist in the source tree.

## 2. Findings — dead code

### 03-F1 — `components/Header.tsx` is dead (15.5 KB / 415 lines unreferenced)
**Severity:** High (large file, easy win)
**Evidence:** [components/Header.tsx](../app/src/components/Header.tsx) imports `AuthModal`, `ScheduleOrderModal`, `ReservationModal`, `getNextOpenTime`, `formatNextOpen`. **No file imports `Header.tsx` itself** (verified across alias + relative paths). The customer-site UI uses the inlined nav inside [app/page.tsx](../app/src/app/page.tsx) and the `(site)` route group uses [SiteSidebar.tsx](../app/src/components/SiteSidebar.tsx) + [SiteMobileHeader.tsx](../app/src/components/SiteMobileHeader.tsx).
**Why it matters:** It looks alive (well-formed component, imports useApp), so a developer might assume it's the source of truth. Maintaining it is wasted effort.
**Possible action:** Delete after a final cross-check by the user.

### 03-F2 — `components/Footer.tsx` is dead
**Severity:** Medium
**Evidence:** [components/Footer.tsx](../app/src/components/Footer.tsx) is never imported. The site uses [SiteFooter.tsx](../app/src/components/SiteFooter.tsx) instead (imported from [(site)/layout.tsx](../app/src/app/(site)/layout.tsx)).
**Possible action:** Delete.

### 03-F3 — `components/Cart.tsx` is dead
**Severity:** Medium
**Evidence:** [components/Cart.tsx](../app/src/components/Cart.tsx) — never imported. Customer-facing cart logic lives inside `CartPanel` inside [app/page.tsx](../app/src/app/page.tsx) (line 487).
**Possible action:** Delete. (Note: when `app/page.tsx` is refactored per 02-F3, `CartPanel` should become `features/cart/components/CartPanel.tsx` rather than reviving this file.)

### 03-F4 — Five legacy storefront components are transitively dead
**Severity:** Medium (5 files, all already audited as ≤300 lines so impact is moderate)
**Evidence:** None of these files are imported anywhere outside their own dead chain:
- [components/CategoryNav.tsx](../app/src/components/CategoryNav.tsx) — 0 importers
- [components/MenuSection.tsx](../app/src/components/MenuSection.tsx) — 0 importers; only imports `MenuItemCard`
- [components/BreakfastSection.tsx](../app/src/components/BreakfastSection.tsx) — 0 importers; only imports `MenuItemCard`
- [components/SearchAndFilters.tsx](../app/src/components/SearchAndFilters.tsx) — 0 importers
- [components/MenuItemCard.tsx](../app/src/components/MenuItemCard.tsx) — only imported by `BreakfastSection` + `MenuSection` (both dead) → **transitively dead**

The actual storefront uses inlined `FoodCard` (line 30) and category navigation inside [app/page.tsx](../app/src/app/page.tsx).
**Why it matters:** A vibe-coded second iteration of the storefront left the first iteration's components in place. Combined with 03-F1/F2/F3 this is **8 dead files** in `components/` — roughly half the non-admin component folder.
**Possible action:** Delete all 5. Verify by running `npm run build` after deletion.

### 03-F5 — All 27 admin panels ARE used (positive finding)
**Severity:** None (positive)
**Evidence:** [admin/page.tsx](../app/src/app/admin/page.tsx) imports all 27 panels (lines 7–33). No orphans in `components/admin/`.
**Why it matters:** Confirms the admin SPA shell pattern (01-F7) — none of the panel weight is dead, just badly organized.

### 03-F6 — `data/` files are all imported at runtime (answer to Audit 01 open question 2)
**Severity:** Low
**Evidence:**
- `data/restaurant.ts` — imported by [app/layout.tsx](../app/src/app/layout.tsx), [AppContext.tsx](../app/src/context/AppContext.tsx), [OperationsPanel.tsx](../app/src/components/admin/OperationsPanel.tsx)
- `data/menu.ts` — imported by [AppContext.tsx](../app/src/context/AppContext.tsx) and [api/admin/seed/route.ts](../app/src/app/api/admin/seed/route.ts)
- `data/customers.ts` — imported by [AppContext.tsx](../app/src/context/AppContext.tsx) and [api/admin/seed/route.ts](../app/src/app/api/admin/seed/route.ts)
- `data/footerPages.ts` — imported by [AppContext.tsx](../app/src/context/AppContext.tsx)

So `data/` files serve dual purposes: (a) seed input for `/api/admin/seed`, and (b) **runtime fallback defaults** inside `AppContext` and `app/layout.tsx` if the DB hasn't been populated.
**Why it matters:** Mixing seed data with runtime fallbacks blurs the boundary between dev-only and production code. If the DB is correctly populated, these defaults should never load. This deserves its own decision in the refactor phase.
**Possible action:** Either (a) keep them as `seed/` and have `AppContext` only call them when explicitly running first-time setup, or (b) accept that they're production fallbacks and document so.

### 03-F7 — `lib/` has no orphans (positive finding)
**Severity:** None (positive)
**Evidence:** All 17 files in [lib/](../app/src/lib/) have imports recorded across 86 files (145 total occurrences). Lowest-usage `lib/` files: `waiterAuth.ts` (3 imports), `connectivity.ts` (varies), `apiHandler.ts` (used in API routes). None unused.

### 03-F8 — No commented-out code blocks of significance found at first pass
**Severity:** Informational
**Evidence:** Spot-checked [components/Header.tsx](../app/src/components/Header.tsx) — comments are doc-only, not commented-out code. A deeper sweep is possible but seems low-yield.

### 03-F9 — 160 `console.*` calls scattered across the codebase
**Severity:** Medium
**Evidence:** 160 `console.log/warn/error` statements across `.ts`/`.tsx` files. Not strictly "dead code" but represents either:
- legitimate runtime logging that should go through a logger module, or
- debug leftovers from the vibe-coding session.
**Why it matters:** Production console spam, possible info leak (logging tokens or PII), and noise that masks real warnings.
**Possible action:** Defer to Phase 5 (`13-typescript-escape-hatches.md` will catch related leftovers). Categorize each: keep behind `process.env.NODE_ENV !== 'production'`, route through a logger, or delete.

### 03-F10 — 33+ TODO/FIXME/`@ts-ignore` markers
**Severity:** Medium
**Evidence:** First-page sample (head_limit 5 files) found 33 occurrences in [types/pos.ts](../app/src/types/pos.ts) (8), [types/index.ts](../app/src/types/index.ts) (12), [lib/adminAuth.ts](../app/src/lib/adminAuth.ts) (3), [middleware.ts](../app/src/middleware.ts) (6), [instrumentation.ts](../app/src/instrumentation.ts) (4). Total likely much higher.
**Why it matters:** TODO/FIXME = unfinished work; `@ts-ignore` = type-safety hole. Both are debt markers worth inventorying.
**Possible action:** Defer the full list to Audit 13 (TypeScript escape hatches). Recorded here so it isn't lost.

## 3. Findings — duplicate functions

### 03-F11 — Date/time formatters duplicated **12+ ways**
**Severity:** High
**Evidence:** Found via `function (fmt|fmtDate|fmtTime|fmtTs|fmtPct|fmt12|formatDate|formatTime|todayStr)\b`:

| Function | Locations | Count |
|---|---|---|
| `fmtDate` | [pos/page.tsx:45](../app/src/app/pos/page.tsx#L45), [DeliveryPanel.tsx:140](../app/src/components/admin/DeliveryPanel.tsx#L140), [CouponsPanel.tsx:44](../app/src/components/admin/CouponsPanel.tsx#L44), [CustomersPanel.tsx:41](../app/src/components/admin/CustomersPanel.tsx#L41), [RefundsPanel.tsx:45](../app/src/components/admin/RefundsPanel.tsx#L45), [POSReportsPanel.tsx:24](../app/src/components/admin/POSReportsPanel.tsx#L24), [ReservationCustomersPanel.tsx:15](../app/src/components/admin/ReservationCustomersPanel.tsx#L15), [ReservationsPanel.tsx:22](../app/src/components/admin/ReservationsPanel.tsx#L22), [ReservationModal.tsx:46](../app/src/components/ReservationModal.tsx#L46), [reservation/[token]/page.tsx:27](../app/src/app/(site)/reservation/[token]/page.tsx#L27), [book/page.tsx:26](../app/src/app/(site)/book/page.tsx#L26) | **11** |
| `fmtTime` | [pos/page.tsx:42](../app/src/app/pos/page.tsx#L42), [DeliveryPanel.tsx:136](../app/src/components/admin/DeliveryPanel.tsx#L136), [CustomersPanel.tsx:44](../app/src/components/admin/CustomersPanel.tsx#L44), [RefundsPanel.tsx:50](../app/src/components/admin/RefundsPanel.tsx#L50), [POSReportsPanel.tsx:27](../app/src/components/admin/POSReportsPanel.tsx#L27) | **5** |
| `fmt12` (12-hour time) | [pos/page.tsx:5640 (fmt12Pos)](../app/src/app/pos/page.tsx#L5640), [ReservationModal.tsx:39](../app/src/components/ReservationModal.tsx#L39), [ReservationsPanel.tsx:16](../app/src/components/admin/ReservationsPanel.tsx#L16), [ReservationCustomersPanel.tsx:20](../app/src/components/admin/ReservationCustomersPanel.tsx#L20), [TableStatusPanel.tsx:31](../app/src/components/admin/TableStatusPanel.tsx#L31), [reservation/[token]/page.tsx:22](../app/src/app/(site)/reservation/[token]/page.tsx#L22), [book/page.tsx:22](../app/src/app/(site)/book/page.tsx#L22) | **7** |
| `fmtTs` (timestamp) | [pos/page.tsx:5645 (fmtTsPos)](../app/src/app/pos/page.tsx#L5645), [IntegrationsPanel.tsx:31](../app/src/components/admin/IntegrationsPanel.tsx#L31), [ReservationsPanel.tsx:29](../app/src/components/admin/ReservationsPanel.tsx#L29), [TableStatusPanel.tsx:36](../app/src/components/admin/TableStatusPanel.tsx#L36) | **4** |
| `todayStr` | [ReservationModal.tsx:54](../app/src/components/ReservationModal.tsx#L54), [ReservationsPanel.tsx:34](../app/src/components/admin/ReservationsPanel.tsx#L34), [TableStatusPanel.tsx:27](../app/src/components/admin/TableStatusPanel.tsx#L27), [book/page.tsx:33](../app/src/app/(site)/book/page.tsx#L33) | **4** |
| `formatDate` / `formatTime` | [(site)/account/page.tsx:175,178](../app/src/app/(site)/account/page.tsx#L175) | 2 (different name, same purpose) |
| `fmtPct` | [pos/page.tsx:31](../app/src/app/pos/page.tsx#L31) | 1 |
| `fmt` (currency) | [pos/page.tsx:30](../app/src/app/pos/page.tsx#L30), [escpos.ts:117](../app/src/lib/escpos.ts#L117) | 2 |

**Why it matters:** ~31 separate implementations of "format a date" / "format a time" across the codebase. Some use `en-GB` locale, some use US format, some use 12-hour, some 24-hour. Bug fixes need to be applied 11 times for `fmtDate`. Locale changes would touch all of them.
**Possible action:** Create [lib/datetime.ts](../app/src/lib/datetime.ts) with one canonical implementation per function (`formatDate`, `formatTime`, `formatDateTime12h`, `formatRelativeTimestamp`, `todayStr`). Delete every duplicate. This is the highest-ROI cleanup in Phase 1 — touches many files but each replacement is mechanical.

### 03-F12 — `initials` / `getInitials` duplicated 7 ways
**Severity:** Medium
**Evidence:**
- `initials(name)` — [waiter/page.tsx:51](../app/src/app/waiter/page.tsx#L51), [kitchen/page.tsx:428](../app/src/app/kitchen/page.tsx#L428), [kitchen/login/page.tsx:10](../app/src/app/kitchen/login/page.tsx#L10), [DriversPanel.tsx:14](../app/src/components/admin/DriversPanel.tsx#L14), [KitchenStaffPanel.tsx:14](../app/src/components/admin/KitchenStaffPanel.tsx#L14), [WaitersPanel.tsx:14](../app/src/components/admin/WaitersPanel.tsx#L14)
- `getInitials(name)` — [pos/page.tsx:32](../app/src/app/pos/page.tsx#L32), [pos/login/page.tsx:9](../app/src/app/pos/login/page.tsx#L9), [UserManagementPanel.tsx:32](../app/src/components/admin/UserManagementPanel.tsx#L32)

**Why it matters:** Same problem, smaller scale. Plus the naming inconsistency (`initials` vs `getInitials`) is itself a smell.
**Possible action:** Add to [lib/strings.ts](../app/src/lib/) or [lib/format.ts](../app/src/lib/) (single home).

### 03-F13 — `buildReceiptHtml` duplicated (POS vs Waiter; different signatures)
**Severity:** Medium-High
**Evidence:**
- [pos/page.tsx:417](../app/src/app/pos/page.tsx#L417): `buildReceiptHtml(sale: POSSale, settings: POSSettings, restaurantNameOverride?: string)` (~60 lines)
- [waiter/page.tsx:57](../app/src/app/waiter/page.tsx#L57): `buildReceiptHtml(receipt: WaiterReceipt, restaurantName: string, receiptPhone: string, receiptWebsite: string, vatNumber: string, thankYou: string)` (~30 lines)
- [pos/page.tsx:1326](../app/src/app/pos/page.tsx#L1326): `buildDineInReceiptHtml(...)` — third variant
- [components/admin/CustomersPanel.tsx:284](../app/src/components/admin/CustomersPanel.tsx#L284): `buildPrintHtml(...)` — fourth variant for customer print

**Why it matters:** Receipt formatting is the kind of code that *must* match what the printer hardware handles. Four printers' worth of HTML construction = four ways to break ESC/POS cleanly. Compliance/refund evidence depends on consistent receipts.
**Possible action:** Single [features/printer/lib/receipt-html.ts](../app/src/lib/) or [server/print/](../app/src/) module that takes a normalized "PrintableSale" type and renders the HTML. POS and Waiter feed different sources but call the same renderer.

### 03-F14 — `blankItem` / `blankCategory` / `blankVariation` / `blankAddOn` duplicated between MenuManagementPanel & BreakfastMenuPanel
**Severity:** Medium (already flagged in 02-F4; restated here with grep evidence)
**Evidence:**
- [MenuManagementPanel.tsx:26,40,44,48](../app/src/components/admin/MenuManagementPanel.tsx#L26)
- [BreakfastMenuPanel.tsx:24,27,30,33](../app/src/components/admin/BreakfastMenuPanel.tsx#L24)

Identical function names and (likely) bodies, side by side. Combined with 02-F4 evidence (`CategoryModal`, `ItemModal`, `ConfirmModal`, `ModalShell` also duplicated in both files), this is **8+ duplicated functions** between the two panels.
**Possible action:** See 02-F4 — extract `MenuCrud*` shared module.

### 03-F15 — `isStoreOpen`, `validateCouponCode` are correctly centralized — but inline only inside AppContext, not shared
**Severity:** Low
**Evidence:** Only one definition each, both in [AppContext.tsx:244,258](../app/src/context/AppContext.tsx#L244). Good — no duplication. But they're locked inside the giant context file rather than being importable from a `lib/` location.
**Possible action:** When AppContext is split (02-F2), move these into `features/store-hours/lib/` and `features/coupons/lib/` so they can be unit-tested and reused.

## 4. Findings — duplicate API surface

### 03-F16 — Two endpoints to read/write the same customer (`/api/customers/[id]` vs `/api/admin/customers/[id]`)
**Severity:** Medium (already flagged in 01-F6; restated with route inventory)
**Evidence:** Both routes exist:
- [api/customers/[id]/route.ts](../app/src/app/api/customers/[id]/route.ts) (top-level, presumably authenticated as the customer themselves)
- [api/admin/customers/[id]/route.ts](../app/src/app/api/admin/customers/[id]/route.ts) (admin-side)

Same conceptual resource, two routes, two auth contracts.
**Why it matters:** Higher attack surface (both routes need to be auth-checked correctly), and inevitable behavior drift (e.g., a field validation added in admin but not in customer).
**Possible action:** Defer the consolidation decision to Phase 4 (`11-api-consistency.md`). Possible patterns: (a) keep both but make admin a thin wrapper that calls the same service-layer function with elevated permissions; (b) merge into one route that branches on caller role.

### 03-F17 — Singular vs plural reservation endpoint
**Severity:** Low (already in 01-F6)
**Evidence:** [api/reservation/[token]/route.ts](../app/src/app/api/reservation/[token]/route.ts) (singular, guest token GET) vs [api/reservations/route.ts](../app/src/app/api/reservations/route.ts) + [api/reservations/availability/route.ts](../app/src/app/api/reservations/availability/route.ts) (plural).
**Possible action:** Pick one convention (REST plural with token as path param: `/api/reservations/by-token/[token]` or `/api/reservations/[id]`). Defer to Phase 4.

## 5. Severity summary

| Severity | IDs |
|---|---|
| **High** | 03-F1 (Header.tsx dead — 415 lines), 03-F11 (date/time formatters duplicated 30+ ways) |
| **Medium-High** | 03-F13 (4 receipt HTML implementations) |
| **Medium** | 03-F2 (Footer dead), 03-F3 (Cart dead), 03-F4 (5 storefront components dead), 03-F9 (160 console statements), 03-F10 (33+ TODO/@ts-ignore), 03-F12 (initials helper duped 7 ways), 03-F14 (Menu CRUD blanks duped), 03-F16 (customer API duplicated) |
| **Low** | 03-F6 (data/ runtime usage), 03-F15 (cohesive but locked in context), 03-F17 (singular/plural reservation) |
| **Informational / positive** | 03-F5 (no orphan admin panels), 03-F7 (no orphan lib files), 03-F8 (no major commented-out blocks) |

## 6. Quick-win deletion list (recommended for the first cleanup PR)

These 8 files are dead and can be deleted with no behavior change:

```
app/src/components/Header.tsx              (415 lines)
app/src/components/Footer.tsx              (~60 lines)
app/src/components/Cart.tsx                (~80 lines)
app/src/components/CategoryNav.tsx         (~50 lines)
app/src/components/MenuSection.tsx         (~50 lines)
app/src/components/BreakfastSection.tsx    (~80 lines)
app/src/components/SearchAndFilters.tsx    (~80 lines)
app/src/components/MenuItemCard.tsx        (~80 lines, transitively dead)
```

Estimated total: **~900 lines deleted** with zero risk if `npm run build` passes after.

## 7. Highest-ROI consolidation (recommended after deletions)

In rough priority order:

1. **[lib/datetime.ts](../app/src/lib/) — single source for `formatDate`, `formatTime`, `formatTime12h`, `formatTimestamp`, `todayStr`.** Replaces ~31 inline definitions across 14 files (03-F11). Highly mechanical refactor.
2. **[lib/strings.ts](../app/src/lib/) (or extend `lib/format.ts`) — `getInitials`.** Replaces 7 copies (03-F12).
3. **Receipt HTML module — `features/print/lib/receipt-html.ts`.** Consolidates 4 receipt builders behind one signature (03-F13).
4. **Shared menu-CRUD primitives.** Resolves 02-F4 + 03-F14 together.

## 8. Open questions for the user

1. Are the 8 dead files (03-F1–03-F4) safe to delete, or are any of them earmarked for an upcoming feature you haven't merged yet? *(I'd verify with you before any delete PR.)*
2. For 03-F6: do you want `data/` to stay as runtime fallback (any DB hiccup → fall back to seed values) or is the intent that DB is always the source of truth and these defaults are dev-only?
3. For 03-F13: are the 4 receipt formats intentionally different (POS gets full breakdown, waiter gets simplified, customer print gets minimal), or did they drift apart unintentionally?

## 9. What's next

- This concludes **Phase 1 — Inventory & structure**.
- **Phase 2 — State & data flow** begins next:
  - Audit 04 — `localStorage` / `sessionStorage` audit (preview from this audit: 25 occurrences across 7 files, with [AppContext.tsx](../app/src/context/AppContext.tsx) leading at 13 and [POSContext.tsx](../app/src/context/POSContext.tsx) at 4 — both look load-bearing, not just UI prefs).
  - Audit 05 — Context bloat (will revisit 02-F2).
