# Audit 13 — TypeScript Escape Hatches

**Phase:** 5 — Frontend quality
**Date:** 2026-05-05
**Scope:** Every `any`, `as any`, `as unknown`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, and `// eslint-disable*` across [app/src/](../app/src/). Plus `tsconfig.json` posture, `eslint.config.mjs` rule strictness, and what each disabled rule actually allows.
**Mode:** Read-only

---

## 1. Methodology

1. Counted occurrences of each escape hatch.
2. Categorized which ESLint rules are most often disabled.
3. Read [tsconfig.json](../app/tsconfig.json) and [eslint.config.mjs](../app/eslint.config.mjs) to characterize the project's strictness baseline.
4. Sampled the most-affected files (top of each grep) to see whether the escape hatches are pragmatic (boundary code) or papering over real type holes.

## 2. Tooling baseline

### tsconfig
- `"strict": true` ✓ (enables `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.)
- `"target": "ES2017"` — fine.
- **Not enabled:** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Each of these would catch a different real-world bug class.
- `"allowJs": true` — useful only if there are JS files. Worth checking.

### eslint
- Extends `next/core-web-vitals` and `next/typescript` (the standard Next.js bundle).
- **No project-specific rules added.** No `no-restricted-imports`, no rule to flag `any`, no rule to enforce import boundaries.

## 3. Statistics

**Total escape-hatch lines:** ~115 across `.ts`/`.tsx`. Distribution:

| Hatch | Count | Notes |
|---|---:|---|
| `// eslint-disable-next-line @typescript-eslint/no-explicit-any` | **25** | Suppressing the lint rule that flags `: any` and `as any` |
| `// eslint-disable-next-line @next/next/no-img-element` | **27** (16 + 11 with closing JSX brace) | Allowing native `<img>` instead of `next/image` |
| `// eslint-disable-next-line react-hooks/exhaustive-deps` | **22** (15 + 7 inline) | Suppressing hook-deps warning |
| `// eslint-disable-next-line @typescript-eslint/no-unused-vars` | **6** | Suppressing unused-var (mostly destructured-rename pattern) |
| `// eslint-disable-next-line @next/next/no-html-link-for-pages` | **1** | OAuth hard-redirect |
| `as any` | **3** lines | Two in [AppContext.tsx](../app/src/context/AppContext.tsx), one in [admin/users/route.ts](../app/src/app/api/admin/users/route.ts) |
| `as unknown` | **5** lines | escpos.ts, pos/page.tsx (×2), orders/route.ts, auth/google/callback/route.ts |
| `: any` annotations | **20+** lines | Concentrated in [AppContext.tsx](../app/src/context/AppContext.tsx) (9 hits) |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | **0** ✓ | None — positive finding |

The 0 `@ts-ignore` count is the most encouraging signal. The rest is a mix of pragmatic boundary code (DB row types, Realtime payloads) and avoidable concessions.

## 4. Findings

### 13-F1 — `AppContext.tsx` is the single largest hotspot for type erosion
**Severity:** 🟡 Medium
**Evidence:** [context/AppContext.tsx](../app/src/context/AppContext.tsx) alone has:
- 9 `: any` annotations.
- 2 `as any` casts.
- 12 `// eslint-disable-next-line` comments.

The `: any` parameter pattern dominates row mappers and Realtime callbacks:
```ts
function mapCategory(row: any): Category { ... }       // line 278
function mapMenuItem(row: any): MenuItem { ... }       // line 283
function mapOrder(row: any): Order { ... }             // line 299
function mapCustomer(row: any): Customer { ... }       // line 328

({ eventType, new: newRow, old: oldRow }: any) => {... // lines 646, 660, 674, 722, 756
```
Plus settings hydration:
```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const d = raw as any;                                  // line 398
setSettings(buildSettingsFromData((row as any).data ?? null));  // line 641
```

**Why it matters:**
- `any` here means "the input from Supabase / Realtime is unstructured." The mapper assigns to a typed result, so callers see typed output — but the *mapper itself* never validates the row shape. A column rename in Postgres silently produces `undefined` fields downstream, which then flow through cart, checkout, and admin reports with no compile-time complaint.
- Cross-ref 02-F2 (the same mappers are trapped inside the megaprovider) and 08-F16 (no validation library). Once mappers move to a `services/` layer with zod schemas, the `any` disappears.
**Possible action:**
1. Define `RowSchema` (zod) per table. Mapper becomes `mapCategory(row: unknown): Category { return CategoryRow.parse(row).map(...) }`. No `any`, runtime-validated.
2. For Realtime payloads, the Supabase JS types are `RealtimePostgresChangesPayload<T>` — explicitly type the callback once and you don't need `any`.

### 13-F2 — `as any` in `admin/users/route.ts` masks a typing gap on Driver row
**Severity:** 🟡 Low
**Evidence:** [admin/users/route.ts:62,85](../app/src/app/api/admin/users/route.ts#L62):
```ts
let customerRows: any[] = [];
const driverRows = (driversResult.data ?? []) as any[];
```
The DB shape is known (mapper exists in [admin/drivers/route.ts](../app/src/app/api/admin/drivers/route.ts)). Casting to `any[]` here hides that the row type isn't shared.
**Why it matters:** Future column renames break silently.
**Possible action:** Define a shared `DriverRow` / `CustomerRow` interface in [types/](../app/src/types/) (or per-feature `repositories/`) and import it.

### 13-F3 — Realtime callback parameters typed as `any`
**Severity:** 🟡 Low
**Evidence:** [AppContext.tsx:646–756](../app/src/context/AppContext.tsx#L646) — five Supabase Realtime subscriptions, each with `({ eventType, new: newRow, old: oldRow }: any) => { ... }`.
**Why it matters:**
- Supabase JS exposes `RealtimePostgresChangesPayload<TableRow>` for typed callbacks. Using it would make `newRow.<field>` a compile-time check, so future column renames are caught.
- Currently each handler does `mapCategory(newRow)` etc. — relying on the mapper to silently do nothing if the field is missing.
**Possible action:** `import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"` and type each handler.

### 13-F4 — `Record<string, any>` in admin update routes
**Severity:** 🟡 Medium (cross-ref 08-F1 mass-assignment)
**Evidence:**
- [admin/drivers/[id]/route.ts:46](../app/src/app/api/admin/drivers/[id]/route.ts#L46): `const update: Record<string, any> = {};`
- [auth/me/route.ts:45](../app/src/app/api/auth/me/route.ts#L45): `function buildCustomer(row: any, orders: any[])`

For drivers/[id] the loose type is the *direct enabler* of the mass-assignment risk in 08-F1: an open object goes straight into Supabase update.
**Why it matters:** Type system would have caught the mass-assignment problem at the boundary if the admin update routes used a typed input shape (an "AllowedDriverUpdate" interface).
**Possible action:** Replace `Record<string, any>` with explicit interfaces. Cross-ref 08-F1 — same fix shape.

### 13-F5 — `as unknown as <Type>` chains in pos/page.tsx
**Severity:** 🟡 Low
**Evidence:** [pos/page.tsx:5694,6074](../app/src/app/pos/page.tsx#L5694):
```ts
setReservations((data ?? []) as unknown as ResRow[]);
setRows((data ?? []) as unknown as ResRowEx[]);
```
The `as unknown as X` double-cast is TS's "I really mean it" override — bypasses the structural type check entirely.
**Why it matters:** `data` shape and `ResRow[]` shape don't match (the mapper is implicit). If they did, you wouldn't need the `as unknown` step. This is a smell that a mapper is missing.
**Possible action:** Add an explicit `mapResRow(row): ResRow` mapper and call it via `.map(mapResRow)`.

### 13-F6 — 22 `react-hooks/exhaustive-deps` suppressions
**Severity:** 🟡 Medium
**Evidence:** Distribution:
- [AppContext.tsx](../app/src/context/AppContext.tsx) — multiple in the giant init effects.
- [(site)/account/page.tsx:1090,1098,1110](../app/src/app/(site)/account/page.tsx#L1090) — three in the same component.
- POSContext, MenuManagementPanel, BreakfastMenuPanel, others.

**Why it matters:**
- This is the single most error-prone lint suppression. Hooks with stale closures cause "I clicked refresh and nothing happened" bugs.
- The high count (22) suggests the codebase has effects that *depend* on stale closures rather than restructuring with `useCallback`/refs/reducers. Each one is a potential bug.
- AppContext's effect at line 470 (initial mount localStorage hydration) is a legitimate `[]` — that one is fine.
- The account-page trio look like search/filter effects where the warnings indicate real omitted deps.
**Possible action:**
1. Walk through each suppression, classify as:
   - **Legitimate run-once-on-mount** (`[]` is correct) — replace with `// eslint-disable-line` plus a comment explaining why mount-only.
   - **Intentionally stale** (depends on a value but doesn't want re-runs) — refactor with a ref pattern (`const xRef = useRef(x); xRef.current = x;`).
   - **Actually a bug** — fix the deps array; let React do the right thing.
2. Cross-ref 02-F1 (giant pos/page.tsx) — when sub-views split out, each useEffect lives in a smaller component where the right deps are obvious.

### 13-F7 — 27 `<img>` elements bypassing `next/image`
**Severity:** 🟡 Low
**Evidence:** Distribution across [account/page.tsx](../app/src/app/(site)/account/page.tsx#L415), [page.tsx](../app/src/app/page.tsx#L361), various admin panels (FooterLogosPanel, EmailTemplatesPanel, etc.).
**Why it matters:**
- `next/image` provides automatic resizing, lazy loading, AVIF/WebP serving, and CLS prevention.
- Native `<img>` is the right choice when:
  - Source is a `data:` URL (uploaded preview).
  - Source is dynamic and external (admin-uploaded URLs from any host — needs `next.config.ts` allowlist).
  - Quick prototype.
- 27 suppressions across the codebase suggest either (a) admin upload flow uses arbitrary URLs (hence allowlist friction) or (b) inertia from quick prototyping.
**Possible action:**
1. For fixed-host images (the public site logo, etc.), migrate to `next/image`.
2. For admin-uploaded URLs, configure `next.config.ts → images.remotePatterns` to allow the upload host(s), then migrate.
3. For `data:` URLs, native `<img>` stays — but document via comment instead of `eslint-disable`.

### 13-F8 — 6 `no-unused-vars` suppressions are the destructure-rename idiom
**Severity:** ⚠️ Acceptable
**Evidence:** [kitchen/auth/route.ts:53,81](../app/src/app/api/kitchen/auth/route.ts#L53), [waiter/auth/route.ts:52](../app/src/app/api/waiter/auth/route.ts#L52), [waiter/config/route.ts:32](../app/src/app/api/waiter/config/route.ts#L32), [reservations/route.ts:121](../app/src/app/api/reservations/route.ts#L121), [kitchen/config/route.ts:25](../app/src/app/api/kitchen/config/route.ts#L25). All match this pattern:
```ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { pin: _p, ...safe } = waiter;
```
The variable is intentionally extracted to drop it from the spread.
**Why it matters:** Idiomatic; lint rule's nature requires the suppression. ESLint's TypeScript variant supports `argsIgnorePattern`/`varsIgnorePattern` that would let you write `const { pin: _pin, ...safe } = waiter;` without a disable comment.
**Possible action:** Add to eslint config:
```js
"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
```
Then drop the disables.

### 13-F9 — Single `no-html-link-for-pages` suppression for OAuth flow is correct
**Severity:** ⚠️ Positive
**Evidence:** [auth/google] flow uses a hard `<a>` to bounce to Google's consent page. `Link` would do client-side routing and break OAuth. The disable is correctly justified.
**Why it matters:** Worth keeping.
**Possible action:** None.

### 13-F10 — `tsconfig` could enable additional safety nets
**Severity:** 🟡 Low (enhancement)
**Evidence:** [tsconfig.json](../app/tsconfig.json) has `"strict": true` (good) but doesn't enable:
- `noUncheckedIndexedAccess` — would flag `arr[i]` and `obj[k]` as `T | undefined`. Catches off-by-one and missing-key bugs at compile time. Has the most ROI for this codebase given how many DB rows are accessed by key.
- `exactOptionalPropertyTypes` — distinguishes `{ x?: string }` from `{ x: string | undefined }`. Catches subtle bugs around `delete obj.x` vs `obj.x = undefined`.
- `noImplicitOverride` — requires `override` keyword on overrides. Low impact in this codebase (no class hierarchy).
- `noImplicitReturns` / `noFallthroughCasesInSwitch` — the cart reducer is the obvious switch — would catch a missing case.

**Why it matters:** Each one moves a class of bug from runtime to compile time. `noUncheckedIndexedAccess` in particular pairs well with the `data: unknown` row pattern.
**Possible action:** Enable opportunistically. `noUncheckedIndexedAccess` will produce ~50–100 new errors that need fixing — schedule for after Phase 1 cleanups land.

### 13-F11 — eslint config has no project-specific rules
**Severity:** 🟡 Low
**Evidence:** [eslint.config.mjs](../app/eslint.config.mjs) extends Next.js defaults only.
**Why it matters:** Several rules would prevent regressions of bugs we found in earlier audits:
- `no-restricted-imports` — block `@/lib/supabaseAdmin` and friends from `'use client'` files (07-F1).
- `@typescript-eslint/no-explicit-any` — currently fires (the disables prove it), but it's a warning, not an error. Promoting to error forces deliberate decisions.
- `react-hooks/exhaustive-deps` is already enabled — promote to error.
**Possible action:**
```js
{
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "react-hooks/exhaustive-deps": "error",
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@/lib/supabaseAdmin", "@/lib/auth", "@/lib/adminAuth", "@/lib/waiterAuth", "@/lib/emailServer", "@/lib/rateLimit", "@/lib/apiHandler"],
        message: "Server-only module — must not be imported from client components."
      }]
    }],
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  }
}
```
The first two will produce immediate errors that need fixing — phase in.

### 13-F12 — `allowJs: true` may be unused
**Severity:** ⚠️ Verify
**Evidence:** [tsconfig.json:5](../app/tsconfig.json#L5) — `"allowJs": true`. Glob via `find c:/.../app/src -name "*.js"` would tell us if any JS files are present.
**Why it matters:** If no JS files, drop the option for slightly faster typecheck.
**Possible action:** Verify; remove if unused.

## 5. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🟡 **Medium** | 13-F1 (AppContext type-erosion concentration), 13-F4 (`Record<string, any>` in admin updates — enables mass-assignment), 13-F6 (22 exhaustive-deps suppressions), 13-F11 (no project-specific eslint rules) | |
| 🟡 **Low** | 13-F2 (admin/users uses `any[]`), 13-F3 (Realtime callbacks `any`), 13-F5 (double-`as`-cast in pos), 13-F7 (27 native `<img>`), 13-F10 (tsconfig safety nets), 13-F12 (`allowJs` likely unused) | |
| ⚠️ **Acceptable / positive** | 13-F8 (no-unused-vars destructure idiom), 13-F9 (OAuth hard-link), no `@ts-ignore` anywhere | |

## 6. Highest-ROI fixes

1. **Add eslint guardrails (13-F11).** Adopting `no-restricted-imports` for server-only modules + `no-unused-vars` `argsIgnorePattern` cleans up 13-F8 disables and prevents the supabaseAdmin client-leak class entirely.
2. **Type the row mappers in AppContext (13-F1, 13-F2, 13-F3).** Pairs naturally with 02-F2 split (mappers move to `services/` and become typed there).
3. **Replace `Record<string, any>` with allowlist interfaces (13-F4).** Same fix as 08-F1 — TypeScript was the missing guardrail.
4. **Walk through 22 exhaustive-deps suppressions (13-F6).** Mostly mechanical; one bug-fix per ~5 suppressions on average.
5. **Eventually enable `noUncheckedIndexedAccess` (13-F10).** Big-bang change but the highest-ROI tsconfig flag for code that handles DB rows.

## 7. Open questions for the user

1. **Lint level for `no-explicit-any`:** OK to promote to `"error"` after the row-mapper refactor lands? It would force every new `any` to be a deliberate per-line decision via `// eslint-disable-next-line` (which can then be reviewed).
2. **`<img>` migration (13-F7):** is admin-uploaded image hosting on a known set of hosts (e.g. only Cloudflare R2 / Supabase storage)? If yes, allowlist them in `next.config.ts`. If "any URL the admin pastes," native `<img>` stays.
3. **Schema validation library:** zod or valibot? (Cross-ref 08-F16, recurring decision.) Once chosen, the row mappers (13-F1) become its first consumers.
4. **Tsconfig escalation:** comfortable enabling `noUncheckedIndexedAccess` after Phase 1 cleanups? Expect ~50–100 new errors to fix.

## 8. What's next

- **Audit 14 — Client/server boundary** ([14-client-server-boundary.md](./14-client-server-boundary.md), pending). Will count `'use client'` markers, identify components that fetch in `useEffect` but could fetch server-side, look for client components doing heavy work (e.g. importing entire admin SDKs), and check for accidental client-leaks of server-only modules now that 07-F1 has flagged the discipline.
