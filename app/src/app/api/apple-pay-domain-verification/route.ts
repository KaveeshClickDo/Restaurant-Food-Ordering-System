/**
 * GET /api/apple-pay-domain-verification
 *
 * Apple Pay domain verification endpoint. Stripe requires the merchant's
 * domain to expose a specific file at
 *   /.well-known/apple-developer-merchantid-domain-association
 * — `next.config.ts` rewrites that URL to this route so the file contents
 * can be loaded from an env var (APPLE_PAY_DOMAIN_ASSOCIATION) instead of
 * being committed.
 *
 * Setup (one-time, per environment):
 *   1. In Stripe Dashboard, Settings → Payment methods → Apple Pay → add domain.
 *   2. Download the verification file Stripe provides.
 *   3. Paste its full contents (one long alphanumeric string, no whitespace)
 *      into APPLE_PAY_DOMAIN_ASSOCIATION.
 *   4. Deploy, then click "Verify" in Stripe Dashboard. After verification,
 *      Apple Pay starts appearing automatically in the PaymentElement for
 *      Safari users — no code change required.
 *
 * Returns 404 when the env var is missing so misconfiguration is loud,
 * rather than serving an empty 200 that would silently fail Stripe's check.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const body = process.env.APPLE_PAY_DOMAIN_ASSOCIATION;
  if (!body || !body.trim()) {
    return new NextResponse("Apple Pay domain association not configured.", { status: 404 });
  }
  return new NextResponse(body.trim(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
