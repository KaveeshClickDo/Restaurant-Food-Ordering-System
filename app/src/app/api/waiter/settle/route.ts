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
    // Final amount owed after discount, exclusive-VAT, tip and service fee.
    const finalTotal = round2(subtotal - discount + vatSurcharge + tip + serviceFee);

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
        runningTotal: finalTotal,
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

    // Mark every order delivered + record the payment method. Settle is the
    // moment the table's money is actually taken, so stamp payment_status too
    // (historically left at the 'unpaid' DB default — schema.sql backfills
    // settled rows minted before this stamp).
    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        status:         "delivered",
        payment_method: paymentMethod ?? "table-service",
        payment_status: "paid",
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
    // We persist the REAL money taken per order row — gift card already
    // deducted — mirroring online orders, so reports/refunds read `total`
    // directly without ever re-subtracting the gift card. The bill-level
    // discount/tip/VAT/fee fold into the anchor; the gift card is then spread
    // across the bill (anchor first) so Σ(order.total) equals net money paid
    // and no row is stored negative. Gross goods value stays recoverable as
    // total + gift_card_used (used by receipts).
    const hasAdjustments = discount > 0 || tip > 0 || serviceFee > 0 || vat > 0;
    if (anchorOrderId && (hasAdjustments || giftCardAmount > 0)) {
      // Gross amount each row carries (bill-level extras fold into the anchor).
      const grossFor = (r: { id: string; total: number | null }) =>
        r.id === anchorOrderId
          ? round2(Number(r.total ?? 0) - discount + vatSurcharge + tip + serviceFee)
          : round2(Number(r.total ?? 0));

      // Anchor first so the gift card eats its share before the other rows.
      const ordered = [...rows].sort((a, b) =>
        a.id === anchorOrderId ? -1 : b.id === anchorOrderId ? 1 : 0,
      );

      let remainingGift = giftCardAmount;
      for (const r of ordered) {
        const gross    = grossFor(r);
        const deduct   = Math.min(gross, Math.max(0, remainingGift));
        remainingGift  = round2(remainingGift - deduct);
        const net      = round2(gross - deduct);
        const isAnchor = r.id === anchorOrderId;

        // Non-anchor rows untouched by the gift card keep their stored total.
        if (!isAnchor && deduct === 0) continue;

        await supabaseAdmin
          .from("orders")
          .update({
            ...(isAnchor && hasAdjustments ? {
              discount_amount: discount,
              discount_note:   discountNote?.trim() || null,
              tip_amount:      tip,
              service_fee:     serviceFee,
              vat_amount:      vat,
              vat_inclusive:   inclusive,
            } : {}),
            total: net,
          })
          .eq("id", r.id);
      }
    }

    // (Gift card was already debited as a gate above, before settling.)

    return NextResponse.json({ ok: true, settled: orderIds.length, tableLabel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/settle]", message);
    return NextResponse.json({ ok: false, error: "Failed to settle table. Please try again." }, { status: 500 });
  }
}
