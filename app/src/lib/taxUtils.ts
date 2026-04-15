/**
 * Tax (VAT) calculation utilities — browser-safe, no Node.js APIs.
 *
 * Two modes:
 *  inclusive  – prices already contain VAT. The VAT amount is extracted for
 *               display only; the order total is unchanged.
 *  exclusive  – prices are ex-VAT. The VAT amount is added on top and the
 *               order total increases accordingly.
 *
 * VAT always applies to the cart item subtotal only. Delivery and service fees
 * are treated as non-VATable for simplicity (common in UK food delivery).
 */

import type { AdminSettings } from "@/types";

// ─── Result shape ─────────────────────────────────────────────────────────────

export interface TaxResult {
  /** Whether VAT is active and should be displayed. */
  enabled: boolean;
  /** The calculated VAT £ amount (0 when disabled). */
  vatAmount: number;
  /**
   * true  = VAT is already embedded in item prices (inclusive).
   * false = VAT is added on top (exclusive) — increases the order total.
   */
  inclusive: boolean;
  /** VAT rate, e.g. 20. */
  rate: number;
  /** Human-readable label, e.g. "VAT (20%)" or "Incl. VAT (20%)". */
  label: string;
  /** Whether the admin chose to show the VAT breakdown line. */
  showBreakdown: boolean;
}

// ─── Main calculator ──────────────────────────────────────────────────────────

/**
 * Compute the VAT for a given cart subtotal using the current admin settings.
 *
 * @param cartSubtotal – sum of (item.price × qty), before delivery / service
 *                       fees and before coupon discount.
 */
export function computeTax(cartSubtotal: number, settings: AdminSettings): TaxResult {
  const tax = settings.taxSettings;

  const disabled: TaxResult = {
    enabled: false, vatAmount: 0, inclusive: false,
    rate: 0, label: "", showBreakdown: false,
  };

  if (!tax?.enabled) return disabled;

  const rate = Math.max(0, Math.min(100, tax.rate ?? 20));

  if (tax.inclusive) {
    // Extract embedded VAT: vatAmount = subtotal × rate / (100 + rate)
    const vatAmount = parseFloat((cartSubtotal * rate / (100 + rate)).toFixed(2));
    return {
      enabled: true,
      vatAmount,
      inclusive: true,
      rate,
      label: `Incl. VAT (${rate}%)`,
      showBreakdown: tax.showBreakdown ?? true,
    };
  } else {
    // Add VAT on top: vatAmount = subtotal × rate / 100
    const vatAmount = parseFloat((cartSubtotal * rate / 100).toFixed(2));
    return {
      enabled: true,
      vatAmount,
      inclusive: false,
      rate,
      label: `VAT (${rate}%)`,
      showBreakdown: tax.showBreakdown ?? true,
    };
  }
}

/**
 * Return the amount that should be ADDED to the order grand total due to tax.
 * For inclusive VAT this is 0 (price already contains it).
 * For exclusive VAT this is the full vatAmount.
 */
export function taxSurcharge(tax: TaxResult): number {
  return tax.inclusive ? 0 : tax.vatAmount;
}

/**
 * Format a VAT amount for display, prefixed with "+" for exclusive mode.
 */
export function formatVat(tax: TaxResult): string {
  if (!tax.enabled) return "";
  const sign = tax.inclusive ? "" : "+";
  return `${sign}£${tax.vatAmount.toFixed(2)}`;
}
