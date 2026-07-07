/**
 * POST /api/admin/gift-cards/[id]/activate — sell & activate a pre-issued card.
 *
 * The moment a physical inactive card is sold over the counter. This is when:
 *   • the card becomes redeemable (status inactive → active),
 *   • the income is recognised (payment_method + payment_ref stamped → the card
 *     now shows up in gift-card-sales, dated by activated_at),
 *   • the expiry clock starts, and
 *   • the delivery email goes out (optional).
 *
 * Recipient email + payment method are required (it's a real sale). A guarded
 * update keyed on status='inactive' makes double-activation a no-op.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { AdminGiftCardActivateSchema } from "@/lib/schemas/giftCard";
import { sendGiftCardDeliveredEmail } from "@/lib/emailServer";
import { upsertMarketingContact } from "@/lib/marketingContacts";

const GIFT_CARD_EXPIRY_MONTHS = 12;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, AdminGiftCardActivateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { paymentMethod, recipientEmail, recipientName, personalMessage, notes, sendEmail } = parsed.data;

  const { data: card, error: cardErr } = await supabaseAdmin
    .from("gift_cards")
    .select("code, balance, status")
    .eq("id", id)
    .maybeSingle();
  if (cardErr) return NextResponse.json({ ok: false, error: cardErr.message }, { status: 500 });
  if (!card)   return NextResponse.json({ ok: false, error: "Gift card not found." }, { status: 404 });
  if (card.status !== "inactive") {
    return NextResponse.json(
      { ok: false, error: "Only inactive cards can be activated." },
      { status: 400 },
    );
  }

  const expiresAt   = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + GIFT_CARD_EXPIRY_MONTHS);
  const activatedAt = new Date().toISOString();
  const cardValue   = Number(card.balance);

  // Guarded update: only flips a card that is STILL inactive, so two concurrent
  // activations can't both succeed (and can't double-count income).
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("gift_cards")
    .update({
      status:           "active",
      payment_method:   paymentMethod,
      payment_ref:      `admin:${paymentMethod}`,
      issued_to_email:  recipientEmail,
      issued_to_name:   recipientName ?? null,
      personal_message: personalMessage ?? null,
      expires_at:       expiresAt.toISOString(),
      activated_at:     activatedAt,
    })
    .eq("id", id)
    .eq("status", "inactive")
    .select("id")
    .maybeSingle();
  if (updErr)   return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: "Card was already activated." }, { status: 409 });

  // Audit row. No balance change (the value was minted at creation), so this is
  // a zero-amount 'activate' marker recording who sold it, how, and to whom.
  await supabaseAdmin.from("gift_card_transactions").insert({
    id:            crypto.randomUUID(),
    gift_card_id:  id,
    type:          "activate",
    amount:        0,
    balance_after: cardValue,
    performed_by:  "admin",
    notes:         `Activated & sold (${paymentMethod}) to ${recipientEmail}${notes ? ` — ${notes}` : ""}`,
  });

  // Marketing contact — the physical-card buyer's email enters the system here.
  await upsertMarketingContact({
    email:  recipientEmail,
    source: "gift_card",
    name:   recipientName,
  });

  // Optional delivery email (same shape as the counter-sale flow).
  if (sendEmail) {
    sendGiftCardDeliveredEmail({
      code:            card.code,
      amount:          cardValue,
      recipientEmail,
      recipientName:   recipientName ?? "there",
      senderName:      undefined,
      personalMessage: personalMessage ?? undefined,
      expiresAt:       expiresAt.toISOString(),
    }).then((result) => {
      if (result.ok) {
        supabaseAdmin.from("gift_cards").update({ delivered_at: new Date().toISOString() }).eq("id", id)
          .then(({ error }) => { if (error) console.error("[admin/gift-cards/activate] delivered_at:", error.message); });
      }
    }).catch((err) => console.error("[admin/gift-cards/activate] email:", err instanceof Error ? err.message : err));
  }

  return NextResponse.json({ ok: true, id, code: card.code });
}
