/**
 * POST /api/pos/gift-cards/[id]/activate — sell & activate a pre-issued card
 * at the till.
 *
 * Mirrors /api/admin/gift-cards/[id]/activate (the admin counter sale) with
 * the POS differences:
 *   • any valid POS session may sell (it's a normal till action; the staff
 *     member is recorded on the audit row),
 *   • payment_ref is 'pos:cash' | 'pos:card' so finance reports book the sale
 *     on the POS slice, not the Admin slice.
 *
 * Recipient email is REQUIRED (same as the admin activate): every till sale
 * captures a marketing contact with the consent tick recorded, so the buyer
 * shows up on /admin?tab=marketing.
 *
 * The guarded update keyed on status='inactive' makes double-activation (two
 * tills, or till + admin, racing on the same card) a no-op.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosSession } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { PosGiftCardActivateSchema } from "@/lib/schemas/giftCard";
import { sendGiftCardDeliveredEmail } from "@/lib/emailServer";
import { upsertMarketingContact } from "@/lib/marketingContacts";

const GIFT_CARD_EXPIRY_MONTHS = 12;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;
  const staff = gate.staff;
  const { id } = await params;

  const parsed = await parseBody(req, PosGiftCardActivateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { paymentMethod, recipientEmail, recipientName, notes, sendEmail, marketingOptIn } = parsed.data;

  const { data: card, error: cardErr } = await supabaseAdmin
    .from("gift_cards")
    .select("code, balance, status")
    .eq("id", id)
    .maybeSingle();
  if (cardErr) return NextResponse.json({ ok: false, error: cardErr.message }, { status: 500 });
  if (!card)   return NextResponse.json({ ok: false, error: "Gift card not found." }, { status: 404 });
  if (card.status !== "inactive") {
    return NextResponse.json(
      { ok: false, error: "Only inactive cards can be sold." },
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
      status:          "active",
      payment_method:  paymentMethod,
      payment_ref:     `pos:${paymentMethod}`,
      issued_to_email: recipientEmail,
      issued_to_name:  recipientName ?? null,
      expires_at:      expiresAt.toISOString(),
      activated_at:    activatedAt,
    })
    .eq("id", id)
    .eq("status", "inactive")
    .select("id")
    .maybeSingle();
  if (updErr)   return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: "Card was already activated." }, { status: 409 });

  // Audit row. No balance change (the value was minted at creation) — a
  // zero-amount 'activate' marker recording who sold it, how, and to whom.
  await supabaseAdmin.from("gift_card_transactions").insert({
    id:            crypto.randomUUID(),
    gift_card_id:  id,
    type:          "activate",
    amount:        0,
    balance_after: cardValue,
    performed_by:  `pos:${staff.name}`,
    notes:         `Sold at POS (${paymentMethod}) to ${recipientEmail}${notes ? ` — ${notes}` : ""}`,
  });

  // Marketing contact — the till buyer's email enters the system here, with
  // the consent tick recorded (unticked → contact stored unsubscribed).
  await upsertMarketingContact({
    email:   recipientEmail,
    source:  "gift_card",
    name:    recipientName,
    consent: marketingOptIn,
  });

  // Optional delivery email (same shape as the admin counter-sale flow).
  if (sendEmail) {
    sendGiftCardDeliveredEmail({
      code:            card.code,
      amount:          cardValue,
      recipientEmail,
      recipientName:   recipientName ?? "there",
      senderName:      undefined,
      personalMessage: undefined,
      expiresAt:       expiresAt.toISOString(),
    }).then((result) => {
      if (result.ok) {
        supabaseAdmin.from("gift_cards").update({ delivered_at: new Date().toISOString() }).eq("id", id)
          .then(({ error }) => { if (error) console.error("[pos/gift-cards/activate] delivered_at:", error.message); });
      }
    }).catch((err) => console.error("[pos/gift-cards/activate] email:", err instanceof Error ? err.message : err));
  }

  return NextResponse.json({ ok: true, id, code: card.code, amount: cardValue });
}
