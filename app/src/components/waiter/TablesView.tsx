"use client";

/**
 * Tables grid — the waiter's home screen. Renders live occupancy (ordered =
 * blue, seated-no-order = violet), the reservations overlay (reserved /
 * due / overdue badges), the foldable kitchen-status panel, and the two
 * bottom sheets (occupied-table actions, reserved-table seating).
 *
 * Owns only its sheet/section UI state; all floor data comes from the
 * useFloorState hook via the `floor` prop, and navigation (start order /
 * open bill) is delegated to the page.
 */

import { useState } from "react";
import {
  UtensilsCrossed, LogOut, Users, Crown, CalendarClock, Clock,
  StickyNote, Utensils, Receipt, CheckCircle2, ChefHat,
} from "lucide-react";
import CollectionFooter from "@/components/collection/CollectionFooter";
import type { WaiterStaff, DiningTable } from "@/types";
import type { WaiterReservation, TileReservation, WaiterReceipt } from "./_types";
import { initials, hhmmToMins, DUE_LEAD, OVERDUE_GRACE, STALE_MAX } from "./_utils";
import type { FloorState } from "./useFloorState";
import KitchenStatusPanel from "./KitchenStatusPanel";
import ReceiptModal from "./ReceiptModal";

export default function TablesView({
  waiter, onLogout, tables, activeSection, onSectionChange, floor, slotDuration,
  kitchenOpen, onKitchenToggle, onSelectTable, onOpenBill, receipt, onCloseReceipt,
}: {
  waiter: Omit<WaiterStaff, "pin"> | null;
  onLogout: () => void;
  tables: DiningTable[];
  activeSection: string;
  onSectionChange: (section: string) => void;
  floor: FloorState;
  slotDuration: number;
  kitchenOpen: boolean;
  onKitchenToggle: () => void;
  /** Enter the order flow; coversOverride pre-fills the covers stepper
   *  (e.g. a seated booking's party size). */
  onSelectTable: (table: DiningTable, coversOverride?: number) => void;
  onOpenBill: (table: DiningTable) => void;
  /** Last receipt — floats above the grid after payment until dismissed. */
  receipt: WaiterReceipt | null;
  onCloseReceipt: () => void;
}) {
  const { activeOrders, reservations, occupiedLabels, readyLabels, dismissedReady } = floor;

  // table action sheet: null = closed, DiningTable = which table was tapped
  const [tableAction, setTableAction] = useState<DiningTable | null>(null);
  // seat sheet for a free-but-reserved table: choose "seat reservation" or "walk-in"
  const [seatAction, setSeatAction] = useState<{ table: DiningTable; reservation: WaiterReservation } | null>(null);
  // best-effort flag while a seat/check-in PUT is in flight (prevents double taps)
  const [seating, setSeating] = useState(false);

  const sections = ["All", ...Array.from(new Set(tables.map((t) => t.section)))];
  const visibleTables = activeSection === "All"
    ? tables
    : tables.filter((t) => t.section === activeSection);

  // Per-tile reservation state (null when the table has no active booking
  // today). Pure — recomputed each render; the 5 s / 30 s polls keep "now"
  // fresh enough for the due / overdue windows.
  function reservationInfoFor(label: string): TileReservation | null {
    const forLabel = reservations.filter((r) => r.tableLabel === label);
    if (forLabel.length === 0) return null;

    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const seated = forLabel.find((r) => r.status === "checked_in") ?? null;
    // Upcoming = not yet seated; ignore stale bookings hours in the past.
    const upcoming = forLabel
      .filter((r) =>
        (r.status === "pending" || r.status === "confirmed") &&
        hhmmToMins(r.time) - nowMins > -STALE_MAX,
      )
      .sort((a, b) => hhmmToMins(a.time) - hhmmToMins(b.time));

    const next = upcoming[0] ?? null;
    let minutesUntil: number | null = null;
    let isDue = false;
    let isOverdue = false;
    if (next) {
      minutesUntil = hhmmToMins(next.time) - nowMins;
      isOverdue = minutesUntil <= -OVERDUE_GRACE;
      isDue = !isOverdue && minutesUntil <= DUE_LEAD;
    }
    if (!seated && !next) return null;
    return {
      seated, next, minutesUntil, isDue, isOverdue,
      count: upcoming.length + (seated ? 1 : 0),
      upcomingCount: upcoming.length,
    };
  }

  // A table is occupied if a waiter order is active on it OR a reservation is
  // checked in there — both mean a party is physically seated. This keeps the
  // grid honest when a guest is checked in from POS/admin (or our own Seat
  // action) before any order is placed, instead of waiting for the first order.
  function isOccupiedLabel(label: string): boolean {
    if (occupiedLabels.has(label)) return true;
    return reservations.some((r) => r.tableLabel === label && r.status === "checked_in");
  }

  // Tile tap router: occupied → bill/add-items sheet; free-but-booked → seat
  // sheet (choose reservation vs walk-in); plain free → straight to menu.
  function onTileClick(table: DiningTable) {
    if (isOccupiedLabel(table.label)) { setTableAction(table); return; }
    const info = reservationInfoFor(table.label);
    if (info?.next) { setSeatAction({ table, reservation: info.next }); return; }
    onSelectTable(table);
  }

  // Seat a reservation: flip it to checked_in (best-effort — never blocks
  // ordering), pre-fill covers from the party size, then enter the order flow.
  // The endpoint is idempotent, so a stale double-tap is harmless.
  function seatReservation(table: DiningTable, res: WaiterReservation) {
    setSeatAction(null);
    setSeating(true);
    fetch(`/api/waiter/reservations/${res.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "checked_in" }),
    })
      .then(() => floor.refreshReservations())
      .catch(() => { /* check-in is best-effort; ordering proceeds regardless */ })
      .finally(() => setSeating(false));
    onSelectTable(table, res.partySize > 0 ? res.partySize : 2);
  }

  return (
    <>
      <div className="min-h-screen bg-slate-950 flex flex-col h-full">
        {/* Header */}
        <header className="bg-slate-900 border-b border-slate-800 px-5 py-4 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
              <UtensilsCrossed size={17} className="text-white" />
            </div>
            <h1 className="text-white font-black text-[15px] sm:text-base">Table Selection</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: waiter?.avatarColor ?? "#666" }}
              >
                {initials(waiter?.name ?? "")}
              </div>
              <span className="text-slate-300 text-sm font-medium hidden sm:block">{waiter?.name}</span>
            </div>
            <button
              onClick={onLogout}
              className="flex whitespace-nowrap items-center gap-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl text-xs font-medium transition"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </header>

        {/* Section filter */}
        {sections.length > 2 && (
          <div className="flex gap-2 px-5 py-3 overflow-x-auto flex-shrink-0 border-b border-slate-800">
            {sections.map((s) => (
              <button
                key={s}
                onClick={() => onSectionChange(s)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition ${activeSection === s
                  ? "bg-orange-500 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Colour key — explains the tile states. Matches the POS / admin
            Table Status boards (amber = reserved, blue = occupied), with two
            waiter-only refinements: violet = seated but no order sent yet,
            green = an order is ready to run from the kitchen. */}
        {tables.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2 flex-shrink-0 border-b border-slate-800 overflow-x-auto text-[11px] text-slate-400">
            <span className="font-bold uppercase tracking-wide text-slate-500">Key</span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-600" /> Available
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Reserved
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-400" /> Seated · no order
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> Occupied
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2.5 h-2.5 rounded-full bg-green-400" /> Ready to serve
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> Due / turn soon
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Crown size={11} className="text-amber-400" /> VIP
            </span>
          </div>
        )}

        {/* Kitchen status — foldable panel */}
        <KitchenStatusPanel
          orders={activeOrders}
          dismissedReady={dismissedReady}
          open={kitchenOpen}
          onToggle={onKitchenToggle}
          onDismiss={floor.dismissReady}
        />

        {/* Table grid */}
        <div className="flex-1 p-5 pb-15 overflow-y-auto h-full">
          {tables.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-600">
              <UtensilsCrossed size={40} className="mb-3 opacity-30" />
              <p className="text-sm">No tables configured</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {visibleTables.map((table) => {
                const resInfo = reservationInfoFor(table.label);
                // Occupied splits into two states the floor needs to tell
                // apart: ORDERED (an active kitchen order holds the table —
                // blue, like the POS / admin boards) vs SEATED-NO-ORDER (a
                // checked-in booking but nothing sent to the kitchen yet —
                // violet, so waiters can spot tables still waiting to order).
                const ordered = occupiedLabels.has(table.label);
                const seatedNoOrder = !ordered && !!resInfo?.seated;
                const occupied = ordered || seatedNoOrder;
                // An order for this table is ready in the kitchen — go grab it.
                const hasReady = readyLabels.has(table.label);
                const reservedFree = !occupied && !!resInfo?.next;
                const dueFree = reservedFree && (resInfo!.isDue || resInfo!.isOverdue);

                const tileCls = ordered
                  ? "bg-blue-950/40 border-blue-500/60 hover:bg-blue-950/60"
                  : seatedNoOrder
                    ? "bg-violet-950/40 border-violet-500/60 hover:bg-violet-950/60"
                    : dueFree
                      ? "bg-amber-950/40 border-amber-500/60 hover:bg-amber-950/60"
                      : reservedFree
                        ? "bg-slate-800 border-amber-500/30 hover:border-amber-400/60 hover:bg-slate-700"
                        : "bg-slate-800 border-slate-700 hover:border-orange-500/60 hover:bg-slate-700";

                // Bottom status line pieces. An occupied table shows a calendar
                // icon + "Next <time>" so the bare time reads clearly as the
                // upcoming booking (rose if it lands within one sitting); a
                // free-but-booked table reads Soon / Res / Due.
                const seatedName = occupied ? resInfo?.seated?.customerName?.split(" ")[0] : undefined;
                const nextSoon = !!resInfo?.next && resInfo.minutesUntil != null && resInfo.minutesUntil <= slotDuration;
                const moreLabel = resInfo && resInfo.upcomingCount > 1 ? ` +${resInfo.upcomingCount - 1}` : "";
                const reservedTag = resInfo?.isOverdue ? "Due" : resInfo?.isDue ? "Soon" : "Res";

                return (
                  <button
                    key={table.id}
                    onClick={() => onTileClick(table)}
                    className={`relative flex flex-col items-center justify-center rounded-2xl p-4 aspect-square border-2 transition-all active:scale-95 ${tileCls}`}
                  >
                    {table.isVip && (
                      <span className="absolute top-2 left-2" title="VIP table">
                        <Crown size={13} className="text-amber-400" />
                      </span>
                    )}
                    {hasReady ? (
                      <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" title="Order ready in kitchen" />
                    ) : ordered ? (
                      <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                    ) : seatedNoOrder ? (
                      <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse" title="Seated — no order yet" />
                    ) : reservedFree && (
                      <span className="absolute top-2 right-2" title={`Reserved ${resInfo!.next!.time} · ${resInfo!.next!.partySize} guests`}>
                        <CalendarClock size={12} className={resInfo!.isOverdue ? "text-rose-400" : "text-amber-400"} />
                      </span>
                    )}
                    <span title={table.label} className={`w-full sm:px-2 text-center truncate text-xl sm:text-2xl font-black ${ordered ? "text-blue-100" : seatedNoOrder ? "text-violet-100" : reservedFree ? "text-amber-100" : "text-white"}`}>
                      {table.label}
                    </span>
                    <span className={`text-xs mt-1 ${ordered ? "text-blue-300/70" : seatedNoOrder ? "text-violet-300/70" : reservedFree ? "text-amber-300/70" : "text-slate-500"}`}>
                      <Users size={10} className="inline mr-0.5" />{table.seats}
                    </span>
                    {hasReady ? (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] font-black text-green-400 max-w-full px-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                        <span className="truncate">Ready to serve</span>
                      </span>
                    ) : seatedNoOrder ? (
                      <span className="mt-0.5 text-[10px] font-semibold text-violet-300 truncate max-w-full px-1">
                        {seatedName ? `${seatedName} · no order` : "No order yet"}
                      </span>
                    ) : occupied ? (
                      resInfo?.next ? (
                        <span className={`mt-0.5 flex items-center gap-0.5 text-[10px] font-semibold max-w-full px-1 ${nextSoon ? "text-rose-400" : "text-amber-400"}`}>
                          <CalendarClock size={9} className="flex-shrink-0" />
                          <span className="truncate">Next {resInfo.next.time}{moreLabel}</span>
                        </span>
                      ) : (
                        <span className="mt-0.5 text-[10px] font-semibold text-blue-400 truncate max-w-full px-1">
                          {seatedName || "Occupied"}
                        </span>
                      )
                    ) : resInfo?.next ? (
                      <span className={`mt-0.5 text-[10px] font-semibold truncate max-w-full px-1 ${resInfo.isOverdue ? "text-rose-400" : resInfo.isDue ? "text-amber-300" : "text-amber-400/70"}`}>
                        {reservedTag} {resInfo.next.time}{moreLabel}
                      </span>
                    ) : (
                      <span className="mt-0.5 text-[10px] font-semibold invisible">Available</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Occupied-table action sheet ─────────────────────────────────── */}
        {tableAction && (() => {
          const seatedRes = reservations.find((r) => r.tableLabel === tableAction.label && r.status === "checked_in") ?? null;
          // The next not-yet-seated booking for this table today (if any), so
          // the floor knows the table is booked again later — at any distance.
          const nextRes = reservationInfoFor(tableAction.label)?.next ?? null;
          // This table's live kitchen orders. None + a seated booking means
          // the party hasn't ordered yet — different actions apply (start the
          // order, or check the guest out if they left; there's no bill).
          const tableOrders = activeOrders.filter((o) => o.tableLabel === tableAction.label);
          const hasOrders = tableOrders.length > 0;
          const newC   = tableOrders.filter((o) => o.status === "pending" || o.status === "confirmed").length;
          const prepC  = tableOrders.filter((o) => o.status === "preparing").length;
          const readyC = tableOrders.filter((o) => o.status === "ready").length;
          return (
            <div className="fixed inset-0 z-50 flex items-end justify-center">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTableAction(null)} />
              <div className="relative bg-slate-900 rounded-t-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
                <div className="flex items-center gap-3 mb-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${hasOrders ? "bg-blue-500" : "bg-violet-500"}`}>
                    <UtensilsCrossed size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-white font-black text-lg">Table {tableAction.label}</p>
                    <p className={`text-xs font-medium ${hasOrders ? "text-blue-400" : "text-violet-400"}`}>
                      {seatedRes
                        ? hasOrders ? "Seated guest" : "Seated — no order yet"
                        : "Currently occupied"}
                    </p>
                  </div>
                </div>

                {/* Kitchen progress for this table's orders */}
                {hasOrders && (
                  <div className="bg-slate-800 rounded-2xl px-4 py-3 flex items-center gap-2 flex-wrap">
                    <ChefHat size={13} className="text-slate-400 flex-shrink-0" />
                    <span className="text-slate-300 text-xs font-semibold">
                      {tableOrders.length} order{tableOrders.length !== 1 ? "s" : ""}
                    </span>
                    {newC > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-300 border-amber-500/40">{newC} NEW</span>}
                    {prepC > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full border bg-orange-500/15 text-orange-400 border-orange-500/40">{prepC} PREPARING</span>}
                    {readyC > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded-full border bg-green-500/15 text-green-400 border-green-500/40">{readyC} READY</span>}
                  </div>
                )}

                {/* Booking details — shown when this occupied table is a seated reservation */}
                {seatedRes && (
                  <div className="bg-slate-800 rounded-2xl px-4 py-3 space-y-1.5">
                    <p className="text-white text-sm font-medium">{seatedRes.customerName}</p>
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                      <Clock size={12} className="text-amber-400" />
                      <span>{seatedRes.time}</span>
                      <span className="text-slate-600">·</span>
                      <Users size={12} />
                      <span>{seatedRes.partySize} guests</span>
                    </div>
                    {seatedRes.note && (
                      <p className="text-amber-400 text-xs flex items-center gap-1">
                        <StickyNote size={11} /> {seatedRes.note}
                      </p>
                    )}
                  </div>
                )}

                {/* Upcoming booking — this table is reserved again later today */}
                {nextRes && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 space-y-1">
                    <p className="text-amber-300 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5">
                      <CalendarClock size={12} /> Booked again today
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-300 text-sm">
                      <span className="flex items-center gap-1"><Clock size={13} className="text-amber-400" /> <span className="font-semibold">{nextRes.time}</span></span>
                      <span className="text-slate-600">·</span>
                      <span className="flex items-center gap-1"><Users size={12} className="text-slate-400" /> {nextRes.partySize}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{nextRes.customerName}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    const coversOverride = seatedRes && !hasOrders && seatedRes.partySize > 0 ? seatedRes.partySize : undefined;
                    setTableAction(null);
                    onSelectTable(tableAction, coversOverride);
                  }}
                  className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all"
                >
                  <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Utensils size={18} className="text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-bold">{hasOrders ? "Add More Items" : "Start Order"}</p>
                    <p className="text-slate-400 text-xs">{hasOrders ? "Send another round to the kitchen" : "Send the first round to the kitchen"}</p>
                  </div>
                </button>

                {hasOrders && (
                  <button
                    onClick={() => { setTableAction(null); onOpenBill(tableAction); }}
                    className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all"
                  >
                    <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Receipt size={18} className="text-white" />
                    </div>
                    <div className="text-left">
                      <p className="text-white font-bold">View Bill &amp; Pay</p>
                      <p className="text-slate-400 text-xs">Show total and settle the table</p>
                    </div>
                  </button>
                )}

                {/* Seated booking with nothing ordered — let the floor free the
                    table without POS/admin (party left, or their orders were
                    voided). Idempotent check-out; the grid refreshes after. */}
                {seatedRes && !hasOrders && (
                  <button
                    onClick={() => { floor.checkoutReservationForLabel(tableAction.label); setTableAction(null); }}
                    className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all"
                  >
                    <div className="w-10 h-10 bg-slate-600 rounded-xl flex items-center justify-center flex-shrink-0">
                      <LogOut size={18} className="text-white" />
                    </div>
                    <div className="text-left">
                      <p className="text-white font-bold">Check Out Guest</p>
                      <p className="text-slate-400 text-xs">Party left without ordering — free the table</p>
                    </div>
                  </button>
                )}

                <button
                  onClick={() => setTableAction(null)}
                  className="w-full py-3 text-slate-500 hover:text-slate-300 text-sm font-medium transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}
        {/* ── Reserved-table seat sheet ───────────────────────────────────── */}
        {seatAction && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSeatAction(null)} />
            <div className="relative bg-slate-900 rounded-t-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
                  <CalendarClock size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-black text-lg">Table {seatAction.table.label}</p>
                  <p className="text-amber-400 text-xs font-medium">Reserved</p>
                </div>
              </div>

              {/* Booking details */}
              <div className="bg-slate-800 rounded-2xl px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-white">
                  <Clock size={14} className="text-amber-400" />
                  <span className="font-bold">{seatAction.reservation.time}</span>
                  <span className="text-slate-600">·</span>
                  <Users size={13} className="text-slate-400" />
                  <span className="text-slate-300 text-sm">{seatAction.reservation.partySize} guests</span>
                </div>
                <p className="text-slate-300 text-sm font-medium">{seatAction.reservation.customerName}</p>
                {seatAction.reservation.note && (
                  <p className="text-amber-400 text-xs flex items-center gap-1">
                    <StickyNote size={11} /> {seatAction.reservation.note}
                  </p>
                )}
              </div>

              <button
                onClick={() => seatReservation(seatAction.table, seatAction.reservation)}
                disabled={seating}
                className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all disabled:opacity-50"
              >
                <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={18} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="text-white font-bold">Seat this reservation</p>
                  <p className="text-slate-400 text-xs">Check in &amp; start the order</p>
                </div>
              </button>

              <button
                onClick={() => { const t = seatAction.table; setSeatAction(null); onSelectTable(t); }}
                className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all"
              >
                <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Utensils size={18} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="text-white font-bold">Seat a walk-in instead</p>
                  <p className="text-slate-400 text-xs">Use this table without the booking</p>
                </div>
              </button>

              <button
                onClick={() => setSeatAction(null)}
                className="w-full py-3 text-slate-500 hover:text-slate-300 text-sm font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <CollectionFooter />
      </div>

      {/* Last receipt — floats above tables view after payment */}
      {receipt && (
        <ReceiptModal receipt={receipt} onClose={onCloseReceipt} />
      )}
    </>
  );
}
