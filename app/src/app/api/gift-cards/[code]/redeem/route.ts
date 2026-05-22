/**
 * POST /api/gift-cards/[code]/redeem — settle a code against a committed
 * order or POS sale.
 *
 * Idempotency model — mirrors store credit's spend-credit endpoint:
 *   1. The consuming order/sale row was stamped with `gift_card_id` and
 *      `gift_card_used` at insert/settle time (server-validated, never client-
 *      trusted). The stamp is permanent — set once, never re-written.
 *   2. This endpoint:
 *      a) Verifies the stamp matches the code being redeemed.
 *      b) Checks `gift_card_transactions` for an existing 'redeem' row linked
 *         to this order/sale. If present, returns the same success payload
 *         (replay-safe — webhook retries or page reloads don't double-spend).
 *      c) Atomically decrements `gift_cards.balance` with a compare-and-swap
 *         (`eq("balance", expectedBalance)`) so two concurrent redemptions
 *         of the same code can't both succeed.
 *      d) Inserts the `gift_card_transactions` ledger row.
 *      e) Flips status='redeemed' if balance hit zero.
 *
 * Called by:
 *   - CheckoutModal after the order succeeds (fire-and-forget — server is
 *     authoritative)
 *   - /api/pos/sales after the POS sale row is inserted (same transaction
 *     scope from the operator's perspective)
 *   - /api/waiter/settle after dine-in settlement
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normaliseGiftCardCode } from "@/lib/giftCardCode";
import { parseBody } from "@/lib/apiValidation";
import { z } from "zod";

// Local schema — the [code] is in the URL, so the body only carries the
// stamp's identifier (orderId XOR posSaleId).
const RedeemBodySchema = z.union([
  z.object({ orderId:   z.string().min(1), posSaleId: z.never().optional() }),
  z.object({ posSaleId: z.string().min(1), orderId:   z.never().optional() }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: codeFromUrl } = await params;
  const normalised = normaliseGiftCardCode(decodeURIComponent(codeFromUrl));
  if (!normalised) {
    return NextResponse.json(
      { ok: false, error: "Invalid gift card code format." },
      { status: 400 },
    );
  }

  const parsed = await parseBody(req, RedeemBodySchema);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  }

  // Look up the card — we accept active + redeemed states here (a card whose
  // balance was reduced to zero is "redeemed"; subsequent reload of a page
  // that already redeemed it should still find it). Voided / expired stay
  // rejected.
  const { data: card, error: cardErr } = await supabaseAdmin
    .from("gift_cards")
    .select("id, code, balance, status, expires_at")
    .eq("code", normalised)
    .maybeSingle();

  if (cardErr) {
    return NextResponse.json({ ok: false, error: cardErr.message }, { status: 500 });
  }
  if (!card) {
    return NextResponse.json({ ok: false, error: "No gift card matches that code." }, { status: 404 });
  }
  if (card.status === "voided") {
    return NextResponse.json({ ok: false, error: "This gift card has been voided." }, { status: 410 });
  }
  if (card.status === "expired" || (card.expires_at && new Date(card.expires_at).getTime() <= Date.now())) {
    return NextResponse.json({ ok: false, error: "This gift card has expired." }, { status: 410 });
  }

  // Resolve which surface the redemption is against, and look up the stamp.
  const orderId   = "orderId"   in parsed.data ? parsed.data.orderId   : undefined;
  const posSaleId = "posSaleId" in parsed.data ? parsed.data.posSaleId : undefined;

  let stampedGiftCardId: string | null = null;
  let stampedUsed = 0;

  if (orderId) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, gift_card_id, gift_card_used")
      .eq("id", orderId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
    stampedGiftCardId = data.gift_card_id;
    stampedUsed = Number(data.gift_card_used ?? 0);
  } else if (posSaleId) {
    const { data, error } = await supabaseAdmin
      .from("pos_sales")
      .select("id, gift_card_id, gift_card_used")
      .eq("id", posSaleId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: "Sale not found." }, { status: 404 });
    stampedGiftCardId = data.gift_card_id;
    stampedUsed = Number(data.gift_card_used ?? 0);
  }

  // The stamp is the entitlement — refuse to redeem against a row that
  // doesn't carry the gift card id (someone trying to attach a code to a
  // pre-existing order would fail here).
  if (stampedGiftCardId !== card.id) {
    return NextResponse.json(
      { ok: false, error: "This order/sale is not associated with this gift card." },
      { status: 403 },
    );
  }
  if (stampedUsed <= 0) {
    return NextResponse.json(
      { ok: false, error: "Nothing to redeem — order/sale wasn't stamped with a use amount." },
      { status: 400 },
    );
  }

  // Idempotency probe — if a previous call already recorded the redemption,
  // return the same balance without decrementing again.
  const txnFilter = orderId
    ? supabaseAdmin.from("gift_card_transactions").select("id, balance_after").eq("type", "redeem").eq("order_id", orderId).eq("gift_card_id", card.id).maybeSingle()
    : supabaseAdmin.from("gift_card_transactions").select("id, balance_after").eq("type", "redeem").eq("pos_sale_id", posSaleId!).eq("gift_card_id", card.id).maybeSingle();

  const { data: existingTxn, error: txnLookupErr } = await txnFilter;
  if (txnLookupErr) {
    return NextResponse.json({ ok: false, error: txnLookupErr.message }, { status: 500 });
  }
  if (existingTxn) {
    return NextResponse.json({
      ok: true,
      replayed: true,
      newBalance: Number(existingTxn.balance_after),
    });
  }

  // Atomic compare-and-swap decrement. If a concurrent caller decremented
  // the balance between our read and this update, the `eq("balance", ...)`
  // predicate matches zero rows and we 409 — caller can retry.
  const currentBalance = Number(card.balance);
  if (currentBalance < stampedUsed) {
    return NextResponse.json(
      { ok: false, error: "Gift card balance is insufficient for this redemption." },
      { status: 409 },
    );
  }
  const newBalance = parseFloat((currentBalance - stampedUsed).toFixed(2));
  const becomeRedeemed = newBalance <= 0;

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("gift_cards")
    .update({
      balance: newBalance,
      status:  becomeRedeemed ? "redeemed" : card.status,
    })
    .eq("id", card.id)
    .eq("balance", currentBalance) // compare-and-swap guard
    .select("id")
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }
  if (!updated) {
    // Lost the CAS race. Caller should look up balance again and retry.
    return NextResponse.json(
      { ok: false, error: "Gift card balance changed during redemption. Please try again." },
      { status: 409 },
    );
  }

  // Append the audit row. If THIS fails the balance is already debited, so
  // the ledger is briefly out of sync — log loudly so admin can patch it.
  const { error: txnInsertErr } = await supabaseAdmin
    .from("gift_card_transactions")
    .insert({
      id:              crypto.randomUUID(),
      gift_card_id:    card.id,
      type:            "redeem",
      amount:          -stampedUsed,
      balance_after:   newBalance,
      order_id:        orderId ?? null,
      pos_sale_id:     posSaleId ?? null,
      performed_by:    orderId ? "system" : "system",
      notes:           orderId ? `Applied to order ${orderId}` : `Applied to POS sale ${posSaleId}`,
    });

  if (txnInsertErr) {
    console.error(
      `[gift-cards/redeem] LEDGER GAP — card ${card.id} debited £${stampedUsed} but txn row failed: ${txnInsertErr.message}`,
    );
    // Still return success so the caller doesn't retry the decrement.
  }

  return NextResponse.json({ ok: true, newBalance });
}
