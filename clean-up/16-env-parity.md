# Audit 16 — Env Parity

**Phase:** 6 — Build & deploy hygiene
**Date:** 2026-05-05
**Scope:** Cross-reference [app/example.env](../app/example.env) against every `process.env.*` read in [app/src/](../app/src/), [migrate.mjs](../app/migrate.mjs), and [next.config.ts](../app/next.config.ts). Document drift, missing entries, undocumented vars, and check `next.config.ts` for declared headers / config that affects runtime behavior.
**Mode:** Read-only

---

## 1. Methodology

1. Grep'd `process.env.[A-Z_]+` across `app/src/`, `migrate.mjs`, and `next.config.ts`.
2. Read [example.env](../app/example.env) for declared variables.
3. Built a matrix of declared vs used.
4. Read [next.config.ts](../app/next.config.ts) for runtime configuration that affects deploy (headers, image hosts, etc.).

## 2. Variable parity matrix

**Declared in example.env (9):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `AUTH_JWT_SECRET`, `NEXT_PUBLIC_SITE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`.

**Read in code (18 unique):**

| Variable | In example.env? | Read by | Verdict |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | [lib/supabase.ts](../app/src/lib/supabase.ts), [lib/supabaseAdmin.ts](../app/src/lib/supabaseAdmin.ts), [app/layout.tsx](../app/src/app/layout.tsx) | ✓ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | [lib/supabase.ts](../app/src/lib/supabase.ts) | ✓ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | [lib/supabaseAdmin.ts](../app/src/lib/supabaseAdmin.ts) | ✓ |
| `ADMIN_PASSWORD` | ✓ | [api/admin/auth/route.ts](../app/src/app/api/admin/auth/route.ts) | ✓ |
| `AUTH_JWT_SECRET` | ✓ | 10+ files | ✓ |
| `NEXT_PUBLIC_SITE_URL` | ✓ | 7+ files | ✓ |
| `GOOGLE_CLIENT_ID` | ✓ | [api/auth/google](../app/src/app/api/auth/google) | ✓ |
| `GOOGLE_CLIENT_SECRET` | ✓ | [api/auth/google/callback](../app/src/app/api/auth/google/callback/route.ts) | ✓ |
| `DATABASE_URL` | ✓ | [migrate.mjs](../app/migrate.mjs) | ✓ |
| `ADMIN_JWT_SECRET` | ⛔ **missing** | [lib/adminAuth.ts](../app/src/lib/adminAuth.ts) + 9 fallback chains | 🔴 **16-F1** |
| `NEXT_PUBLIC_ADMIN_CONFIGURED` | ⛔ **missing** | [admin/page.tsx:293](../app/src/app/admin/page.tsx#L293) | 🟡 **16-F2** |
| `SMTP_HOST` | ⛔ **missing** | [api/email/route.ts](../app/src/app/api/email/route.ts), 4 routes | 🔴 **16-F3** |
| `SMTP_PORT` | ⛔ **missing** | [api/email/route.ts:62](../app/src/app/api/email/route.ts#L62) | 🔴 **16-F3** |
| `SMTP_USER` | ⛔ **missing** | [api/email/route.ts:63](../app/src/app/api/email/route.ts#L63), [lib/emailServer.ts](../app/src/lib/emailServer.ts) | 🔴 **16-F3** |
| `SMTP_PASS` | ⛔ **missing** | [api/email/route.ts:64](../app/src/app/api/email/route.ts#L64), [lib/emailServer.ts](../app/src/lib/emailServer.ts) | 🔴 **16-F3** |
| `SMTP_FROM` | ⛔ **missing** | [api/email/route.ts:75](../app/src/app/api/email/route.ts#L75), [lib/emailServer.ts](../app/src/lib/emailServer.ts) | 🔴 **16-F3** |
| `SMTP_FROM_NAME` | ⛔ **missing** | [api/email/route.ts:87](../app/src/app/api/email/route.ts#L87) | 🔴 **16-F3** |
| `NODE_ENV` | n/a (Node-managed) | cookie-secure flag | ✓ |

## 3. Findings

### 16-F1 — `ADMIN_JWT_SECRET` is read by 10 files but not documented in `example.env`
**Severity:** 🔴 High
**Evidence:**
- Read directly by [lib/adminAuth.ts:18](../app/src/lib/adminAuth.ts#L18): `const secret = process.env.ADMIN_JWT_SECRET?.trim()`. Throws if not set.
- Read as fallback in 9 other files via the `process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? ""` pattern.
- [example.env:29](../app/example.env#L29) declares **only** `AUTH_JWT_SECRET`.
**Why it matters:**
- A new developer following [example.env](../app/example.env) sets `AUTH_JWT_SECRET` and runs `npm run dev`. The customer/driver/waiter routes work. But **admin login fails with a 500** ("ADMIN_JWT_SECRET env var is not set") because [lib/adminAuth.ts:21](../app/src/lib/adminAuth.ts#L21) requires the admin variant specifically.
- In production, admin sessions silently use `AUTH_JWT_SECRET` via the fallback — but [lib/adminAuth.ts](../app/src/lib/adminAuth.ts) does **not** use the fallback chain. So:
  - Admin auth requires `ADMIN_JWT_SECRET` (no fallback).
  - Other auth routes prefer `AUTH_JWT_SECRET`, fall back to `ADMIN_JWT_SECRET`.
  - This is the root of 09-F11's "rotation surprise" — the two secrets aren't symmetric.
**Possible action:**
1. Add to [example.env](../app/example.env):
   ```
   ADMIN_JWT_SECRET=replace-with-a-long-random-secret-at-least-64-chars
   ```
   Document that it can be the same as `AUTH_JWT_SECRET` for development, but should differ in production for clean rotation semantics.
2. Better: cross-ref 09-F11 — make [lib/adminAuth.ts](../app/src/lib/adminAuth.ts) accept the same fallback chain (`AUTH_JWT_SECRET ?? ADMIN_JWT_SECRET`) so a single env var works for the whole app. Then plan to drop `ADMIN_JWT_SECRET` entirely.

### 16-F2 — `NEXT_PUBLIC_ADMIN_CONFIGURED` is read but never documented
**Severity:** 🟡 Medium
**Evidence:** [admin/page.tsx:293](../app/src/app/admin/page.tsx#L293):
```tsx
{!process.env.NEXT_PUBLIC_ADMIN_CONFIGURED && (
  ...
)}
```
Toggles a "needs setup" UI hint. Not declared in [example.env](../app/example.env).
**Why it matters:**
- `NEXT_PUBLIC_*` vars are inlined at build time. So the value of this flag is whatever it was when `npm run build` ran.
- A developer who forgets to set it will see the "needs setup" UI even on a fully-configured deployment.
- A developer who sets it wrong (e.g. `false`) will *not* see the warning when they should.
- It's also a strange `NEXT_PUBLIC_*` to expose — its purpose seems to be "we're configured, hide the setup prompt". A server-side check (e.g. `app_settings.data` non-empty) would be more reliable.
**Possible action:**
1. Document in [example.env](../app/example.env) what value is expected (`true` after first-run setup?).
2. Better: replace the env-var check with a server-side check (`SELECT 1 FROM app_settings WHERE id = 1`). Removes another env-var that needs to be remembered.

### 16-F3 — SMTP env vars are read but `example.env` says creds come from `app_settings`
**Severity:** 🔴 Critical (contradiction between docs and code)
**Evidence:**
- [example.env:57–60](../app/example.env#L57):
  ```
  # NOTE: SMTP and Stripe/PayPal credentials are NOT set here.
  # They are entered through Admin → Integrations and stored in
  # the `app_settings` table. They never reach the browser.
  ```
- Code reads SMTP from env in 5 places:
  - [api/email/route.ts:61–64,75,87](../app/src/app/api/email/route.ts#L61): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME`.
  - [lib/emailServer.ts:39,66–67](../app/src/lib/emailServer.ts#L39): `SMTP_USER`, `SMTP_HOST`, `SMTP_PASS`.
  - 4 password-reset / verification routes gate `if (process.env.SMTP_HOST)` to decide whether to send email.
- Cross-ref Audit 07: [07-F2](./07-service-role-key.md#07-F2) noted this contradiction from the security side.
**Why it matters:**
- **Critical for security:** [example.env](../app/example.env) explicitly says SMTP creds live in `app_settings`. Audit 07 found `app_settings` is anon-readable (07-F2). If SMTP creds were actually in `app_settings`, they'd leak to anyone with the anon key.
- **Critical for deployment:** Code reads from env, not from `app_settings`. So setting SMTP via the admin UI silently does nothing — the email-sending paths only work if env vars are also configured.
- **Real state:** the env-var reads are the source of truth. The example.env note is outdated documentation. The admin UI's "Integrations" form (per [components/admin/IntegrationsPanel.tsx](../app/src/components/admin/IntegrationsPanel.tsx)) shows env-var names rather than collecting credentials — confirming env is right, the comment is wrong.
**Possible action:**
1. **Update [example.env](../app/example.env)** to declare all 6 SMTP vars with brief explanations. The current comment lying about where SMTP creds live is the worst part.
2. **Decide:** are SMTP creds in env, or in `app_settings`? They cannot be both. The current state is "code reads from env; admin UI displays env-var names but doesn't collect them". Either:
   - Stay in env (current actual behavior). Document. Make admin UI surface "configured? yes/no" without exposing values.
   - Move to `app_settings.data` AND fix 07-F2 by splitting public vs private settings.
3. Cross-ref 07-F2 — same finding from the security-audit angle.

### 16-F4 — `next.config.ts` has a permissive CSP that's worse than no CSP
**Severity:** 🟡 Medium
**Evidence:** [next.config.ts:14–22](../app/next.config.ts#L14):
```ts
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: "img-src * data: blob:;" },
        ...
      ],
    },
    ...
  ];
}
```
**Why it matters:**
- A CSP header **with only `img-src` set** doesn't restrict scripts, styles, frames, or anything else. It's effectively meaningless for security.
- Worse: setting *any* CSP header may activate browser CSP enforcement on directives that aren't declared, causing default behaviors that subtly differ from no-CSP — but in this case the directive is so narrow it doesn't trigger anything.
- Cross-ref 10-F8: Audit 10 said "no CSP." More accurately: there's a CSP header present but it doesn't function as a security control. It exists to allow image loading from any host (paired with `images.remotePatterns: { hostname: "**" }` in the same file).
- The `dangerouslyAllowSVG: true` + `hostname: "**"` config in [next.config.ts:5–9](../app/next.config.ts#L5) means `next/image` accepts SVG from any external host. SVGs can contain `<script>` and execute when displayed. This is what the comment "dangerouslyAllow" warns about.
**Why it matters (security):**
- Admin can paste any image URL. A malicious admin (or 06-F1 mass-assignment exploit) sets a logo URL to `https://attacker/x.svg` containing JavaScript. Customer site renders it via `next/image` — script executes.
- 10-F2 (customHeadCode) + this SVG vector mean the customer site is two distinct admin-controlled XSS pathways away from compromise.
**Possible action:**
1. Set a real CSP. Cross-ref 10-F8 for the recommended baseline.
2. Lock down `images.remotePatterns` to known hosts (Supabase storage URL, Cloudflare R2, etc.).
3. Either remove `dangerouslyAllowSVG` or sanitize uploaded SVGs server-side.

### 16-F5 — `next.config.ts` declares Service-Worker headers but no `sw.js` was found in earlier audits
**Severity:** 🟡 Verify
**Evidence:** [next.config.ts:18,25–31](../app/next.config.ts#L18) sets `Service-Worker-Allowed: /` and explicit `Cache-Control: no-cache` on `/sw.js`. Suggests a service worker is expected at `/sw.js`.
**Why it matters:**
- Audit 01 inventoried [public/](../app/public/) — need to verify whether `sw.js` exists.
- If it exists, it's running on every customer page (PWA / Capacitor caching).
- If it doesn't, the headers are dead config.
**Possible action:** `ls app/public/sw.js`. If absent, remove the headers. If present, audit the SW for security implications (it can intercept all fetches, including auth flows).

### 16-F6 — example.env doesn't note that `migrate.mjs` requires `DATABASE_URL` separately
**Severity:** 🟡 Low
**Evidence:** [example.env:46–53](../app/example.env#L46) does describe `DATABASE_URL` and notes "only needed for `npm run db:migrate`". Good. But:
- The connection string format example uses postgresql://...:5432/postgres which is the direct connection — Supabase's documentation also offers a session-pooler variant on a different port. The example only shows one form.
- The instruction "Special chars in the password MUST be URL-encoded" is good but easy to miss — could move to a more visible position or add an example.
**Why it matters:** First-run setup pain. Affects onboarding more than runtime safety.
**Possible action:** Minor docs improvement; tooling helper (`npm run db:check`) that prints which env vars are missing.

### 16-F7 — Comments in example.env claim some env vars are "safe to expose" — semi-true
**Severity:** 🟡 Low
**Evidence:** [example.env:8](../app/example.env#L8): "Supabase — safe to expose to the browser". Re anon key + URL.
**Why it matters:**
- Anon key is "safe to expose" only if RLS is correctly configured (cross-ref Audit 07 — RLS has gaps in 07-F3, 07-F4, 07-F5).
- Customers reading [example.env](../app/example.env) might assume "safe means safe in all configurations" rather than "safe given correct RLS."
**Possible action:** Update comment to "Safe to expose **once RLS is correctly configured per supabase/rls_policies.sql**". Same idea, more honest.

### 16-F8 — `NODE_ENV` reads are correct (positive)
**Severity:** ⚠️ Positive
**Evidence:** Used to gate cookie `secure` flag in [auth.ts](../app/src/lib/auth.ts), [adminAuth.ts](../app/src/lib/adminAuth.ts), [auth/google/callback/route.ts:42](../app/src/app/api/auth/google/callback/route.ts#L42), etc.:
```ts
secure: process.env.NODE_ENV === "production"
```
**Why it matters:** Standard pattern; Node manages this var. Safe to keep.

### 16-F9 — No `.env.production`, `.env.development` distinction (acceptable)
**Severity:** ⚠️ Acceptable
**Evidence:** Only `.env.local` is mentioned. Vercel injects production env at deploy time; local dev uses `.env.local`. No need for environment-tagged files.
**Possible action:** None — keep simple.

### 16-F10 — `next.config.ts` has no `productionBrowserSourceMaps` toggle
**Severity:** 🟡 Low
**Evidence:** Default behavior is "no source maps in production build." That's the default and the safe choice (source maps would expose internals to anyone who pops DevTools).
**Why it matters:** Worth confirming because debugging production issues sometimes pushes teams to enable source maps inadvertently.
**Possible action:** None unless someone wants production source maps — at which point they should be uploaded to a private error-tracker (Sentry) rather than served to the browser.

## 4. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🔴 **Critical** | 16-F3 (SMTP creds documented as in `app_settings` but actually in env — or vice versa) | |
| 🔴 **High** | 16-F1 (ADMIN_JWT_SECRET undocumented but required) | |
| 🟡 **Medium** | 16-F2 (NEXT_PUBLIC_ADMIN_CONFIGURED undocumented), 16-F4 (CSP header is decorative; SVG hosts unrestricted) | |
| 🟡 **Low** | 16-F5 (sw.js verify), 16-F6 (DATABASE_URL onboarding hints), 16-F7 ("safe to expose" wording), 16-F10 (source maps verify) | |
| ⚠️ **Acceptable / positive** | 16-F8 (NODE_ENV usage), 16-F9 (no env-tag files needed) | |

## 5. Highest-ROI fixes

1. **16-F1 — Add `ADMIN_JWT_SECRET` to [example.env](../app/example.env)** with a clear comment explaining its relationship to `AUTH_JWT_SECRET`. Or better: unify per 09-F11 and drop `ADMIN_JWT_SECRET`.
2. **16-F3 — Resolve the SMTP-source contradiction.** Either:
   - Update [example.env](../app/example.env) to declare all 6 SMTP vars and remove the misleading "they live in app_settings" comment. (Code stays as-is.)
   - Migrate SMTP creds to `app_settings.data` (private side, after 07-F2 split). (Code changes.)
3. **16-F2 — Document or remove `NEXT_PUBLIC_ADMIN_CONFIGURED`.** Probably remove + replace with a server-side check.
4. **16-F4 — Tighten CSP and image hosts** in [next.config.ts](../app/next.config.ts). Cross-ref 10-F8.
5. **16-F5 — Verify** `app/public/sw.js` existence; remove dead config or audit the SW.

## 6. Open questions for the user

1. **SMTP source of truth (16-F3):** is the intent that SMTP creds are in env vars (current reality) or in `app_settings` (current docs)? Once decided, we update one or the other.
2. **`ADMIN_JWT_SECRET` consolidation (16-F1):** OK to make admin auth use the `AUTH_JWT_SECRET ?? ADMIN_JWT_SECRET` fallback chain so one env var works for the whole app?
3. **`NEXT_PUBLIC_ADMIN_CONFIGURED` purpose (16-F2):** what was this flag for originally? If it's the "show first-run setup hint" toggle, replace with a server-side check on `app_settings`.
4. **PWA / service worker (16-F5):** is there a service worker in production? The `next.config.ts` headers suggest yes; need to verify and audit.
5. **Image host allowlist (16-F4):** what are the actual image hosts you serve from (Supabase storage URL, R2, …)? Once known, lock down `images.remotePatterns`.

## 7. Phase 6 closeout

This concludes **Phase 6 — Build & deploy hygiene** and the **full audit pass** (Audits 01–16).

## 8. Audit pass — final summary

Across **16 audits in 6 phases**, the cleanup catalog now contains **~210 individual findings** with severities, evidence, and fix shapes. Headline themes:

- **Phase 1 (Inventory & structure):** 50 findings. The codebase is a single-tier SPA with god pages ([pos/page.tsx](../app/src/app/pos/page.tsx) at 6,746 lines), no feature modules, ~900 lines of dead components, and 30+ duplicate date-format helpers.
- **Phase 2 (State & data flow):** ~25 findings. POS treats localStorage as master and DB as slave (admin reports unreachable across devices); `AppContext` is a 1,500-line god provider exposing 74 fields.
- **Phase 3 (Security):** 62 findings, including critical ones — open SMTP relay, SSRF print endpoint, mass-assignment in 5 admin routes, customer→staff stored XSS via unescaped receipts, RLS gaps that expose every order's data and let attackers mass-cancel reservations.
- **Phase 4 (API layer):** ~37 findings. Coupon usage and store credit have lost-update bugs; reservations have a TOCTOU race (double-booking); zero declared indexes; 5 admin endpoints do mass-assignment.
- **Phase 5 (Frontend quality):** 23 findings. 94% of components are client; eslint config has zero project-specific rules; AppContext is the typing-erosion hotspot.
- **Phase 6 (Build & deploy):** ~25 findings. Two transitive moderate advisories; SMTP env-vs-app_settings contradiction; CSP header is decorative.

**Recommended next step:** stop auditing, start fixing. The audit files are durable references; pick the highest-ROI items per phase and queue the first refactor PR. The audits cross-reference each other, so a single PR can often close a finding across multiple files (e.g. adopt zod → closes 08-F1, 08-F3, 08-F4, 13-F1; adopt server-only → closes 07-F1, 14-F5).
