/**
 * Small shared helpers + tuning constants for the /waiter surface.
 * Pure functions — safe on client and server.
 */

export const fmtCur = (n: number, sym = "£") =>
  sym + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// "HH:MM" → minutes since midnight. Used to compare booking times against now.
export function hhmmToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Awareness windows (minutes). A booking is "due" when it's within DUE_LEAD of
// now; "overdue" once it's OVERDUE_GRACE past with nobody seated; bookings more
// than STALE_MAX in the past are ignored as stale data (POS/admin will clear).
export const DUE_LEAD = 30;
export const OVERDUE_GRACE = 15;
export const STALE_MAX = 120;
