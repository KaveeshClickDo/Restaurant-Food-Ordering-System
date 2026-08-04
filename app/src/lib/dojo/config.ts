/**
 * Dojo configuration + feature-flag resolution. SERVER-SIDE ONLY (reads secrets).
 *
 * Three modes, chosen by env so the SAME code path serves dev, sandbox and prod:
 *
 *   DOJO_MODE = "off"   (default)  → feature disabled; POS behaves exactly as
 *                                    today (cash/card recorded, no terminal).
 *   DOJO_MODE = "mock"             → in-memory simulator; NO Dojo account/key
 *                                    needed. Used to build + test the whole flow
 *                                    (all outcomes) before credentials arrive.
 *   DOJO_MODE = "live"             → real https://api.dojo.tech. Requires
 *                                    DOJO_API_KEY. The key PREFIX decides the
 *                                    Dojo environment: sk_sandbox_ = sandbox,
 *                                    sk_prod_ = production. (Base URL is the same
 *                                    for both — Dojo routes by key.)
 *
 * Cutover path (per docs/dojo/dojo-integration-reference.md §2, §11):
 *   build now:  DOJO_MODE=mock
 *   sandbox:    DOJO_MODE=live  DOJO_API_KEY=sk_sandbox_…   (+ real software-house-id/reseller-id if issued)
 *   production: DOJO_MODE=live  DOJO_API_KEY=sk_prod_…      + Dojo-assigned software-house-id/reseller-id
 * No code change between them — only env values.
 *
 * SECURITY: DOJO_API_KEY / DOJO_WEBHOOK_SECRET are secrets. They live in the
 * server env (.env.local / production env) ONLY. They must NEVER be prefixed
 * NEXT_PUBLIC_ and must NEVER go in .env.capacitor (that would bake the secret
 * into the shipped APK). The POS bundle only ever calls our /api/pos/dojo/*
 * routes; it never sees these values.
 */

export type DojoMode = "off" | "mock" | "live";

/**
 * Which provider drives the terminal when mode === "live". Chosen by the
 * DOJO_PROVIDER env var, which WE set per deployment — the merchant never sees it:
 *   "dojo_cloud" (default) → api.dojo.tech REST (Terminals / payment-intents).
 *   "connect"              → legacy Paymentsense Connect (<host>.connect.paymentsense.cloud).
 * The mock is provider-agnostic, so this only takes effect in live mode.
 */
export type DojoProvider = "dojo_cloud" | "connect";

export interface DojoConfig {
  mode: DojoMode;
  provider: DojoProvider;
  baseUrl: string;
  apiKey: string;
  version: string;
  softwareHouseId: string;
  resellerId: string;
  webhookSecret: string;
  /** Optional pinned terminal id; when empty we auto-discover an Available one. */
  terminalId: string;
  /** Currency for terminal charges (ISO 4217). */
  currencyCode: string;
}

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * Resolve the active mode. "live" requires a key; if DOJO_MODE=live but no key
 * is set we fall back to "off" (fail safe — never pretend to be live without a
 * key). An explicit DOJO_MODE=mock needs no key.
 */
export function dojoMode(): DojoMode {
  const raw = env("DOJO_MODE", "off").toLowerCase();
  if (raw === "mock") return "mock";
  if (raw === "live") return env("DOJO_API_KEY") ? "live" : "off";
  return "off";
}

/**
 * Which provider to use in live mode. Defaults to "dojo_cloud" (api.dojo.tech);
 * any unrecognised value also falls back to "dojo_cloud" — the built + tested
 * provider — so a typo can never silently pick the unfinished Connect adapter.
 * WE set this per deployment; merchants never see or control it.
 */
export function dojoProvider(): DojoProvider {
  return env("DOJO_PROVIDER", "dojo_cloud").toLowerCase() === "connect" ? "connect" : "dojo_cloud";
}

/** The POS "Pay on terminal" option is available when a mode is active. */
export function isDojoEnabled(): boolean {
  return dojoMode() !== "off";
}

/** True when we're talking to the real Dojo sandbox (vs production or mock). */
export function isDojoSandboxKey(): boolean {
  return env("DOJO_API_KEY").startsWith("sk_sandbox_");
}

export function dojoConfig(): DojoConfig {
  return {
    mode: dojoMode(),
    provider: dojoProvider(),
    baseUrl: env("DOJO_API_BASE", "https://api.dojo.tech").replace(/\/+$/, ""),
    apiKey: env("DOJO_API_KEY"),
    version: env("DOJO_API_VERSION", "2026-02-27"),
    // Sandbox dummies are the documented public values; production values are
    // assigned by Dojo during onboarding.
    softwareHouseId: env("DOJO_SOFTWARE_HOUSE_ID", "softwareHouse1"),
    resellerId: env("DOJO_RESELLER_ID", "reseller1"),
    webhookSecret: env("DOJO_WEBHOOK_SECRET"),
    terminalId: env("DOJO_TERMINAL_ID"),
    currencyCode: env("DOJO_CURRENCY_CODE", "GBP"),
  };
}
