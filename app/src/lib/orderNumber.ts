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
