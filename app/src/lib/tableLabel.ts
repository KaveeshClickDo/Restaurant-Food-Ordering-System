/**
 * Canonical parser for the dine-in table label carried in an order's note.
 *
 * Waiter / dine-in orders write their table into the note as:
 *   "[WAITER] Table <label> · <covers> covers · Staff: <name> · <kitchen note>"
 * (see app/src/app/api/waiter/orders/route.ts). The label itself can contain
 * spaces — e.g. "Blue Occupied" — so we capture everything after "Table " up to
 * the " · " field separator (or the end of the note), NOT just the first word.
 *
 * Using `\S+` here (the old approach) truncated multi-word names to their first
 * word, which broke the waiter occupancy grid and showed shortened labels on the
 * kitchen / POS / admin / customer-display screens. Keep all of those pointed at
 * this one helper so the regex never drifts apart again.
 *
 * Pure string function — safe to import on both client and server.
 *
 * @returns the full label (trimmed), or null when the note has no "Table …" part.
 */
export function parseTableLabelFromNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = note.match(/Table\s+(.+?)(?: · |$)/);
  return m ? m[1].trim() : null;
}
