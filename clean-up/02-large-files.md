# Audit 02 — Large Files / God Components

**Phase:** 1 — Inventory & structure
**Date:** 2026-05-04
**Scope:** Every `.ts`/`.tsx` file in [app/src/](../app/src/) ranked by size; characterization of files >500 lines; concrete split boundaries.
**Mode:** Read-only

---

## 1. Methodology

- File size measured in two ways: bytes (storage), and **lines of code** (more meaningful — bytes inflate with long Tailwind class strings).
- For each file I counted: `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, top-level `function` declarations, `fetch(` calls, and direct `supabase.` calls.
- For Tier-1 god files I grep'd top-level `function` / `export function` declarations to map the file's internal sub-components.

**Thresholds used:**

| Tier | Lines | Verdict |
|---|---|---|
| 1 — God file | >1500 | Must be split. Single file holds multiple unrelated views/responsibilities. |
| 2 — Large | 700–1500 | Should be split. Likely contains 3+ sub-components or modals. |
| 3 — Borderline | 400–700 | Review case-by-case. Acceptable if cohesive; suspect if it contains modals or unrelated tabs. |
| 4 — OK | <400 | No action. |

Total project size (audit scope): **49,370 lines** across 163 `.ts/.tsx` files.

## 2. Ranking — full report (top 40)

> Bytes column included for cross-reference with Audit 01.

| # | Lines | Bytes | Path | Tier | Notes |
|---:|---:|---:|---|---|---|
| 1 | **6,746** | 394,718 | [app/pos/page.tsx](../app/src/app/pos/page.tsx) | **1** | The single worst file in the codebase. 8 sub-views + 3 modals + ~12 helpers + main shell, all in one file. |
| 2 | 1,830 | 87,054 | [app/waiter/page.tsx](../app/src/app/waiter/page.tsx) | 1 | 8 sub-components incl. ItemModal, VoidRefundModal, PinPad, BillEmailBar, ReceiptModal. |
| 3 | 1,582 | 81,996 | [app/page.tsx](../app/src/app/page.tsx) | 1 | Customer-facing storefront: FoodCard, TrackOrderModal, MobileBottomNav, Sidebar, CartPanel, Hero, OrdersView, FooterContent — 7 sub-components. |
| 4 | 1,504 | 73,336 | [context/AppContext.tsx](../app/src/context/AppContext.tsx) | 1 | God provider: 32 `fetch(` calls + mappers (`mapCategory`, `mapMenuItem`, `mapOrder`, `mapCustomer`) + reducers + settings builder + provider with 12 useStates and 13 useEffects. |
| 5 | 1,484 | 69,787 | [(site)/account/page.tsx](../app/src/app/(site)/account/page.tsx) | 1 | 4 tabs as in-file components (FavouritesTab, AddressesTab, ProfileTab) + ChangePasswordCard + OrderCard + OrderTracker + DeliveryTracker + ReorderToast + QuickReorder + StatusBadge. |
| 6 | 1,094 | 52,875 | [components/admin/MenuManagementPanel.tsx](../app/src/components/admin/MenuManagementPanel.tsx) | 2 | CategoryModal + ItemModal + ConfirmModal + ModalShell + main panel. |
| 7 | 1,059 | 46,602 | [components/admin/OperationsPanel.tsx](../app/src/components/admin/OperationsPanel.tsx) | 2 | 5 cards in one file: BrandingCard, SeoCard, CustomHeadCard, LocationCard, plus Field/LocationField helpers. 23 useStates. |
| 8 | 1,046 | 45,100 | [components/admin/UserManagementPanel.tsx](../app/src/components/admin/UserManagementPanel.tsx) | 2 | UserRow + CreateUserModal + EditUserModal + ChangePasswordModal + ModalWrapper + FormField + ToggleSwitch + main. 40 useStates, 7 fetches. |
| 9 | 932 | 46,675 | [components/admin/IntegrationsPanel.tsx](../app/src/components/admin/IntegrationsPanel.tsx) | 2 | 3 tabs: PaymentMethodsTab, ApiKeysTab, PrinterTab + MethodRow + EnvVarRow + Toggle. |
| 10 | 826 | 43,220 | [components/admin/CustomersPanel.tsx](../app/src/components/admin/CustomersPanel.tsx) | 2 | StatCard + ReceiptModal + CustomerDrawer + buildPrintHtml + main. |
| 11 | 798 | 41,273 | [components/admin/ReservationsPanel.tsx](../app/src/components/admin/ReservationsPanel.tsx) | 2 | ReservationSettings (200 lines) + ReservationCard + main. 28 useStates, 4 fetches. |
| 12 | 794 | 38,142 | [lib/emailTemplates.ts](../app/src/lib/emailTemplates.ts) | 2 | Multiple HTML email templates inlined. Borderline acceptable as a template file but each template should be its own module. |
| 13 | 792 | 37,783 | [components/CheckoutModal.tsx](../app/src/components/CheckoutModal.tsx) | 2 | Single modal but with embedded LocationWidget + delivery-zone math + payment method logic. |
| 14 | 761 | 35,914 | [components/admin/DeliveryPanel.tsx](../app/src/components/admin/DeliveryPanel.tsx) | 2 | StatCard + KanbanCard + OrderModal + main. |
| 15 | 734 | 33,064 | [components/admin/OnlineReportsPanel.tsx](../app/src/components/admin/OnlineReportsPanel.tsx) | 2 | StatCard + BarChart + HBar + grouping helpers + main. |
| 16 | 720 | 37,286 | [app/admin/page.tsx](../app/src/app/admin/page.tsx) | 2 | Admin SPA shell loading 27 panels (see 01-F7). |
| 17 | 719 | 35,469 | [context/POSContext.tsx](../app/src/context/POSContext.tsx) | 2 | Provider + load/save (localStorage) helpers + syncMenuToSupabase + usePOS. |
| 18 | 719 | 30,750 | [app/driver/page.tsx](../app/src/app/driver/page.tsx) | 2 | Driver delivery view. Probably similar pattern: tabs + modals + main. |
| 19 | 709 | 43,337 | [components/admin/BreakfastMenuPanel.tsx](../app/src/components/admin/BreakfastMenuPanel.tsx) | 2 | Near-duplicate of MenuManagementPanel pattern: CategoryModal + ItemModal + ConfirmModal + ModalShell. **See 02-F4 for duplication.** |
| 20 | 690 | 28,810 | [app/kitchen/page.tsx](../app/src/app/kitchen/page.tsx) | 2 | Kitchen display. |
| 21 | 673 | 27,857 | [components/admin/EmailTemplatesPanel.tsx](../app/src/components/admin/EmailTemplatesPanel.tsx) | 3 | RichEditor + EmailPreview + TestSendWidget + main. |
| 22 | 669 | 30,311 | [components/admin/WaitersPanel.tsx](../app/src/components/admin/WaitersPanel.tsx) | 3 | |
| 23 | 637 | 21,879 | [lib/escpos.ts](../app/src/lib/escpos.ts) | 3 | Receipt printer protocol. Acceptable if cohesive (single hardware concern). |
| 24 | 636 | 30,059 | [components/ReservationModal.tsx](../app/src/components/ReservationModal.tsx) | 3 | |
| 25 | 624 | 36,384 | [components/admin/POSReportsPanel.tsx](../app/src/components/admin/POSReportsPanel.tsx) | 3 | KpiCard + 6 helper functions (date ranges, buckets, exportCSV) + main. **Helpers duplicate logic from `pos/page.tsx`.** |
| 26 | 582 | 26,200 | [components/admin/RefundsPanel.tsx](../app/src/components/admin/RefundsPanel.tsx) | 3 | |
| 27 | 568 | 27,684 | [components/admin/DeliveryZonesPanel.tsx](../app/src/components/admin/DeliveryZonesPanel.tsx) | 3 | |
| 28 | 555 | 24,759 | [components/admin/ReservationCustomersPanel.tsx](../app/src/components/admin/ReservationCustomersPanel.tsx) | 3 | |
| 29 | 543 | 22,623 | [components/admin/DriversPanel.tsx](../app/src/components/admin/DriversPanel.tsx) | 3 | |
| 30 | 513 | 23,053 | [components/admin/CouponsPanel.tsx](../app/src/components/admin/CouponsPanel.tsx) | 3 | |
| 31 | 490 | 15,877 | [types/index.ts](../app/src/types/index.ts) | 3 | Cross-feature type bag. Should be split per domain. |
| 32 | 479 | 19,754 | [app/customer-display/page.tsx](../app/src/app/customer-display/page.tsx) | 3 | |
| 33 | 460 | 20,501 | [components/admin/CustomPagesPanel.tsx](../app/src/components/admin/CustomPagesPanel.tsx) | 3 | |
| 34 | 445 | 17,869 | [components/admin/FooterLogosPanel.tsx](../app/src/components/admin/FooterLogosPanel.tsx) | 3 | |
| 35 | 414 | — | [components/admin/MenuLinksPanel.tsx](../app/src/components/admin/MenuLinksPanel.tsx) | 3 | |
| 36 | 407 | 17,295 | [components/admin/ReceiptSettingsPanel.tsx](../app/src/components/admin/ReceiptSettingsPanel.tsx) | 3 | |
| 37 | 400 | 19,476 | [(site)/login/page.tsx](../app/src/app/(site)/login/page.tsx) | 4 | OK. |
| 38 | 391 | 18,591 | [app/driver/login/page.tsx](../app/src/app/driver/login/page.tsx) | 4 | OK. |
| 39 | 388 | 22,899 | [(site)/book/page.tsx](../app/src/app/(site)/book/page.tsx) | 4 | OK. |
| 40 | — | 16,422 | [components/admin/TaxSettingsPanel.tsx](../app/src/components/admin/TaxSettingsPanel.tsx) | 4 | OK. |

## 3. Findings

### 02-F1 — `app/pos/page.tsx` is the single worst file in the project (6,746 lines)
**Severity:** Critical
**Evidence:** 112 `useState` calls, 19 `useEffect`, 94 top-level functions, 8 fetch calls, 3 direct supabase calls. Top-level structural map (line numbers):
```
30–47    Helpers (fmt, fmtPct, getInitials, relTime, fmtTime, fmtDate)
60–195   ModifierModal
196–416  PaymentModal
417–477  buildReceiptHtml + ReceiptModal
699–897  OrderPanel
898–1250 SaleView                          ← sub-view #1
1251–1325 POS date / bucket / CSV helpers
1326–1356 buildDineInReceiptHtml
1357–3080 DashboardView                     ← sub-view #2 (1,723 lines!)
3081–3489 CustomersView                     ← sub-view #3
3490–3814 StaffView                         ← sub-view #4
3815–4043 POSPrinterPanel
4044–5639 SettingsView                      ← sub-view #5 (1,595 lines)
5640–5917 TableStatusView                   ← sub-view #6
5918–5947 Local-date helpers (duplicated below in res)
5948–6547 ReservationsView                  ← sub-view #7
6548+     Main POSPage shell (mount guards, outbox sync, view router)
```
**Why it matters:** Every state change re-renders all sub-views. Adding a feature to one view risks breaking the others. Code splitting cannot kick in — the entire bundle ships when `/pos` loads. PR review on this file is effectively impossible.
**Possible action — concrete split:**
```
src/features/pos/
├── components/
│   ├── ModifierModal.tsx          (lines 60–195)
│   ├── PaymentModal.tsx           (lines 196–416)
│   ├── ReceiptModal.tsx           (lines 417–477)
│   ├── DineInReceiptModal.tsx
│   ├── OrderPanel.tsx             (lines 699–897)
│   └── POSPrinterPanel.tsx        (lines 3815–4043)
├── views/
│   ├── SaleView.tsx               (lines 898–1250)
│   ├── DashboardView.tsx          (lines 1357–3080)  → consider splitting further into KPIs/Charts/Transactions
│   ├── CustomersView.tsx          (lines 3081–3489)
│   ├── StaffView.tsx              (lines 3490–3814)
│   ├── SettingsView.tsx           (lines 4044–5639)  → split per settings tab
│   ├── TableStatusView.tsx        (lines 5640–5917)
│   └── ReservationsView.tsx       (lines 5948–6547)
├── lib/
│   ├── format.ts                  (lines 30–47)
│   ├── receipt-html.ts            (buildReceiptHtml + buildDineInReceiptHtml)
│   ├── date-buckets.ts            (getPOSDateRange, posDailyBuckets, posHourlyBuckets, posExportCSV)
│   └── slot-helpers.ts            (lines 5918–5947 res helpers)
└── (route) app/pos/page.tsx        (<150 lines: shell, view router, mount guards)
```

### 02-F2 — `context/AppContext.tsx` is a god provider mixing data access, mappers, reducers, and orchestration (1,504 lines)
**Severity:** High
**Evidence:** 32 `fetch()` calls (the highest of any file). Contents include:
- `cartReducer` — cart state machine (line 46)
- `mergeEmailTemplates`, `buildSettingsFromData` — settings hydration
- Row mappers: `mapCategory`, `mapMenuItem`, `mapOrder`, `mapCustomer` (lines 278–344)
- Reverse mappers: `categoryToRow`, `menuItemToRow`, `orderToRow`, `customerToRow` (lines 346–393)
- Domain logic: `isStoreOpen`, `validateCouponCode`
- `AppProvider` — 1069-line provider with 12 useStates / 13 useEffects orchestrating menu, orders, customers, settings, cart, coupons, footer pages, etc.

**Why it matters:** This is the central nervous system of the customer site, but it conflates data-access (Supabase queries + DTO mapping), state container, and business rules. Any change forces re-evaluation of unrelated concerns. Performance-wise, every consumer of `useApp()` re-renders when *any* slice changes.
**Possible action — concrete split:**
```
src/features/
├── menu/services/menu.repo.ts            (mapCategory, mapMenuItem, categoryToRow, menuItemToRow + fetchers)
├── orders/services/orders.repo.ts        (mapOrder, orderToRow + fetchers)
├── customers/services/customers.repo.ts  (mapCustomer, customerToRow + fetchers)
├── settings/services/settings.repo.ts    (buildSettingsFromData, mergeEmailTemplates, fetchers)
├── cart/state/cartReducer.ts             (lift out reducer + types)
├── coupons/lib/validate.ts               (validateCouponCode)
└── opening-hours/lib/isStoreOpen.ts
```
Then split the provider into per-domain contexts (MenuContext, OrdersContext, CartContext, SettingsContext) — each only re-renders its consumers.

### 02-F3 — Pages are containing entire role-specific apps (Tier-1: waiter, home, account)
**Severity:** High
**Evidence:** Three more files >1,400 lines each:
- [waiter/page.tsx](../app/src/app/waiter/page.tsx) (1,830) — ItemModal, VoidRefundModal, PinPad, BillEmailBar, ReceiptModal, buildReceiptHtml + main shell.
- [page.tsx](../app/src/app/page.tsx) (1,582) — FoodCard, TrackOrderModal, MobileBottomNav, Sidebar, CartPanel, Hero, OrdersView (660+ lines), FooterContent.
- [(site)/account/page.tsx](../app/src/app/(site)/account/page.tsx) (1,484) — 4 tabs + 5 sub-components.
**Why it matters:** Same problems as 02-F1 at smaller scale. These should each become a `features/<role>/` module with components and views split out. The route page should be a shell.

### 02-F4 — `BreakfastMenuPanel.tsx` is a near-duplicate of `MenuManagementPanel.tsx`
**Severity:** Medium
**Evidence:** Both files have the exact same internal structure: `blankItem`, `blankCategory`, `blankVariation`, `blankAddOn`, `CategoryModal`, `ItemModal`, `ConfirmModal`, `ModalShell`. MenuManagementPanel is 1,094 lines; BreakfastMenuPanel is 709 lines. Together they are 1,803 lines of likely 50–80% duplicated code.
**Why it matters:** Changes to the menu CRUD flow (e.g. adding a field to MenuItem) need to be made twice. High risk of behavior drift.
**Possible action:** Extract a shared `MenuCrudPanel` that takes a "menu type" prop (regular vs breakfast). Or extract the modals (`MenuCategoryModal`, `MenuItemModal`, `ConfirmModal`, `ModalShell`) into reusable components and have both panels compose them. Cross-ref `03-dead-code-duplicates.md` (planned).

### 02-F5 — POS reporting logic is duplicated in two places
**Severity:** Medium
**Evidence:** [pos/page.tsx](../app/src/app/pos/page.tsx) has `getPOSDateRange`, `posDailyBuckets`, `posHourlyBuckets`, `posExportCSV` (lines 1251–1325). [components/admin/POSReportsPanel.tsx](../app/src/components/admin/POSReportsPanel.tsx) has the *same* concepts as `getDateRange`, `buildDailyBuckets`, `buildHourlyBuckets`, `exportCSV` (lines 42–120). The naming differs by a `pos`/`build` prefix; the logic is the same problem domain (POS sales analytics).
**Why it matters:** Two code paths for the same calculation = guaranteed drift. Bug fixes happen in one and not the other.
**Possible action:** Extract to `features/pos/lib/analytics.ts` (date ranges, daily/hourly bucketing, CSV export). Both consumers import the same module.

### 02-F6 — Reservation slot/date helpers are likely duplicated 3+ ways
**Severity:** Medium (suspected — needs grep confirmation in `03-dead-code-duplicates.md`)
**Evidence:** [pos/page.tsx](../app/src/app/pos/page.tsx) lines 5918–5947 define `localTodayStrRes`, `localMaxDateStrRes`, `nowLocalMinsRes`, `toMinsRes`, `isSlotPastRes`, `generateSlotsRes`, `isNoShowCandidate` (the `Res` suffix suggests they're a renamed copy from a reservations file). [lib/scheduleUtils.ts](../app/src/lib/scheduleUtils.ts) (153 lines) likely has the originals. [components/admin/ReservationsPanel.tsx](../app/src/components/admin/ReservationsPanel.tsx) has its own `fmt12`, `fmtDate`, `fmtTs`, `todayStr`.
**Why it matters:** Time/date math + slot generation is high-stakes (off-by-one bugs become "we double-booked the table"). It must live in exactly one place.
**Possible action:** Consolidate into `features/reservations/lib/slots.ts` and `lib/datetime.ts` (pure utils).

### 02-F7 — Common modal shell is reimplemented per panel instead of shared
**Severity:** Medium
**Evidence:** `ModalShell` exists in [MenuManagementPanel](../app/src/components/admin/MenuManagementPanel.tsx) (line 1075) and [BreakfastMenuPanel](../app/src/components/admin/BreakfastMenuPanel.tsx) (line 696). `ModalWrapper` in [UserManagementPanel](../app/src/components/admin/UserManagementPanel.tsx) (line 983). `ConfirmModal` appears in two of them. Many other panels re-roll their own modal divs.
**Why it matters:** Inconsistent UX, accessibility (focus trap, ESC handling), and styling.
**Possible action:** Add `components/ui/Modal.tsx` and `components/ui/ConfirmDialog.tsx`. Cross-ref Audit 01's `components/ui/` recommendation.

### 02-F8 — Tier-2 panels with high `useState` counts suggest sub-component candidates
**Severity:** Medium
**Evidence:**
- UserManagementPanel: **40** useStates in 1,046 lines (3 modals embedded).
- ReservationsPanel: **28** useStates (settings + card + add modal in one file).
- OperationsPanel: **23** useStates (5 cards in one file — but they don't share state, so most useStates are unrelated).

A single component with 20+ useStates almost always means it's secretly multiple components.
**Why it matters:** Each unrelated state change re-renders the whole panel. Easier to test, reason about, and lazy-load when split.
**Possible action:** For each panel — pull out the modals into their own files at minimum; ideally split each panel into `features/<domain>/{components,modals,hooks}`.

### 02-F9 — `lib/emailTemplates.ts` (794 lines) bundles every email template into one file
**Severity:** Low-Medium
**Evidence:** 38 KB, 794 lines. Hard to know which template is which without reading the whole file.
**Possible action:** Split per template into `server/email/templates/{order-confirmation,reservation-created,...}.ts`. Cross-ref Audit 01's `server/` recommendation.

### 02-F10 — Sub-view DashboardView (1,723 lines) and SettingsView (1,595 lines) inside `pos/page.tsx` would each be Tier-1 god files on their own
**Severity:** Critical (subset of 02-F1)
**Evidence:** Lines 1357–3080 and 4044–5639 of [pos/page.tsx](../app/src/app/pos/page.tsx). DashboardView mixes 3 tab variants (today's overview, dine-in stats, full reports), KPI calculations, payment-mix charts, transactions list, void/refund modals. SettingsView contains every POS setting category with its own state.
**Why it matters:** Even after 02-F1's first-pass split, these two need a second pass — break DashboardView into `{Overview,Reports,Transactions}.tsx` and SettingsView into per-tab files.

## 4. Severity summary

| Severity | IDs |
|---|---|
| **Critical** | 02-F1 (pos/page.tsx 6.7k lines), 02-F10 (sub-views inside pos that are themselves god files) |
| **High** | 02-F2 (AppContext god provider), 02-F3 (waiter/home/account Tier-1) |
| **Medium** | 02-F4 (BreakfastMenu duplicates MenuManagement), 02-F5 (POS analytics dup), 02-F6 (reservation slot helpers dup), 02-F7 (modal shells repeated), 02-F8 (high useState counts) |
| **Low-Medium** | 02-F9 (emailTemplates.ts bundle) |

## 5. Recommended split priority order

When we move into refactor phase, tackle in this order to minimize risk:

1. **Extract pure helpers first (02-F5, 02-F6, 02-F9).** Pull `format.ts`, `analytics.ts`, slot helpers, email templates out into pure modules. Zero behavior change, easy to verify.
2. **Extract shared UI primitives (02-F7).** `Modal`, `ConfirmDialog`, `FormField`. Replace duplicated implementations one panel at a time.
3. **Split modals out of large panels (02-F8).** UserManagementPanel → 4 files; ReservationsPanel → 3 files; etc.
4. **Carve sub-views out of pos/page.tsx (02-F1, 02-F10).** Start with the cleanest boundary (CustomersView or StaffView) before tackling DashboardView/SettingsView.
5. **Split AppContext into per-domain contexts (02-F2).** Highest blast radius — do last, after services/repositories are extracted.
6. **Address near-duplicate panels (02-F4).** Unify MenuManagementPanel + BreakfastMenuPanel via composition.

## 6. Open questions for the user

1. Is BreakfastMenuPanel a fork that diverged on purpose (different fields/behavior) or genuinely a copy with a different category filter? Affects 02-F4 fix shape.
2. POS DashboardView contains 3 distinct period modes. Are they truly separate UX flows, or could they collapse into one with a period selector? Affects 02-F10.
3. Is there an appetite for code-splitting (`next/dynamic`) per role on this round, or is the goal purely structural (file split) without changing bundle behavior?

## 7. What's next

- **Audit 03 — Dead code & duplicates** ([03-dead-code-duplicates.md](./03-dead-code-duplicates.md), pending). Will confirm 02-F4, 02-F5, 02-F6, 02-F7 with grep evidence and add findings on unused exports / commented-out code / duplicate Header/Footer pairs flagged in 01-F12.
