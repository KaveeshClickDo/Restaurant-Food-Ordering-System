/**
 * POST /api/pos/orders/[id]/settle
 * Takes payment for an online COLLECTION order at the POS counter and completes
 * the handover in one step: payment_status → "paid", status → "delivered", and
 * awards loyalty points.
 *
 * The amount collected is `order.total`, which is already net of any coupon,
 * store credit, and gift card applied at online checkout — so this route never
 * re-touches those. Tender is cash / card / split only; nothing is written to
 * pos_sales (the order row stays the single source of truth, like dine-in).
 *
 * Requires a POS or admin session. Only valid when the order is a real online
 * collection order that is currently unpaid AND "ready".
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { isAdminAuthenticated }      from "@/lib/adminAuth";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { parseBody }                 from "@/lib/apiValidation";
import { PosCollectionSettleSchema } from "@/lib/schemas/pos";
import { rewardLoyaltyPoints }       from "@/lib/loyaltyUtils";
import { sendOrderStatusEmail }      from "@/lib/emailServer";

const POS_CUSTOMER_ID = "pos-walk-in";

const TENDER_LABEL: Record<"cash" | "card" | "split", string> = {
  cash:  "Cash",
  card:  "Card",
  split: "Split (cash + card)",
};

async function isPosOrAdmin(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  return Boolean(await getPosSession());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isPosOrAdmin()) return unauthorizedJson();

  const { id } = await params;

  const parsed = await parseBody(req, PosCollectionSettleSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { paymentMethod } = parsed.data;

  // Pull the fields we need to guard the transition + award loyalty.
  const { data: order, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("status, fulfillment, payment_status, customer_id, total")
    .eq("id", id)
    .single();

  if (fetchErr || !order) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  // Only real online collection orders can be settled here. POS walk-in mirror
  // rows are already paid via pos_sales; delivery/dine-in have their own flows.
  if (order.fulfillment !== "collection" || order.customer_id === POS_CUSTOMER_ID) {
    return NextResponse.json(
      { ok: false, error: "This is not an online collection order." },
      { status: 400 },
    );
  }
  if (order.payment_status !== "unpaid") {
    return NextResponse.json(
      { ok: false, error: `Order is already '${order.payment_status}'. Use 'Mark Collected' instead.` },
      { status: 409 },
    );
  }
  // Mirror the /collected ready-guard — never jump the kitchen by marking an
  // order delivered before the food is ready.
  if (order.status !== "ready") {
    return NextResponse.json(
      { ok: false, error: `Order is '${order.status}', not 'ready'.` },
      { status: 409 },
    );
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "paid",
      payment_method: TENDER_LABEL[paymentMethod],
      status:         "delivered",
    })
    .eq("id", id);

  if (error) {
    console.error("pos/orders/[id]/settle POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Award loyalty for the now-paid order. Awaited so the points land before we
  // respond. rewardLoyaltyPoints no-ops for guests / pos-walk-in / £0. The
  // unpaid→paid guard above guarantees this runs exactly once (the admin
  // status route's shouldMarkPaid won't re-fire once payment_status is "paid").
  await rewardLoyaltyPoints(order.customer_id, Number(order.total));

  // Notify the customer their collection order is complete (status → delivered).
  // Fire-and-forget so an SMTP outage never fails the settle.
  sendOrderStatusEmail(id, "delivered").catch((err: unknown) =>
    console.error("[pos/settle] delivered email:", err instanceof Error ? err.message : err),
  );

  return NextResponse.json({ ok: true });
}
