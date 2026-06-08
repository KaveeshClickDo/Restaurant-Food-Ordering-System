/**
 * Stripe server-side SDK singleton.
 *
 * Server-only. Never import from a "use client" file. The secret key is read
 * lazily so a missing key produces a clear runtime error in the route handler
 * (returned as JSON 500 via withError), rather than crashing the Next.js
 * dev server at import time.
 *
 * Currency handling:
 *   Stripe expects integer amounts in the smallest unit of the presentment
 *   currency. Most are 2-decimal (e.g. £1.50 → 150), some are zero-decimal
 *   (JPY, KRW: ¥150 → 150), and a few three-decimal (KWD, BHD: not in our
 *   preset list, so unsupported here). Use toStripeAmount() rather than
 *   multiplying by 100 directly.
 */

import Stripe from "stripe";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Add it to .env.local (sk_test_… for development).",
      );
    }
    _stripe = new Stripe(key, {
      // Pin the API version so Stripe library upgrades don't silently change
      // the wire shape. Update intentionally when bumping behaviour.
      apiVersion: "2026-04-22.dahlia",
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Convert a decimal amount in the merchant's currency to the integer Stripe
 * expects (smallest unit). Rounds to the nearest unit to avoid floating-point
 * drift on values like 19.99 * 100 = 1998.9999999.
 */
export function toStripeAmount(amount: number, currency: string): number {
  const cc = currency.toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(cc)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

/** Inverse of toStripeAmount — used when reading refund amounts back from Stripe. */
export function fromStripeAmount(stripeAmount: number, currency: string): number {
  const cc = currency.toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(cc)) {
    return stripeAmount;
  }
  return Math.round(stripeAmount) / 100;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set. Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` for local dev and copy the whsec_… value into .env.local.",
    );
  }
  return secret;
}
