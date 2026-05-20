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
  // The "pos-walk-in" sentinel is for POS-placed orders and must never appear
  // on the customer-facing endpoint (POS uses /api/pos/sales). The string
  // "guest" is the documented unauthenticated checkout value — any other
  // customer_id must match the logged-in session.
  if (customer_id === "pos-walk-in") return unauthorizedJson();
  const session = await getCustomerSession();
  if (session) {
    if (session.id !== customer_id) return unauthorizedJson();
  } else if (customer_id !== "guest") {
    return unauthorizedJson();
  }

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
  const insertRow = { ...row, payment_status: "unpaid" };

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
    delivery_code:   row.delivery_code ?? undefined,
    date:            row.date,
  }).catch((err: unknown) =>
    console.error("[orders] confirmation email:", err instanceof Error ? err.message : err),
  );

  return NextResponse.json({ ok: true, orderId: row.id, total: row.total });
}
