# Audit 05 — Context Bloat

**Phase:** 2 — State & data flow
**Date:** 2026-05-04
**Scope:** [AppContext.tsx](../app/src/context/AppContext.tsx) (1,504 lines) and [POSContext.tsx](../app/src/context/POSContext.tsx) (719 lines) — what's inside, who consumes them, what re-renders too often, and concrete split boundaries.
**Mode:** Read-only

---

## 1. Methodology

For each context I:
1. Read the full `interface ContextValue` to enumerate exposed surface area.
2. Mapped every action handler / state setter / `useEffect` / DTO mapper inside the provider with line numbers.
3. Counted consumers via `useApp()` / `usePOS()` calls.
4. Grouped surface area into responsibility slices to identify split boundaries.
5. Scored each slice on: state volume, change frequency, consumer overlap, side effects.

A healthy React context exposes one cohesive concern, has <10 fields on its value type, and re-renders only when its slice changes. A god context exposes everything and re-renders all consumers on any change.

## 2. AppContext.tsx — anatomy (1,504 lines, 32 fetch calls)

### 2.1 — Surface area (the `interface AppContextValue`)

I counted **74 exposed fields/methods** on `AppContextValue` ([lines 60–138](../app/src/context/AppContext.tsx#L60)). Grouped:

| Slice | Fields/methods | Count | Lines (interface) |
|---|---|---|---|
| **Cart** | `cart`, `addToCart`, `removeFromCart`, `updateQty`, `clearCart`, `cartTotal`, `cartCount` | 7 | 61–67 |
| **Settings (global)** | `settings`, `updateSettings` | 2 | 68–69 |
| **Store hours** | `isOpen` | 1 | 70 |
| **Fulfillment / scheduling** | `fulfillment`, `setFulfillment`, `scheduledTime`, `setScheduledTime` | 4 | 71–74 |
| **Menu (categories + items)** | `categories`, `menuItems`, `addCategory`, `updateCategory`, `deleteCategory`, `addMenuItem`, `updateMenuItem`, `deleteMenuItem`, `reorderCategories` | 9 | 75–83 |
| **Customers** | `customers`, `addCustomer`, `updateCustomer` | 3 | 84, 87–88 |
| **Orders (on customers)** | `addOrder`, `updateOrderStatus`, `addRefund`, `spendStoreCredit` | 4 | 85–86, 125–126 |
| **Auth (customer)** | `currentUser`, `login`, `register`, `logout`, `refreshCurrentUser` | 5 | 89–92, 137 |
| **Favourites** | `toggleFavourite`, `isFavourite` | 2 | 93–94 |
| **Payment methods** | `updatePaymentMethod`, `togglePaymentMethod`, `reorderPaymentMethods` | 3 | 95–97 |
| **Delivery zones** | `addDeliveryZone`, `updateDeliveryZone`, `deleteDeliveryZone` | 3 | 98–100 |
| **Coupons** | `coupons`, `addCoupon`, `updateCoupon`, `deleteCoupon`, `toggleCoupon`, `appliedCoupon`, `applyCoupon`, `removeCoupon`, `incrementCouponUsage` | 9 | 101–109 |
| **Saved addresses** | `addSavedAddress`, `updateSavedAddress`, `deleteSavedAddress`, `setDefaultAddress` | 4 | 110–113 |
| **Drivers (admin CRUD)** | `drivers`, `addDriver`, `updateDriver`, `deleteDriver`, `toggleDriver` | 5 | 114, 119–122 |
| **Driver auth/session** | `currentDriver`, `driverLogin`, `driverLogout` | 3 | 115, 117–118 |
| **Driver dispatch** | `assignDriverToOrder`, `updateDeliveryStatus` | 2 | 123–124 |
| **Breakfast menu** | `updateBreakfastSettings`, `addBreakfastCategory`, `updateBreakfastCategory`, `deleteBreakfastCategory`, `reorderBreakfastCategories`, `addBreakfastItem`, `updateBreakfastItem`, `deleteBreakfastItem` | 8 | 128–135 |

**74 surface fields** is roughly 7× too many for a single context.

### 2.2 — Internal state (lines 438–463)

The provider holds these `useState` slots:

| State | Type | Line |
|---|---|---|
| `cart` (via `useReducer`) | `CartItem[]` | 438 |
| `settings` | `AdminSettings` | 441 |
| `categories` | `Category[]` | 444 |
| `menuItems` | `MenuItem[]` | 445 |
| `customers` | `Customer[]` | 446 |
| `customersRef` | `useRef<Customer[]>` | 449 |
| `drivers` | `Driver[]` | 452 |
| `currentUser` | `Customer \| null` | 453 |
| `currentDriver` | `Driver \| null` | 454 |
| `fulfillment` | `'delivery' \| 'collection'` | 455 |
| `scheduledTime` | `string \| null` | 456 |
| `appliedCoupon` | object | 457 |
| `isOpen` | boolean | 463 |

Plus `useEffect` blocks at lines [466, 470, 532, 534, 539, 546, 555, 633, 785](../app/src/context/AppContext.tsx#L466) — 9 effects in the provider. The big two are:
- **[470–530](../app/src/context/AppContext.tsx#L470)** — initial mount: restore localStorage caches for cart/driver/customer, validate sessions via `/api/auth/me` + `/api/auth/driver`.
- **[555–632](../app/src/context/AppContext.tsx#L555)** — initial Supabase load: settings + drivers + categories + menu_items + customers, with first-run seeding fallback for each table.
- **[633–784](../app/src/context/AppContext.tsx#L633)** — Supabase Realtime subscription: 150 lines of channel handling for categories, menu_items, orders, customers, drivers.

### 2.3 — Helpers defined inside the file (and not exported)

Pre-provider helpers (lines 31–428, ~400 lines):
- `mergeEmailTemplates` — settings-template merger
- `cartReducer` — pure reducer for cart state machine
- `isStoreOpen` — store-hours computation
- `validateCouponCode` — coupon eligibility logic
- `mapCategory` / `mapMenuItem` / `mapOrder` / `mapCustomer` — DB row → TS type mappers
- `categoryToRow` / `menuItemToRow` / `orderToRow` / `customerToRow` — TS type → DB row mappers
- `buildSettingsFromData` — settings hydration (~30 lines)
- 7 `DEFAULT_*` constants

These are **pure functions** wrongly co-located in the provider file. They cannot be unit-tested in isolation today.

### 2.4 — Consumer count

`useApp()` is called from at least the role pages (storefront, admin, account) plus Header/Footer, modals, and many admin panels. A safe estimate: **30+ consumer call sites** across the customer + admin tree. Every one of them re-renders on any state change anywhere in this provider.

## 3. POSContext.tsx — anatomy (719 lines)

### 3.1 — Surface area (lines 124–178)

POSContext exposes **39 fields/methods**. Grouped:

| Slice | Fields/methods | Count |
|---|---|---|
| **Auth** | `currentStaff`, `login`, `logout` | 3 |
| **Data (mirrors of DB tables)** | `staff` + setter, `products` + setter, `categories` + setter, `sales` + setter, `customers` + setter, `clockEntries` + setter, `settings` + setter | 14 |
| **Cart** | `cart`, `addToCart`, `updateCartQty`, `removeFromCart`, `clearCart`, `updateCartNote` | 6 |
| **Order context** | `discount` + setter, `tipAmount` + setter, `assignedCustomer` + setter | 6 |
| **Computed totals** | `subtotal`, `discountAmount`, `taxAmount`, `grandTotal` | 4 |
| **Actions** | `completeSale`, `voidSale`, `clockIn`, `clockOut`, `isClocked`, `receiptCounter` | 6 |
| **Storage management** | `salesRetentionDays`, `exportSales`, `purgeOldSales` | 3 |

**39 surface fields** — also too many but slightly more cohesive (everything is POS-related).

### 3.2 — Internal state (lines 271–303)

10 `useState` slots: `currentStaff`, `staff`, `products`, `categories`, `sales`, `customers`, `clockEntries`, `settings`, `cart`, `discount`, `tipAmount`, `assignedCustomer` + `useRef` for `receiptCounter`.

### 3.3 — `useEffect` hot list

- 8 persistence effects ([306–319](../app/src/context/POSContext.tsx#L306)): one per state slot, each writing to localStorage on change.
- Idle-timeout watchdog ([445–460](../app/src/context/POSContext.tsx#L445)) — 30-min inactivity → auto-logout.
- Menu sync to Supabase ([403–411](../app/src/context/POSContext.tsx#L403) — debounced).
- Realtime subscriptions for products + categories.

### 3.4 — Consumer count

15 `usePOS()` calls inside [pos/page.tsx](../app/src/app/pos/page.tsx) alone (verified via grep). Plus pos/login, pos/layout. POSReportsPanel does **not** use the context — it reads localStorage directly (a smell already flagged in 04-F2).

## 4. Findings

### 05-F1 — `AppContext` exposes 74 fields and behaves as the entire backend client
**Severity:** 🔴 Critical
**Evidence:** [AppContext.tsx:60–138](../app/src/context/AppContext.tsx#L60). 74 fields covering 17 distinct responsibility slices.
**Why it matters:**
- Every consumer subscribes to all 74. A keystroke into the cart triggers a re-render in every component that calls `useApp()` — 30+ consumer call sites.
- The "what does this thing own?" answer is "almost everything," which makes ownership unclear when adding features.
- Testing requires mocking 74 fields per test.
**Possible action:** Split into per-domain providers (sketch in §6).

### 05-F2 — Pure helpers are trapped inside the provider file
**Severity:** Medium-High
**Evidence:** ~400 lines of pure helpers ([31–428](../app/src/context/AppContext.tsx#L31)) — `cartReducer`, `isStoreOpen`, `validateCouponCode`, 4 `map*` mappers, 4 `*ToRow` mappers, `buildSettingsFromData`, `mergeEmailTemplates`, 7 `DEFAULT_*` objects.
**Why it matters:**
- These are testable units stuck inside an untestable file.
- DTO mappers belong in a `repositories/` or `services/` layer — they shouldn't sit next to React context plumbing.
- Cross-ref 02-F2 (already flagged) and 03-F15 (`isStoreOpen` / `validateCouponCode`).
**Possible action:** Move to:
```
features/cart/state/cartReducer.ts
features/coupons/lib/validate.ts
features/store-hours/lib/isStoreOpen.ts
features/menu/services/menu.repo.ts        (mapCategory, mapMenuItem, *ToRow)
features/orders/services/orders.repo.ts    (mapOrder, orderToRow)
features/customers/services/customers.repo.ts
features/settings/lib/build.ts             (buildSettingsFromData, mergeEmailTemplates, DEFAULT_*)
```

### 05-F3 — One useEffect mixes localStorage hydration, two session validations, and customer sync
**Severity:** Medium
**Evidence:** [AppContext.tsx:470–530](../app/src/context/AppContext.tsx#L470) — 60-line effect that reads `sg_cart`, `sg_driver_session`, `sg_current_user`, calls `/api/auth/driver`, calls `/api/auth/driver/me`, and calls `/api/auth/me`. Each of these is a separate concern.
**Why it matters:**
- One bug in the customer-restore branch can break driver-session restoration.
- Effect dependencies `[]` mean it never re-runs — fine for mount, but no recovery if a session expires mid-session.
- A future split into `CustomerAuthProvider` / `DriverSessionProvider` makes each effect 1/3 the size and obviously correct.
**Possible action:** Each session type owns its own provider with its own bootstrap effect.

### 05-F4 — Initial Supabase load + Realtime subscription are 230 lines of orchestration in one file
**Severity:** Medium
**Evidence:** [AppContext.tsx:555–784](../app/src/context/AppContext.tsx#L555) — `init()` loads settings, drivers, categories, menu items, customers (with first-run seeding); the Realtime channel handles 5 different table change events. All in one provider.
**Why it matters:**
- Realtime handlers reach into `setCategories`, `setMenuItems`, `setCustomers`, `setDrivers` — coupled to the megaprovider.
- Adding a new table for Realtime requires editing this 150-line `useEffect`.
- Each domain should own its own data fetcher + Realtime subscription.
**Possible action:** Once domains are split (per 05-F1), each provider runs its own load + Realtime subscription. Consider extracting a `useRealtimeTable<T>(table, mapper, dispatch)` hook.

### 05-F5 — Cart state is a self-contained reducer trapped in the megaprovider
**Severity:** Low (but easy fix, high clarity gain)
**Evidence:** `cartReducer` is a pure reducer ([46–56](../app/src/context/AppContext.tsx#L46)) used via `useReducer(cartReducer, [])` ([438](../app/src/context/AppContext.tsx#L438)). No dependency on any other AppContext state.
**Why it matters:** Cart is the textbook example of an isolatable provider. Splitting it out reduces re-renders dramatically — most consumers of `useApp()` don't care about cart, and the cart UI doesn't care about the rest of the app.
**Possible action:** First split — `features/cart/state/CartProvider.tsx` with `useCart()`. Low risk, high signal.

### 05-F6 — Admin-side concerns are mounted into the customer-side provider
**Severity:** Medium
**Evidence:** `AppContext` exposes admin CRUD: `addDriver`, `updateDriver`, `deleteDriver`, `addCategory`, `updateCategory`, `addMenuItem`, `updateMenuItem`, `addDeliveryZone`, `addCoupon`, etc. The customer storefront ships all of this code in its bundle.
**Why it matters:**
- Bundle size: customer-facing pages download admin mutation logic they never use.
- Permission boundaries: a bug exposing one of these handlers via the customer client could let unprivileged users call admin paths (server-side auth still gates the API, but client code shouldn't have these handlers at all).
- Cohesion: customer-facing context shouldn't know what `addDriver` is.
**Possible action:** Admin panels live inside [admin/page.tsx](../app/src/app/admin/page.tsx). Wrap admin-only state in an `AdminProvider` that mounts there. Customer site only gets `MenuProvider`/`OrdersProvider`/`CartProvider`/`AuthProvider` etc.

### 05-F7 — POSContext exposes raw `setState` setters, leaking ownership
**Severity:** Medium
**Evidence:** `setStaff`, `setProducts`, `setCategories`, `setSales`, `setCustomers`, `setClockEntries`, `setSettings`, `setDiscount`, `setTipAmount`, `setAssignedCustomer` — all `React.Dispatch<SetStateAction<...>>` ([130–157](../app/src/context/POSContext.tsx#L130)).
**Why it matters:**
- Any consumer can replace the entire staff list (or sales list, or customer list) with anything. There's no "what changed and why" boundary.
- Persistence (localStorage write) is decoupled from mutation logic — if a consumer calls `setSales(prev => [...prev])` to no-op, it still triggers a localStorage write.
- Refactors are paralysed: changing the data shape requires checking every callsite that destructures the setter.
**Possible action:** Replace setters with intent-named actions: `addStaff(...)`, `removeStaff(...)`, `setStaffActive(...)`, etc. Same shape `AppContext` already uses for menu items — just consistency.

### 05-F8 — POSContext mirrors DB tables that aren't authoritative locally (rooted in 04-F1)
**Severity:** Linked to 04-F1 — see Audit 04
**Evidence:** `staff`, `products`, `categories`, `customers`, `clockEntries` are all loaded from localStorage with `SEED_*` fallbacks. The provider treats localStorage as master.
**Why it matters:** Already covered in 04-F1. Calling out here so the context refactor and the data-source refactor are aware of each other.
**Possible action:** Refactor data sourcing first (Audit 04 actions), then refactor the context split — order matters.

### 05-F9 — Computed values (`subtotal`, `discountAmount`, `taxAmount`, `grandTotal`) are surfaced through context but should be derived
**Severity:** Low
**Evidence:** [POSContext.tsx:158–162](../app/src/context/POSContext.tsx#L158). Likely computed from `cart`, `discount`, `tipAmount`, `settings.taxRate`. Putting derived values on context means every change to the inputs re-renders all consumers of any of them.
**Why it matters:** Derived values can live in a `useMemo` inside the only component that needs them, or in a small `useCartTotals(cart, discount, tipAmount, settings)` hook. Context is the wrong home for purely derived state.
**Possible action:** Extract `features/pos/hooks/useCartTotals.ts`.

### 05-F10 — `customersRef` ref-mirror pattern signals tight coupling between Realtime callback and state
**Severity:** Low
**Evidence:** [AppContext.tsx:447–449,466,697](../app/src/context/AppContext.tsx#L447) — keeps a ref in sync with `customers` state because Realtime callbacks are stale-closure-prone.
**Why it matters:** This is a workaround for "useEffect callback closes over stale state". When the customers slice is its own provider with its own callbacks, the ref pattern is no longer needed.
**Possible action:** Drops out naturally during the split.

### 05-F11 — Both contexts use `null` sentinel + throw-on-missing pattern (positive note)
**Severity:** ⚠️ Positive
**Evidence:** [AppContext.tsx:140](../app/src/context/AppContext.tsx#L140) and [POSContext.tsx:180–187](../app/src/context/POSContext.tsx#L180): `createContext(null)` + `useApp()`/`usePOS()` throws if used outside provider.
**Why it matters:** This is a good pattern — keep it when splitting.

## 5. Re-render impact analysis

| Trigger | Components that re-render today | Components that should re-render |
|---|---|---|
| Add an item to cart | every `useApp()` consumer (~30+) | only cart-aware components |
| Admin updates a menu item | every `useApp()` consumer | menu-displaying components only |
| Customer logs in | every `useApp()` consumer | auth-aware components only |
| Realtime: order status changes | every `useApp()` consumer | account page + admin orders panel |
| POS adds line to cart | every `usePOS()` consumer (~15) | POS sale view only |

The actual perf cost depends on memoization in consumers, but the architectural cost is real: every team change has to think about every other slice.

## 6. Proposed split — concrete provider tree

### Customer site (replaces `AppContext`)

```
<AppRootProvider>                       # mounts only the slice each route needs
  <SettingsProvider>                    # admin settings, isStoreOpen, color theme
    <MenuProvider>                      # categories, menuItems, breakfast menu
      <CouponsProvider>                 # coupons, appliedCoupon, applyCoupon
        <CartProvider>                  # cart reducer + persistence (sg_cart)
          <FulfillmentProvider>         # fulfillment + scheduledTime
            <CustomerAuthProvider>      # currentUser, login, register, logout, refreshCurrentUser, favourites
              <CustomerOrdersProvider>  # addOrder, updateOrderStatus, addRefund, savedAddresses, spendStoreCredit
                {children}
```

### Admin shell (mounted only inside [admin/page.tsx](../app/src/app/admin/page.tsx))

```
<AdminProvider>
  <DriverManagementProvider>            # drivers + CRUD + dispatch
  <CustomerManagementProvider>          # customers, addCustomer, updateCustomer
  <DeliveryZoneProvider>
  <PaymentMethodAdminProvider>
  ...one provider per panel that has cross-page state...
```

### Driver app (driver/page.tsx)

```
<DriverAuthProvider>                    # currentDriver, driverLogin/Logout, validation
  {children}
```

### POS app (`POSContext` becomes 4 contexts)

```
<POSAuthProvider>                       # currentStaff, login/logout, idle timeout
  <POSDataProvider>                     # staff, products, categories, customers, clockEntries (DB-backed per Audit 04)
    <POSCartProvider>                   # cart, discount, tipAmount, assignedCustomer + actions
      <POSSalesProvider>                # sales, completeSale, voidSale, receiptCounter
        {children}
```

`subtotal`/`discountAmount`/`taxAmount`/`grandTotal` move to a `useCartTotals()` hook, not on context.

## 7. Severity summary

| Severity | IDs |
|---|---|
| 🔴 **Critical** | 05-F1 (AppContext god provider) |
| **Medium-High** | 05-F2 (helpers trapped in file) |
| **Medium** | 05-F3 (mixed bootstrap effect), 05-F4 (load + Realtime entanglement), 05-F6 (admin in customer provider), 05-F7 (POS exposes raw setters) |
| **Low** | 05-F5 (cart easy split — easy win), 05-F9 (totals on context), 05-F10 (customersRef workaround) |
| **Linked** | 05-F8 (depends on 04-F1) |
| ⚠️ **Positive** | 05-F11 (null-sentinel throw pattern is good) |

## 8. Recommended order of operations

When refactor phase begins, the lowest-risk path is:

1. **Extract pure helpers (05-F2).** Move mappers/reducers/validators to `features/.../{services,lib,state}/`. Provider keeps importing them — zero behavior change.
2. **Extract `CartProvider` (05-F5).** Smallest, most isolated split. Validates the pattern.
3. **Extract `CustomerAuthProvider` and `DriverSessionProvider` (05-F3, 05-F6 partial).** Carve auth out of the megaprovider.
4. **Extract `MenuProvider` + `SettingsProvider`.** Brings Realtime entanglement (05-F4) into a contained domain.
5. **Extract `AdminProvider` family (05-F6).** Move admin CRUD out of the customer bundle.
6. **POS context split (05-F7, 05-F9).** Do this *after* 04-F1 (data sources move to DB-master) — otherwise we're re-shaping the wrong contract.

## 9. Open questions for the user

1. Are you OK with multiple smaller contexts (the customer site would mount ~7 nested providers in its layout) versus one flatter solution? An alternative is one context + selector hooks (`useApp(s => s.cart)`) via Zustand or similar — different tradeoff: less nesting, but introduces a state library.
2. The driver app currently shares `AppContext` with the customer site. Is that intentional (drivers also browse menu / orders?) or accidental? Affects whether `DriverAuthProvider` lives inside or outside the customer tree.
3. Some admin pages (e.g. `OperationsPanel`'s branding card) already call `useApp()` to mutate `settings`. After the split, would you prefer (a) a unified `SettingsProvider` shared by customer + admin, or (b) admin uses its own `SettingsAdminProvider` that POSTs and revalidates the customer one? Affects 05-F6 boundary.

## 10. What's next

- This concludes **Phase 2 — State & data flow**.
- Next is **Phase 3 — Security**, beginning with Audit 06 (auth & authorization across all 67 API routes — particularly checking that `adminAuth.ts` / `waiterAuth.ts` / `auth.ts` are actually invoked at every gate).
