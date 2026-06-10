/**
 * Canonical "is this table physically occupied right now" logic, shared by the
 * reservation availability check and the booking-conflict re-checks so they all
 * agree. A dine-in order on a table means a party is physically sitting there;
 * that should block a new reservation for the same sitting — without anyone
 * having to create a reservation row for the walk-in.
 *
 * Two distinct notions live in this codebase; keep them straight:
 *   - LIVE occupancy (waiter / POS / admin grids): table is taken until the
 *     guest leaves (bill settled = order 'delivered', or reservation checked_out).
 *   - BOOKING availability (this file): a table is unavailable for slot T only if
 *     an active order's *sitting window* [order time, +slotDuration] overlaps T,
 *     on the same local day. So a 3 pm walk-in blocks a 3:30 booking but NOT an
 *     8 pm one — the table will have turned over.
 *
 * Timezone: like the rest of the reservation code (availability's past-slot
 * check, admin todayStr), times are compared in the server's local zone, which
 * is assumed to be the restaurant's.
 *
 * Server-only — pulls supabaseAdmin. Never throws; degrades to "no order
 * occupancy" on error so a booking is never blocked by an infrastructure hiccup.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseTableLabelFromNote } from "@/lib/tableLabel";

// A dine-in order holds its table until it's settled ('delivered') or voided
// ('cancelled'). Those two free the table, so they're excluded here.
const ACTIVE_DINE_IN_STATUSES = ["pending", "confirmed", "preparing", "ready"];

/** ISO timestamp → local calendar date ("YYYY-MM-DD") + minutes-since-midnight. */
function localDateMins(iso: string): { date: string; mins: number } {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { date, mins: d.getHours() * 60 + d.getMinutes() };
}

/** "HH:MM" → minutes since midnight. */
function hhmmToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Snap a raw time down to the slot it falls into, so a guest seated mid-slot is
 * treated as occupying that slot — e.g. an order at 4:25 becomes the 4:00 slot,
 * matching how a checked-in reservation (which carries the slot time) blocks.
 * Falls back to the raw time when the slot grid isn't supplied.
 */
function snapToSlot(mins: number, openTime?: string, intervalMinutes?: number): number {
  if (!intervalMinutes || intervalMinutes <= 0) return mins;
  const openMins = openTime ? hhmmToMins(openTime) : 0;
  if (mins < openMins) return mins;
  return openMins + Math.floor((mins - openMins) / intervalMinutes) * intervalMinutes;
}

export interface OrderOccupancyResult {
  /** Table ids whose active dine-in order overlaps the requested slot. */
  ids: Set<string>;
  /** True if the orders query failed — caller should treat as "no extra blocks". */
  error: boolean;
}

export interface OrderOccupancyOpts {
  date: string;
  requestedMins: number;
  slotDurationMinutes: number;
  /** Slot grid. When supplied, each order's time is snapped down to the slot it
   *  falls into (4:25 → 4:00), so a waiter-seated walk-in blocks the same future
   *  slots as a checked-in reservation, which already carries the slot time. */
  slotIntervalMinutes?: number;
  openTime?: string;
  /** label → id, so pre-migration rows without a table_id resolve via their note. */
  tablesByLabel?: Map<string, string>;
}

/**
 * Table ids physically occupied by an active dine-in order whose sitting window
 * overlaps `requestedMins` on local day `date`.
 */
export async function getOrderOccupiedTableIds(opts: OrderOccupancyOpts): Promise<OrderOccupancyResult> {
  const { date, requestedMins, slotDurationMinutes, slotIntervalMinutes, openTime, tablesByLabel } = opts;
  const ids = new Set<string>();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("table_id, table_label, note, date")
    .eq("fulfillment", "dine-in")
    .in("status", ACTIVE_DINE_IN_STATUSES)
    .limit(1000);

  if (error || !data) return { ids, error: !!error };

  for (const o of data) {
    const { date: oDate, mins: oMins } = localDateMins(o.date as string);
    // Occupancy is a "now" signal — it only affects bookings on the same day.
    if (oDate !== date) continue;
    // Treat the order as occupying its slot (4:25 → 4:00) so its sitting window
    // lines up with how reservations block. Sitting-window overlap is symmetric,
    // mirroring the reservation overlap rule.
    const slotMins = snapToSlot(oMins, openTime, slotIntervalMinutes);
    if (Math.abs(slotMins - requestedMins) >= slotDurationMinutes) continue;

    let id = (o.table_id as string | null) ?? null;
    if (!id) {
      const label = (o.table_label as string | null) ?? parseTableLabelFromNote(o.note as string | null);
      if (label && tablesByLabel) id = tablesByLabel.get(label) ?? null;
    }
    if (id) ids.add(id);
  }

  return { ids, error: false };
}

/**
 * Table ids that are physically occupied *right now* by an active dine-in order
 * — no time window, just "is a party sitting there". This is the LIVE-occupancy
 * notion used by the staff table-status dashboards (waiter / POS / admin), as
 * opposed to the sitting-window logic above used for booking availability.
 *
 * Resolves legacy rows that have no table_id via their note → dining_tables.label
 * (loaded lazily, only if such a row exists). Never throws.
 */
export async function getActiveDineInTableIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("table_id, table_label, note")
    .eq("fulfillment", "dine-in")
    .in("status", ACTIVE_DINE_IN_STATUSES)
    .limit(1000);

  if (error || !data) return ids;

  let labelToId: Map<string, string> | null = null;
  for (const o of data) {
    let id = (o.table_id as string | null) ?? null;
    if (!id) {
      const label = (o.table_label as string | null) ?? parseTableLabelFromNote(o.note as string | null);
      if (label) {
        if (!labelToId) {
          const { data: rows } = await supabaseAdmin.from("dining_tables").select("id, label");
          labelToId = new Map((rows ?? []).map((t) => [t.label as string, t.id as string]));
        }
        id = labelToId.get(label) ?? null;
      }
    }
    if (id) ids.add(id);
  }

  return ids;
}
