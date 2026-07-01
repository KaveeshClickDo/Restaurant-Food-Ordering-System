/**
 * apiBase() — origin prefix for POS API calls.
 *
 * The Capacitor static export (`npm run build:capacitor`, Phase 1.5) bundles
 * the POS UI into the APK but **no** `/api/*` route handlers — those only exist
 * on the deployed server. So inside the bundled app, a same-origin
 * `fetch("/api/...")` would resolve to `capacitor://localhost/api/...` and 404.
 *
 * The fix: every POS API call becomes `fetch(apiBase() + "/api/...")`.
 *
 *  - **Web / PWA build:** `NEXT_PUBLIC_API_BASE_URL` is unset, so this returns
 *    `""` and calls stay same-origin relative — identical to today's behaviour.
 *  - **Capacitor build:** `scripts/build-capacitor.mjs` inlines
 *    `NEXT_PUBLIC_API_BASE_URL` (from `CAPACITOR_SERVER_URL`) at build time, so
 *    this returns e.g. `https://yourapp.vercel.app` and every call targets the
 *    real backend over the network.
 *
 * `process.env.NEXT_PUBLIC_*` is statically inlined by Next at build time, so
 * this is a constant in the bundle — no runtime env lookup, no per-call cost.
 *
 * Note: the value carries no trailing slash (call sites supply the leading
 * "/api/..."), and an empty string concatenates harmlessly on web.
 */
export function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}
