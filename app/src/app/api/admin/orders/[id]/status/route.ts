/**
 * PUT /api/admin/orders/[id]/status — update order status
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { sendOrderStatusEmail }                 from "@/lib/emailServer";
import type { OrderStatus }                     from "@/types";
import { parseBody }                            from "@/lib/apiValidation";
import { OrderStatusUpdateSchema }              from "@/lib/schemas/pos";
import { restoreStock, type StockItem }         from "@/lib/stockMutation";

// Statuses we consider "cancelled" for stock-restore purposes. Refunds go
// through /admin/orders/[id]/refund and restore there; here we only handle
// the cancellation transition. Once an order has already passed any of these
// terminal states we treat it as "stock already accounted for" and skip the
// restore on subsequent re-saves.
const TERMINAL_STATUSES_FOR_STOCK = new Set([
  "cancelled", "refunded", "partially_refunded",
]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, OrderStatusUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  // Refetch the current order so we can decide whether to also flip
  // payment_status to "paid" — cash is collected at the moment of delivery,
  // so the unpaid → paid transition happens here (not at order creation).
  // We do this defensively: only flip if the order is currently unpaid AND
  // the new status is "delivered" AND the payment method is NOT card/stripe.
  // This must never override an already-set payment status (e.g. "paid",
  // "refunded", "partially_refunded") — Stripe flows are untouched.
  //
  // We also pull `items` + `oversold` so we can restore stock on the
  // pending → cancelled transition (only when the original sale actually
  // decremented — oversold webhook orders never did).
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("payment_status, payment_method, status, items, oversold, customer_id, store_credit_used")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    console.error("admin/orders/[id]/status PUT (fetch):", fetchErr?.message);
    return NextResponse.json(
      { ok: false, error: fetchErr?.message ?? "Order not found" },
      { status: 500 },
    );
  }

  const method = String(existing.payment_method ?? "").toLowerCase();
  const isCashLike = method !== "stripe" && method !== "card";
  const shouldMarkPaid =
    body.status === "delivered" &&
    existing.payment_status === "unpaid" &&
    existing.status !== "delivered" &&
    isCashLike;

  const updatePayload: Record<string, unknown> = { status: body.status };
  if (shouldMarkPaid) {
    updatePayload.payment_status = "paid";
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    console.error("admin/orders/[id]/status PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Restore stock when an active order transitions into "cancelled". Skip
  // when the order was already in a terminal state (idempotent — admin
  // toggling cancelled → cancelled must not double-restore) or when the
  // original webhook flagged it oversold (the decrement never ran, so
  // restoring would create false positive inventory).
  const wasActive = !TERMINAL_STATUSES_FOR_STOCK.has(String(existing.status ?? ""));
  const becomingCancelled = body.status === "cancelled";
  if (wasActive && becomingCancelled && existing.oversold !== true) {
    const rawItems = Array.isArray(existing.items) ? existing.items as Array<Record<string, unknown>> : [];
    const stockItems: StockItem[] = rawItems
      .map((i) => ({ id: String(i.menuItemId ?? ""), qty: Number(i.qty ?? 0) }))
      .filter((i) => i.id);
    if (stockItems.length > 0) {
      restoreStock(stockItems).catch((err) =>
        console.error("[admin/orders status] stock restore on cancel:", err instanceof Error ? err.message : err),
      );
    }
  }

  // Restore the customer's store credit when an active order goes to
  // "cancelled". Mirrors the stock-restore gate above — only triggers on the
  // first transition into cancelled (`wasActive` guard) so re-saving a
  // cancelled order doesn't double-restore. After topping the balance up we
  // zero the stamp on the order row, which makes the operation idempotent if
  // the same status-update is replayed. Guest / POS walk-in sentinels are
  // skipped — they don't have a real customer balance to restore to.
  const creditUsed = Number(existing.store_credit_used ?? 0);
  const orderCustomerId = String(existing.customer_id ?? "");
  if (
    wasActive && becomingCancelled
    && creditUsed > 0
    && orderCustomerId && orderCustomerId !== "guest" && orderCustomerId !== "pos-walk-in"
  ) {
    try {
      const { data: cust } = await supabaseAdmin
        .from("customers")
        .select("store_credit")
        .eq("id", orderCustomerId)
        .maybeSingle();
      if (cust) {
        const current    = Number(cust.store_credit ?? 0);
        const newBalance = parseFloat((current + creditUsed).toFixed(2));
        const { error: credErr } = await supabaseAdmin
          .from("customers")
          .update({ store_credit: newBalance })
          .eq("id", orderCustomerId);
        if (credErr) {
          console.error("[admin/orders status] store credit restore:", credErr.message);
        } else {
          // Idempotency: zero the order's stamp so a replay sees 0 and no-ops.
          await supabaseAdmin
            .from("orders")
            .update({ store_credit_used: 0 })
            .eq("id", id);
        }
      }
    } catch (err) {
      console.error("[admin/orders status] store credit restore:", err instanceof Error ? err.message : err);
    }
  }

  // Fire-and-forget — email failure must never fail the status update response
  sendOrderStatusEmail(id, body.status as OrderStatus).catch((err: unknown) =>
    console.error("[orders] status email:", err instanceof Error ? err.message : err)
  );

  return NextResponse.json({ ok: true });
}
