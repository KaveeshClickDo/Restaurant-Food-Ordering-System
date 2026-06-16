/**
 * POST /api/admin/gift-cards/inactive — pre-issue an INACTIVE gift card.
 *
 * Mints a card with a value + code but NO payment, NO recipient, NO expiry.
 * The card is UNREDEEMABLE (lookupActiveGiftCard rejects 'inactive') and is NOT
 * booked as income (gift-card-sales skips cards with no payment_method) until an
 * admin activates it at the point of sale via
 * /api/admin/gift-cards/[id]/activate.
 *
 * This is what makes physical cards on a counter safe: a code copied off the
 * rack is worthless because the card holds no spendable balance until it's sold.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { AdminGiftCardInactiveCreateSchema } from "@/lib/schemas/giftCard";
import { generateGiftCardCode } from "@/lib/giftCardCode";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, AdminGiftCardInactiveCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { amount, notes } = parsed.data;

  const code = generateGiftCardCode();
  const id   = crypto.randomUUID();

  const { error: insertErr } = await supabaseAdmin
    .from("gift_cards")
    .insert({
      id,
      code,
      initial_amount: amount,
      balance:        amount,
      status:         "inactive",
      // No payment_method / payment_ref → excluded from finance reports.
      // No recipient, no expiry — all captured at activation time.
    });

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Code collision (1-in-10^17). Caller can simply retry.
      return NextResponse.json({ ok: false, error: "Code collision — please retry." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  // Audit row — the card was minted with a value (the balance exists from
  // creation; it's just not redeemable until activated).
  await supabaseAdmin.from("gift_card_transactions").insert({
    id:            crypto.randomUUID(),
    gift_card_id:  id,
    type:          "issue",
    amount:        amount,
    balance_after: amount,
    performed_by:  "admin",
    notes:         notes ?? "Pre-issued (inactive) by admin",
  });

  return NextResponse.json({ ok: true, id, code }, { status: 201 });
}
