/**
 * GET    /api/admin/gift-cards/[id] — card detail + full transaction history.
 * PATCH  /api/admin/gift-cards/[id] — void a card (body: { reason }).
 * DELETE /api/admin/gift-cards/[id] — hard delete (only when no transactions
 *                                     beyond the initial issue exist).
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { AdminGiftCardVoidSchema } from "@/lib/schemas/giftCard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToGiftCard(row: any) {
  return {
    id:                 row.id,
    code:               row.code,
    initialAmount:      Number(row.initial_amount),
    balance:            Number(row.balance),
    status:             row.status,
    issuedToEmail:      row.issued_to_email ?? undefined,
    issuedToName:       row.issued_to_name ?? undefined,
    issuedByCustomerId: row.issued_by_customer_id ?? undefined,
    personalMessage:    row.personal_message ?? undefined,
    expiresAt:          row.expires_at ?? undefined,
    deliveredAt:        row.delivered_at ?? undefined,
    activatedAt:        row.activated_at ?? undefined,
    createdAt:          row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTxn(row: any) {
  return {
    id:           row.id,
    giftCardId:   row.gift_card_id,
    type:         row.type,
    amount:       Number(row.amount),
    balanceAfter: Number(row.balance_after),
    orderId:      row.order_id ?? undefined,
    posSaleId:    row.pos_sale_id ?? undefined,
    performedBy:  row.performed_by,
    notes:        row.notes ?? undefined,
    createdAt:    row.created_at,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const { data: card, error: cardErr } = await supabaseAdmin
    .from("gift_cards").select("*").eq("id", id).maybeSingle();
  if (cardErr) return NextResponse.json({ ok: false, error: cardErr.message }, { status: 500 });
  if (!card)   return NextResponse.json({ ok: false, error: "Gift card not found." }, { status: 404 });

  const { data: txns } = await supabaseAdmin
    .from("gift_card_transactions")
    .select("*")
    .eq("gift_card_id", id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    ok: true,
    giftCard:     rowToGiftCard(card),
    transactions: (txns ?? []).map(rowToTxn),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, AdminGiftCardVoidSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const { data: card } = await supabaseAdmin
    .from("gift_cards").select("balance, status").eq("id", id).maybeSingle();
  if (!card) return NextResponse.json({ ok: false, error: "Gift card not found." }, { status: 404 });
  if (card.status === "voided") {
    return NextResponse.json({ ok: false, error: "Card is already voided." }, { status: 400 });
  }

  // Voiding zeroes the spendable balance so it can't be redeemed. The audit
  // row records the amount that was clawed back (negative).
  const clawback = Number(card.balance);
  const { error: updErr } = await supabaseAdmin
    .from("gift_cards")
    .update({ status: "voided", balance: 0 })
    .eq("id", id);
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  await supabaseAdmin.from("gift_card_transactions").insert({
    id:            crypto.randomUUID(),
    gift_card_id:  id,
    type:          "void",
    amount:        -clawback,
    balance_after: 0,
    performed_by:  "admin",
    notes:         parsed.data.reason,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  // Only allow delete when the card has never been redeemed/refunded — i.e.
  // its only ledger row is the initial 'issue'. Otherwise voiding is the
  // correct action (preserves the audit trail).
  const { data: txns } = await supabaseAdmin
    .from("gift_card_transactions")
    .select("type")
    .eq("gift_card_id", id);
  const nonIssue = (txns ?? []).filter((t) => t.type !== "issue");
  if (nonIssue.length > 0) {
    return NextResponse.json(
      { ok: false, error: "This card has activity — void it instead of deleting to keep the audit trail." },
      { status: 400 },
    );
  }

  // Cascade deletes the gift_card_transactions rows (FK on delete cascade).
  const { error } = await supabaseAdmin.from("gift_cards").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
