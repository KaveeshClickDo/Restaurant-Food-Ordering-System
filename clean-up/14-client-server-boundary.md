# Audit 14 — Client/Server Boundary

**Phase:** 5 — Frontend quality
**Date:** 2026-05-05
**Scope:** Where `'use client'` is declared vs. should be, what's fetched in `useEffect` that could be fetched server-side, server-component opportunities (`generateMetadata`, RSC data loading, `loading.tsx` Suspense boundaries), and a verification of zero server-only-module leakage into client components.
**Mode:** Read-only

---

## 1. Methodology

1. Counted `'use client'` markers across the `.tsx` tree.
2. Counted server components by exclusion (no `'use client'` directive).
3. Listed routes (`page.tsx`) and which are client vs server.
4. Sampled the largest client components for "data fetched in `useEffect` on mount with `[]` deps" — that's the canonical RSC migration target.
5. Verified no `.tsx` file imports a server-only `lib/*` module.
6. Looked for `loading.tsx` files (Suspense streaming), `generateMetadata`, `generateStaticParams`, `cache()`, and `fetch(... { next: { revalidate } })`.

## 2. Statistics

- **`.tsx` files (excluding API routes):** 71.
- **Marked `'use client'`:** 67 / 71 = **94%**.
- **Server components:** 4. Specifically:
  - [app/layout.tsx](../app/src/app/layout.tsx) — root layout, runs server-side, fetches settings via `fetch()` (avoids importing `supabaseAdmin` to keep the root free of `next/server` dependencies).
  - [app/(site)/layout.tsx](../app/src/app/(site)/layout.tsx) — public-site layout shell.
  - [app/pos/layout.tsx](../app/src/app/pos/layout.tsx) — POS layout.
  - [app/not-found.tsx](../app/src/app/not-found.tsx) — 404 page.
- **Server actions** (`'use server'`): **0**. The codebase uses route handlers exclusively for server-side mutations.
- **`loading.tsx`:** 0 — no Suspense streaming boundaries.
- **`generateMetadata`:** 1 ([app/layout.tsx](../app/src/app/layout.tsx)) — used to render server-side meta tags.
- **`generateStaticParams`:** 0.
- **`fetch(... { next: { revalidate } })` / `cache()`:** 0 explicit usage. All fetches are runtime / client-side.
- **`useEffect(... , [])`** (mount-only effects): top hits — POS / kitchen / customer-display / pos-login each have a mount-only effect.
- **Server-only module imports from `.tsx`:** **0** ✓ (verified with `^import .* from "@/lib/(supabaseAdmin|auth|adminAuth|waiterAuth|emailServer|rateLimit|apiHandler)"` against the `.tsx` set).

## 3. Findings

### 14-F1 — 94% of components are client components — heavy bundle, no server rendering for data
**Severity:** 🟡 Medium
**Evidence:** 67 of 71 `.tsx` files are client. The 4 server components are layout shells; **every page component is `'use client'`**.
**Why it matters:**
- The codebase is effectively an SPA with Next.js as a build tool — `app router` benefits (RSC, streaming, server fetches, automatic code-splitting per route) are unused.
- First-page bundle size is large (storefront page is 82 KB source / much larger compiled — see Audit 02). Hydration cost for low-end devices is significant.
- Every fetch is a runtime client-side round-trip. The customer site flashes empty state while [AppContext](../app/src/context/AppContext.tsx) loads settings → menu → customer-data sequentially. Server rendering could deliver a hydrated page on the first paint.
- SEO: only [app/layout.tsx](../app/src/app/layout.tsx) `generateMetadata` provides server-rendered meta. Page-specific titles/descriptions for footer pages, menu items, etc., are added client-side via [SeoHead.tsx](../app/src/components/SeoHead.tsx) (a workaround that depends on React 19's `<title>` hoisting). Search engine crawlers vary in how well they execute JS.
**Possible action — staged:**
1. **Phase 1 (low-risk):** Convert read-only public pages to server components: [(site)/[footerPage]/page.tsx](../app/src/app/(site)/[footerPage]/page.tsx) (renders static content), [(site)/book/page.tsx](../app/src/app/(site)/book/page.tsx) (initial reservation form data), and the storefront index. The interactive parts (Cart, Header) stay as client islands.
2. **Phase 2:** Carve `app/page.tsx` (storefront) and account page into RSC + client islands. Menu data is server-fetched; the cart UI is the only client-side concern.
3. **Phase 3 (deferred):** Admin / POS / waiter remain client-heavy by nature (interactive applications) — RSC migration not the priority there.

### 14-F2 — Every page component runs a mount-effect to fetch its data
**Severity:** 🟡 Medium
**Evidence:**
- `customer-display/page.tsx` — fetches sales / orders on mount.
- `kitchen/page.tsx` — fetches via Realtime subscription set up in mount effect.
- `pos/page.tsx` — fetches reservations / orders.
- `(site)/book/page.tsx` — fetches `/api/settings/public`, then `/api/reservations/availability`.
- `(site)/reservation/[token]/page.tsx` — fetches `/api/reservation/[token]` for the booking details.
- `(site)/verify-email/page.tsx` — fetches `/api/auth/verify-email` with the token from URL.

For server-renderable cases ([book](../app/src/app/(site)/book/page.tsx), [reservation/[token]](../app/src/app/(site)/reservation/[token]/page.tsx), [verify-email](../app/src/app/(site)/verify-email/page.tsx), [(site)/[footerPage]](../app/src/app/(site)/[footerPage]/page.tsx)), there's no reason to wait for a client roundtrip:
- **Initial state can be fetched server-side** via the same Supabase or `/api/...` URL.
- The page hydrates already-populated → no spinner, faster meaningful paint, and search-engine crawlers see real content.
**Why it matters:**
- Direct UX hit: loading spinners on every navigation that could be near-instant.
- 14-F1 enables this — the page must shed `'use client'` (or push it down into the interactive island).
**Possible action:** Convert the listed pages to server components. Keep only the interactive form / submit handler as a client island.

### 14-F3 — `(site)/[footerPage]/page.tsx` is a client component for purely static content
**Severity:** 🟡 Medium (concrete instance of 14-F2)
**Evidence:** [(site)/[footerPage]/page.tsx](../app/src/app/(site)/[footerPage]/page.tsx) — uses `useApp()` to read `settings.footerPages` / `settings.customPages`, then renders the `content` field. Pure read-display of admin-edited content. Client-side rendering means:
- First paint shows nothing (settings haven't loaded into AppContext yet).
- Search engines may not see the content.
- The page should be one of the easiest to migrate to RSC.
**Why it matters:** Custom Pages and Footer Pages are exactly the kind of content that benefits most from server rendering: SEO, fast first paint, easy caching.
**Possible action:** Make the page a server component that fetches `app_settings.data.footerPages` / `customPages` server-side. Use `generateMetadata` to set per-page title / description from the same data. Optionally `generateStaticParams` for static export. Cross-ref 10-F3 — the same page bypasses sanitization; fix together.

### 14-F4 — No `loading.tsx` boundaries — every navigation freezes the previous page
**Severity:** 🟡 Low
**Evidence:** Zero `loading.tsx` files. Next.js App Router uses `loading.tsx` to show a fallback while the next page's server data loads.
**Why it matters:**
- With everything client-side, transitions feel instant (just a state change). But once any page becomes a server component (per 14-F1/F2), navigation will block on the server fetch unless a `loading.tsx` is in place.
- Without `loading.tsx`, Next.js shows the *previous* page until the new one is ready — confusing UX.
**Possible action:** Add a `loading.tsx` per route group when migrating to server components. A simple skeleton or spinner is enough.

### 14-F5 — `app/layout.tsx` does its own `fetch()` to avoid `supabaseAdmin` import
**Severity:** ⚠️ Worth noting
**Evidence:** [app/layout.tsx:18–20](../app/src/app/layout.tsx#L18) (comment): "Uses native fetch() — deliberately avoids importing supabaseAdmin (which pulls in next/server's NextResponse) so the root layout stays free of next/server dependencies that confuse the Turbopack module graph."
**Why it matters:**
- Confirms the discipline from 07-F1 is being deliberately maintained.
- But it's brittle: a contributor who adds `supabaseAdmin` to layout breaks Turbopack-only builds, and the failure is mysterious.
- Cross-ref 07-F1 — the `import "server-only"` package would make this discipline declarative rather than tribal knowledge.
**Possible action:** Adopt `server-only` as recommended in 07-F1.

### 14-F6 — `<Suspense>` used minimally; only [verify-email](../app/src/app/(site)/verify-email/page.tsx) wraps a `useSearchParams` consumer
**Severity:** 🟡 Low
**Evidence:** Found one `<Suspense>` boundary (the verify-email page). Required because Next.js 15 demands `useSearchParams()` consumers be wrapped in Suspense.
**Why it matters:** Other pages that read URL state via `useSearchParams` likely also need Suspense and may be silently fine because Next.js uses "force-dynamic" fallback. Worth a sweep when migrating to RSC.
**Possible action:** Audit `useSearchParams` consumers; ensure each is in a Suspense boundary.

### 14-F7 — No `cache()` / `next: { revalidate }` / ISR usage anywhere
**Severity:** 🟡 Low
**Evidence:** Zero `cache(...)`, no `revalidate` settings, no `fetch(... { next: ... })`. The only cache directive seen is **client-side** `cache: "no-store"` in `auth/me` calls.
**Why it matters:**
- Once pages are server components, eligible reads (settings, public menu, footer pages) can be cached for ~30–60 s with `revalidate`.
- Fully static content (static footer pages, restaurant info) could go to ISR or static export.
- Currently every public-page render hits the DB. At small scale fine; at scale wasteful.
**Possible action:** When server-component migration starts, layer in `revalidate: 60` on the top-level fetches and `cache()` for de-duplicated reads within a single request.

### 14-F8 — `AppContext.tsx` runs fetch sequence client-side and is the slowest boot
**Severity:** 🟡 Medium (cross-ref 02-F2 / 05-F4)
**Evidence:** [AppContext.tsx:555–632](../app/src/context/AppContext.tsx#L555) `init()` runs on mount, sequentially fetching settings → drivers → categories → menu → customers, with first-run seed fallbacks. ~5 round trips minimum on first visit.
**Why it matters:**
- First-paint cost is dominated by this. Server-rendering the layout already does part of this (fetching settings server-side per [layout.tsx:23](../app/src/app/layout.tsx#L23)) — but the *rest* of the data still loads client-side.
- A migration plan: server-render the menu + categories at the layout level, push the result into `AppProvider`'s `initialData` (the prop already exists per [AppContext.tsx:431](../app/src/context/AppContext.tsx#L431)). Then `init()` can skip those fetches.
**Possible action:** Cross-ref 05-F4 (Realtime + load entanglement). When AppContext is split per domain, each domain provider can accept `initialData` from a server-component fetch. RSC + provider hydration eliminates client-side bootstrap.

### 14-F9 — `pos/layout.tsx`, `(site)/layout.tsx` are server components but only render JSX shells
**Severity:** ⚠️ Acceptable
**Evidence:** Both layouts are server components but their children (the actual `page.tsx`) are client. So the server tree is just `<html><body><AppProvider>{children}</AppProvider></body></html>` — no real server work.
**Why it matters:** Latent capacity. These layouts could fetch shared per-route-group data (e.g. `(site)/layout.tsx` could fetch settings once and pass to children, avoiding the duplicate fetch in AppContext).
**Possible action:** Defer until per-route-group data is actually shared. Premature without 14-F8 migration.

### 14-F10 — No server-only module is imported from a `.tsx` file (positive finding)
**Severity:** ⚠️ Positive
**Evidence:** Grep for imports of `@/lib/{supabaseAdmin,auth,adminAuth,waiterAuth,emailServer,rateLimit,apiHandler}` against `.tsx` files returns **0**. Discipline holds.
**Why it matters:** Confirms 07-F1's positive finding from a different angle.
**Possible action:** Cross-ref 07-F1 — formalize via `server-only` so this isn't memory-only.

### 14-F11 — Capacitor (Android wrapper) consumes the same routes — boundary considerations
**Severity:** ⚠️ Worth noting
**Evidence:** [package.json](../app/package.json) — `@capacitor/android` + `@capacitor/cli`. Capacitor wraps the Next.js export into a WebView. App Router's server-component model assumes a Node.js server — Capacitor's static export doesn't run server code at all.
**Why it matters:**
- If the app is intended to be deployable as a static Android bundle, *every* `'use client'` is currently there because there's no server runtime.
- If the app runs against a deployed Next.js server (Capacitor WebView pointing at e.g. `restaurant.com`), then RSC works normally.
- This is the deployment fork in the road that determines the answer to 14-F1: aggressive RSC migration is correct for hosted Next.js, wrong for static export.
**Possible action:** Confirm with user (open question 1 below). The answer changes Phase 5 priorities.

## 4. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🟡 **Medium** | 14-F1 (94% client components), 14-F2 (mount-effect data fetching), 14-F3 (footerPage page is client), 14-F8 (AppContext bootstrap dominates first paint) | |
| 🟡 **Low** | 14-F4 (no loading.tsx), 14-F6 (`<Suspense>` minimal), 14-F7 (no cache directives) | |
| ⚠️ **Acceptable / positive** | 14-F5 (layout deliberately uses fetch), 14-F9 (group layouts thin), 14-F10 (no server-leak), 14-F11 (deployment-shape question) | |

## 5. Recommended migration sequence (if hosted Next.js)

If the deployment target is a hosted Next.js server (not static export), here's the lowest-risk RSC migration order:

1. **`(site)/[footerPage]/page.tsx`** — pure read content. RSC + `generateMetadata`. Cross-ref 10-F3 (sanitization fix lands here too).
2. **`(site)/verify-email/page.tsx`** — reads token from URL, calls API. Easy server-component conversion: do the verify in a server action / route handler, render the result.
3. **`(site)/reservation/[token]/page.tsx`** — read-only reservation details by token. Server fetch + RSC.
4. **`(site)/book/page.tsx`** — initial slot data fetched server-side; the booking form stays as a client island.
5. **`app/page.tsx`** (storefront) — split into server (menu data, hero, SEO) + client islands (cart, search, modals). Biggest UX win, biggest refactor.
6. **`(site)/account/page.tsx`** — auth-gated; server-fetch initial customer data, client-side updates.
7. **Defer:** admin / POS / waiter / kitchen / driver / customer-display — these are app-shell SPAs by nature.

If the deployment target is **static export** (Capacitor), this audit's recommendations don't apply — keep the client-side architecture.

## 6. Open questions for the user

1. **Deployment shape:** does the customer-facing site run as a hosted Next.js server (Vercel / Node), as a static export consumed by Capacitor, or both? The answer drives whether 14-F1's RSC migration is high-priority or moot.
2. **SEO requirements:** does the public restaurant site need to rank for menu items / location keywords? RSC + per-page `generateMetadata` is required for crawler-friendly content. Important if marketing-driven, optional if ordering is via QR codes / Capacitor app only.
3. **First-paint priority:** what's the worst observed first-paint time on the customer-facing site, on a real phone with mid-range bandwidth? The case for RSC strengthens linearly with first-paint pain.
4. **Cache TTLs:** when caching becomes an option (post-RSC), what's the acceptable staleness for menu / footer pages? 30 s? 5 min? 1 hour?

## 7. What's next

- This concludes **Phase 5 — Frontend quality**.
- **Phase 6 — Build & deploy hygiene** begins next:
  - Audit 15 — Dependencies (versions, security advisories, unused packages, missing `peerDependencies`).
  - Audit 16 — Env parity (`example.env` vs all env-var reads, document drift).
