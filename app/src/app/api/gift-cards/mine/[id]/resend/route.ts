/**
 * POST /api/gift-cards/mine/[id]/resend — buyer re-sends a card they bought.
 *
 * Customer-facing equivalent of the admin resend route. Verifies the calling
 * session owns the card (issued_by_customer_id === session.id) before sending.
 *
 * Lives under the static `mine` segment (not /gift-cards/[id]) so it doesn't
 * collide with the /gift-cards/[code] dynamic slug — Next.js forbids two
 * different slug names at the same path level.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { sendGiftCardDeliveredEmail } from "@/lib/emailServer";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();
  const { id } = await params;

  const { data: card, error } = await supabaseAdmin
    .from("gift_cards")
    .select("code, initial_amount, issued_to_email, issued_to_name, personal_message, expires_at, issued_by_customer_id, status")
    .eq("id", id)
    .maybeSingle();
  if (error)  return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!card)  return NextResponse.json({ ok: false, error: "Gift card not found." }, { status: 404 });

  // Ownership check — only the buyer can resend.
  if (card.issued_by_customer_id !== session.id) {
    return NextResponse.json({ ok: false, error: "This isn't your gift card." }, { status: 403 });
  }
  if (!card.issued_to_email) {
    return NextResponse.json({ ok: false, error: "No recipient email on file." }, { status: 400 });
  }
  if (card.status === "voided") {
    return NextResponse.json({ ok: false, error: "This card has been voided." }, { status: 400 });
  }

  // Look up the buyer's own name for the "from" line.
  const { data: buyer } = await supabaseAdmin
    .from("customers").select("name").eq("id", session.id).maybeSingle();

  const result = await sendGiftCardDeliveredEmail({
    code:            card.code,
    amount:          Number(card.initial_amount),
    recipientEmail:  card.issued_to_email,
    recipientName:   card.issued_to_name ?? "there",
    senderName:      buyer?.name ?? undefined,
    personalMessage: card.personal_message ?? undefined,
    expiresAt:       card.expires_at,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Failed to send email." }, { status: 500 });
  }

  await supabaseAdmin.from("gift_cards").update({ delivered_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
