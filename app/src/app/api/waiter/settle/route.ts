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
          discountAmount, discountNote, tipAmount, serviceFeeAmount, vatAmount, vatInclusive } = parsed.data;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  try {
    // Fetch the orders being settled up-front: we need their combined subtotal
    // to clamp the discount + gift card, and the first row is the anchor that
    // carries the bill-level discount / tip / service-fee / gift-card stamps.
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
    const serviceFee = Math.max(0, Number(serviceFeeAmount ?? 0));
    // VAT synced from the admin Tax & VAT setting (computed client-side, same as
    // POS). Inclusive VAT is already inside the item prices, so it does NOT add
    // to the total — it's recorded for reporting only. Exclusive VAT is added on
    // top of the post-discount amount.
    const vat       = Math.max(0, Number(vatAmount ?? 0));
    const inclusive = vatInclusive ?? false;
    const vatSurcharge = inclusive ? 0 : vat;
    // const giftCard = Math.max(0, Number(giftCardUsed ?? 0));
    // Grand amount owed after discount, exclusive-VAT, tip and service fee.
    const grandTotal = round2(subtotal - discount + vatSurcharge + tip + serviceFee);
    // Final amount owed after gift card redemption (clamped to the grand total).
    // const finalTotal = round2(grandTotal - giftCard);

    // ── Gift card tender (optional) ────────────────────────────────────────
    // Applied across the table's combined bill AFTER discount + tip + service-fee, clamped to
    // the final amount owed. The redemption (atomic balance debit) runs FIRST,
    // as a gate: if the card can't back the amount (a concurrent settle on
    // another terminal drained it), we refuse to settle rather than apply a
    // gift-card discount the card can't cover. Only on a successful debit do we
    // stamp the anchor order + mark the bill delivered.
    let giftCardId: string | null = null;
    let giftCardAmount = 0;
    if (giftCardCode && giftCardUsed && giftCardUsed > 0) {
      const lookup = await lookupActiveGiftCard(giftCardCode);
      if (!lookup.ok) return NextResponse.json({ ok: false, error: lookup.message }, { status: 400 });
      giftCardId = lookup.card.id;
      giftCardAmount = clampGiftCardAmount({
        cardBalance:  lookup.card.balance,
        runningTotal: grandTotal,
        requested:    giftCardUsed,
      });

      if (anchorOrderId && giftCardAmount > 0) {
        // Debit first (idempotent + CAS-guarded on the anchor order id).
        const redeem = await redeemGiftCardForRow({
          giftCardId,
          amount:      giftCardAmount,
          orderId:     anchorOrderId,
          performedBy: "waiter",
        });
        if (!redeem.ok) {
          console.error("[waiter/settle] gift card redeem failed, not settling:", redeem.reason, redeem.error);
          return NextResponse.json(
            { ok: false, error: "Gift card balance changed. Please re-check the card and try again." },
            { status: 409 },
          );
        }
        // Debit succeeded — stamp the anchor so reports / refunds see the card.
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

    // Close out the bill's kitchen tickets so the settled table leaves the KDS
    // and the /waiter floor. Best-effort — the bill is already delivered above.
    const { error: ticketErr } = await supabaseAdmin
      .from("dine_in_tickets")
      .update({ status: "delivered" })
      .in("order_id", orderIds)
      .not("status", "in", '("delivered","cancelled")');
    if (ticketErr) console.error("[waiter/settle] ticket close-out:", ticketErr.message);

    // Stamp the bill-level discount + tip + service-fee + VAT on the anchor order and fold the
    // net (−discount +exclusiveVAT +tip + service-fee) into its total, so Σ(order.total) across
    // the bill equals the final amount owed — keeping reports / refunds accurate
    // without touching the other orders' line items. vat_amount is recorded
    // regardless of mode so the Finance Reports VAT breakdown includes dine-in.
    if (anchorOrderId && (discount > 0 || tip > 0 || serviceFee > 0 || vat > 0 || giftCardAmount > 0)) {
      const anchorOriginal = Number(anchor?.total ?? 0);
      await supabaseAdmin
        .from("orders")
        .update({
          discount_amount: discount,
          discount_note:   discountNote?.trim() || null,
          tip_amount:      tip,
          service_fee:     serviceFee,
          vat_amount:      vat,
          vat_inclusive:   inclusive,
          total:           round2(anchorOriginal - discount + vatSurcharge + tip + serviceFee - giftCardAmount),
        })
        .eq("id", anchorOrderId);
    }

    // (Gift card was already debited as a gate above, before settling.)

    return NextResponse.json({ ok: true, settled: orderIds.length, tableLabel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/settle]", message);
    return NextResponse.json({ ok: false, error: "Failed to settle table. Please try again." }, { status: 500 });
  }
}
