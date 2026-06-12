/**
 * Loyalty points — server-only helpers over the apply_loyalty_points() RPC.
 *
 * Every points movement goes through the SQL function (see schema.sql):
 * it row-locks the customer, dedupes earn/redeem/redeem_reversal per
 * order/sale id (webhook retries + POS outbox replays are no-ops), clamps
 * debits at zero (or hard-fails when enforced), and writes the ledger row
 * plus the cached customers.loyalty_points balance in one transaction.
 *
 * Earning model: floor(money paid × loyaltyPointsPerPound). "Money paid" is
 * the order total NET of coupon / store credit / gift card — those never earn.
 * Redemption model: points buy reward items (loyalty_rewards catalog); points
 * are never converted to a money discount.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";

const SENTINELS = new Set(["guest", "pos-walk-in"]);

export type LoyaltyLedgerType = "earn" | "redeem" | "earn_reversal" | "redeem_reversal" | "adjust";

export interface LoyaltyApplyResult {
  ok: boolean;
  /** Signed points actually applied (debits may be clamped below the request). */
  applied: number;
  /** True when this order/sale already had a row of this type — no-op success. */
  duplicate: boolean;
  balance?: number;
  error?: string;
}

interface ApplyArgs {
  customerId: string;
  delta: number;
  type: LoyaltyLedgerType;
  orderId?: string | null;
  posSaleId?: string | null;
  rewardId?: string | null;
  note?: string;
  /** true → fail with "insufficient" instead of clamping (redeem gate). */
  enforce?: boolean;
}

export async function applyLoyaltyPoints(args: ApplyArgs): Promise<LoyaltyApplyResult> {
  const { data, error } = await supabaseAdmin.rpc("apply_loyalty_points", {
    p_customer_id: args.customerId,
    p_delta:       Math.trunc(args.delta),
    p_type:        args.type,
    p_order_id:    args.orderId ?? null,
    p_pos_sale_id: args.posSaleId ?? null,
    p_reward_id:   args.rewardId ?? null,
    p_note:        args.note ?? "",
    p_enforce:     args.enforce ?? false,
  });
  if (error) {
    console.error("[loyalty] apply_loyalty_points rpc:", error.message);
    return { ok: false, applied: 0, duplicate: false, error: error.message };
  }
  const row = data as { ok: boolean; applied?: number; duplicate?: boolean; balance?: number; error?: string };
  return {
    ok:        row.ok === true,
    applied:   Number(row.applied ?? 0),
    duplicate: row.duplicate === true,
    balance:   row.balance != null ? Number(row.balance) : undefined,
    error:     row.error,
  };
}

/** Live earning rate from app_settings (points per £ of real money). */
export async function getLoyaltyRate(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("data").eq("id", 1).single();
  const rate = Number(data?.data?.loyaltyPointsPerPound);
  return Number.isFinite(rate) && rate >= 0 ? rate : 1;
}

/**
 * Award points for money actually collected on an order / POS sale.
 * Idempotent per orderId / posSaleId — safe to call from webhook retries.
 * Keeps the old call shape (callers pass the net money total).
 */
export async function rewardLoyaltyPoints(
  customerId: string | null | undefined,
  moneyPaid: number,
  ref: { orderId?: string; posSaleId?: string; note?: string } = {},
): Promise<void> {
  if (!customerId || SENTINELS.has(customerId) || moneyPaid <= 0) return;
  try {
    const rate = await getLoyaltyRate();
    const points = Math.floor(moneyPaid * rate);
    if (points <= 0) return;
    const res = await applyLoyaltyPoints({
      customerId,
      delta: points,
      type: "earn",
      orderId: ref.orderId ?? null,
      posSaleId: ref.posSaleId ?? null,
      note: ref.note ?? "",
    });
    if (res.ok && !res.duplicate) {
      console.log(`[Loyalty] Awarded ${res.applied} points to ${customerId}`);
    }
  } catch (err) {
    console.error("[Loyalty] Failed to reward points:", err);
  }
}

/** Net points a reference (order or POS sale) has earned so far: earn − reversals. */
async function netEarnedFor(ref: { orderId?: string; posSaleId?: string }): Promise<number> {
  let q = supabaseAdmin.from("loyalty_transactions").select("type, points");
  if (ref.orderId)        q = q.eq("order_id", ref.orderId);
  else if (ref.posSaleId) q = q.eq("pos_sale_id", ref.posSaleId);
  else return 0;
  const { data } = await q.in("type", ["earn", "earn_reversal"]);
  return (data ?? []).reduce((s, r) => s + Number(r.points ?? 0), 0);
}

/**
 * Claw back earned points after a money refund — but never more than the
 * order/sale actually earned (net of prior clawbacks). An order that never
 * earned (e.g. an unpaid cash order) deducts nothing, so refunds can no
 * longer eat points earned elsewhere.
 */
export async function deductLoyaltyPoints(
  customerId: string | null | undefined,
  refundAmount: number,
  ref: { orderId?: string; posSaleId?: string; note?: string } = {},
): Promise<void> {
  if (!customerId || SENTINELS.has(customerId) || refundAmount <= 0) return;
  try {
    const rate = await getLoyaltyRate();
    let points = Math.floor(refundAmount * rate);
    if (points <= 0) return;

    if (ref.orderId || ref.posSaleId) {
      const earned = await netEarnedFor(ref);
      points = Math.min(points, Math.max(0, earned));
      if (points <= 0) return;
    }

    await applyLoyaltyPoints({
      customerId,
      delta: -points,
      type: "earn_reversal",
      orderId: ref.orderId ?? null,
      posSaleId: ref.posSaleId ?? null,
      note: ref.note ?? "Refund",
    });
  } catch (err) {
    console.error("[Loyalty] Failed to deduct points:", err);
  }
}

/**
 * Reverse EVERYTHING an order / POS sale earned — used when the whole sale is
 * annulled (POS void), regardless of how much money was handed back. Clamped
 * at zero and bounded by the net earned, so replays are harmless.
 */
export async function reverseEarnedPoints(
  customerId: string | null | undefined,
  ref: { orderId?: string; posSaleId?: string },
  note = "Sale voided",
): Promise<void> {
  if (!customerId || SENTINELS.has(customerId)) return;
  try {
    const earned = await netEarnedFor(ref);
    if (earned <= 0) return;
    await applyLoyaltyPoints({
      customerId,
      delta: -earned,
      type: "earn_reversal",
      orderId: ref.orderId ?? null,
      posSaleId: ref.posSaleId ?? null,
      note,
    });
  } catch (err) {
    console.error("[Loyalty] Failed to reverse earned points:", err);
  }
}

/**
 * Redeem points for a reward carried on an order — the atomic gate used by
 * /api/orders and the payment webhooks, alongside store credit / gift cards.
 * enforce=true: fails with reason "insufficient" instead of clamping.
 * Idempotent on orderId (webhook retries debit exactly once).
 */
export async function redeemLoyaltyPointsForOrder(args: {
  customerId: string;
  points: number;
  orderId: string;
  rewardId: string;
}): Promise<{ ok: true } | { ok: false; reason: "insufficient" | "db_error"; error: string }> {
  const res = await applyLoyaltyPoints({
    customerId: args.customerId,
    delta: -Math.abs(args.points),
    type: "redeem",
    orderId: args.orderId,
    rewardId: args.rewardId,
    enforce: true,
    note: "Reward redemption",
  });
  if (res.ok) return { ok: true };
  if (res.error === "insufficient") {
    return { ok: false, reason: "insufficient", error: "Not enough loyalty points." };
  }
  return { ok: false, reason: "db_error", error: res.error ?? "Loyalty redemption failed." };
}

/**
 * Return redeemed points when an order is cancelled / fully refunded before
 * the customer got the food. Reads the redeem rows for the order and credits
 * them back; idempotent (only one redeem_reversal per order is accepted).
 */
export async function refundRedeemedPoints(orderId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("loyalty_transactions")
      .select("customer_id, points, reward_id")
      .eq("order_id", orderId)
      .eq("type", "redeem");
    if (!data || data.length === 0) return;
    const customerId = String(data[0].customer_id);
    const redeemed = data.reduce((s, r) => s + Math.abs(Number(r.points ?? 0)), 0);
    if (redeemed <= 0) return;
    await applyLoyaltyPoints({
      customerId,
      delta: redeemed,
      type: "redeem_reversal",
      orderId,
      rewardId: data[0].reward_id ? String(data[0].reward_id) : null,
      note: "Order cancelled — reward points returned",
    });
  } catch (err) {
    console.error("[Loyalty] Failed to refund redeemed points:", err);
  }
}
