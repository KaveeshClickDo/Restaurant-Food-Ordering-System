/**
 * Shared business logic for online collection-order pickups, used by BOTH the
 * POS Collection tab (/api/pos/orders/*) and the standalone /collection surface
 * (/api/collection/orders/*). Server-only — uses supabaseAdmin.
 *
 * "Online collection order" = fulfillment "collection" with a real customer_id
 * (the POS walk-in sentinel is excluded — those are settled via pos_sales).
 * order.total is already net of coupon / store credit / gift card applied at
 * checkout, so settling just records the tender and completes the handover.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rewardLoyaltyPoints } from "@/lib/loyaltyUtils";
import { sendOrderStatusEmail } from "@/lib/emailServer";

const POS_CUSTOMER_ID = "pos-walk-in";
const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

const ORDER_SELECT = `
  id, items, total, note, status, payment_method, payment_status,
  date, scheduled_time, customer_id,
  customers ( name, phone )
`;

const TENDER_LABEL: Record<"cash" | "card" | "split", string> = {
  cash:  "Cash",
  card:  "Card",
  split: "Split (cash + card)",
};

export type CollectionTender = "cash" | "card" | "split";

export interface MutationResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * List collection orders for the pickup queue.
 *  - active  → status in (pending, confirmed, preparing, ready)
 *  - history → status = "delivered" (optionally since `sinceISO`)
 */
export async function listCollectionOrders(opts: {
  history?: boolean;
  sinceISO?: string;
  limit?: number;
} = {}): Promise<{ ok: true; orders: unknown[] } | { ok: false; error: string }> {
  const limit = Math.min(opts.limit ?? 200, 2000);

  let q = supabaseAdmin
    .from("orders")
    .select(ORDER_SELECT)
    .eq("fulfillment", "collection")
    .neq("customer_id", POS_CUSTOMER_ID)
    .order("date", { ascending: false })
    .limit(limit);

  if (opts.history) {
    q = q.eq("status", "delivered");
    if (opts.sinceISO) q = q.gte("date", opts.sinceISO);
  } else {
    q = q.in("status", ACTIVE_STATUSES);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[collectionOrders] list:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, orders: data ?? [] };
}

/**
 * Take payment for an unpaid, ready online collection order: flip it to
 * paid + delivered and award loyalty (exactly once — guarded by the
 * payment_status="unpaid" precondition).
 */
export async function settleCollectionOrder(
  id: string,
  paymentMethod: CollectionTender,
): Promise<MutationResult> {
  const { data: order, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("status, fulfillment, payment_status, customer_id, total")
    .eq("id", id)
    .single();

  if (fetchErr || !order) return { ok: false, status: 404, error: "Order not found." };

  if (order.fulfillment !== "collection" || order.customer_id === POS_CUSTOMER_ID) {
    return { ok: false, status: 400, error: "This is not an online collection order." };
  }
  if (order.payment_status !== "unpaid") {
    return { ok: false, status: 409, error: `Order is already '${order.payment_status}'. Use 'Mark Collected' instead.` };
  }
  if (order.status !== "ready") {
    return { ok: false, status: 409, error: `Order is '${order.status}', not 'ready'.` };
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
    console.error("[collectionOrders] settle:", error.message);
    return { ok: false, status: 500, error: error.message };
  }

  await rewardLoyaltyPoints(order.customer_id, Number(order.total), { orderId: id });
  sendOrderStatusEmail(id, "delivered").catch((err: unknown) =>
    console.error("[collectionOrders] settle email:", err instanceof Error ? err.message : err),
  );

  return { ok: true, status: 200 };
}

/**
 * Complete the handover of an already-paid (card/online) collection order:
 * ready → delivered. No payment, no loyalty (already awarded at checkout).
 */
export async function markCollectionCollected(id: string): Promise<MutationResult> {
  const { data: order, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("status, fulfillment, customer_id")
    .eq("id", id)
    .single();

  if (fetchErr || !order) return { ok: false, status: 404, error: "Order not found." };
  if (order.fulfillment !== "collection" || order.customer_id === POS_CUSTOMER_ID) {
    return { ok: false, status: 400, error: "This is not an online collection order." };
  }
  if (order.status !== "ready") {
    return { ok: false, status: 409, error: `Order is '${order.status}', not 'ready'.` };
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({ status: "delivered" })
    .eq("id", id);

  if (error) {
    console.error("[collectionOrders] collected:", error.message);
    return { ok: false, status: 500, error: error.message };
  }

  sendOrderStatusEmail(id, "delivered").catch((err: unknown) =>
    console.error("[collectionOrders] collected email:", err instanceof Error ? err.message : err),
  );

  return { ok: true, status: 200 };
}

/** Resolve a history period token to an ISO lower bound. */
export function periodToSinceISO(period: string | null): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // local midnight today
  if (period === "7d")  start.setDate(start.getDate() - 6);
  if (period === "30d") start.setDate(start.getDate() - 29);
  return start.toISOString();
}
