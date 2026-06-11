/**
 * Display label for an order's raw payment_method on admin screens.
 *
 * The raw value differs by where the order/payment came from:
 *   • Online checkout stores the configured method NAME ("Card (Stripe)",
 *     "PayPal", "Cash", or a custom method name).
 *   • The POS sales mirror and waiter settle store machine tenders
 *     ("cash", "card", "split", "gift_card").
 *   • POS settling an online collection order writes "Cash" / "Card" /
 *     "Split (cash + card)".
 *   • Unsettled dine-in orders carry "table-service".
 *
 * Admin screens show all of these side by side, so the ambiguous Cash/Card
 * buckets get tagged with where the money was taken: a card charged on the
 * physical terminal is "Card (POS/Waiter)" — only Stripe/PayPal cards are
 * truly online — while cash splits on whether the order was placed online
 * ("Cash (Online)") or rung up by staff ("Cash (POS/Waiter)").
 *
 * `staffOrder` = the order originated at the till / table service
 * (pos-walk-in customer or dine-in fulfillment) rather than the online shop.
 */
export function paymentMethodLabel(raw: string | null | undefined, staffOrder: boolean): string {
  const value = (raw ?? "").trim();
  if (!value) return "Unknown";
  switch (value.toLowerCase()) {
    case "card":                return "Card (POS/Waiter)";
    case "cash":                return staffOrder ? "Cash (POS/Waiter)" : "Cash (Online)";
    case "split":
    case "split (cash + card)": return "Split (POS/Waiter)";
    case "gift_card":           return "Gift Card";
    case "table-service":       return "Table Service (unsettled)";
    default:                    return value; // "Card (Stripe)", "PayPal", custom method names
  }
}
