/**
 * Customer soft-delete — server-only helpers shared by every delete path
 * (admin/customers/[id], pos/customers/[id], admin/users/[id] type=customer).
 *
 * A "deleted" customer is NOT removed from the table. We stamp `deleted_at` and
 * leave the row (and its FK links) intact, so orders, the loyalty ledger, and
 * the reservation_customers CRM profile all survive. That's what lets a customer
 * come back with everything restored when they re-register (see auth/register).
 *
 * `reactivation_blocked` distinguishes a plain delete (the customer may rejoin
 * by signing up again) from a ban (re-registration is refused). Deletion is
 * still blocked while the customer has any non-terminal order — kitchen /
 * delivery flows depend on the customer link being live.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Synthetic ids that are not real customer rows and must never be soft-deleted.
const PROTECTED_IDS = new Set(["__deleted__", "pos-walk-in"]);

// Orders in these states are still "live" — block deletion until they resolve.
const ACTIVE_ORDER_STATUSES = ["pending", "confirmed", "preparing", "ready"];

export interface SoftDeleteResult {
  ok: boolean;
  status?: number;                               // HTTP status to surface on failure
  error?: string;
  activeOrders?: { id: string; status: string }[];
}

/**
 * Soft-delete a customer: stamp `deleted_at` (and `reactivation_blocked` when
 * `block` is set). Rejects sentinels and blocks while non-terminal orders exist.
 */
export async function softDeleteCustomer(
  id: string,
  { block = false }: { block?: boolean } = {},
): Promise<SoftDeleteResult> {
  if (PROTECTED_IDS.has(id)) {
    return { ok: false, status: 400, error: "This is a system-managed row and cannot be deleted." };
  }

  const { data: activeOrders, error: activeErr } = await supabaseAdmin
    .from("orders")
    .select("id, status")
    .eq("customer_id", id)
    .in("status", ACTIVE_ORDER_STATUSES);
  if (activeErr) return { ok: false, status: 500, error: activeErr.message };
  if (activeOrders && activeOrders.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "This customer has active orders. Cancel or complete them before deleting.",
      activeOrders,
    };
  }

  const { error } = await supabaseAdmin
    .from("customers")
    .update({ deleted_at: new Date().toISOString(), reactivation_blocked: block })
    .eq("id", id);
  if (error) return { ok: false, status: 500, error: error.message };

  return { ok: true };
}

/**
 * Restore (un-delete) a customer: clear `deleted_at` and stamp `reactivated_at`.
 * Everything else is untouched — the row never lost its data.
 */
export async function restoreCustomer(id: string): Promise<SoftDeleteResult> {
  if (PROTECTED_IDS.has(id)) {
    return { ok: false, status: 400, error: "This is a system-managed row and cannot be restored." };
  }
  const { error } = await supabaseAdmin
    .from("customers")
    .update({ deleted_at: null, reactivated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true };
}
