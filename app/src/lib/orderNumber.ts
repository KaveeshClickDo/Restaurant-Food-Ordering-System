/** Format a full order ID for display. Uppercase, prefixed with #. */
export function fullOrderNumber(id: string): string {
  return `#${id.toUpperCase()}`;
}

/** Short fallback for very tight spaces: prefix + last-6. */
export function shortOrderNumber(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`;
}

/** Pull the POS receipt number ("R1024") out of an order note, if present.
 *  POS sales embed it as "Receipt: R1024" in the order note field. */
export function extractReceiptNo(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = note.match(/Receipt:\s*(R\d+)/);
  return m ? m[1] : null;
}

/** Short, screen-friendly code: a one-letter type prefix + the last 6 chars of
 *  the id. e.g. shortCode("C", "ord-…c9dc2b") → "C-C9DC2B". This is the code the
 *  in-store customer-display board shows; other surfaces echo it for cross-ref. */
export function shortCode(prefix: string, id: string): string {
  return `${prefix}-${id.slice(-6).toUpperCase()}`;
}

/** Collection label for staff/customer surfaces: the full order number followed
 *  by the board's short C-code in brackets, so an order can be matched against
 *  the in-store collection screen. e.g. "#ORD-1A2B3C4D (C-2B3C4D)". */
export function collectionLabel(id: string): string {
  return `${fullOrderNumber(id)} (${shortCode("C", id)})`;
}

/** Customer-facing order label. Collection orders carry the board C-code in
 *  brackets; everything else is just the full order number. */
export function customerOrderLabel(id: string, fulfillment: string): string {
  return fulfillment === "collection" ? collectionLabel(id) : fullOrderNumber(id);
}
