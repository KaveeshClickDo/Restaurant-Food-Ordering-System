import type { MenuItem, StockStatus } from "@/types";

/** Items with qty ≤ this value are shown as "low stock" on the frontend. */
export const LOW_STOCK_THRESHOLD = 5;

/**
 * Resolve the effective stock status for a menu item.
 *
 * Priority:
 *  1. If `stockQty` is a number → derive from quantity (0 = OOS, ≤5 = low, >5 = in stock).
 *  2. If `stockStatus` is explicitly set → use it.
 *  3. Default → "in_stock" (available).
 */
export function resolveStock(item: Pick<MenuItem, "stockQty" | "stockStatus">): StockStatus {
  if (typeof item.stockQty === "number") {
    if (item.stockQty <= 0) return "out_of_stock";
    if (item.stockQty <= LOW_STOCK_THRESHOLD) return "low_stock";
    return "in_stock";
  }
  return item.stockStatus ?? "in_stock";
}

/** Returns false when the item must not be added to the cart. */
export function isAvailable(item: Pick<MenuItem, "stockQty" | "stockStatus">): boolean {
  return resolveStock(item) !== "out_of_stock";
}

/** Human-readable label for the resolved status. */
export function stockLabel(status: StockStatus): string {
  return status === "out_of_stock" ? "Out of stock"
       : status === "low_stock"    ? "Low stock"
       :                             "In stock";
}
