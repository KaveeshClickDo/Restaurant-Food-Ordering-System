/**
 * The short id of a POS till sale, and how a card machine payment names it.
 *
 * A till card payment's Dojo reference is "POS sale 3F9A2C1B": the first 8
 * characters of the sale's id, upper-case (the same short form the
 * reservations list shows). The till makes the sale's id when the payment
 * screen opens, so the reference is known before the card is charged, and the
 * sales searches find the sale from it. A Dojo payment whose short id matches
 * no sale was charged but never saved.
 */

/** "3F9A2C1B" for sale id "3f9a2c1b-…". */
export function shortSaleId(saleId: string): string {
  return saleId.slice(0, 8).toUpperCase();
}

/** The card machine payment's reference for a till sale (well under Dojo's 60 characters). */
export function posSaleReference(saleId: string): string {
  return `POS sale ${shortSaleId(saleId)}`;
}

/**
 * Does a sales search name this sale by its short id? Typed on its own
 * ("3f9a2c1b", or at least its first 4 characters) or pasted as Dojo shows it
 * ("POS sale 3F9A2C1B"). Case doesn't matter.
 */
export function matchesShortSaleId(saleId: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^pos sale\s+/, "");
  return q.length >= 4 && saleId.toLowerCase().startsWith(q);
}
