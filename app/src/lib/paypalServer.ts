/**
 * PayPal server-side helpers.
 *
 * Server-only. Never import from a "use client" file. Credentials are read
 * lazily so a missing key produces a clear runtime error in the route handler
 * rather than crashing the Next.js dev server at import time.
 *
 * We talk to PayPal over plain REST (no SDK) — the surface area we need is
 * tiny (create order, capture, refund, verify webhook) and the official SDK
 * pulls in a lot of weight for very little gain. OAuth tokens are cached in
 * memory for their declared lifetime; we re-fetch when the cached token is
 * within 60 seconds of expiry.
 *
 * Currency handling:
 *   PayPal expects decimal strings ("12.50") with currency-specific decimal
 *   counts. Most currencies are 2-decimal; a handful are zero-decimal (JPY,
 *   HUF, TWD) and PayPal will reject a value with cents for those. Use
 *   toPaypalAmount() rather than `String(amount.toFixed(2))` directly.
 */

// Currencies PayPal treats as zero-decimal — payments must be sent as whole
// integers ("100" not "100.00"). HUF is rejected with decimals even though
// the wider world uses 2-decimal forms. JPY/TWD follow ISO 4217.
const PAYPAL_ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "HUF", "TWD"]);

export type PaypalEnv = "sandbox" | "live";

interface CachedToken {
  accessToken: string;
  expiresAt:   number; // epoch ms
}

let _tokenCache: CachedToken | null = null;

export function getPaypalEnv(): PaypalEnv {
  const raw = (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase();
  return raw === "live" ? "live" : "sandbox";
}

export function getPaypalApiBase(): string {
  return getPaypalEnv() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getCredentials(): { clientId: string; clientSecret: string } {
  // Read the server-side client id from either name. NEXT_PUBLIC_PAYPAL_CLIENT_ID
  // is the canonical one (it's the same value as the browser script uses),
  // but PAYPAL_CLIENT_ID is accepted as a fallback so server-only deploys
  // don't have to expose the variable to the bundler.
  const clientId =
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ??
    process.env.PAYPAL_CLIENT_ID ??
    "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "PayPal credentials not configured. Set NEXT_PUBLIC_PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local (sandbox values during development).",
    );
  }
  return { clientId, clientSecret };
}

export function getPaypalWebhookId(): string {
  const id = process.env.PAYPAL_WEBHOOK_ID ?? "";
  if (!id) {
    throw new Error(
      "PAYPAL_WEBHOOK_ID is not set. Create a webhook in the PayPal Developer dashboard and paste its ID into .env.local.",
    );
  }
  return id;
}

/** True when at least the bare minimum (id + secret) is configured. */
export function paypalIsConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID) &&
    process.env.PAYPAL_CLIENT_SECRET,
  );
}

/**
 * Fetch (and cache) an OAuth 2.0 access token. PayPal tokens are bearer
 * tokens valid for ~9 hours; we re-use the cached one until 60s before
 * expiry to avoid mid-request invalidation.
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt - 60_000 > now) {
    return _tokenCache.accessToken;
  }
  const { clientId, clientSecret } = getCredentials();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${getPaypalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    // Token endpoint is a backend call — don't let any framework caching
    // intercept it.
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal OAuth failed (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("PayPal OAuth response missing access_token.");

  const lifetimeMs = ((json.expires_in ?? 32_000) * 1000);
  _tokenCache = {
    accessToken: json.access_token,
    expiresAt:   now + lifetimeMs,
  };
  return json.access_token;
}

/**
 * Authenticated PayPal REST call. Returns the parsed JSON body and the HTTP
 * status; callers decide what counts as success. We do NOT throw on non-2xx
 * because some endpoints (verify-webhook-signature) return rich JSON we want
 * to inspect on any status.
 */
export async function paypalFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; data: T }> {
  const token = await getAccessToken();
  const res = await fetch(`${getPaypalApiBase()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept:         "application/json",
      ...(init.headers ?? {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { raw: text }; }
  }
  return { status: res.status, data: data as T };
}

/**
 * Format a decimal amount as the string PayPal expects. Rounds to the
 * currency's decimal count to avoid 0.1 + 0.2 = 0.30000000000000004 leaking
 * into the API.
 */
export function toPaypalAmount(amount: number, currency: string): string {
  const cc = currency.toUpperCase();
  if (PAYPAL_ZERO_DECIMAL_CURRENCIES.has(cc)) {
    return String(Math.round(amount));
  }
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/** Inverse — used when reading capture / refund amounts back from PayPal. */
export function fromPaypalAmount(amountStr: string): number {
  const n = Number(amountStr);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Verify a webhook delivery using PayPal's signature-verification endpoint.
 * PayPal does not give merchants a static signing secret (the way Stripe
 * does); instead we POST the headers + body back to PayPal which tells us
 * whether the signature is valid for our configured webhook id.
 */
export async function verifyPaypalWebhook(args: {
  headers:    Record<string, string | null | undefined>;
  rawBody:    string;
  webhookId:  string;
}): Promise<boolean> {
  const h = args.headers;
  const required = [
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ];
  for (const key of required) {
    if (!h[key]) return false;
  }

  // PayPal requires the body re-parsed as an object inside the verification
  // payload — not the raw string. We do this round-trip explicitly so a
  // malformed body fails verification rather than crashing the route.
  let parsedBody: unknown;
  try { parsedBody = JSON.parse(args.rawBody); }
  catch { return false; }

  const { status, data } = await paypalFetch<{ verification_status?: string }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: {
        auth_algo:         h["paypal-auth-algo"],
        cert_url:          h["paypal-cert-url"],
        transmission_id:   h["paypal-transmission-id"],
        transmission_sig:  h["paypal-transmission-sig"],
        transmission_time: h["paypal-transmission-time"],
        webhook_id:        args.webhookId,
        webhook_event:     parsedBody,
      },
    },
  );

  return status === 200 && data?.verification_status === "SUCCESS";
}
