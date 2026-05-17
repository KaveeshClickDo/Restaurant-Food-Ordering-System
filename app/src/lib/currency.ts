/**
 * Currency utilities — single source of truth for money formatting.
 *
 * The admin picks a currency in Admin → Operations. The symbol is stored in
 * app_settings.data.currency.symbol and read everywhere via getSymbol() or
 * the useCurrency() hook. Amounts are stored as naked numbers; only the
 * display symbol is swapped.
 */

import type { AdminSettings } from "@/types";

export interface CurrencyPreset {
  code: string;   // ISO 4217 — kept for future payment-gateway integration
  symbol: string;
  label: string;
}

export const CURRENCY_PRESETS: readonly CurrencyPreset[] = [
  { code: "GBP", symbol: "£",   label: "British Pound" },
  { code: "USD", symbol: "$",   label: "US Dollar" },
  { code: "EUR", symbol: "€",   label: "Euro" },
  { code: "INR", symbol: "₹",   label: "Indian Rupee" },
  { code: "LKR", symbol: "Rs.", label: "Sri Lankan Rupee" },
  { code: "AUD", symbol: "A$",  label: "Australian Dollar" },
  { code: "CAD", symbol: "C$",  label: "Canadian Dollar" },
  { code: "JPY", symbol: "¥",   label: "Japanese Yen" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham" },
  { code: "SGD", symbol: "S$",  label: "Singapore Dollar" },
] as const;

export const DEFAULT_CURRENCY = { code: "GBP", symbol: "£" } as const;

/** Read the symbol from settings, falling back to the default. Tolerates null/undefined. */
export function getSymbol(
  settings: { currency?: { symbol?: string } | null } | null | undefined,
): string {
  return settings?.currency?.symbol || DEFAULT_CURRENCY.symbol;
}

export function getCode(
  settings: { currency?: { code?: string } | null } | null | undefined,
): string {
  return settings?.currency?.code || DEFAULT_CURRENCY.code;
}

/** Primary helper: format an amount using the admin-configured currency. */
export function formatMoney(
  n: number,
  settings: AdminSettings | { currency?: { symbol?: string } | null } | null | undefined,
  opts?: { signed?: boolean; decimals?: number },
): string {
  const sym = getSymbol(settings);
  const sign = opts?.signed && n > 0 ? "+" : "";
  const decimals = opts?.decimals ?? 2;
  return `${sign}${sym}${n.toFixed(decimals)}`;
}

/** Use when only the symbol string is available (server-rendered HTML, ESC/POS bytes). */
export function formatMoneyWithSymbol(
  n: number,
  symbol: string,
  opts?: { signed?: boolean; decimals?: number },
): string {
  const sign = opts?.signed && n > 0 ? "+" : "";
  const decimals = opts?.decimals ?? 2;
  return `${sign}${symbol}${n.toFixed(decimals)}`;
}
