# Audit 15 — Dependencies

**Phase:** 6 — Build & deploy hygiene
**Date:** 2026-05-05
**Scope:** [app/package.json](../app/package.json) — production deps, dev deps, optional deps. Outdated versions, security advisories, unused / misplaced packages, peer dependencies, types-package placement.
**Mode:** Read-only

---

## 1. Methodology

1. Ran `npm audit --json` for security advisories.
2. Ran `npm outdated --json` for version drift.
3. Cross-referenced every direct dependency against `import` statements in source.
4. Checked `@types/*` placement (devDeps vs prod deps) for runtime/type-only correctness.
5. Verified each package's purpose against actual import patterns.

## 2. Direct-dependency inventory

### Production dependencies (8)

| Package | Declared | Latest | Notes |
|---|---|---|---|
| `@supabase/supabase-js` | `^2.103.2` | 2.105.3 | Patch behind. ✓ used everywhere. |
| `@types/bcryptjs` | `^2.4.6` | — | **Misplaced** — type packages belong in devDependencies. See 15-F1. |
| `bcryptjs` | `^3.0.3` | — | Used in 6 routes for password hashing. ✓ |
| `lucide-react` | `^1.8.0` | 1.14.0 | Minor behind. Imported across many components. ✓ |
| `next` | `15.5.15` | 16.2.4 | One major behind. See 15-F3. |
| `nodemailer` | `^8.0.5` | 8.0.7 | Patch behind. ✓ |
| `react` | `19.1.0` | 19.2.5 | Minor behind. ✓ |
| `react-dom` | `19.1.0` | 19.2.5 | Minor behind. ✓ |

### Dev dependencies (12)

| Package | Declared | Latest | Notes |
|---|---|---|---|
| `@capacitor/android` | `^7.6.2` | 8.3.1 | One major behind. See 15-F4. |
| `@capacitor/cli` | `^7.6.2` | 8.3.1 | One major behind. |
| `@capacitor/splash-screen` | `^7.0.5` | 8.0.1 | One major behind. |
| `@eslint/eslintrc` | `^3` | — | Current. |
| `@tailwindcss/postcss` | `^4` | 4.2.4 | Current. |
| `@types/node` | `^20` | 25.6.0 | **Five majors behind**, but bound to Node 20 deploy target. See 15-F2. |
| `@types/nodemailer` | `^8.0.0` | — | ✓ correctly in devDeps. |
| `@types/react` | `^19` | — | ✓ |
| `@types/react-dom` | `^19` | — | ✓ |
| `eslint` | `^9` | 10.3.0 | One major behind. |
| `eslint-config-next` | `15.5.15` | 16.2.4 | Pinned to next major. |
| `pg` | `^8.20.0` | — | Used **only** by [migrate.mjs](../app/migrate.mjs) one-shot script — see 15-F5. |
| `tailwindcss` | `^4` | 4.2.4 | Current. |
| `typescript` | `^5` | 5.9.3 | Current. |

### Optional dependencies (1)

| Package | Declared | Notes |
|---|---|---|
| `@capacitor/core` | `^7.6.2` | Optional so the Next.js build doesn't fail when Capacitor isn't installed. ✓ — `lib/capacitorBridge.ts` reads `window.Capacitor` at runtime, never imports the package. Clever. |

**Total installed:** 499 packages (34 prod / 431 dev / 82 optional).

## 3. Security advisories

`npm audit` reports **2 moderate vulnerabilities** (both transitive via the same chain):

| Advisory | Package | Severity | Direct? | Fix |
|---|---|---|---|---|
| GHSA-qx2v-qp2m-jg93 — XSS via unescaped `</style>` in PostCSS stringify | `postcss < 8.5.10` | Moderate (CVSS 6.1) | No (transitive via `next`) | Upgrade to next that pulls postcss ≥ 8.5.10 |
| Effect | `next 9.3.4-canary.0 — 16.3.0-canary.5` | Moderate | Direct | Upgrade past affected range |

**Risk in this codebase:** the PostCSS XSS vector applies to build-time CSS processing, not runtime user input. To exploit, an attacker would need to inject crafted CSS into the build pipeline (admin-uploaded CSS via `customHeadCode` is closer to runtime — that's 10-F2's territory, separate concern). Practical exploit risk is low here, but the advisory still applies.

## 4. Findings

### 15-F1 — `@types/bcryptjs` is in production dependencies (should be dev)
**Severity:** 🟡 Low
**Evidence:** [package.json:17](../app/package.json#L17): `"@types/bcryptjs": "^2.4.6"` is listed under `dependencies`. Type-only packages don't ship to runtime — they belong in `devDependencies`.
**Why it matters:**
- Production install (`npm install --production`) downloads it pointlessly. Build-server bandwidth + image size.
- Inconsistent with `@types/nodemailer`, `@types/react`, `@types/react-dom`, `@types/node` which are correctly in `devDependencies`.
- `@types/bcryptjs` has been deprecated upstream — bcryptjs 3.x ships its own types. So this dependency is doubly redundant.
**Possible action:**
1. Move to `devDependencies` (or remove entirely if bcryptjs 3.x types work — try `import bcrypt from "bcryptjs"` after deletion).

### 15-F2 — `@types/node` pinned to v20 while latest is v25
**Severity:** ⚠️ Likely intentional (verify)
**Evidence:** `^20.19.39` declared; `25.6.0` available.
**Why it matters:**
- `@types/node` should match the Node runtime your build/deploy targets. v20 LTS is supported through April 2026, then maintenance through April 2026.
- Vercel currently defaults to Node 22 (latest LTS at time of writing). Many hosts have moved on.
- Mismatch isn't dangerous — extra v22+ APIs just won't have types. But `@types/node` v20 may be missing types for newer Node 22+ features (e.g. `node:test` improvements, `--watch` mode declarations).
**Possible action:** Confirm deploy target Node version. If Node 22 is the intent, bump `@types/node` to `^22`. Otherwise leave as-is and re-evaluate when Node 20 leaves LTS.

### 15-F3 — Next.js v15.5.15, latest is v16.2.4 (one major behind)
**Severity:** 🟡 Medium (security + ecosystem alignment)
**Evidence:** Outdated check shows `next: 15.5.15 → 16.2.4`.
**Why it matters:**
- Major version skip; Next.js 16 has breaking changes (caching defaults, Turbopack as default dev, runtime config, etc.).
- The PostCSS advisory (15-F3) above is pulled in via Next; upgrading might or might not fix it depending on Next 16's transitive deps.
- `eslint-config-next` is pinned to match `next` (`15.5.15`); both must move together.
- Next 15 → 16 typically requires: testing the migration path (Vercel's codemods help), reviewing async params handling, route handler signatures.
**Possible action:**
1. Hold off on Next 16 if the codebase has uses that broke (e.g. some sync APIs were deprecated). Roadmap: stabilize Phase 1–5 cleanups first, then plan a Next 16 upgrade as a focused PR.
2. Until then, run `npm audit fix` periodically to pick up patch-level Next releases on the v15 branch.

### 15-F4 — Capacitor packages one major behind (v7 → v8)
**Severity:** 🟡 Low (mobile-only)
**Evidence:** `@capacitor/android`, `@capacitor/cli`, `@capacitor/splash-screen`, `@capacitor/core` all `^7.x` while latest is `8.x`.
**Why it matters:**
- Capacitor 8 has Gradle / Android SDK target updates; Google Play Store enforces minimum target SDK levels and rejects apps below threshold.
- If the Android wrapper is published to Play Store, this matters for keeping the app installable. If it's only distributed in-house / sideloaded, low priority.
**Possible action:** Defer to whenever the Android shell is next updated. Cross-ref 14-F11 (deployment-shape question — is Capacitor actively used?).

### 15-F5 — `pg` is in devDependencies but is a runtime dependency of `migrate.mjs`
**Severity:** 🟡 Low
**Evidence:** [package.json:36](../app/package.json#L36): `"pg": "^8.20.0"` in `devDependencies`. [migrate.mjs:16](../app/migrate.mjs#L16) imports it: `import pg from "pg";`.
**Why it matters:**
- `migrate.mjs` is a one-shot CLI script run via `npm run db:migrate`. It runs locally during setup, not in production.
- Putting `pg` in `devDependencies` means a production install can't run migrations. Probably correct intent — migrations run from a developer machine — but worth being explicit.
**Possible action:** Keep as-is. Document in the migrate runbook that `npm install` (with devDeps) is required to run migrations.

### 15-F6 — `lucide-react` minor-behind across many call sites
**Severity:** 🟡 Low
**Evidence:** `lucide-react: 1.8.0 → 1.14.0`. Imported in ~50 files (icons everywhere).
**Why it matters:**
- Lucide is icon-set. Minor releases bring new icons + breaking changes to obscure ones. Risk of breakage is low.
- Bundle size: `lucide-react` tree-shakes per import, so version doesn't materially affect bundle.
**Possible action:** `npm install lucide-react@latest` — should be a no-op. Defer to whenever next admin/shell touch goes in.

### 15-F7 — `react` / `react-dom` minor-behind 19.1 → 19.2
**Severity:** 🟡 Low
**Evidence:** Latest 19.2.5; declared 19.1.0.
**Why it matters:** React 19 is stable; minor versions are usually safe. The `<title>` / `<meta>` hoisting that [SeoHead.tsx](../app/src/components/SeoHead.tsx) relies on landed in 19.0; 19.2 has no breaking changes I'm aware of.
**Possible action:** Bump together in a future PR. Re-test SEO meta-rendering.

### 15-F8 — All declared production deps are actually used
**Severity:** ⚠️ Positive
**Evidence:**
- `@supabase/supabase-js` — imported in [lib/supabase.ts](../app/src/lib/supabase.ts), [lib/supabaseAdmin.ts](../app/src/lib/supabaseAdmin.ts), [middleware.ts](../app/src/middleware.ts).
- `bcryptjs` — used in 6 auth-related routes.
- `nodemailer` — used in [lib/emailServer.ts](../app/src/lib/emailServer.ts), [api/email/route.ts](../app/src/app/api/email/route.ts).
- `lucide-react` — icons everywhere.
- `next`, `react`, `react-dom` — framework.
**Why it matters:** No prod-bloat from unused packages. Worth keeping audit hygiene.
**Possible action:** None.

### 15-F9 — No `peerDependencies` declared
**Severity:** 🟡 Low
**Evidence:** [package.json](../app/package.json) has no `peerDependencies`. This is correct for an end-application (only libraries declare peers).
**Why it matters:** N/A — flagging only because the audit checklist mentioned it. App is correctly not a library.
**Possible action:** None.

### 15-F10 — `@capacitor/core` as `optionalDependencies` is a clever pattern
**Severity:** ⚠️ Positive
**Evidence:** [package.json:39–41](../app/package.json#L39):
```json
"optionalDependencies": {
  "@capacitor/core": "^7.6.2"
}
```
And [lib/capacitorBridge.ts:7–9](../app/src/lib/capacitorBridge.ts#L7) explicitly does NOT import the package — it reads `window.Capacitor` injected at runtime by the Android shell.
**Why it matters:**
- Web build doesn't fail when `@capacitor/core` is unavailable.
- Android build (when Capacitor is fully installed) gets the runtime injection.
- The cli / splash-screen are dev-only Android tooling.
**Possible action:** None — keep this. Document in [docs/](../docs/) as a deliberate pattern.

### 15-F11 — `package-lock.json` not audited for committed status
**Severity:** ⚠️ Verify
**Evidence:** [app/package-lock.json](../app/package-lock.json) exists in the repo (per Audit 01 inventory). That's the standard Next.js setup.
**Why it matters:** Commit lock file means deterministic builds across machines. Already in place. No action.

### 15-F12 — Heavy dev-deps tree (431 dev packages)
**Severity:** 🟡 Low
**Evidence:** `npm audit` reports 431 dev dependencies. This is normal for a Next.js + Capacitor + ESLint + Tailwind project.
**Why it matters:** Local install size + cold-CI time. Not a vulnerability concern.
**Possible action:** None.

### 15-F13 — Recommendation: adopt zod / valibot (cross-ref 08-F16)
**Severity:** 🟡 Recommendation only
**Evidence:** No schema validation library currently. Cross-ref 08-F16, 13-F1.
**Why it matters:** Audits 08 and 13 both recommend a runtime schema validator as the right fix for several findings (mass-assignment, row mappers, settings shape). When added, it'd be the first new dependency in this audit's scope.
**Possible action:** Pick one (zod ~12 KB gzip server-only, valibot ~3 KB tree-shaken). Add to `dependencies`.

### 15-F14 — Recommendation: adopt `server-only` (cross-ref 07-F1)
**Severity:** 🟡 Recommendation only
**Evidence:** Audit 07 (07-F1) recommends adding `server-only` to flag server-only modules at build time. The package is published by Vercel.
**Why it matters:** Tiny dep (essentially a marker package). Catches client/server boundary violations that today depend on convention.
**Possible action:** `npm install server-only` — add `import "server-only"` to [lib/supabaseAdmin.ts](../app/src/lib/supabaseAdmin.ts), [lib/auth.ts](../app/src/lib/auth.ts), [lib/adminAuth.ts](../app/src/lib/adminAuth.ts), [lib/waiterAuth.ts](../app/src/lib/waiterAuth.ts), [lib/emailServer.ts](../app/src/lib/emailServer.ts), [lib/rateLimit.ts](../app/src/lib/rateLimit.ts), [lib/apiHandler.ts](../app/src/lib/apiHandler.ts).

### 15-F15 — Recommendation: adopt DOMPurify (cross-ref 10-F3 / 10-F10)
**Severity:** 🟡 Recommendation only
**Evidence:** Audit 10 found that the [RichEditor](../app/src/components/admin/RichEditor.tsx) saves raw HTML and downstream `dangerouslySetInnerHTML` callsites have either no sanitization or fragile regex sanitization.
**Why it matters:** ~10 KB gzip. Standard, well-maintained sanitizer.
**Possible action:** `npm install isomorphic-dompurify` (works on both server + client). Use in the rich-text save path and in the email preview.

## 5. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🟡 **Medium** | 15-F3 (Next.js one major behind, transitive PostCSS advisory) | |
| 🟡 **Low** | 15-F1 (@types/bcryptjs in prod deps), 15-F2 (@types/node version), 15-F4 (Capacitor major behind), 15-F5 (pg dev placement), 15-F6 (lucide minor), 15-F7 (react minor), 15-F12 (dev tree size) | |
| ⚠️ **Verify** | 15-F11 (lock file), 15-F2 (Node version intent) | |
| ⚠️ **Recommendation** | 15-F13 (add zod / valibot), 15-F14 (add server-only), 15-F15 (add DOMPurify) | |
| ⚠️ **Positive** | 15-F8 (no unused prod deps), 15-F9 (no peer deps required), 15-F10 (Capacitor optional pattern) | |

## 6. Highest-ROI fixes

1. **15-F1** — Move `@types/bcryptjs` to devDependencies (or delete if bcryptjs 3.x types work). One-line edit.
2. **15-F14** — Install `server-only` and import in the 7 server-only modules. Closes the client-leak class structurally.
3. **15-F13** — Install zod (or valibot) as the centerpiece of Phase-3 input validation fixes (08-F1, 08-F3, 08-F4, 13-F1).
4. **15-F15** — Install `isomorphic-dompurify` and apply per 10-F3 / 10-F10.
5. **Patch sweep:** `npm update` to pull in the patch-level releases of Supabase, nodemailer, Tailwind, react, react-dom, lucide-react. Run tests / smoke-test the build.
6. **15-F3 (Next 16):** Defer until Phase 1–5 cleanups are stable. Plan as a focused upgrade PR.

## 7. Open questions for the user

1. **Node version target (15-F2):** what Node version is your production deploy on (Vercel default? Self-hosted Node 20? Node 22)? Determines `@types/node` upgrade target.
2. **Capacitor (15-F4):** is the Android wrapper actively used / published to Play Store? Drives priority of the Capacitor 8 upgrade.
3. **Next 16 (15-F3):** comfortable scheduling a Next 15 → 16 upgrade in a focused PR after Phase 1 cleanups land?
4. **Validation library (15-F13):** zod or valibot? Cross-ref 08-F16.

## 8. What's next

- **Audit 16 — Env parity** ([16-env-parity.md](./16-env-parity.md), pending). Will cross-reference [example.env](../app/example.env) against every `process.env.*` access in the codebase, document drift, and check for `NEXT_PUBLIC_*` variables that shouldn't be public.
