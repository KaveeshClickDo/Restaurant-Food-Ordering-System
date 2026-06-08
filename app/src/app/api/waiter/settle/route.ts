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
  const { orderIds, tableLabel, paymentMethod, giftCardCode, giftCardUsed,
          discountAmount, discountNote, tipAmount, vatAmount, vatInclusive } = parsed.data;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  try {
    // Fetch the orders being settled up-front: we need their combined subtotal
    // to clamp the discount + gift card, and the first row is the anchor that
    // carries the bill-level discount / tip / gift-card stamps.
    const { data: orderRows } = await supabaseAdmin
      .from("orders")
      .select("id, total")
      .in("id", orderIds)
      .eq("fulfillment", "dine-in");

    const rows = orderRows ?? [];
    const subtotal      = round2(rows.reduce((s, o) => s + Number(o.total ?? 0), 0));
    const anchor        = rows[0] ?? null;
    const anchorOrderId = anchor?.id ?? null;

    // Clamp the manual discount to the bill subtotal — it can never exceed what's
    // owed (mirrors the POS server-side guard). Tip is additive, never negative.
    const discount = Math.min(Math.max(0, Number(discountAmount ?? 0)), subtotal);
    const tip      = Math.max(0, Number(tipAmount ?? 0));
    // VAT synced from the admin Tax & VAT setting (computed client-side, same as
    // POS). Inclusive VAT is already inside the item prices, so it does NOT add
    // to the total — it's recorded for reporting only. Exclusive VAT is added on
    // top of the post-discount amount.
    const vat       = Math.max(0, Number(vatAmount ?? 0));
    const inclusive = vatInclusive ?? false;
    const vatSurcharge = inclusive ? 0 : vat;
    // Final amount owed after discount, exclusive-VAT, and tip.
    const finalTotal = round2(subtotal - discount + vatSurcharge + tip);

    // ── Gift card tender (optional) ────────────────────────────────────────
    // Applied across the table's combined bill AFTER discount + tip, clamped to
    // the final amount owed, then stamped on the anchor order so the redemption
    // is idempotent (the redeem helper keys on that order id).
    let giftCardId: string | null = null;
    let giftCardAmount = 0;
    if (giftCardCode && giftCardUsed && giftCardUsed > 0) {
      const lookup = await lookupActiveGiftCard(giftCardCode);
      if (!lookup.ok) return NextResponse.json({ ok: false, error: lookup.message }, { status: 400 });
      giftCardId = lookup.card.id;
      giftCardAmount = clampGiftCardAmount({
        cardBalance:  lookup.card.balance,
        runningTotal: finalTotal,
        requested:    giftCardUsed,
      });

      if (anchorOrderId && giftCardAmount > 0) {
        await supabaseAdmin
          .from("orders")
          .update({ gift_card_id: giftCardId, gift_card_used: giftCardAmount })
          .eq("id", anchorOrderId)
          .eq("gift_card_used", 0);
      }
    }

    // Mark every order delivered + record the payment method.
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

    // Stamp the bill-level discount + tip + VAT on the anchor order and fold the
    // net (−discount +exclusiveVAT +tip) into its total, so Σ(order.total) across
    // the bill equals the final amount owed — keeping reports / refunds accurate
    // without touching the other orders' line items. vat_amount is recorded
    // regardless of mode so the Finance Reports VAT breakdown includes dine-in.
    if (anchorOrderId && (discount > 0 || tip > 0 || vat > 0)) {
      const anchorOriginal = Number(anchor?.total ?? 0);
      await supabaseAdmin
        .from("orders")
        .update({
          discount_amount: discount,
          discount_note:   discountNote?.trim() || null,
          tip_amount:      tip,
          vat_amount:      vat,
          vat_inclusive:   inclusive,
          total:           round2(anchorOriginal - discount + vatSurcharge + tip),
        })
        .eq("id", anchorOrderId);
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
