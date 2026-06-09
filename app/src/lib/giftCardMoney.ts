/**
 * Gift-card-aware money math — the single source of truth for "how much real
 * money came in" on a sale that may have been part/fully paid by a gift card.
 *
 * A gift card is PREPAID money: it's recognised as income when the card is
 * SOLD, never again when it's spent. So when a gift card covers part/all of a
 * sale, only the remaining cash / card / gateway amount is real money in — and
 * that (not the goods value) is what revenue, customer spend, loyalty points,
 * and refund caps must be based on.
 *
 * ⚠️ NET vs GROSS — read before using:
 *   • ONLINE orders already STORE the net total (the gift card is subtracted
 *     before save — see orderValidation `serverTotal`). Their `total` IS
 *     moneyPaid already. Do NOT call moneyPaidGross() on them — that would
 *     subtract the gift card a second time.
 *   • POS sales and DINE-IN orders STORE the gross goods value and keep the
 *     gift card separately in `gift_card_used`. Use moneyPaidGross() for these.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Real money collected on a GROSS-stored sale (POS / dine-in) =
 * goods total − the gift-card-covered portion, floored at 0.
 *
 * Accepts string|number because DB numeric columns arrive as strings.
 */
export function moneyPaidGross(
  total: number | string | null | undefined,
  giftCardUsed: number | string | null | undefined,
): number {
  const t = Number(total) || 0;
  const g = Number(giftCardUsed) || 0;
  return Math.max(0, round2(t - g));
}
