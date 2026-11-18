/** Format a full order ID for display. Uppercase, prefixed with #. */
export function fullOrderNumber(id: string): string {
  return `#${id.toUpperCase()}`;
}

/** Short fallback for very tight spaces: prefix + last-6. */
export function shortOrderNumber(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`;
}

/** Pull the POS receipt number out of an order note, if present. POS sales
 *  embed it as "Receipt: <no>" in the order note field — "R1024" from the
 *  web/tablet POS's shared sequence, or "R-<DEVICE>-<seq>" from the Windows
 *  desktop POS app's per-device offline sequence. Matches either shape, same
 *  as the admin Order History / Order Monitor / Online Reports panels. */
export function extractReceiptNo(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = note.match(/Receipt:\s*(\S+)/);
  return m ? m[1] : null;
}
