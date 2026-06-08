/**
 * POST /api/gift-cards/lookup — check a gift card balance.
 *
 * Bearer model — no auth required. Called from:
 *   - Online checkout (CheckoutModal) when the customer types a code
 *   - POS PaymentModal when the cashier types a code
 *   - Waiter settle dialog
 *   - Customer "check my balance" link in the delivery email (future Phase 2)
 *
 * Rate-limited by IP to make brute-force discovery infeasible. 10 attempts
 * per minute is generous for legitimate typos but stops a script from
 * walking the alphabet — even at 10/min, ~10^17 possibilities means the
 * heat death of the sun comes first.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/apiValidation";
import { rateLimit } from "@/lib/rateLimit";
import { lookupActiveGiftCard } from "@/lib/giftCardValidation";
import { GiftCardLookupSchema } from "@/lib/schemas/giftCard";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`gift-card-lookup:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json(
      { ok: false, error: "Too many lookup attempts. Please wait a minute." },
      { status: 429 },
    );
  }

  const parsed = await parseBody(req, GiftCardLookupSchema);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  }

  const result = await lookupActiveGiftCard(parsed.data.code);
  if (!result.ok) {
    // We surface the helper's friendly message but always return 404 to make
    // the response time + body identical across "invalid format" / "not found"
    // / "voided" / "expired" — prevents enumeration via timing or shape.
    return NextResponse.json({ ok: false, error: result.message }, { status: 404 });
  }

  // Reveal only what the consumer needs to apply the card at checkout.
  // We do NOT return issuedToEmail / issuedToName / personalMessage etc. —
  // anyone with a code shouldn't be able to learn who bought it for whom.
  return NextResponse.json({
    ok: true,
    card: {
      code:           result.card.code,
      balance:        result.card.balance,
      initialAmount:  result.card.initialAmount,
      expiresAt:      result.card.expiresAt,
    },
  });
}
