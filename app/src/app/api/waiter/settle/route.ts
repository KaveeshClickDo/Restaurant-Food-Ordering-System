/**
 * POST /api/waiter/settle
 * Marks all active orders for a table as "delivered" and records the payment method.
 * Called by the waiter app when the customer pays their bill.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { parseBody } from "@/lib/apiValidation";
import { WaiterSettleSchema } from "@/lib/schemas/waiter";
import { lookupActiveGiftCard, clampGiftCardAmount, redeemGiftCardForRow } from "@/lib/giftCardValidation";

export async function POST(req: NextRequest) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;

  const parsed = await parseBody(req, WaiterSettleSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { orderIds, tableLabel, paymentMethod, giftCardCode, giftCardUsed } = parsed.data;

  try {
    // ── Gift card tender (optional) ────────────────────────────────────────
    // Applied across the table's combined bill. We compute the batch total
    // from the orders being settled, clamp the gift card amount to it, then
    // stamp the gift_card_id + gift_card_used on the FIRST order so the
    // redemption has a single stable anchor (the redeem helper is idempotent
    // on that order id).
    let giftCardId: string | null = null;
    let giftCardAmount = 0;
    let anchorOrderId: string | null = null;
    if (giftCardCode && giftCardUsed && giftCardUsed > 0) {
      const { data: orderRows } = await supabaseAdmin
        .from("orders")
        .select("id, total")
        .in("id", orderIds)
        .eq("fulfillment", "dine-in");
      const batchTotal = (orderRows ?? []).reduce((s, o) => s + Number(o.total ?? 0), 0);
      anchorOrderId = (orderRows ?? [])[0]?.id ?? null;

      const lookup = await lookupActiveGiftCard(giftCardCode);
      if (!lookup.ok) return NextResponse.json({ ok: false, error: lookup.message }, { status: 400 });
      giftCardId = lookup.card.id;
      giftCardAmount = clampGiftCardAmount({
        cardBalance:  lookup.card.balance,
        runningTotal: batchTotal,
        requested:    giftCardUsed,
      });

      // Stamp the anchor order so the redemption is idempotent + auditable.
      if (anchorOrderId && giftCardAmount > 0) {
        await supabaseAdmin
          .from("orders")
          .update({ gift_card_id: giftCardId, gift_card_used: giftCardAmount })
          .eq("id", anchorOrderId)
          .eq("gift_card_used", 0);
      }
    }

    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        status:         "delivered",
        payment_method: paymentMethod ?? "table-service",
      })
      .in("id", orderIds)
      .eq("fulfillment", "dine-in");

    if (error) {
      console.error("waiter/settle:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // Redeem after the orders are settled. AWAITED — a fire-and-forget promise
    // would be cut off when this route returns, leaving the card balance
    // un-debited. Idempotent on the anchor order id so a retry can't double-debit.
    if (giftCardId && giftCardAmount > 0 && anchorOrderId) {
      const redeem = await redeemGiftCardForRow({
        giftCardId,
        amount:      giftCardAmount,
        orderId:     anchorOrderId,
        performedBy: "waiter",
      });
      if (!redeem.ok) {
        console.error("[waiter/settle] gift card redeem:", redeem.error);
      }
    }

    return NextResponse.json({ ok: true, settled: orderIds.length, tableLabel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/settle]", message);
    return NextResponse.json({ ok: false, error: "Failed to settle table. Please try again." }, { status: 500 });
  }
}
