/**
 * PATCH /api/pos/sales/[id] — void or refund a POS sale.
 *
 * Body: { voidReason, refundMethod, refundAmount }
 *
 * Marks the pos_sales row as voided and also flips the corresponding orders
 * row so the KDS view stays consistent.
 *
 * AUTHZ:
 *   - Requires `canVoidSale` permission on the caller's pos_staff row, OR an
 *     admin session. A bare cashier session is not enough.
 *   - When a refundAmount is supplied, additionally requires `canIssueRefund`.
 *
 * A card refund of a sale paid on the Dojo card machine is sent to Dojo FIRST
 * (lib/dojo/refund.ts, idempotent on body.refundRequestId); only if Dojo
 * accepts is the sale voided. Other card refunds stay a record only.
 *
 * A tip the customer added on the card machine is money they paid too, so the
 * refund can include it. A refund comes out of the sale first; anything above
 * the sale total is tip, recorded in card_tip_refunded so refund_amount stays
 * within `total`. On a card machine refund the card gets back its own part
 * (all of a card sale, a split's card part) plus the tip; the rest of a split
 * sale's refund is handed back in cash.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { parseBody }                 from "@/lib/apiValidation";
import { PosSaleVoidSchema }         from "@/lib/schemas/pos";
import { requirePosPermission }      from "@/lib/posPermissions";
import { restoreStock, type StockItem } from "@/lib/stockMutation";
import { deductLoyaltyPoints }       from "@/lib/loyaltyUtils";
import type { POSCartItem }          from "@/types/pos";
import { findDojoPayment, hasDojoRefund, refundDojoPayment, type DojoRefundOutcome } from "@/lib/dojo/refund";
import { dojoErrorResponse }         from "@/lib/dojo/respond";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  // Void requires `canVoidSale`. We re-check `canIssueRefund` below when a
  // refund amount is present so refund-without-void or refund-only flows
  // can't be triggered by a void-only operator.
  const voidGate = await requirePosPermission("canVoidSale");
  if (!voidGate.ok) return voidGate.response;
  const actor = voidGate.staff; // null when admin

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });

  const parsed = await parseBody(req, PosSaleVoidSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const reason = body.voidReason;
  const refundMethod = body.refundMethod ?? "none";
  const refundAmount = body.refundAmount && body.refundAmount > 0 ? body.refundAmount : null;
  /** Set when this request refunded the card through Dojo. */
  let cardRefund: DojoRefundOutcome | null = null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  /** The refund out of the sale total, and the part of it that is the card
   *  machine tip (a refund comes out of the sale first). */
  let salePart = refundAmount ?? 0;
  let tipPart = 0;
  let tipRefundedBefore = 0;
  /** How the money goes back: to the card through Dojo, and in cash. */
  let toCard = 0;
  let cashBack = 0;

  // Refund-side gate: only managers/admins (canIssueRefund) can move money.
  if (refundAmount !== null) {
    const refundGate = await requirePosPermission("canIssueRefund");
    if (!refundGate.ok) return refundGate.response;

    // Cap the refund at money actually collected. A gift card is prepaid money,
    // so the gift-card-covered portion is non-refundable — and `total` is already
    // stored net of it. Guards against refunding more cash than was taken. A tip
    // added on the card machine was paid too, so it can be given back.
    const { data: saleForCap } = await supabaseAdmin
      .from("pos_sales")
      .select("total, gift_card_used, voided, payment_method, payments, card_tip_amount, card_tip_refunded")
      .eq("id", id).maybeSingle();
    if (saleForCap && !saleForCap.voided) {
      const saleMoney = Number(saleForCap.total) || 0;
      tipRefundedBefore = Number(saleForCap.card_tip_refunded ?? 0);
      const tipLeft = round2(Math.max(0, Number(saleForCap.card_tip_amount ?? 0) - tipRefundedBefore));
      const moneyPaid = round2(saleMoney + tipLeft);
      if (refundAmount > moneyPaid + 0.001) {
        return NextResponse.json(
          { ok: false, error: `Refund (${refundAmount}) cannot exceed the ${moneyPaid.toFixed(2)} paid by cash/card${tipLeft > 0 ? " (including the tip on the card machine)" : ""}. The gift-card portion is non-refundable.` },
          { status: 400 },
        );
      }
      salePart = round2(Math.min(refundAmount, saleMoney));
      tipPart = round2(Math.min(tipLeft, refundAmount - salePart));
      cashBack = refundMethod === "cash" ? refundAmount : 0;

      // A card machine sale is refunded to the card through Dojo FIRST: if Dojo
      // refuses, nothing is voided. A sale already refunded through Dojo (an
      // earlier try whose void didn't save) isn't refunded again.
      if (refundMethod === "card") {
        const payment = await findDojoPayment("pos_sale", id);
        // The card gets back its own part plus the tip; for a split sale any
        // rest is cash.
        const cardLeg = saleForCap.payment_method === "split"
          ? round2(((saleForCap.payments ?? []) as { method: string; amount: number }[])
              .filter((p) => p.method === "card").reduce((s, p) => s + Number(p.amount || 0), 0))
          : saleMoney;
        toCard = payment ? round2(Math.min(refundAmount, cardLeg + tipLeft)) : refundAmount;
        cashBack = round2(refundAmount - toCard);
        if (payment && toCard > 0 && !(await hasDojoRefund("pos_sale", id))) {
          try {
            cardRefund = await refundDojoPayment({
              paymentIntentId: payment.paymentIntentId,
              amount: toCard,
              requestId: body.refundRequestId ?? `pos-sale-void-${id}`,
              reason,
              sourceType: "pos_sale",
              sourceId: id,
              staffId: actor?.id ?? null,
            });
          } catch (err) {
            return dojoErrorResponse(err, "refund");
          }
        }
      }
    }
  }

  // Conditionally void: `.eq("voided", false)` makes this a no-op idempotent
  // operation if the sale has already been voided. Returning the items so we
  // know what to restore — but only if this UPDATE was the one that actually
  // changed the row (otherwise we'd double-restore on retries).
  const { data: updated, error } = await supabaseAdmin
    .from("pos_sales")
    .update({
      voided:        true,
      void_reason:   reason,
      voided_at:     new Date().toISOString(),
      refund_method: refundMethod,
      // Within `total`: the tip part goes in card_tip_refunded.
      refund_amount: refundAmount === null ? null : salePart,
      ...(tipPart > 0 ? { card_tip_refunded: round2(tipRefundedBefore + tipPart) } : {}),
    })
    .eq("id", id)
    .eq("voided", false)
    .select("id, items, customer_id")
    .maybeSingle();

  if (error) {
    console.error(`PATCH /api/pos/sales/${id}:`, error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // No row matched: either the sale doesn't exist, or it was already voided.
  // Disambiguate with a lookup so the caller gets a sensible status.
  if (!updated) {
    const { data: existing } = await supabaseAdmin
      .from("pos_sales").select("id, voided").eq("id", id).maybeSingle();
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Sale not found." }, { status: 404 });
    }
    // Already voided — idempotent success, no stock restore.
    return NextResponse.json({ ok: true, id: existing.id, alreadyVoided: true });
  }

  // Claw back loyalty points in proportion to the money actually refunded —
  // points follow the money, mirroring the online refund path. A void with no
  // refund keeps the points (the till kept the money, so the customer keeps the
  // points they paid for); a refund reverses only what was handed back. Capped
  // at what THIS sale earned and bounded by the ledger, so retries / replays are
  // no-ops. Runs only when THIS request flipped the row (`updated` non-null).
  // Points were earned on the sale, not on a tip added on the card machine.
  deductLoyaltyPoints(updated.customer_id as string | null, refundAmount === null ? 0 : salePart, { posSaleId: id, note: "POS void refund" }).catch((err) =>
    console.error(`[pos/sales/${id}] loyalty clawback on void:`, err instanceof Error ? err.message : err),
  );

  // Restore stock for every catalogued line. Best-effort — a failure here just
  // leaves a small under-count that admin can correct manually.
  const items = Array.isArray(updated.items) ? (updated.items as POSCartItem[]) : [];
  const stockItems: StockItem[] = items
    .map((it) => ({ id: it.productId, qty: it.quantity }))
    .filter((i) => i.id);
  restoreStock(stockItems).catch((err) =>
    console.error(`[pos/sales/${id}] stock restore on void:`, err instanceof Error ? err.message : err),
  );

  // Also flip the KDS-side orders row so kitchen + admin see the void
  // immediately. Failure here is non-fatal — pos_sales is the audit truth.
  //
  // Bug #1 (refunds): also propagate refund state to the mirror order. Without
  // these fields the admin Finance Reports / Refunds / Payments panels — which
  // read from `orders` (not `pos_sales`) — can't tell the sale was refunded.
  // `isMoneyBearing` in OnlineReportsPanel excludes cancelled rows whose
  // payment_status isn't paid/refunded/partially_refunded, so without stamping
  // payment_status here the sale + its refund silently disappear from finance.
  const orderPatch: Record<string, unknown> = {
    status:      "cancelled",
    voided_by:   actor?.id ?? "admin",
    void_reason: reason,
    voided_at:   new Date().toISOString(),
  };
  if (refundAmount !== null) {
    // Full vs partial is judged against money PAID (gift card excluded). `total`
    // is already stored net of the gift card, so it IS the money paid.
    const { data: saleRow } = await supabaseAdmin
      .from("pos_sales").select("total").eq("id", id).maybeSingle();
    const moneyPaid = Number(saleRow?.total) || 0;
    const isFullRefund = salePart >= moneyPaid - 0.001;
    orderPatch.refunded_amount = salePart;
    orderPatch.payment_status  = isFullRefund ? "refunded" : "partially_refunded";
  } else {
    // Void with NO refund — the till kept the money, so the cancelled mirror is
    // still money-bearing (mirrors an online cancel+no-refund). Mark it paid so
    // the admin Finance Reports count it as revenue.
    orderPatch.payment_status = "paid";
  }
  await supabaseAdmin
    .from("orders")
    .update(orderPatch)
    .eq("id", id);

  return NextResponse.json({
    ok: true,
    id: updated.id,
    cardRefund: cardRefund ? { status: cardRefund.status, refundedAmount: cardRefund.refundedAmount } : null,
    refund: refundAmount === null ? null : { salePart, tipPart, toCard, cash: cashBack },
  });
}
