/**
 * Server-side store-credit + coupon mutation helpers.
 *
 * These wrap the atomic Postgres functions in supabase/schema.sql
 * (spend_store_credit_atomic / add_store_credit_atomic / claim_coupon_usage).
 * The atomic functions do the check-and-mutate in a single statement, so two
 * concurrent orders can't both spend the same credit or push a coupon past its
 * limit — the same guarantee `decrement_stock_atomic` gives stock and the
 * gift-card CAS gives gift cards.
 *
 * NEVER import from client code — uses supabaseAdmin (service-role bypass).
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type StoreCreditFailureReason = "insufficient" | "db_error";

/**
 * Atomically deduct `amount` from a customer's store credit. The underlying
 * UPDATE is guarded by `store_credit >= amount`, so a concurrent spend that
 * already drained the balance returns no row → we report `insufficient`. The
 * caller gates the order on this and rolls back / refunds on failure.
 */
export async function spendStoreCredit(
  customerId: string,
  amount: number,
): Promise<{ ok: true; newBalance: number } | { ok: false; reason: StoreCreditFailureReason; error: string }> {
  if (!customerId || amount <= 0) {
    // Nothing to spend — treat as a no-op success so callers don't branch.
    return { ok: true, newBalance: 0 };
  }
  const { data, error } = await supabaseAdmin.rpc("spend_store_credit_atomic", {
    p_customer_id: customerId,
    p_amount: amount,
  });
  if (error) {
    return { ok: false, reason: "db_error", error: error.message };
  }
  // NULL return = the guarded UPDATE matched no row = balance was insufficient
  // (or the customer row is missing). Either way the credit can't back the order.
  if (data === null || data === undefined) {
    return { ok: false, reason: "insufficient", error: "Store credit balance insufficient." };
  }
  return { ok: true, newBalance: Number(data) };
}

/**
 * Atomically credit `amount` back to a customer's store credit. Used to
 * compensate a successful store-credit spend when a later gate on the same
 * order fails (and reusable by the refund / cancel restore paths). Best-effort:
 * returns the new balance, or an error the caller can log.
 */
export async function refundStoreCredit(
  customerId: string,
  amount: number,
): Promise<{ ok: boolean; newBalance?: number; error?: string }> {
  if (!customerId || amount <= 0) return { ok: true };
  const { data, error } = await supabaseAdmin.rpc("add_store_credit_atomic", {
    p_customer_id: customerId,
    p_amount: amount,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, newBalance: data === null || data === undefined ? undefined : Number(data) };
}

/**
 * Atomically claim one use of a coupon. Returns true if a use was recorded,
 * false if the coupon is at its usage limit (or no longer exists). The settings
 * row is locked for the duration, so concurrent claims can't lose updates to
 * the app_settings JSONB blob. Soft enforcement: the caller does NOT roll the
 * order back on a false return — it just means the counter is already at its cap.
 */
export async function claimCouponUsage(couponId: string): Promise<boolean> {
  if (!couponId) return false;
  const { data, error } = await supabaseAdmin.rpc("claim_coupon_usage", {
    p_coupon_id: couponId,
  });
  if (error) {
    console.error("[storeCredit] claimCouponUsage:", error.message);
    return false;
  }
  return data === true;
}
