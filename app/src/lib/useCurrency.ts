"use client";

import { useApp } from "@/context/AppContext";
import { formatMoney, getSymbol } from "./currency";

/**
 * React hook for the admin-configured currency. Reads from AppContext.
 *
 * Usage:
 *   const { symbol, fmt } = useCurrency();
 *   <span>{fmt(item.price)}</span>
 */
export function useCurrency() {
  const { settings } = useApp();
  const symbol = getSymbol(settings);
  return {
    symbol,
    fmt: (n: number, opts?: { signed?: boolean; decimals?: number }) =>
      formatMoney(n, settings, opts),
  };
}
