/**
 * What a till sale's card paid, for receipts. Shared by the on-screen, browser
 * print, emailed and thermal receipts so they always agree. Client-safe.
 */

import type { POSCardPayment, POSSale } from "@/types/pos";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The card's part of a sale before any tip added on the machine: the whole
 *  net total for a card sale, the card part of a split, nothing otherwise. */
export function cardLegAmount(sale: Pick<POSSale, "paymentMethod" | "payments" | "total">): number {
  if (sale.paymentMethod === "card") return sale.total;
  if (sale.paymentMethod === "split") {
    return round2((sale.payments ?? []).filter((p) => p.method === "card").reduce((s, p) => s + p.amount, 0));
  }
  return 0;
}

/** What the card was charged in all: its part plus the tip added on the machine. */
export function cardChargedTotal(sale: Pick<POSSale, "paymentMethod" | "payments" | "total" | "cardTipAmount">): number {
  return round2(cardLegAmount(sale) + (sale.cardTipAmount ?? 0));
}

/** "VISA ****1234", or null when Dojo gave no card details. */
export function cardLabel(card?: Pick<POSCardPayment, "scheme" | "last4"> | null): string | null {
  if (!card) return null;
  const parts = [card.scheme?.trim() || null, card.last4 ? `****${card.last4}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** The card line under the payment: "VISA ****1234 · Auth 123456", or null.
 *  Thermal printers pass an ASCII separator: their code page has no "·". */
export function cardDetailLine(card?: POSCardPayment | null, separator = " · "): string | null {
  if (!card) return null;
  const parts = [cardLabel(card), card.authCode ? `Auth ${card.authCode}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(separator) : null;
}
