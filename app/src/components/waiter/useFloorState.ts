"use client";

/**
 * Live floor data for the /waiter surface: active dine-in orders + today's
 * reservations, polled from the waiter's own API (never the KDS routes),
 * plus the derived occupancy / ready sets the tables grid renders from.
 *
 * One orders poll feeds three consumers: which tables are occupied, which
 * occupied tables have actually ordered (vs just seated), and the foldable
 * kitchen-status panel.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { parseTableLabelFromNote } from "@/lib/tableLabel";
import type { WaiterActiveOrder, WaiterReservation } from "./_types";

export interface FloorState {
  /** All active dine-in orders (any waiter). */
  activeOrders: WaiterActiveOrder[];
  /** Today's active reservations (pending / confirmed / checked_in). */
  reservations: WaiterReservation[];
  /** Tables holding at least one active waiter order — the "ordered" half of
   *  occupied. A checked-in reservation with no order yet is the other half. */
  occupiedLabels: Set<string>;
  /** Ready-to-serve orders. */
  readyOrders: WaiterActiveOrder[];
  readyLabels: Set<string>;
  /** Mark a ready ticket served — persisted server-side (PUT
   *  /api/waiter/tickets/[id]/serve), visible to every device and the KDS
   *  immediately. The ticket stays occupying its table (not "delivered")
   *  until the bill is actually settled. Best-effort + idempotent. */
  markServed: (ticketId: string) => void;
  refreshOrders: () => void;
  refreshReservations: () => void;
  /** Close out the reservation seated at a table (settle / party left).
   *  Best-effort + idempotent: a missing or already checked-out booking is a
   *  no-op and never blocks the caller. */
  checkoutReservationForLabel: (label: string) => void;
}

export function useFloorState(polling: boolean): FloorState {
  const [activeOrders, setActiveOrders] = useState<WaiterActiveOrder[]>([]);
  const [reservations, setReservations] = useState<WaiterReservation[]>([]);

  // Guards markServed()'s optimistic update against the automatic 5 s poll
  // racing ahead of the serve PUT — same idea as the KDS page's pendingStatusRef.
  const pendingServedRef = useRef<Map<string, number>>(new Map());

  // ── Active dine-in tickets (occupancy + kitchen status) ─────────────────────
  // Reads the per-round kitchen tickets (one per original order / add-more), not
  // the single settle-time bill: occupancy, ready-to-serve and the kitchen panel
  // are all per-round. Same response shape as the old /api/waiter/orders poll
  // (ok + orders[]), so only the URL changed.
  const refreshOrders = useCallback(async () => {
    try {
      const r = await fetch("/api/waiter/tickets", { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as {
        ok: boolean;
        orders?: Array<{ id: string; note?: string | null; status?: string; table_label?: string | null; date?: string; items?: { name: string; qty: number; price: number }[] }>;
      };
      if (!json.ok || !json.orders) return;

      const pendingServed = pendingServedRef.current;
      const now = Date.now();
      const next: WaiterActiveOrder[] = [];
      for (const o of json.orders) {
        if (o.status === "delivered" || o.status === "cancelled") continue;
        // Prefer the structural table_label column. Fall back to the note for
        // legacy rows — the shared parser keeps the whole label (not just the
        // first word) so multi-word names like "Blue Occupied" match.
        const label = o.table_label?.trim() || parseTableLabelFromNote(String(o.note ?? ""));
        if (!label) continue;
        let status = o.status ?? "pending";
        const until = pendingServed.get(o.id);
        if (until !== undefined) {
          if (until < now || status === "served") pendingServed.delete(o.id);
          else status = "served";
        }
        next.push({
          id:         o.id,
          tableLabel: label,
          status,
          items:      o.items ?? [],
          date:       o.date ?? "",
        });
      }
      setActiveOrders(next);
    } catch { /* ignore — surface is non-critical */ }
  }, []);

  useEffect(() => {
    if (!polling) return;
    refreshOrders();
    // Unlike the kitchen/driver/POS surfaces, the waiter grid had no auto-
    // refresh, so a tablet left on the tables view could show stale occupied/
    // free state until its own waiter acted. Poll every 5 s while the grid is
    // visible so changes from other devices (another waiter seating or
    // settling a table, the kitchen advancing an order) self-heal. Interval
    // matches the 4–6 s used elsewhere.
    const id = setInterval(refreshOrders, 5_000);
    return () => clearInterval(id);
  }, [polling, refreshOrders]);

  const occupiedLabels = useMemo(
    () => new Set(activeOrders.map((o) => o.tableLabel)),
    [activeOrders],
  );

  // Ready-to-serve orders — drives the green tile badge and the kitchen panel's ready rows.
  const readyOrders = useMemo(
    () => activeOrders.filter((o) => o.status === "ready"),
    [activeOrders],
  );
  const readyLabels = useMemo(
    () => new Set(readyOrders.map((o) => o.tableLabel)),
    [readyOrders],
  );

  // Optimistic local flip to "served" so the badge clears instantly on this
  // device, then the real write — refreshOrders reconciles everyone else
  // (and this device, on the next poll) with the server's own copy.
  const markServed = useCallback((ticketId: string) => {
    setActiveOrders((prev) => prev.map((o) => (o.id === ticketId ? { ...o, status: "served" } : o)));
    pendingServedRef.current.set(ticketId, Date.now() + 10_000);
    fetch(`/api/waiter/tickets/${ticketId}/serve`, { method: "PUT" })
      .then(() => {
        pendingServedRef.current.delete(ticketId);
        refreshOrders();
      })
      .catch(() => { /* best-effort; the guard's TTL + next poll self-heal */ });
  }, [refreshOrders]);

  // ── Today's reservations overlay ─────────────────────────────────────────────
  // Always on, regardless of the admin "reservations" toggle: that toggle only
  // hides the booking button on the customer-facing website. POS/admin can
  // still take phone bookings while it's off, so the waiter grid must keep
  // showing them (POS and the admin Table Status board already ignore the
  // toggle). The endpoint is fail-safe — it returns an empty list on any DB
  // problem, so the grid never breaks because of this overlay.
  const refreshReservations = useCallback(async () => {
    try {
      // Use the tablet's local date so a server/browser timezone gap can't shift
      // which day's bookings we load.
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const r = await fetch(`/api/waiter/reservations?date=${localDate}`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; reservations?: WaiterReservation[] };
      if (json.ok && Array.isArray(json.reservations)) setReservations(json.reservations);
    } catch { /* network — keep last good values */ }
  }, []);

  useEffect(() => {
    if (!polling) return;
    refreshReservations();
    // Bookings don't move second-to-second, so poll slower than occupancy (30 s).
    const id = setInterval(refreshReservations, 30_000);
    return () => clearInterval(id);
  }, [polling, refreshReservations]);

  // When a table is settled/cleared, close out any reservation seated there
  // today.
  const checkoutReservationForLabel = useCallback((label: string) => {
    const res = reservations.find((r) => r.tableLabel === label && r.status === "checked_in");
    if (!res) return;
    fetch(`/api/waiter/reservations/${res.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "checked_out" }),
    })
      .then(() => refreshReservations())
      .catch(() => { });
  }, [reservations, refreshReservations]);

  return {
    activeOrders, reservations, occupiedLabels, readyOrders, readyLabels,
    markServed, refreshOrders, refreshReservations,
    checkoutReservationForLabel,
  };
}
