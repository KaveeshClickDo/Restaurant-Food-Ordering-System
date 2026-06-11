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

import { useState, useEffect, useCallback, useMemo } from "react";
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
  /** Ready-to-serve orders the waiter hasn't dismissed yet. */
  readyOrders: WaiterActiveOrder[];
  readyLabels: Set<string>;
  /** Locally dismissed ("Got it") ready orders — per-device only: the order
   *  itself stays "ready" in the DB until the bill is settled, so other
   *  tablets still see it. */
  dismissedReady: Set<string>;
  dismissReady: (orderId: string) => void;
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
  const [dismissedReady, setDismissedReady] = useState<Set<string>>(new Set());

  // ── Active dine-in orders (occupancy + kitchen status) ──────────────────────
  // The endpoint already filters fulfillment=dine-in; we keep only rows that
  // still hold a table.
  const refreshOrders = useCallback(async () => {
    try {
      const r = await fetch("/api/waiter/orders", { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as {
        ok: boolean;
        orders?: Array<{ id: string; note?: string | null; status?: string; table_label?: string | null; date?: string; items?: { name: string; qty: number; price: number }[] }>;
      };
      if (!json.ok || !json.orders) return;

      const next: WaiterActiveOrder[] = [];
      for (const o of json.orders) {
        if (o.status === "delivered" || o.status === "cancelled") continue;
        // Prefer the structural table_label column. Fall back to the note for
        // legacy rows — the shared parser keeps the whole label (not just the
        // first word) so multi-word names like "Blue Occupied" match.
        const label = o.table_label?.trim() || parseTableLabelFromNote(String(o.note ?? ""));
        if (!label) continue;
        next.push({
          id:         o.id,
          tableLabel: label,
          status:     o.status ?? "pending",
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

  // Prune local dismissals once their order leaves "ready" (settled / voided)
  // so the set can't grow without bound over a shift.
  useEffect(() => {
    setDismissedReady((prev) => {
      const stillReady = new Set(activeOrders.filter((o) => o.status === "ready").map((o) => o.id));
      const next = new Set([...prev].filter((id) => stillReady.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [activeOrders]);

  // Ready-to-serve orders the waiter hasn't dismissed yet — drives the green
  // tile badge and the kitchen panel's ready rows.
  const readyOrders = useMemo(
    () => activeOrders.filter((o) => o.status === "ready" && !dismissedReady.has(o.id)),
    [activeOrders, dismissedReady],
  );
  const readyLabels = useMemo(
    () => new Set(readyOrders.map((o) => o.tableLabel)),
    [readyOrders],
  );

  const dismissReady = useCallback((orderId: string) => {
    setDismissedReady((prev) => new Set(prev).add(orderId));
  }, []);

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
    dismissedReady, dismissReady, refreshOrders, refreshReservations,
    checkoutReservationForLabel,
  };
}
