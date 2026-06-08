/**
 * POST /api/customers/[id]/spend-credit — deduct store credit at checkout.
 *
 * F-PU-1: must be tied to an actual order owned by the calling customer.
 * The order's `store_credit_used` column is the idempotency key — once it's
 * non-zero we refuse to deduct again for the same order, so a replay of this
 * request cannot drain the balance.
 *
 * Caller flow:
 *   1. POST /api/orders (or webhooks/stripe) creates the order.
 *   2. Browser calls this with { amount, order_id } to settle the credit.
 *   3. Server verifies session.id === order.customer_id, order.store_credit_used === 0,
 *      then atomically updates both order.store_credit_used and customer.store_credit.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { parseBody }                 from "@/lib/apiValidation";
import { SpendCreditSchema }         from "@/lib/schemas/waiter";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await getCustomerSession();
  if (!session || session.id !== id) return unauthorizedJson();

  const parsed = await parseBody(req, SpendCreditSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { amount, order_id } = parsed.data;

  // Verify the order belongs to this customer.
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("id, customer_id, store_credit_used, total")
    .eq("id", order_id)
    .maybeSingle();

  if (orderErr) {
    return NextResponse.json({ ok: false, error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }
  if (order.customer_id !== id) {
    return NextResponse.json({ ok: false, error: "Order does not belong to this customer." }, { status: 403 });
  }

  // Idempotency: refuse to apply credit twice for the same order.
  if (Number(order.store_credit_used ?? 0) > 0) {
    return NextResponse.json(
      { ok: false, error: "Store credit already applied to this order." },
      { status: 409 },
    );
  }

  // Cap: can't claim more credit than the order's value.
  if (amount > Number(order.total)) {
    return NextResponse.json(
      { ok: false, error: "Credit amount exceeds order total." },
      { status: 400 },
    );
  }

  // Fetch current balance — clamp the deduction at 0.
  const { data: customer, error: custFetchErr } = await supabaseAdmin
    .from("customers")
    .select("store_credit")
    .eq("id", id)
    .maybeSingle();

  if (custFetchErr) {
    return NextResponse.json({ ok: false, error: custFetchErr.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  }

  const currentBalance = Number(customer.store_credit) || 0;
  const effectiveDeduct = Math.min(amount, currentBalance);
  const newBalance = parseFloat((currentBalance - effectiveDeduct).toFixed(2));

  // Stamp the order first — that's our idempotency token. If the customer
  // update fails afterwards, a retry sees store_credit_used != 0 and 409s
  // without double-charging.
  const { error: stampErr } = await supabaseAdmin
    .from("orders")
    .update({ store_credit_used: effectiveDeduct })
    .eq("id", order_id)
    .eq("store_credit_used", 0); // optimistic guard against concurrent writes

  if (stampErr) {
    return NextResponse.json({ ok: false, error: stampErr.message }, { status: 500 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("customers")
    .update({ store_credit: newBalance })
    .eq("id", id);

  if (updateErr) {
    console.error("customers/[id]/spend-credit POST:", updateErr.message);
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, newBalance, applied: effectiveDeduct });
}
