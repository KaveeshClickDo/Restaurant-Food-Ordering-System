/**
 * Single source of truth for a customer's lifetime "total spent" contribution
 * from one order. Shared by the admin customer list, the POS customer list, and
 * the customer account page so all three agree.
 *
 * These had drifted into three separate calculations: a paid-then-cancelled
 * order that was NOT refunded counted toward spend in admin (correct — the
 * customer paid and we kept the money) but vanished from both the customer's own
 * "Total spent" and the POS customer stats, which dropped every cancelled order
 * outright and never netted refunds. Centralising the rule here keeps them in
 * lock-step.
 *
 * "Total spent" is NET — what the customer paid and we kept — so refunds reduce
 * spend on every order regardless of fulfilment status:
 *   • Cancelled AND unpaid  → no money ever moved; contributes nothing and is
 *     not counted as a visit.
 *   • Cancelled but paid    → money was kept (no/partial refund); counts at
 *     net = total − refunded.
 *   • Everything else       → net = total − refunded (a fully-refunded order is
 *     £0 but still counts as a visit).
 */

export interface SpendInput {
  status: string;
  /** PaymentStatus — camelCase on the typed client Order, snake_case from DB rows. */
  paymentStatus?: string | null;
  total?: number | string | null;
  /** Cumulative amount refunded so far. */
  refundedAmount?: number | string | null;
}

export function orderSpendContribution(o: SpendInput): { amount: number; counts: boolean } {
  const total = Number(o.total) || 0;
  const refunded = Number(o.refundedAmount) || 0;
  if (o.status === "cancelled") {
    const moneyBearing =
      o.paymentStatus === "paid" ||
      o.paymentStatus === "partially_refunded" ||
      o.paymentStatus === "refunded";
    if (!moneyBearing) return { amount: 0, counts: false };
  }
  return { amount: Math.max(0, total - refunded), counts: true };
}
