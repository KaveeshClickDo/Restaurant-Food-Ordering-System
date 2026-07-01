/**
 * Server-side atomic stock mutations for order creation and refunds.
 *
 * Why this exists: the menu_items.stock_qty column was previously only
 * decremented by the POS client in localStorage, which meant:
 *   • Customer online orders never decremented stock at all.
 *   • Waiter dine-in orders never decremented stock at all.
 *   • Two POS terminals could race each other and clobber each other's
 *     pushes because the client did a SET, not an atomic decrement.
 *
 * Both helpers delegate to Postgres functions defined in supabase/schema.sql
 * (decrement_stock_atomic, restore_stock). The decrement is wrapped in a
 * single transaction at the DB level so a multi-item order is all-or-nothing
 * — partial state is impossible.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export interface StockItem {
  /** menu_items.id for this line. Lines with no id (ad-hoc POS items) are skipped. */
  id:  string;
  /** Units to decrement / restore. Non-positive values are skipped. */
  qty: number;
}

export type StockMutationResult =
  | { ok: true }
  | {
      ok: false;
      type: "insufficient_stock";
      id: string;
      name?: string;
      requested?: number;
      available?: number;
      message: string;
    };

/** Collapse duplicate ids and drop invalid entries before sending to the DB. */
function normalise(items: StockItem[]): Array<{ id: string; qty: number }> {
  const map = new Map<string, number>();
  for (const it of items) {
    if (!it || typeof it.id !== "string" || !it.id) continue;
    if (!Number.isFinite(it.qty) || it.qty <= 0) continue;
    map.set(it.id, (map.get(it.id) ?? 0) + Math.floor(it.qty));
  }
  return Array.from(map, ([id, qty]) => ({ id, qty }));
}

/**
 * Atomically decrement stock for every tracked line in `items`. Returns
 * `{ ok: true }` on success, or an `insufficient_stock` failure describing
 * the first line that didn't have enough stock — in which case nothing was
 * mutated.
 *
 * Throws on unexpected DB errors (network failure, schema drift). Callers
 * should treat a thrown error as "could not place order, try again."
 *
 * Pass `{ force: true }` for offline-sale reconciliation (outbox replay): the
 * RPC then oversells instead of rejecting (stock_qty may go negative) so a sale
 * that already happened offline is never stranded. Online sales omit it and
 * keep the hard limit.
 */
export async function decrementStock(
  items: StockItem[],
  opts?: { force?: boolean },
): Promise<StockMutationResult> {
  const payload = normalise(items);
  if (payload.length === 0) return { ok: true };

  // force=true (offline-sale replay) tells the RPC to oversell rather than
  // raise INSUFFICIENT_STOCK — the sale already happened, so it must never be
  // rejected. The count is allowed to go negative as the visible oversell flag.
  const { error } = await supabaseAdmin.rpc("decrement_stock_atomic", {
    p_items: payload,
    p_force: opts?.force ?? false,
  });
  if (!error) return { ok: true };

  // The Postgres function raises P0001 with message "INSUFFICIENT_STOCK <id>"
  // and a JSON detail string. Anything else is a real DB error.
  const err = error as { code?: string; message?: string; details?: string };
  const isInsufficient = err.code === "P0001"
    && typeof err.message === "string"
    && err.message.includes("INSUFFICIENT_STOCK");

  if (isInsufficient) {
    let detail: { id?: string; name?: string; requested?: number; available?: number } = {};
    try { detail = JSON.parse(err.details ?? "{}"); } catch { /* fall through */ }
    const name = detail.name || detail.id || "An item";
    const avail = detail.available ?? 0;
    return {
      ok: false,
      type: "insufficient_stock",
      id: detail.id ?? "",
      name: detail.name,
      requested: detail.requested,
      available: detail.available,
      message: avail > 0
        ? `${name} only has ${avail} left in stock.`
        : `${name} is out of stock.`,
    };
  }

  throw new Error(err.message ?? "Stock decrement failed.");
}

/**
 * Add `qty` back to each item's stock. Used by void and refund flows so a
 * cancelled / refunded order returns inventory to the counter. Idempotency
 * is the caller's responsibility — only call this once per refund event.
 */
export async function restoreStock(items: StockItem[]): Promise<void> {
  const payload = normalise(items);
  if (payload.length === 0) return;

  const { error } = await supabaseAdmin.rpc("restore_stock", { p_items: payload });
  if (error) throw new Error(error.message);
}
