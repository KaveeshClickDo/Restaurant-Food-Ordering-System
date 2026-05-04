# Audit 04 — localStorage / sessionStorage Audit

**Phase:** 2 — State & data flow
**Date:** 2026-05-04
**Scope:** Every `localStorage` / `sessionStorage` read/write across [app/src/](../app/src/), classified by purpose and DB-backing fitness.
**Mode:** Read-only

---

## 1. Methodology

For each storage key I captured: where it is read, where it is written, what data type lives in it, whether the data is also persisted server-side, and what the failure mode is if the storage entry diverges from the DB.

Classification rubric:

| Classification | Meaning |
|---|---|
| ✅ **OK — UI/UX cache** | Pure UI preference or short-lived display state. Acceptable in browser storage. |
| ⚠️ **OK — offline-first cache** | Storage is a deliberate offline-first cache; DB is the eventual source of truth. Justified, but worth documenting. |
| 🟡 **Profile cache (PII)** | Holds personal information for stale-while-revalidate UX. Not a security boundary (auth is in httpOnly cookies), but plaintext PII in localStorage. |
| 🔴 **Should be DB-backed** | Business-critical data that lives only in the browser, or DB exists but the app reads from localStorage instead. |

**Total occurrences:** 25 calls across 7 files (matches Audit 03 §3-F preview).

## 2. Storage key inventory

### 2.1 — Customer site (`AppContext.tsx`, `app/layout.tsx`)

| Key | Type | Read | Written | Classification | Notes |
|---|---|---|---|---|---|
| `sg_cart` | `CartItem[]` | [AppContext.tsx:472](../app/src/context/AppContext.tsx#L472) | [AppContext.tsx:532](../app/src/context/AppContext.tsx#L532) (every cart change) | ✅ | Pre-checkout shopping cart. Belongs in browser storage — cart isn't a server resource until checkout. |
| `sg_color_theme` | CSS string | [AppContext.tsx:794](../app/src/context/AppContext.tsx#L794) (write), [app/layout.tsx:105](../app/src/app/layout.tsx#L105) (FOUC inline script) | [AppContext.tsx:794](../app/src/context/AppContext.tsx#L794) | ✅ | UI theme. Inline FOUC-prevention script reads it before React hydrates. Correct pattern. |
| `sg_current_user` | `Customer` (full profile incl. orders, addresses, favourites) | [AppContext.tsx:503](../app/src/context/AppContext.tsx#L503) | [AppContext.tsx:535](../app/src/context/AppContext.tsx#L535), cleared on logout [1183](../app/src/context/AppContext.tsx#L1183) | 🟡 | **Stale-while-revalidate cache.** Real auth is httpOnly cookie `customer_session` (verified via `/api/auth/me`). Local copy lets the account page render instantly on first click. **PII concern:** customer data including order history sits in plaintext localStorage forever. |
| `sg_driver_session` | `Driver` profile | [AppContext.tsx:474](../app/src/context/AppContext.tsx#L474) | [AppContext.tsx:495,540](../app/src/context/AppContext.tsx#L495), cleared [482,541,1375](../app/src/context/AppContext.tsx#L482) | 🟡 | Same pattern. Real auth is httpOnly cookie `driver_session`. The localStorage copy is a profile cache. The code already validates against `/api/auth/driver` and clears stale copies, which is good. |

### 2.2 — Waiter app (`waiter/page.tsx`)

| Key | Type | Read | Written | Classification | Notes |
|---|---|---|---|---|---|
| `waiter_session` (sessionStorage) | `WaiterStaff` profile | [waiter/page.tsx:789](../app/src/app/waiter/page.tsx#L789) | [waiter/page.tsx:853](../app/src/app/waiter/page.tsx#L853), removed [869](../app/src/app/waiter/page.tsx#L869) | 🟡 | Auth is httpOnly cookie `waiter_session` (same name, different storage layer). The sessionStorage copy is a UI cache. Difference vs. customer: `sessionStorage` clears on tab close — appropriate for a shared till device. |

### 2.3 — POS context (`POSContext.tsx`)

All accessed via private `load<T>(key, fallback)` / `save<T>(key, value)` helpers ([POSContext.tsx:194](../app/src/context/POSContext.tsx#L194) / [204](../app/src/context/POSContext.tsx#L204)).

| Key | Type | Read | Written | Classification | Notes |
|---|---|---|---|---|---|
| `pos_session` | `POSStaff \| null` | [273](../app/src/context/POSContext.tsx#L273) | [306](../app/src/context/POSContext.tsx#L306) | 🟡 | Profile cache. Real auth = httpOnly cookie `pos_staff_session`. |
| `pos_staff` | `POSStaff[]` | [276](../app/src/context/POSContext.tsx#L276) | [307](../app/src/context/POSContext.tsx#L307) | 🔴 | **Staff list is in DB** (admin manages waiters/kitchen staff via Supabase). This is a stale local mirror. Hiring/firing on admin won't reflect in POS until something refreshes the local copy. |
| `pos_products` | `POSProduct[]` | [279](../app/src/context/POSContext.tsx#L279) | [308](../app/src/context/POSContext.tsx#L308) | 🔴 | **Menu is in DB** (`menu_items` table). POS reads from localStorage and pushes to DB via `syncMenuToSupabase` ([220](../app/src/context/POSContext.tsx#L220)) — so localStorage is treated as the master and DB is the slave. Customer site uses DB. **Two sources of truth — guaranteed drift.** |
| `pos_categories` | `POSCategory[]` | [282](../app/src/context/POSContext.tsx#L282) | [309](../app/src/context/POSContext.tsx#L309) | 🔴 | Same problem as `pos_products`. |
| `pos_sales` | `POSSale[]` | [285](../app/src/context/POSContext.tsx#L285) | implicit via `purgeOldSales` [315](../app/src/context/POSContext.tsx#L315) | 🔴 / ⚠️ hybrid | **Critical.** Sale records (totals, payment method, line items, refund history) live primarily in localStorage. The outbox pushes a copy to `/api/pos/orders`, but the in-app source of truth for reports IS the localStorage copy. Sales pruned past 90 days from local. **If the device is wiped, local sales are gone unless they all sync'd successfully.** |
| `pos_customers` | `POSCustomer[]` | [288](../app/src/context/POSContext.tsx#L288) | [317](../app/src/context/POSContext.tsx#L317) | 🔴 | Customer DB exists. Local POS customers are a parallel set. **Two customer tables — drift inevitable.** PII (names, phones, totals) in plaintext storage. |
| `pos_clock` | `POSClockEntry[]` | [291](../app/src/context/POSContext.tsx#L291) | [318](../app/src/context/POSContext.tsx#L318) | 🔴 | **Time-clock entries for staff = payroll input.** Stored only in browser. Lost on device reset. Cannot be reconciled if disputed. |
| `pos_settings` | `POSSettings` | [296](../app/src/context/POSContext.tsx#L296) | [319](../app/src/context/POSContext.tsx#L319) | ⚠️ | Per-device POS preferences (printer, currency symbol, retention days). OK to be local — these are device-level. But some fields may overlap with admin-side `restaurant.settings`. |
| `pos_receipt_counter` | `number` | [303](../app/src/context/POSContext.tsx#L303) | [542](../app/src/context/POSContext.tsx#L542) | 🔴 | **Receipt sequence number.** If the device is wiped or replaced, the counter resets and could collide with previously-issued receipt numbers — audit/tax issue (HMRC-relevant in the UK). Should be DB-backed and atomic. |

### 2.4 — POS outbox (`lib/posOutbox.ts`)

| Key | Type | Read | Written | Classification | Notes |
|---|---|---|---|---|---|
| `pos_outbox` | `OutboxEntry[]` | [posOutbox.ts:34](../app/src/lib/posOutbox.ts#L34) | [posOutbox.ts:41](../app/src/lib/posOutbox.ts#L41) (multiple call sites) | ⚠️ | **This one is correct.** Offline-first sync queue: when the POS is offline, sales sit in `pos_outbox` until connectivity returns, then they POST to `/api/pos/orders` with retry/back-off. localStorage is the right home for an offline outbox. |

### 2.5 — Admin reports (`POSReportsPanel.tsx`)

| Key | Read | Classification | Notes |
|---|---|---|---|
| `pos_sales` | [POSReportsPanel.tsx:160,168](../app/src/components/admin/POSReportsPanel.tsx#L160) | 🔴 **Critical** | Admin POS reports load sales from the **same browser's localStorage**, not from `/api/admin/...`. Implies admin must be opened on the POS device. Open the admin page on a laptop while the POS runs on a tablet → reports show nothing. See 04-F2. |
| `pos_products` | [POSReportsPanel.tsx:161,169](../app/src/components/admin/POSReportsPanel.tsx#L161) | 🔴 | Same. |
| `pos_settings` | [POSReportsPanel.tsx:162](../app/src/components/admin/POSReportsPanel.tsx#L162) | 🟡 | Currency symbol read locally — only visual. |

## 3. Findings

### 04-F1 — POS treats localStorage as the master and Supabase as a slave (architectural inversion)
**Severity:** 🔴 Critical
**Evidence:** [POSContext.tsx:220–267](../app/src/context/POSContext.tsx#L220) — `syncMenuToSupabase(products, categories)` *pushes* the local menu to `/api/pos/menu`. Reads in [POSContext.tsx:278–283](../app/src/context/POSContext.tsx#L278) initialize from `pos_products` / `pos_categories` (localStorage) with `SEED_PRODUCTS` fallback. The customer site, in contrast, reads menu from Supabase via `AppContext`.
**Why it matters:**
- **Two writers, two sources of truth** for the menu. A waiter editing the menu in POS settings overwrites whatever admin had set; an admin updating the menu via [MenuManagementPanel](../app/src/components/admin/MenuManagementPanel.tsx) doesn't reach POS until the POS browser re-fetches.
- POS staff/customers/clock-entries also exist as parallel tables to admin-side data.
- Multi-device POS deployments are broken: each tablet has its own staff list, clock entries, customer list, and sale history.
**Possible action:**
- Treat Supabase as the source of truth for menu/customers/staff. Use localStorage only as an offline-first **read-through cache** with a clear invalidation story.
- Sales should write to DB first, fall back to outbox if offline (already exists for KDS push — apply the same pattern to the historical record).
- Receipt counters should be issued by the server (atomic increment).

### 04-F2 — Admin POS reports read from localStorage of the browser viewing them
**Severity:** 🔴 Critical
**Evidence:** [POSReportsPanel.tsx:160](../app/src/components/admin/POSReportsPanel.tsx#L160) and [:168](../app/src/components/admin/POSReportsPanel.tsx#L168) call `loadPOS<POSSale[]>("pos_sales", [])`, which returns `JSON.parse(localStorage.getItem("pos_sales"))`. There is no fetch to a `/api/admin/...` endpoint. The admin "reports" page shows whatever the current browser happens to have in `pos_sales`.
**Why it matters:**
- Restaurant owner opens admin on their phone → sees no sales (no `pos_sales` key on phone).
- Multiple POS terminals → each terminal's admin view shows only that terminal's sales.
- Cannot generate cross-device or historical reports beyond 90 days.
- Compliance: VAT returns / tax filings cannot be derived from this.
**Possible action:**
- Add `/api/admin/pos/sales?period=...` that reads from the `pos_sales` table (or wherever the outbox sends them). Make `POSReportsPanel` fetch from there.
- Cross-ref 02-F5 (POS analytics duplicated) — the consolidation should land in the same effort.

### 04-F3 — `pos_clock` (time-clock entries / payroll input) lives only in the browser
**Severity:** 🔴 Critical
**Evidence:** [POSContext.tsx:291](../app/src/context/POSContext.tsx#L291) reads `pos_clock`; [318](../app/src/context/POSContext.tsx#L318) writes it. No fetch to a server endpoint. Storage purge logic ([311–315](../app/src/context/POSContext.tsx#L311)) operates on `pos_sales` but I see no equivalent server push for clock entries. To verify in the API audit phase whether `/api/pos/clock` exists — none was found in the route inventory in Audit 01 §3.
**Why it matters:**
- Payroll evidence cannot be reconstructed if the device is wiped.
- Disputes ("did Sara work that shift?") have no server-side record.
- This is a workforce/legal risk, not just a UX issue.
**Possible action:**
- Push every clock-in/out event to a `staff_time_entries` table.
- Treat localStorage as a write-through cache only for offline resilience.

### 04-F4 — `pos_receipt_counter` should not be browser-local
**Severity:** 🔴 High
**Evidence:** [POSContext.tsx:303](../app/src/context/POSContext.tsx#L303): `useRef(load<number>("pos_receipt_counter", 1000))`; written at [542](../app/src/context/POSContext.tsx#L542).
**Why it matters:**
- Receipt numbers are an audit trail. UK HMRC and most other tax regimes require non-repeating, sequentially-issued receipt numbers. A wiped device that resets to 1000 and re-issues numbers that were already issued previously is an accounting issue.
- Multi-device deployments will collide receipt numbers (each device starts at 1000).
**Possible action:**
- Issue numbers from a server-side counter (Postgres sequence or `RETURNING` from an insert). Pre-allocate a small range to each device for offline use.

### 04-F5 — `pos_customers` is a parallel customer database
**Severity:** 🔴 High
**Evidence:** [POSContext.tsx:288](../app/src/context/POSContext.tsx#L288). Customer site uses Supabase `customers` table; POS uses `pos_customers` localStorage with `SEED_CUSTOMERS` fallback.
**Why it matters:**
- A customer who orders online and then walks in is a different person to the system.
- Loyalty / credit balances diverge.
- PII duplicated across systems = harder GDPR deletion.
**Possible action:**
- Single `customers` table. POS reads via a thin endpoint. Local cache OK for offline lookup, but writes go to DB.

### 04-F6 — `pos_staff`, `pos_categories`, `pos_products` are parallel datasets too
**Severity:** 🔴 Medium-High
**Evidence:** [POSContext.tsx:276,279,282](../app/src/context/POSContext.tsx#L276). Already covered conceptually by 04-F1 but called out as the concrete keys.
**Why it matters:** Same drift issues as 04-F1/04-F5 at smaller scope.
**Possible action:** Same pattern — server is master, localStorage is offline cache.

### 04-F7 — Customer profile cache (`sg_current_user`) holds order history + addresses in plaintext
**Severity:** 🟡 Medium (privacy, not security)
**Evidence:** [AppContext.tsx:503](../app/src/context/AppContext.tsx#L503): `JSON.parse(localStorage.getItem("sg_current_user"))` cast to `Customer`. The `Customer` type ([types/index.ts](../app/src/types/index.ts)) likely includes `orders[]`, `addresses[]`, `favourites[]`, `phone`, `email` based on usage in [account/page.tsx](../app/src/app/(site)/account/page.tsx).
**Why it matters:**
- Auth is in httpOnly cookies (good). But shared/lost devices with active sessions expose PII via DevTools → Application → localStorage.
- Order history accumulates indefinitely (no eviction).
- A user logging out clears it — but a user closing the browser without logging out leaves it.
**Possible action:**
- Cache only minimal display fields (`id`, `firstName`, `email`) in localStorage — fetch the rest from `/api/auth/me` on demand.
- Or move to an in-memory cache only and accept a brief loading spinner on first account-page render.

### 04-F8 — `sg_driver_session` follows the same pattern, with active validation (positive note)
**Severity:** 🟡 Low (already partially mitigated)
**Evidence:** [AppContext.tsx:478](../app/src/context/AppContext.tsx#L478): after restoring `currentDriver` from localStorage, the code immediately calls `/api/auth/driver` and clears the local copy if the cookie is invalid. [AppContext.tsx:490](../app/src/context/AppContext.tsx#L490): if no localStorage but cookie is valid, it fetches driver via `/api/auth/driver/me` and writes localStorage to bootstrap.
**Why it matters:** This is the *correct* stale-while-revalidate flow. The customer-side `sg_current_user` follows a similar pattern (see [507](../app/src/context/AppContext.tsx#L507)). Worth keeping as a model for other caches.
**Possible action:** None for the security side — but trim what's cached (see 04-F7).

### 04-F9 — `waiter_session` in sessionStorage is appropriate but stale-merge logic is missing
**Severity:** 🟡 Low
**Evidence:** [waiter/page.tsx:789](../app/src/app/waiter/page.tsx#L789): on mount, restores waiter from sessionStorage. Unlike `AppContext.tsx`, **there is no follow-up call to `/api/auth/me`-equivalent** to verify the cookie is still valid.
**Why it matters:** If the cookie expires while the tab is open, the UI continues to act as if the waiter is logged in until they trigger a request that returns 401. Better UX is to verify session at the same time the local copy is restored.
**Possible action:** Add a verification call (whatever the waiter equivalent of `/api/auth/me` is — possibly a new `GET /api/waiter/me` endpoint) to mirror the customer flow.

### 04-F10 — `pos_outbox` is correctly scoped (positive finding)
**Severity:** ⚠️ None (positive)
**Evidence:** [posOutbox.ts](../app/src/lib/posOutbox.ts) — clean offline-first queue with idempotency (409 = already exists), exponential back-off, and capped retries. localStorage is the right home for this concern.
**Why it matters:** When refactoring 04-F1, do **not** remove this; instead, model the rest of the POS sync after it.
**Possible action:** No action — keep as a reference pattern.

### 04-F11 — `load`/`save` helpers swallow `QuotaExceededError` silently in places
**Severity:** Low
**Evidence:** [POSContext.tsx:204–215](../app/src/context/POSContext.tsx#L204) does log a `console.warn` and tells the user to export. [posOutbox.ts:40–42](../app/src/lib/posOutbox.ts#L40) does **not** — it can throw. [POSReportsPanel.tsx:13–17](../app/src/components/admin/POSReportsPanel.tsx#L13) catches everything silently.
**Why it matters:** Inconsistent error handling. Once 04-F1–F4 are addressed, `pos_sales` won't grow unbounded and quota errors become rare, but currently quota issues can swallow a sale write without surfacing to the user.
**Possible action:** When DB-backing the sales pipeline, this concern goes away.

### 04-F12 — No `localStorage` used for true UI-only preferences beyond `sg_color_theme`
**Severity:** Informational
**Evidence:** Sidebar collapsed state, kitchen station selection, tab choices — none persist across reloads (a quick scan of the role pages showed no UI-pref keys). Either the app doesn't need persistence here, or persistence is missing.
**Why it matters:** Worth confirming with the user whether some UI prefs *should* persist (e.g. waiter's last selected table section, kitchen station filter) — those would be legitimate localStorage candidates.

## 4. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🔴 **Critical** | 04-F1, 04-F2, 04-F3 | POS treats localStorage as master; admin reports & payroll data unreachable across devices |
| 🔴 **High** | 04-F4 (receipt counter), 04-F5 (parallel customer DB) | Audit/compliance + data integrity |
| 🔴 **Medium-High** | 04-F6 (parallel staff/menu data) | |
| 🟡 **Medium** | 04-F7 (PII in plaintext localStorage) | |
| 🟡 **Low** | 04-F8 (driver session cache — already correct), 04-F9 (waiter session no validation), 04-F11 (quota error handling) | |
| ⚠️ **Positive** | 04-F10 (outbox is exemplary) | |
| **Info** | 04-F12 | |

## 5. The big picture

The system has **two distinct data-layer patterns** that should be unified:

```
Customer site:                            POS app:
  Browser ↔ Supabase (master)               Browser localStorage (master)
                                              ↓ sync
                                            Supabase (slave/copy)
```

Both should be:
```
  Browser localStorage (offline cache) ↔ Supabase (master)
                                          ↑
                                       Outbox (offline writes)
```

This is the single most impactful change implied by Audit 04. It touches Audits 02 (god files), 03 (duplicate analytics), and the upcoming Phase 3 security review (04-F7 PII concerns).

## 6. Reclassification table — what to do per key

| Key | Current | Target |
|---|---|---|
| `sg_cart` | ✅ keep | ✅ keep |
| `sg_color_theme` | ✅ keep | ✅ keep |
| `sg_current_user` | 🟡 PII profile cache | Trim to `id`+`firstName`, fetch rest from server |
| `sg_driver_session` | 🟡 PII cache, validated | Trim same as above |
| `waiter_session` (session) | 🟡 cache, no validation | Add validation call on restore |
| `pos_session` | 🟡 cache | Trim or remove; cookie alone is sufficient |
| `pos_staff` | 🔴 parallel DB | Read-through cache only |
| `pos_products` | 🔴 master | Cache; DB is master |
| `pos_categories` | 🔴 master | Cache; DB is master |
| `pos_sales` | 🔴 master + 90-day local cap | Cache; DB is master; outbox for offline writes |
| `pos_customers` | 🔴 parallel DB | Read-through cache only |
| `pos_clock` | 🔴 only here | DB-backed, write-through cache |
| `pos_settings` | ⚠️ per-device | Keep local for device prefs; sync shared bits |
| `pos_receipt_counter` | 🔴 device-local | Server-issued (Postgres sequence) |
| `pos_outbox` | ⚠️ correct | Keep as reference pattern |

## 7. Open questions for the user

1. **POS deployment model:** is this app meant to run on (a) one tablet per restaurant where admin is also accessed from the same device, or (b) multiple POS terminals + admin on a separate laptop? The fix shape for 04-F2 depends on this.
2. **Receipt numbering:** what jurisdiction's tax rules apply? UK HMRC requires non-repeating sequential receipt IDs — that constraint sets the bar for 04-F4.
3. **Time clock:** is staff time-tracking actually used, or is `pos_clock` a feature that was scaffolded but not relied upon? Affects 04-F3 priority.
4. **Customer overlap:** are POS walk-in customers and online customers meant to be the same records (loyalty across channels) or deliberately separate? Affects 04-F5 fix shape.

## 8. What's next

- **Audit 05 — Context bloat** ([05-context-bloat.md](./05-context-bloat.md), pending). Will revisit 02-F2's god provider claim and break down `AppContext.tsx` (1,504 lines, 32 fetches) and `POSContext.tsx` (719 lines) by responsibility, so we have a concrete split plan.
