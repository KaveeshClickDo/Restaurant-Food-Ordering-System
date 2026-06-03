/**
 * POST /api/orders — public endpoint for customer order placement.
 *
 * This route is for **non-card** payment methods (cash, pay-on-delivery).
 * Card payments go through /api/payments/intent → Stripe Elements → webhook,
 * which inserts the order only after the gateway confirms the charge.
 *
 * Validates the payload server-side and inserts via the service role key,
 * so the anon key never needs INSERT permission on the orders table.
 *
 * Security measures applied here:
 *  - Explicit field whitelist via validateAndNormaliseOrder — only known
 *    columns are written. Sensitive fields (driver_id, delivery_status,
 *    refunded_amount, etc.) are never accepted from the client.
 *  - Server-side price verification: item prices replaced with authoritative
 *    values from the menu_items table.
 *  - Server-authoritative total: grand total recalculated from verified
 *    prices + whitelisted fees; the client-supplied total is ignored.
 *  - Status locked to "pending": client cannot set an arbitrary initial status.
 *  - Server-side coupon re-validation: discount re-derived from the canonical
 *    coupon definition, not the client-supplied figure.
 */

import { NextRequest, NextResponse }    from "next/server";
import { supabaseAdmin }                from "@/lib/supabaseAdmin";
import { sendOrderConfirmationEmail }   from "@/lib/emailServer";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { rateLimit }                    from "@/lib/rateLimit";
import { validateAndNormaliseOrder, incrementCouponUsage } from "@/lib/orderValidation";
import { redeemGiftCardForRow } from "@/lib/giftCardValidation";
import { decrementStock, restoreStock, type StockItem } from "@/lib/stockMutation";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`orders:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many requests. Please wait a minute." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { customer_id } = body;
  if (!customer_id || typeof customer_id !== "string") {
    return NextResponse.json({ ok: false, error: "'customer_id' is required." }, { status: 400 });
  }

  // ── Session ownership check ──────────────────────────────────────────────
  // Customer ordering requires a logged-in session, and the order must belong
  // to that customer. This also rejects the "guest" and "pos-walk-in"
  // sentinels, since neither can equal a real session id — there is no
  // anonymous checkout on this endpoint. POS / dine-in / waiter orders are
  // placed through their own staff-gated endpoints (/api/pos/sales,
  // /api/pos/orders/dine-in, /api/waiter/orders) and are unaffected.
  const session = await getCustomerSession();
  if (!session || session.id !== customer_id) return unauthorizedJson();

  const validation = await validateAndNormaliseOrder(body, String(customer_id));
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: validation.status });
  }

  const { row, verifiedItems, coupon } = validation.data;

  // Build the stock-decrement payload from verifiedItems. Lines without a
  // menuItemId (legacy / hand-typed) are dropped by the helper.
  const stockItems: StockItem[] = verifiedItems
    .map((i) => ({ id: String(i.menuItemId ?? ""), qty: Number(i.qty ?? 0) }))
    .filter((i) => i.id);

  // Decrement stock BEFORE the order insert so an out-of-stock cart fails
  // before we create an order row. All-or-nothing at the DB level.
  const stock = await decrementStock(stockItems);
  if (!stock.ok) {
    return NextResponse.json({ ok: false, error: stock.message }, { status: 409 });
  }

  // Cash orders are unpaid until staff collect on hand-off.
  // Lifecycle: "unpaid" → "paid" (on delivery for cash) → optionally
  // "partially_refunded" / "refunded". The unpaid → paid transition is
  // handled in /api/admin/orders/[id]/status when status flips to "delivered".
  //
  // Exception: when a gift card / store credit fully covers the order (nothing
  // left to charge), there's no cash to collect — mark it paid up front so it
  // doesn't sit forever as "unpaid".
  const fullyCoveredByCredit =
    row.total <= 0.001 && ((row.gift_card_used ?? 0) > 0 || row.store_credit_used > 0);
  const insertRow = { ...row, payment_status: fullyCoveredByCredit ? "paid" : "unpaid" };

  const { error } = await supabaseAdmin.from("orders").insert(insertRow);
  if (error) {
    // Insert failed after we already deducted stock — give the units back so
    // the next customer can buy them. Best-effort: a failure here just leaves
    // a small drift that admin can correct.
    restoreStock(stockItems).catch((err) =>
      console.error("[orders] stock restore after insert failure:", err instanceof Error ? err.message : err),
    );
    console.error("orders POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Increment coupon usage now — order is committed.
  if (coupon) {
    incrementCouponUsage(coupon.id).catch((err) =>
      console.error("[orders] coupon increment:", err instanceof Error ? err.message : err),
    );
  }

  // Apply the gift card redemption. Order row already carries the stamp
  // (gift_card_id + gift_card_used) — the helper uses that as the idempotency
  // key. AWAITED so the balance is debited before we respond (a dangling
  // promise can be killed when the route returns).
  if (row.gift_card_id && row.gift_card_used > 0) {
    const redeem = await redeemGiftCardForRow({
      giftCardId:  row.gift_card_id,
      amount:      row.gift_card_used,
      orderId:     row.id,
      performedBy: `customer:${row.customer_id}`,
    });
    if (!redeem.ok) console.error("[orders] gift card redeem:", redeem.error);
  }

  // Store-credit deduction. Mirrors the Stripe / PayPal webhook behaviour so
  // the cash flow also debits `customers.store_credit` server-side. Before
  // this, the cash path stamped `order.store_credit_used` at insert but never
  // touched the customer balance (the client-side /spend-credit POST 409'd
  // because the stamp was already non-zero) → customers could redeem the
  // same credit forever. Best-effort: a failure here is logged but doesn't
  // fail the order response (we don't want one balance write hiccup to look
  // like the entire checkout failed).
  if (row.store_credit_used > 0 && row.customer_id && row.customer_id !== "guest") {
    try {
      const { data: cust, error: fetchErr } = await supabaseAdmin
        .from("customers")
        .select("store_credit")
        .eq("id", row.customer_id)
        .maybeSingle();
      if (fetchErr) {
        console.error("[orders] store credit fetch:", fetchErr.message);
      } else if (cust) {
        const current    = Number(cust.store_credit ?? 0);
        const newBalance = Math.max(0, parseFloat((current - row.store_credit_used).toFixed(2)));
        const { error: credErr } = await supabaseAdmin
          .from("customers")
          .update({ store_credit: newBalance })
          .eq("id", row.customer_id);
        if (credErr) console.error("[orders] store credit deduct:", credErr.message);
      }
    } catch (err) {
      console.error("[orders] store credit deduct:", err instanceof Error ? err.message : err);
    }
  }

  // Fire-and-forget — email failure must never fail the order response
  sendOrderConfirmationEmail({
    id:              row.id,
    customer_id:     row.customer_id,
    fulfillment:     row.fulfillment,
    total:           row.total,
    items:           verifiedItems as Array<{ name: string; qty: number; price: number }>,
    payment_method:  row.payment_method,
    address:         row.address ?? undefined,
    delivery_fee:    row.delivery_fee > 0 ? row.delivery_fee : undefined,
    service_fee:     row.service_fee  > 0 ? row.service_fee  : undefined,
    vat_amount:      row.vat_amount ?? undefined,
    vat_inclusive:   row.vat_inclusive ?? undefined,
    coupon_code:     row.coupon_code ?? undefined,
    coupon_discount: row.coupon_code ? row.coupon_discount : undefined,
    store_credit_used: row.store_credit_used > 0 ? row.store_credit_used : undefined,
    gift_card_used:    row.gift_card_used   > 0 ? row.gift_card_used   : undefined,
    delivery_code:   row.delivery_code ?? undefined,
    date:            row.date,
  }).catch((err: unknown) =>
    console.error("[orders] confirmation email:", err instanceof Error ? err.message : err),
  );

  return NextResponse.json({ ok: true, orderId: row.id, total: row.total });
}
