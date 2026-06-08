/**
 * POST /api/admin/gift-cards/[id]/resend — re-send the delivery email.
 *
 * For when the recipient lost the original email. Requires the card to have a
 * recipient email on file. Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { sendGiftCardDeliveredEmail } from "@/lib/emailServer";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const { data: card, error } = await supabaseAdmin
    .from("gift_cards")
    .select("code, initial_amount, issued_to_email, issued_to_name, personal_message, expires_at, issued_by_customer_id, status")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!card)  return NextResponse.json({ ok: false, error: "Gift card not found." }, { status: 404 });
  if (!card.issued_to_email) {
    return NextResponse.json({ ok: false, error: "No recipient email on file for this card." }, { status: 400 });
  }
  if (card.status === "voided") {
    return NextResponse.json({ ok: false, error: "Cannot resend a voided card." }, { status: 400 });
  }

  // Look up the buyer name for the "from" line if it was a customer purchase.
  let senderName: string | undefined;
  if (card.issued_by_customer_id) {
    const { data: buyer } = await supabaseAdmin
      .from("customers").select("name").eq("id", card.issued_by_customer_id).maybeSingle();
    senderName = buyer?.name ?? undefined;
  }

  const result = await sendGiftCardDeliveredEmail({
    code:            card.code,
    amount:          Number(card.initial_amount),
    recipientEmail:  card.issued_to_email,
    recipientName:   card.issued_to_name ?? "there",
    senderName,
    personalMessage: card.personal_message ?? undefined,
    expiresAt:       card.expires_at,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Failed to send email." }, { status: 500 });
  }

  await supabaseAdmin.from("gift_cards").update({ delivered_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
