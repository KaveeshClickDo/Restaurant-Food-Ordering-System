/** Format a full order ID for display. Uppercase, prefixed with #. */
export function fullOrderNumber(id: string): string {
  return `#${id.toUpperCase()}`;
}

/** Short fallback for very tight spaces: prefix + last-6. */
export function shortOrderNumber(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`;
}
