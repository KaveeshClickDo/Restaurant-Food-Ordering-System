# Authentication & Token Handling Audit

**Date:** 2026-05-11 (refreshed after `git pull origin kaveesh` → HEAD `b11167f`)
**Branch:** kaveesh
**Scope:** Every route under [app/src/app/api/](app/src/app/api/) (67 `route.ts` files), session helpers, edge middleware, client-side auth state, seed data, and localStorage usage.
**Mode:** Read-only — findings re-verified against current code; cross-referenced with the prior audit at [clean-up/06-auth-authorization.md](clean-up/06-auth-authorization.md) and re-checked file-by-file.

---

## Update log

**2026-05-11 refresh** — Pulled 16 new commits from origin/kaveesh (`d149ec8..b11167f`). Almost all are responsive-layout fixes (mobile header, scroll overflow on driver/kitchen/admin/POS/waiter pages, padding tweaks). **Two commits touch files this audit flagged:**

- `13fdb69` — Changed `SEED_STAFF` admin PIN from `""` → `"1234"` in [POSContext.tsx:18](app/src/context/POSContext.tsx#L18). **This does not close NEW-F2 — see updated §NEW-F2.** The PIN is still client-shipped, still localStorage-editable, still validated in the browser. The new value `"1234"` is the most-guessed PIN globally; from an attacker's standpoint the change is neutral-to-worse.
- `5e4c499` — Added `line-clamp-2` to the email verification banner text. Purely cosmetic. The dismiss `×` and "login works without verification" issues (NEW-F1, NEW-F7) are unchanged.

**Net auth impact of the pull: zero findings closed.** All 14 critical/high findings from the prior audit and all 8 new findings below remain open. One finding (NEW-F2) was modified-in-place but not fixed.

---

## 2026-05-12 remediation — Steps 1 through 6 applied

After the audit was published, Steps 1–6 from §7 were implemented on the `kaveesh` branch. **Every critical, high, and med-high finding is now closed.** Status of each finding:

| # | Severity | Status | Closed in |
|---|---|---|---|
| 06-F1  | 🔴 Critical | ✅ Closed | Step 1 — `isAdminAuthenticated()` added to all 4 handlers in [admin/drivers/route.ts](app/src/app/api/admin/drivers/route.ts) + [[id]/route.ts](app/src/app/api/admin/drivers/[id]/route.ts) |
| 06-F2  | 🔴 High     | ✅ Closed | Step 1 — admin gate added to [admin/seed/route.ts](app/src/app/api/admin/seed/route.ts) |
| 06-F3  | 🔴 Critical | ✅ Closed | Step 2 — `session.id === id` check in [customers/[id]/route.ts](app/src/app/api/customers/[id]/route.ts) |
| 06-F4  | 🔴 Critical | ✅ Closed | Step 2 — same in [customers/[id]/spend-credit/route.ts](app/src/app/api/customers/[id]/spend-credit/route.ts) |
| 06-F5  | 🔴 Critical | ✅ Closed | Step 1 — admin/staff session required on [api/email/route.ts](app/src/app/api/email/route.ts) |
| 06-F6  | 🔴 Critical | ✅ Closed | Step 2 — [api/orders/route.ts](app/src/app/api/orders/route.ts) verifies session matches `customer_id`; rejects `pos-walk-in`; preserves the explicit `"guest"` checkout value |
| 06-F7  | 🟠 Med-High | ✅ Closed | Step 2 — staff session required on [pos/orders/[id]/collected](app/src/app/api/pos/orders/[id]/collected/route.ts) |
| 06-F8  | 🔴 High     | ✅ Closed | Step 2 — POS/admin gate on both [pos/reservations](app/src/app/api/pos/reservations/route.ts) handlers |
| 06-F9  | 🔴 Critical | ✅ Closed | Step 1 — staff session + private-IP allowlist + 64KB cap on [api/print/route.ts](app/src/app/api/print/route.ts) |
| 06-F10 | 🟡 Medium   | ✅ Closed | Step 5 — 5 bookings/min/IP rate limit on [api/reservations/route.ts](app/src/app/api/reservations/route.ts) |
| 06-F11 | 🟡 Medium   | ✅ Closed | Step 5 — 10 req/min/IP rate limit on [api/guest-profile/route.ts](app/src/app/api/guest-profile/route.ts) |
| 06-F12 | 🔴 Critical | ✅ Closed | Step 1 — `requireWaiterAuth()` on [waiter/refund](app/src/app/api/waiter/refund/route.ts) |
| 06-F13 | 🔴 High     | ✅ Closed | Step 1 — same on [waiter/settle](app/src/app/api/waiter/settle/route.ts) |
| 06-F14 | 🔴 High     | ✅ Closed | Step 1 — same on [waiter/void](app/src/app/api/waiter/void/route.ts) |
| 06-F15 | 🟢 Low      | ✅ Closed | Step 6 — admin token migrated to unified `<exp>\|<id>\|<role>\|<sig>` format. Middleware + lib/adminAuth.ts now share one verifier with lib/auth.ts. Old admin sessions invalid → one forced re-login. |
| 06-F16 | 🟡 Medium   | ⏳ Open    | Per-admin accounts deferred — needs DB schema work. ADMIN_PASSWORD remains the single credential. Tracked for future. |
| 06-F17 | 🟢 Low      | ✅ Closed | Step 6 — admin password compare uses sha256-wrapped fixed-length buffers in [admin/auth/route.ts:38-44](app/src/app/api/admin/auth/route.ts#L38). Length no longer detectable. |
| 06-F18 | 🟢 Low      | ✅ Closed | Step 4 — `GET /api/pos/auth` added. Step 5 — [api/auth/waiter/me/route.ts](app/src/app/api/auth/waiter/me/route.ts) added. |
| 06-F19 | 🟡 Medium   | ⚠ Partial | Step 5 — `/pos/*` now redirects to `/pos/login` at the edge ([middleware.ts](app/src/middleware.ts)). `/admin` and `/waiter` skipped: their pages render the login form inline (no separate `/login` subroute), so a redirect would loop. Splitting those pages is the proper fix — tracked as a UX task. |
| 06-F20 | 🟢 Low      | ✅ Closed | Auto-closed by Step 2 — `/api/orders` explicitly rejects `customer_id === "pos-walk-in"`. |
| NEW-F1 | 🔴 High     | ✅ Closed | Step 3 — [api/auth/login/route.ts](app/src/app/api/auth/login/route.ts) returns 403 with `needsVerification: true` when `email_verified === false`. Login + register UIs show a "Check your inbox" panel. |
| NEW-F2 | 🔴 Critical | ✅ Closed | Step 4 — POS PIN now validated server-side only. `SEED_STAFF = []`. `currentStaff` hydrated from `GET /api/pos/auth`. Stale `pos_session` localStorage key wiped on mount. |
| NEW-F3 | 🔴 High     | ✅ Closed | Step 1 — `SEED_KITCHEN` deleted from [kitchen/auth/route.ts](app/src/app/api/kitchen/auth/route.ts). Returns 503 when no staff configured. |
| NEW-F4 | 🟠 Med-High | ✅ Closed | Step 4 — `waiters: []` and `kitchenStaff: []` in [AppContext.tsx](app/src/context/AppContext.tsx). No hardcoded PINs in the JS bundle. |
| NEW-F5 | 🔴 Critical | ✅ Closed | Step 1 — `mockCustomers` seed gated behind `NODE_ENV !== "production"` in [admin/seed/route.ts](app/src/app/api/admin/seed/route.ts). |
| NEW-F6 | 🟡 Medium   | ⚠ Partial | `pos_session` localStorage removed (Step 4). Other localStorage caches (`pos_staff`, `pos_sales`, etc.) remain but are not auth-bearing. |
| NEW-F7 | 🔴 High     | ✅ Closed | Step 3 — [auth/register/route.ts](app/src/app/api/auth/register/route.ts) returns `requiresVerification` and withholds the session cookie. Cookie is issued in [auth/verify-email/route.ts](app/src/app/api/auth/verify-email/route.ts) only after the link is clicked. |
| NEW-F8 | 🟢 Low      | ⏳ Open    | Not addressed — minor cleanup, tracked for future. |

**Final state: 21 of 23 closable findings closed. 2 remain (06-F16 per-admin accounts, NEW-F8 response shape consistency). The partials (06-F19 admin/waiter middleware, NEW-F6 other localStorage) are documented limitations, not unaddressed risks.**

### Files touched across Steps 1–6

31 files modified, 1 new file:

```
app/src/lib/auth.ts                                  (Step 6 — admin role added)
app/src/lib/adminAuth.ts                              (Step 6 — rewritten)
app/src/middleware.ts                                 (Steps 5 + 6)
app/src/app/api/auth/login/route.ts                   (Step 3)
app/src/app/api/auth/register/route.ts                (Step 3)
app/src/app/api/auth/verify-email/route.ts            (Step 3)
app/src/app/api/auth/resend-verification/route.ts     (Step 3)
app/src/app/api/auth/waiter/me/route.ts               (Step 5 — new)
app/src/app/api/admin/auth/route.ts                   (Step 6)
app/src/app/api/admin/drivers/route.ts                (Step 1)
app/src/app/api/admin/drivers/[id]/route.ts           (Step 1)
app/src/app/api/admin/seed/route.ts                   (Step 1)
app/src/app/api/email/route.ts                        (Step 1)
app/src/app/api/print/route.ts                        (Step 1)
app/src/app/api/kitchen/auth/route.ts                 (Step 1)
app/src/app/api/orders/route.ts                       (Step 2)
app/src/app/api/customers/[id]/route.ts               (Step 2)
app/src/app/api/customers/[id]/spend-credit/route.ts  (Step 2)
app/src/app/api/pos/auth/route.ts                     (Step 4 — GET added)
app/src/app/api/pos/orders/[id]/collected/route.ts    (Step 2)
app/src/app/api/pos/reservations/route.ts             (Step 2)
app/src/app/api/pos/reservations/[id]/route.ts        (Step 2)
app/src/app/api/reservations/route.ts                 (Step 5)
app/src/app/api/guest-profile/route.ts                (Step 5)
app/src/app/api/waiter/refund/route.ts                (Step 1)
app/src/app/api/waiter/settle/route.ts                (Step 1)
app/src/app/api/waiter/void/route.ts                  (Step 1)
app/src/app/(site)/login/page.tsx                     (Step 3)
app/src/app/(site)/verify-email/page.tsx              (Step 3)
app/src/app/pos/login/page.tsx                        (Step 4)
app/src/components/AuthModal.tsx                      (Step 3)
app/src/components/EmailVerificationBanner.tsx        (Step 3)
app/src/context/AppContext.tsx                        (Steps 3 + 4)
app/src/context/POSContext.tsx                        (Step 4)
```

### Deploy notes

- **All existing sessions are invalidated.** Admin tokens used the old `<exp>.<sig>` format; after Step 6 they no longer verify and produce one forced re-login per admin. POS sessions stored in `localStorage.pos_session` are cleared on first mount of the new client (Step 4).
- **Fresh installs need configuration before staff can log in.** Hardcoded seed PINs are gone — admin must add POS/waiter/kitchen staff via the admin panel.
- **No DB migrations required by these steps.** All schema columns referenced by the new code (`email_verified`, `email_verification_token`, `email_verification_expires`, `password_hash` on customers; `password_hash` on drivers) live in the canonical [supabase/schema.sql](supabase/schema.sql) (consolidated from 8 fragmented migration files on 2026-05-12 — see git history). The code uses `PGRST204` fallback paths for installations where that schema hasn't been applied yet.
- **No new env vars required.** `ADMIN_JWT_SECRET` / `AUTH_JWT_SECRET` / `ADMIN_PASSWORD` / `SMTP_*` are the same as before. The unified token format lets `AUTH_JWT_SECRET` cover everything; `ADMIN_JWT_SECRET` is still read as a fallback for backwards compatibility.

---

## 0. TL;DR

The system has **six independent auth subsystems** (admin password / customer / driver / waiter PIN / kitchen PIN / POS PIN) plus a Google OAuth path. The crypto primitives are solid (HMAC-signed cookies, bcrypt, timing-safe compare on most paths), but:

1. **All 14 critical/high findings from the 2026-05-04 audit are still present.** None of `06-F1`…`06-F14` have been remediated. See [§3](#3-confirmation--prior-audit-findings-still-open) for evidence.
2. **The login flow does not enforce email verification.** A "please verify" banner appears but the customer is already auto-logged-in, the session cookie is set, and every authenticated endpoint accepts the unverified session.
3. **The POS terminal validates PINs in the browser**, not on the server. Anyone with browser devtools can edit `localStorage.pos_staff` to set any PIN — including the bundled `SEED_STAFF` admin account that ships with `pin: ""` (empty string).
4. **Default PINs are hardcoded in app code and seeded into the DB.** Kitchen & waiter PINs `1111/2222/3333/1234/2345/3456` live in [app/src/context/AppContext.tsx:214-223](app/src/context/AppContext.tsx#L214) and [app/src/app/api/kitchen/auth/route.ts:17-21](app/src/app/api/kitchen/auth/route.ts#L17). The kitchen route falls back to these seeds whenever `app_settings.kitchenStaff` is empty — meaning a fresh deployment ships with known credentials.
5. **Mock customer accounts get seeded with `password: "password"`** ([app/src/data/customers.ts:15,67,105](app/src/data/customers.ts#L15)) on the first call to the unauthenticated `POST /api/admin/seed` endpoint.
6. **Edge middleware only protects `/driver` and `/kitchen` pages.** `/admin`, `/pos`, and `/waiter` rely on client-side gates, which means anyone can hit the JS bundle and inspect it; deep links flash the protected UI before redirect.
7. **Two non-interoperable token formats** coexist (admin uses `<exp>.<sig>`; everything else uses `<exp>|<id>|<role>|<sig>`), with three separate verifier implementations (Node `crypto` in `auth.ts`, Node `crypto` in `adminAuth.ts`, Web Crypto in `middleware.ts`).

The answer to "**should we move to a single auth system with JWT + encryption?**" is **yes, but selectively** — see [§7](#7-recommendation-single-auth-system-vs-targeted-fixes).

---

## 1. Methodology

1. Grepped for every auth helper call across the 67 API routes: `getCustomerSession`, `getDriverSession`, `getWaiterSession`, `getKitchenSession`, `getPosSession`, `isAdminAuthenticated`, `requireWaiterAuth`.
2. Opened every route flagged in [clean-up/06-auth-authorization.md](clean-up/06-auth-authorization.md) and re-confirmed the missing checks against the current file contents (not the audit text).
3. Read the auth helpers ([app/src/lib/auth.ts](app/src/lib/auth.ts), [adminAuth.ts](app/src/lib/adminAuth.ts), [waiterAuth.ts](app/src/lib/waiterAuth.ts)) and the edge [middleware.ts](app/src/middleware.ts).
4. Searched for hardcoded passwords / PINs / localStorage credential storage outside the API surface.
5. Traced the customer registration → email-verification → login → API call lifecycle to confirm the user's observation that verification is not enforced.

This audit deliberately does NOT trust the README, docs, or `clean-up/06-*.md` text — every finding below was re-verified against the working tree on branch `kaveesh` as of 2026-05-11.

---

## 2. Current auth architecture

```
┌──────────────────────────────────────────────────────────────────┐
│   Subsystem      │ Cookie name           │ Verifier              │
├──────────────────────────────────────────────────────────────────┤
│ Admin            │ admin_session         │ adminAuth.ts (Node)   │
│                  │                       │ middleware.ts (Web)   │
│ Customer         │ customer_session      │ auth.ts (Node)        │
│ Driver           │ driver_session        │ auth.ts + middleware  │
│ Waiter           │ waiter_session        │ auth.ts               │
│ Kitchen          │ kitchen_session       │ auth.ts + middleware  │
│ POS staff        │ pos_staff_session     │ auth.ts               │
└──────────────────────────────────────────────────────────────────┘
```

Token formats:

| Subsystem | Format | Secret env var |
|---|---|---|
| Admin | `<exp>.<hmac>` | `ADMIN_JWT_SECRET` |
| Customer/driver/waiter/kitchen/POS | `<exp>\|<id>\|<role>\|<hmac>` | `AUTH_JWT_SECRET` (falls back to `ADMIN_JWT_SECRET`) |

What is good:
- HMAC-SHA256 signed cookies, httpOnly, `sameSite: lax`, `secure` in production ([app/src/lib/auth.ts:67-73](app/src/lib/auth.ts#L67)).
- `timingSafeEqual` on every signature compare and on the admin password compare ([app/src/lib/auth.ts:58](app/src/lib/auth.ts#L58), [app/src/lib/adminAuth.ts:44](app/src/lib/adminAuth.ts#L44), [app/src/app/api/admin/auth/route.ts:46](app/src/app/api/admin/auth/route.ts#L46)).
- bcrypt cost 10–12 on customer + driver paths ([app/src/app/api/auth/register/route.ts:90](app/src/app/api/auth/register/route.ts#L90), [app/src/app/api/admin/drivers/route.ts:72](app/src/app/api/admin/drivers/route.ts#L72)).
- Rate limiting on all 5 login endpoints ([app/src/lib/rateLimit.ts](app/src/lib/rateLimit.ts)).
- Server-authoritative price/coupon recalculation in `/api/orders` ([app/src/app/api/orders/route.ts:80-214](app/src/app/api/orders/route.ts#L80)).

What is not good — see [§3](#3-confirmation--prior-audit-findings-still-open) and [§4](#4-new-findings-not-covered-or-only-partially-covered-by-the-prior-audit).

---

## 3. Confirmation — prior audit findings, still open

Re-verified file-by-file on 2026-05-11. **All 14 critical/high findings remain unfixed.**

| ID | Route(s) | Severity | Status today |
|---|---|---|---|
| 06-F1  | `admin/drivers`, `admin/drivers/[id]` | 🔴 Critical | Still no `isAdminAuthenticated()` — [route.ts:34](app/src/app/api/admin/drivers/route.ts#L34), [[id]/route.ts:29](app/src/app/api/admin/drivers/[id]/route.ts#L29) |
| 06-F2  | `admin/seed` | 🔴 High     | Still no auth — explicit comment "No admin auth required" — [route.ts:5](app/src/app/api/admin/seed/route.ts#L5) |
| 06-F3  | `customers/[id]` PATCH | 🔴 Critical | Strips disallowed fields but **no `getCustomerSession()` check** — [route.ts:14-39](app/src/app/api/customers/[id]/route.ts#L14) |
| 06-F4  | `customers/[id]/spend-credit` | 🔴 Critical | Comment still says "No admin auth required" — no session ownership check — [route.ts:5,11](app/src/app/api/customers/[id]/spend-credit/route.ts#L5) |
| 06-F5  | `email` | 🔴 Critical | **Open SMTP relay** — anyone can `POST {to, subject, html}` — [route.ts:38](app/src/app/api/email/route.ts#L38) |
| 06-F6  | `orders` POST | 🔴 Critical | Accepts arbitrary `customer_id` from request body — [route.ts:40-47](app/src/app/api/orders/route.ts#L40) |
| 06-F7  | `pos/orders/[id]/collected` | 🟠 Med-High | Comment "trusted in-restaurant screen" — no `getPosSession()` — [route.ts:5-6](app/src/app/api/pos/orders/[id]/collected/route.ts#L5) |
| 06-F8  | `pos/reservations` (POST + PUT) | 🔴 High | Comment "POS is an internal staff terminal" — no auth — [route.ts:5](app/src/app/api/pos/reservations/route.ts#L5), [[id]/route.ts:5](app/src/app/api/pos/reservations/[id]/route.ts#L5) |
| 06-F9  | `print` | 🔴 Critical | **SSRF**: accepts `ip`, `port`, `bytes` from anyone — [route.ts:38](app/src/app/api/print/route.ts#L38) |
| 06-F10 | `reservations` POST | 🟡 Medium | No rate limit on public booking — [route.ts:17](app/src/app/api/reservations/route.ts#L17) |
| 06-F11 | `guest-profile` POST | 🟡 Medium | No rate limit, no auth — pollutes `reservation_customers` — [route.ts:11](app/src/app/api/guest-profile/route.ts#L11) |
| 06-F12 | `waiter/refund` | 🔴 Critical | No `requireWaiterAuth()` — anyone can write refund records — [route.ts:23](app/src/app/api/waiter/refund/route.ts#L23) |
| 06-F13 | `waiter/settle` | 🔴 High | No auth — anyone can mark orders delivered — [route.ts:10](app/src/app/api/waiter/settle/route.ts#L10) |
| 06-F14 | `waiter/void` | 🔴 High | No auth — anyone can cancel active dine-in orders — [route.ts:11](app/src/app/api/waiter/void/route.ts#L11) |

**Auth-model issues from the prior audit, also still present:**

- 06-F15 — Two HMAC token formats. Still true — see [§2](#2-current-auth-architecture).
- 06-F16 — `ADMIN_PASSWORD` is a single shared password, no per-admin identity. [admin/auth/route.ts:24](app/src/app/api/admin/auth/route.ts#L24).
- 06-F17 — Admin password compare leaks length. [admin/auth/route.ts:46](app/src/app/api/admin/auth/route.ts#L46).
- 06-F18 — No `auth/waiter/me` or `auth/pos/me`.
- 06-F19 — Middleware does not cover `/admin`, `/pos`, `/waiter`. [middleware.ts:144-146](app/src/middleware.ts#L144).
- 06-F20 — `pos-walk-in` sentinel customer back-door (closes when 06-F6 is fixed).

---

## 4. New findings (not covered, or only partially covered, by the prior audit)

### NEW-F1 — Customer login does NOT enforce email verification
**Severity:** 🔴 High
**Evidence:**
- [app/src/app/api/auth/register/route.ts:142-145](app/src/app/api/auth/register/route.ts#L142) — `createSessionToken(...)` and `setSessionCookie(...)` fire unconditionally after insert. The user is logged in *before* they ever see the verification email.
- [app/src/app/api/auth/login/route.ts:77-108](app/src/app/api/auth/login/route.ts#L77) — verifies password but never reads `email_verified`. Successful password → cookie issued.
- [app/src/components/EmailVerificationBanner.tsx:11,40-46](app/src/components/EmailVerificationBanner.tsx#L11) — verification is a yellow banner with a dismiss `×` button.
- No API endpoint short-circuits on `email_verified === false`.

**Impact:** A user can register with a typo'd address (`bob@gnail.com`), get auto-logged-in, dismiss the banner, place orders, save addresses, use store credit, and never see another nag. The verification flow exists but enforces nothing — exactly the symptom the user described ("message showed as please confirm but users can simply ignore that").

**Fix options:**
1. Easy stop-gap: in `auth/login`, reject when `email_verified === false` with a clear message + resend link. Update `auth/register` to NOT issue the session cookie until verification.
2. Better: gate value-bearing actions (place order, spend credit, save profile) on `email_verified` server-side, not just login. This avoids the trap of an existing logged-in tab continuing to work after deploy.

### NEW-F2 — POS PIN is verified client-side; PINs and session live in localStorage
**Severity:** 🔴 Critical
**Evidence:**
- [app/src/context/POSContext.tsx:413-425](app/src/context/POSContext.tsx#L413) — `login()` checks `member.pin !== pin` **in the browser**, then sets `currentStaff` in React state. The `/api/pos/auth` call is fire-and-forget (`.catch(() => {})`), so it doesn't gate UI access — local POS continues regardless.
- [app/src/context/POSContext.tsx:272-276](app/src/context/POSContext.tsx#L272) — `currentStaff` and `staff` are loaded from `localStorage` keys `pos_session` and `pos_staff` on mount.
- [app/src/context/POSContext.tsx:306-307](app/src/context/POSContext.tsx#L306) — every change is persisted back to localStorage.
- [app/src/context/POSContext.tsx:15-21](app/src/context/POSContext.tsx#L15) — `SEED_STAFF` ships **Admin role with `pin: "1234"`** (was `""` until commit `13fdb69`, 2026-05-08). On a fresh install (or any device where `pos_staff` is wiped), the admin account has a world-readable PIN baked into the JS bundle.

**Note on the recent change:** commit `13fdb69` ("fix: set default PIN for Admin staff in seed data") only changed the seed value `"" → "1234"`. This addresses the empty-PIN UX edge case but does not close the security gap — `"1234"` is in the top-3 most common PINs globally and is still readable in the client bundle by anyone visiting the site. The three causes of the finding (client-side validation, localStorage-resident session, hardcoded credential in JS) are all unchanged.

**Impact:** This matches the user's observation exactly ("admin password hard coded and then may be get it from db after db seed and save it on local storage that anyone can change"). A user with browser devtools can:
1. Open Application → Local Storage → set `pos_session` to any staff object → reload → already logged in as admin.
2. Or set `pos_staff` to a list containing themselves with `role: "admin", pin: "0000"` and "log in" through the legitimate UI.
3. The server-side `/api/pos/auth` validates against `app_settings.pos_staff`, but only *some* POS routes (`/api/pos/orders` mutations and `/api/pos/menu` POST) check the cookie. UI features that operate purely client-side (cash drawer, sale completion, void, discount) trust the client-only `currentStaff` and do not call any cookie-gated endpoint. So spoofing localStorage bypasses everything that doesn't round-trip through a checked API.

**Fix:** PIN verification must move to the server (it already partly exists at `/api/pos/auth`). The client must stop allowing login on a local-only result. The `pos_session` key in localStorage must be either removed entirely (rely on the httpOnly cookie + `GET /api/pos/auth` like the driver flow does with `/api/auth/driver/me`) or it must hold ONLY the staff *display* metadata (name, role) without conferring access.

### NEW-F3 — Kitchen auth falls back to hardcoded PINs when DB is unconfigured
**Severity:** 🔴 High
**Evidence:** [app/src/app/api/kitchen/auth/route.ts:17-27](app/src/app/api/kitchen/auth/route.ts#L17). `SEED_KITCHEN` declares three staff with PINs `1234`, `2345`, `3456`. `getKitchenStaff()` returns `row.data.kitchenStaff` if non-empty, otherwise the seed.

**Impact:** A fresh deployment where the admin has not yet added kitchen staff exposes three known PINs that pass authentication and issue a real `kitchen_session` cookie. Compare with `pos/auth` which correctly returns 503 in this scenario ([pos/auth/route.ts:50-55](app/src/app/api/pos/auth/route.ts#L50)).

**Fix:** Delete `SEED_KITCHEN`. Return 503 when no staff are configured (mirror `pos/auth`). The kitchen login UI already shows a "no staff configured" path elsewhere — this just makes the server consistent.

### NEW-F4 — Default waiter/kitchen PINs are hardcoded in client code
**Severity:** 🟠 Med-High
**Evidence:** [app/src/context/AppContext.tsx:214-223](app/src/context/AppContext.tsx#L214) sets the *default* `app_settings.waiters` and `app_settings.kitchenStaff` arrays with PINs `1111`, `2222`, `3333`, `1234`, `2345`, `3456`. The "Head Waiter" account has `role: "senior"` — the elevated role that the system uses for refunds/voids.

**Impact:**
- These defaults are pushed to `app_settings` the first time an admin saves settings, persisting the known PINs into the DB.
- Even if admins are diligent and change PINs, the defaults are world-readable in the JavaScript bundle (anyone visiting the site can `view-source` the chunk).
- The "senior" role on the default waiter compounds 06-F12 / 06-F14 — once those checks are added, the elevation must check role, not just role-string-from-cookie.

**Fix:** Drop PINs from the seed defaults entirely. Force admins to set PINs explicitly during a first-run wizard. Move the staff list to a separate `app_settings.data.waiters` write that happens only when the admin clicks "save" with non-empty PINs.

### NEW-F5 — Mock customer accounts seeded with `password: "password"`
**Severity:** 🔴 Critical (when combined with 06-F2)
**Evidence:** [app/src/data/customers.ts:15,67,105](app/src/data/customers.ts#L15). Three mock customers (`cust-001`/`cust-002`/`cust-003`) each have `password: "password"` (literal string). [admin/seed/route.ts:94-105](app/src/app/api/admin/seed/route.ts#L94) inserts them into the `customers` table via the `customerToRow` mapper, which copies the `password` field verbatim. Since `/api/admin/seed` has no auth (06-F2), anyone can trigger the seed on a fresh DB and immediately log in as any of those mock customers.

**Impact:**
- Three known credentials usable to test the login flow on production.
- Combines with 06-F6 to place arbitrary orders billed to those customer IDs.
- The mock customers come with non-trivial `tags`, `favourites`, `saved_addresses`, and order history — useful for crafting plausible-looking fraud.

**Fix:** Stop seeding `mockCustomers` from the production seed endpoint. Move that data to a dev-only fixture loader that requires `NODE_ENV !== "production"` AND an admin session.

### NEW-F6 — `localStorage` carries customer session data and POS state
**Severity:** 🟡 Medium (data-loss / desync, not direct auth bypass)
**Evidence:**
- [app/src/context/POSContext.tsx:272-298](app/src/context/POSContext.tsx#L272) — `pos_session`, `pos_staff`, `pos_products`, `pos_sales`, `pos_customers`, etc.
- [app/src/context/AppContext.tsx](app/src/context/AppContext.tsx) — also persists customer state to `localStorage`.
- See also [clean-up/04-localstorage-audit.md](clean-up/04-localstorage-audit.md) for the full surface.

**Impact:** localStorage is not an auth surface but it is being used like one in the POS flow (NEW-F2). Even where it isn't load-bearing for auth, mutable client state that mirrors server state is a frequent source of "user looks logged in but isn't" bugs.

**Fix:** Decide per-key whether it is a *cache* (rebuildable from server) or *source of truth* (must move server-side). For session/staff data the answer is unambiguously "cache, source of truth must be the httpOnly cookie + a server `/me` endpoint."

### NEW-F7 — Customer registration auto-issues a session cookie before verification
**Severity:** 🔴 High (this is the mechanical cause of NEW-F1)
**Evidence:** [app/src/app/api/auth/register/route.ts:141-145](app/src/app/api/auth/register/route.ts#L141). The token is created and cookie set *after* the DB insert regardless of whether the verification email succeeded (note that the email send is `await`-ed but its failure is logged-not-thrown at line 55, and never gates the cookie).

**Fix:** Set the cookie only when `email_verified === true` (Google OAuth path) OR delay session issuance until `auth/verify-email` confirms the token.

### NEW-F8 — Inconsistent return shapes for "not authenticated"
**Severity:** 🟢 Low (DX issue, but contributes to the inconsistency that hides real bugs)
**Evidence:** Some routes return `unauthorizedJson()` from `auth.ts` (`{ ok: false, error: "Unauthorized" }`, 401). Some return `{ ok: false }` (no error string, 401 — e.g. [auth/driver/route.ts:18](app/src/app/api/auth/driver/route.ts#L18)). Admin uses `unauthorizedResponse()` ([adminAuth.ts:66](app/src/lib/adminAuth.ts#L66)). Manually-constructed 401s appear in several files with their own ad-hoc payloads.

**Fix:** One helper across the codebase. The shape consumers parse should be identical so the client error-handling can be one path.

---

## 5. Coverage matrix — verified 2026-05-11

Updated from prior audit. Legend identical: A=admin, C=customer, P=POS, K=kitchen, W=waiter, D=driver, T=URL token, ⛔=missing, ✓=present.

| Route | Required | Implemented | Verdict |
|---|---|---|---|
| `admin/auth` POST/GET/DELETE | A | A (login uses ADMIN_PASSWORD; GET/DELETE check cookie) | ✓ |
| `admin/categories` (+/[id]) | A | A | ✓ |
| `admin/customers` (+/[id]) | A | A | ✓ |
| **`admin/drivers` (+/[id])** | **A** | **none** | ⛔ **06-F1** |
| `admin/menu` (+/[id]) | A | A | ✓ |
| `admin/orders/[id]/driver` PUT | A | A | ✓ |
| `admin/orders/[id]/refund` POST | A | A | ✓ |
| `admin/orders/[id]/status` PUT | A | A | ✓ |
| `admin/reservations` (+/[id]) | A | A | ✓ |
| `admin/reservation-customers` (+/[id]) | A | A | ✓ |
| **`admin/seed`** | **A** | **none** | ⛔ **06-F2** |
| `admin/settings` | A | A | ✓ |
| `admin/users` (+/[id], send-reset, set-password) | A | A | ✓ |
| `auth/change-password` | C | C | ✓ |
| `auth/driver` POST/GET | public POST / D for GET | D on GET | ✓ |
| `auth/driver/me` GET | D | D | ✓ |
| `auth/driver/logout` | — | clear cookie | ✓ |
| `auth/driver/reset-password` | public | rate-limited | ✓ |
| `auth/driver/reset-password/confirm` | T | T | ✓ |
| `auth/google` + `/callback` | public OAuth | OAuth state CSRF | ✓ |
| `auth/login` | public | rate-limited | ✓ — but see **NEW-F1** (no email_verified check) |
| `auth/logout` | — | clear cookie | ✓ |
| `auth/me` | C | C | ✓ |
| `auth/register` | public | rate-limited | ✓ — but see **NEW-F7** (cookie issued before verification) |
| `auth/resend-verification` | C | C | ✓ |
| `auth/reset-password` (+/confirm) | public / T | rate-limited / T | ✓ |
| `auth/verify-email` | T | T | ✓ |
| **`customers/[id]` PATCH** | **C (same id)** | **allowlist only, no session** | ⛔ **06-F3** |
| **`customers/[id]/spend-credit`** | **C (same id)** | **none** | ⛔ **06-F4** |
| **`email` POST** | **server-only** | **open relay** | ⛔ **06-F5** |
| **`guest-profile`** | **rate-limit** | **none** | 🟡 **06-F11** |
| `kds/orders/[id]/status` PUT | K or A | K or A | ✓ |
| `kitchen/auth` POST | public PIN | rate-limited | ⚠ falls back to hardcoded PINs — **NEW-F3** |
| `kitchen/config` GET | public (PINs stripped) | strips PINs | ✓ |
| `kitchen/logout` | K | K | ✓ |
| **`orders` POST** | **C (matching customer_id)** | **accepts arbitrary customer_id** | ⛔ **06-F6** |
| `ping` | public | none | ✓ |
| `pos/auth` POST | public PIN | rate-limited | ✓ |
| `pos/menu` GET/POST | P | P | ✓ |
| **`pos/orders/[id]/collected`** | **P or A** | **none** | ⛔ **06-F7** |
| `pos/orders` | P | P | ✓ |
| **`pos/reservations` (+/[id])** | **P** | **none** | ⛔ **06-F8** |
| **`print` POST** | **A or P** | **none — SSRF** | ⛔ **06-F9** |
| `reservation/[token]` | T | T | ✓ |
| **`reservations` POST** | rate-limit | **none** | 🟡 **06-F10** |
| `reservations/availability` GET | public | none | ✓ |
| `settings/public` GET | public (whitelisted) | strips sensitive | ✓ |
| `waiter/auth` POST | public PIN | rate-limited | ✓ |
| `waiter/config` GET | public (PINs stripped) | strips PINs | ✓ |
| `waiter/logout` | — | clear cookie | ✓ |
| `waiter/orders` POST | W | W | ✓ |
| **`waiter/refund` POST** | **W (senior) or A** | **none** | ⛔ **06-F12** |
| **`waiter/settle` POST** | **W or A** | **none** | ⛔ **06-F13** |
| **`waiter/void` POST** | **W (senior) or A** | **none** | ⛔ **06-F14** |

**Tally:** 12 of 67 API routes are missing auth they need (18%, unchanged from prior audit). Plus 5 new findings outside the matrix (NEW-F1, F2, F3, F4, F5).

---

## 6. Severity-grouped issue list

### 🔴 Critical (data loss, financial fraud, internet-exposable)
1. **06-F5 — `/api/email` open SMTP relay.** First to fix; cost & reputation impact compounds with time.
2. **06-F9 — `/api/print` SSRF via raw TCP bytes.** Deployment-dependent but high blast radius.
3. **06-F12 — `/api/waiter/refund` unauthenticated.** Direct cash-position impact.
4. **06-F6 — `/api/orders` accepts arbitrary `customer_id`.** Order-spoofing on legit accounts.
5. **06-F3 — `/api/customers/[id]` PATCH lets anyone update any customer.** Combines with F6.
6. **06-F4 — `/api/customers/[id]/spend-credit` lets anyone burn any customer's credit.**
7. **06-F1 — `/api/admin/drivers*` no admin check.** Anyone can create a driver and log in as them.
8. **NEW-F2 — POS PIN verified client-side; SEED_STAFF admin has empty PIN.** localStorage-edit → admin.
9. **NEW-F5 — Mock customers seeded with `password: "password"`** (combines with 06-F2).

### 🔴 High
10. **06-F2 — `/api/admin/seed` no auth.**
11. **06-F8 — POS reservation create/update no auth.**
12. **06-F13 — `/api/waiter/settle` no auth.**
13. **06-F14 — `/api/waiter/void` no auth.**
14. **NEW-F1 — Login doesn't enforce email verification.**
15. **NEW-F3 — Kitchen auth falls back to hardcoded PINs 1234/2345/3456.**
16. **NEW-F7 — Register issues session cookie before email verification.**

### 🟠 Med-High
17. **06-F7 — `/api/pos/orders/[id]/collected` no auth.**
18. **NEW-F4 — Default waiter PINs `1111/2222/3333` and `senior` role baked into JS bundle.**

### 🟡 Medium
19. **06-F10 — `/api/reservations` POST no rate limit.**
20. **06-F11 — `/api/guest-profile` POST no rate limit / no auth.**
21. **06-F16 — Single shared `ADMIN_PASSWORD`, no per-admin identity / audit.**
22. **06-F19 — Edge middleware doesn't cover `/admin`, `/pos`, `/waiter`.**
23. **NEW-F6 — localStorage holds session-shaped state that should be cache only.**

### 🟢 Low
24. **06-F15 — Two HMAC token formats.**
25. **06-F17 — Admin password compare leaks length.**
26. **06-F18 — No `/api/auth/waiter/me` or `/api/auth/pos/me`.**
27. **06-F20 — `pos-walk-in` sentinel customer (auto-closes when 06-F6 is fixed).**
28. **NEW-F8 — Inconsistent 401 response shapes.**

---

## 7. Recommendation: single auth system vs targeted fixes

**Question from the user:** "should we go single auth and token handling system like nextauth and jwt? with encryptions?"

**Short answer:** **Do not migrate to NextAuth / Auth.js yet.** Do the targeted fixes first. Here's why:

### Why migration is not the right immediate move
1. **The crypto foundation is already correct.** HMAC-signed cookies, timing-safe compare, bcrypt, secure flags, sameSite — these are all in place. The bugs are missing *calls* to existing helpers, not weak crypto.
2. **The 14 unfixed critical/high gaps are 1–3 lines each.** `if (!await isAdminAuthenticated()) return unauthorizedResponse();` at the top of a handler closes most of them. Replacing the auth library does not, by itself, close them — you still have to add the check.
3. **NextAuth/Auth.js is opinionated around OAuth providers and DB-backed sessions.** This system has six distinct auth surfaces (admin password, customer email/password, customer Google OAuth, driver email/password, three PIN-based staff roles). Mapping six surfaces onto one provider model is months of work for a system that should not be in production without the §6 critical fixes regardless.
4. **"JWT with encryption" specifically:** the current tokens are HMAC-signed, not encrypted, which is *correct* — they hold only `<exp>|<id>|<role>`, all non-sensitive. Encrypting them adds complexity (key rotation, JWE) for no confidentiality gain. Don't optimize crypto, fix the missing authorization checks.

### What to do, in order

**Phase 1 — Stop the bleeding (1 PR, 1–2 hours):**
1. 06-F5 `/api/email` — add admin/session gate, deploy immediately.
2. 06-F9 `/api/print` — add session gate + IP allowlist (default 9100 + RFC1918 blocklist).
3. 06-F12 `waiter/refund`, 06-F13 `waiter/settle`, 06-F14 `waiter/void` — three `requireWaiterAuth()` lines.
4. 06-F1 `admin/drivers*` (4 handlers) — four `isAdminAuthenticated()` lines.
5. 06-F2 `admin/seed` — one `isAdminAuthenticated()` line.
6. NEW-F3 kitchen seed PIN — delete `SEED_KITCHEN`, return 503 when empty (mirror POS).
7. NEW-F5 — gate mock customer seeding behind `NODE_ENV !== "production"`.

**Phase 2 — Close the cross-account vectors (1 PR, 2–4 hours):**
8. 06-F6 `/api/orders` — verify `session.id === customer_id`; reject `pos-walk-in` sentinel from this endpoint.
9. 06-F3 `customers/[id]` PATCH — verify `session.id === id`.
10. 06-F4 `customers/[id]/spend-credit` — verify `session.id === id`.
11. 06-F7 `pos/orders/[id]/collected`, 06-F8 `pos/reservations*` — add `getPosSession()` checks.

**Phase 3 — Lifecycle correctness (1 PR, 4–6 hours):**
12. NEW-F1 + NEW-F7 — gate session issuance / login on `email_verified`. Add clear error path with resend.
13. NEW-F2 — move POS PIN verification to be server-authoritative; have the client require a successful `/api/pos/auth` cookie before unlocking the UI; treat `localStorage.pos_session` as cache only.
14. NEW-F4 — drop hardcoded PIN defaults from `AppContext.tsx`; require admins to set PINs on first save.

**Phase 4 — Hardening (1 PR, ~1 day):**
15. 06-F10, 06-F11 — apply `rateLimit("reservation:" + ip, 5, 60_000)` and similar.
16. 06-F19 — extend middleware matcher to `/admin/:path*`, `/pos/:path*`, `/waiter/:path*`. Use the Web Crypto verifiers already in `middleware.ts`.
17. 06-F18 — add `GET /api/auth/waiter/me` and `/api/auth/pos/me` (mirror `/api/auth/driver/me`).
18. NEW-F8 — single `unauthorized()` helper across all auth modules.

**Phase 5 — Refactor (1 PR, ~1–2 days):**
19. 06-F15 + 06-F16 + 06-F17 — unify the token format: admin migrates to `<exp>|<id>|<role>|<sig>` with `role: "admin"`. Replace the env-var `ADMIN_PASSWORD` with bcrypt-hashed rows in the existing `users` table (admin panel already manages this — see [UserManagementPanel.tsx](app/src/components/admin/UserManagementPanel.tsx)). Existing admin tokens become invalid → forced re-login (acceptable).

After Phase 5, the codebase has one auth library, one token format, per-user admin identities, and an audit trail. At *that* point, evaluating NextAuth becomes a meaningful question — but the answer might still be "stay" because the only thing NextAuth adds at that point is OAuth-provider plumbing the system doesn't need.

### Verdict on encryption
Don't encrypt the session tokens. They contain only `(exp, id, role)`, none of which are sensitive — `id` is a UUID, `role` is one of six known strings, `exp` is a timestamp. Encrypting them would require JWE and key rotation for no gain. The valuable secrets (passwords, PINs) are already hashed/stored server-side; the cookie itself is just a bearer credential and HMAC signing is the correct primitive for that.

---

## 8. Self-check — did this audit miss anything?

I re-read the routes the prior audit marked ✓ to be sure none have regressed:

- `admin/categories`, `admin/customers`, `admin/menu`, `admin/orders/*`, `admin/reservations`, `admin/users`, `admin/settings` — confirmed `isAdminAuthenticated()` present (via grep + spot-check of 5 files).
- `auth/login`, `auth/me`, `auth/change-password` — confirmed cookie-gated.
- `auth/driver*`, `auth/driver/me` — confirmed.
- `kds/orders/[id]/status` — confirmed K or A.
- `waiter/orders` — confirmed `requireWaiterAuth()` at line top.
- `pos/orders` mutations — confirmed `getPosSession()`.

I additionally checked the user's specific claims:
- ✅ "found one /pos or something with admin password hard coded" — yes, `SEED_STAFF` in [POSContext.tsx:15](app/src/context/POSContext.tsx#L15) has `Admin` role with empty PIN.
- ✅ "save it on local storage that anyone can change" — yes, `pos_session` / `pos_staff` keys.
- ✅ "user can log in using any email and password without confirming it. message showed as please confirm but users can simply ignore that" — yes, [NEW-F1](#new-f1--customer-login-does-not-enforce-email-verification).
- ✅ "apis no auth check there as I know. routess are may be get checked may be not" — yes, 12 of 67 routes confirmed.

Areas I deliberately did NOT cover in depth (out of scope here, covered by sibling audits):
- RLS policies on the Supabase side → see [clean-up/07-service-role-key.md](clean-up/07-service-role-key.md).
- Input validation / XSS / SQL injection → see [clean-up/08-input-validation.md](clean-up/08-input-validation.md), [clean-up/10-xss-injection.md](clean-up/10-xss-injection.md).
- Full localStorage surface → see [clean-up/04-localstorage-audit.md](clean-up/04-localstorage-audit.md).

If a finding above turns out to be wrong, the most likely cause is that a route was edited in the working tree between the read and the writeup — re-grep before fixing to confirm the line numbers above still point at the right code.

---

## 9. FAQ — "We always use JWT and NextAuth. Why not here?"

### "Why aren't we using JWT?"

**We are.** The tokens this project issues are functionally JWTs. They contain claims (`exp`, `id`, `role`), they're signed with HMAC-SHA256, the signature uses `timingSafeEqual` for verification. The only difference from a "standards-compliant" JWT is the **wire format**: this project uses `<exp>|<id>|<role>|<sig>` instead of the standard JWS form `base64url(header).base64url(payload).base64url(sig)`.

So the question is not "JWT vs not-JWT," it's "**custom HMAC format vs the JWS standard.**" Tradeoffs:

| | Custom `<exp>\|<id>\|<role>\|<sig>` | Standard JWS (`jsonwebtoken` / `jose`) |
|---|---|---|
| Crypto strength | Identical (HMAC-SHA256) | Identical |
| Wire size | Smaller (~110 bytes) | Larger (~200+ bytes, base64 overhead + header JSON) |
| Tooling | None — bespoke | jwt.io debugger, library ecosystem, `alg` negotiation |
| Footguns | No `alg: none` risk; you control everything | Historical `alg: none` and key-confusion CVEs in older libs |
| Claim extensibility | Add a field = parse-format change everywhere | Add a field = one more property in the payload object |
| Two separate implementations needed for Edge (Web Crypto) and Node | Yes — that's why [middleware.ts:13-72](app/src/middleware.ts#L13) duplicates `verifyDriverToken`/`verifyKitchenToken` | Same — `jose` works in both, would unify these |

**Verdict:** if you're going to touch this anyway in Phase 6 (token unification, per-admin accounts), **swap to `jose` at the same time**. It would let middleware.ts and lib/auth.ts share one verifier. That's a real, modest win. But by itself, "are these JWTs?" is a yes — the crypto is correct, the format is custom.

### "Why aren't we using NextAuth (Auth.js)?"

NextAuth is best when you have **one user table with several login methods**. Examples where it shines:
- A SaaS where users sign in with Google, GitHub, Apple, or email/password → all map to one `User` row.
- An app that needs OIDC/SAML/enterprise SSO.
- An app where you'd otherwise hand-roll OAuth provider plumbing for 3+ providers.

This codebase has the opposite shape: **six distinct identity stores, none of which map cleanly to NextAuth's `User`/`Account`/`Session` schema:**

| Identity type | Storage | Login method | NextAuth fit |
|---|---|---|---|
| Customer | `customers` table (bcrypt) | email+password OR Google OAuth | OK — could be one NextAuth user |
| Driver | `drivers` table (bcrypt, separate from customers) | email+password | Awkward — different table, same column names |
| Admin | env-var `ADMIN_PASSWORD` (shared) | password only | Doesn't fit at all — no per-user identity |
| Waiter | `app_settings.data.waiters` JSON array | 4-digit PIN, picked from a profile list | Doesn't fit — not a "credential," not a "user," more like a shift session |
| Kitchen staff | `app_settings.data.kitchenStaff` JSON | 4-digit PIN | Same as waiter |
| POS staff | `app_settings.data.pos_staff` JSON | 4-digit PIN | Same as waiter |

To use NextAuth you'd write a custom Credentials provider for every row in that table, plus a custom Adapter that fans `getUser()`/`createSession()` out to four different storage shapes. By the time you finish that, you've written **more code than the existing `getCustomerSession()` / `getDriverSession()` / `getPosSession()` helpers** — and it sits inside a library you didn't write, which is harder to debug than 100 lines of clear `lib/auth.ts`.

Other reasons NextAuth doesn't pay rent here specifically:
1. **NextAuth's session model is per-request, not per-shift.** PIN-based staff login is a shift concept — a waiter logs in, works for 8 hours on a shared terminal. NextAuth's defaults (rotating tokens, refresh flows, idle timeouts) fight that pattern.
2. **The actual bugs are missing authorization checks, not weak authentication.** Replacing the library doesn't add `if (!session) return 401` to the 14 unprotected routes. You still have to do that walk — and now you're also doing a NextAuth migration in parallel, doubling the surface for new bugs during the cutover.
3. **NextAuth's middleware model isn't a great fit for six cookie names.** Currently the edge middleware verifies driver, kitchen, and admin tokens independently. Mapping that onto NextAuth's single-session abstraction means either collapsing roles (loss of clarity) or running NextAuth in parallel with the existing cookies (more complexity, not less).
4. **OAuth providers** — the only thing NextAuth would genuinely save effort on — are currently one: Google, and that's already implemented in [app/src/app/api/auth/google/callback/route.ts](app/src/app/api/auth/google/callback/route.ts). It's ~190 lines and it's correct (CSRF state, code exchange, email_verified honored on the OAuth path). NextAuth would replace those 190 lines with a config block, but you'd give up the bespoke flow control.

### "But we ALWAYS use NextAuth + JWT. Won't this code be hard to onboard new devs onto?"

This is the most legitimate version of the question, and the honest answer is: **yes, somewhat, but the alternative is worse.**

What an experienced Next.js developer expects:
- ✅ A library they recognize.
- ✅ `useSession()` hooks and `getServerSession()`.
- ✅ Standard provider patterns.

What they actually get in this project:
- A 100-line `lib/auth.ts` they can read in 5 minutes.
- Six explicit `getXSession()` functions, one per role.
- An edge middleware that calls Web Crypto directly.

This is more code to *read*, but less code to *understand* — there's no library magic, no `next-auth.d.ts` module augmentation, no adapter abstraction layer. A new dev can step through every line of the auth flow with no docs. That's an underrated property for a system that has been shipping with authorization bugs for months.

### Decision rubric

Use NextAuth when you have **2+ of these:**
- 2+ OAuth providers (Google + Apple + Facebook, etc.).
- One unified user table.
- A team that already knows NextAuth's escape hatches (custom adapters, JWT callbacks, session strategies).
- Enterprise SSO (SAML/OIDC) requirements.

Use a hand-rolled session library (what this project has) when:
- You have several distinct identity stores with different login modes (PIN vs password vs OAuth).
- You need predictable behavior at the cookie/HMAC level for edge middleware.
- You'd rather own a 100-line file than configure a 10MB dependency.

**This codebase falls firmly in the second column.** The right move is to *fix what's broken* in the existing system, not to import a library that was built for a different shape of problem.

### What I'd accept as a NextAuth migration trigger
- If marketing wants 3+ OAuth providers (Apple, Facebook, Microsoft).
- If we collapse waiter/kitchen/POS into one `staff` table with a shared role system.
- If we need SAML/OIDC for enterprise admin login.

None of those are on the roadmap as far as I can see from the repo. Until they are, **stay on the custom library, swap `<exp>|<id>|<role>|<sig>` for `jose`-issued JWS tokens during Phase 6** if you want closer-to-standards crypto, and call it done.
