"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useApp } from "@/context/AppContext";
import type { Order, OrderStatus } from "@/types";
import {
  ChefHat, Clock, Truck, ShoppingBag, CheckCircle2,
  LayoutDashboard, Maximize2, Minimize2, UtensilsCrossed,
  AlertTriangle, CalendarClock,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlatOrder {
  order: Order;
  customerId: string;
  customerName: string;
}

type ColumnConfig = {
  statuses: OrderStatus[];
  label: string;
  shortLabel: string;
  borderClass: string;
  dotClass: string;
  badgeClass: string;
  textClass: string;
  buttonClass: string;
  colBg: string;
  nextStatus?: OrderStatus;
  nextLabel?: string;
};

// ─── Column config ────────────────────────────────────────────────────────────

const COLUMNS: ColumnConfig[] = [
  {
    statuses:    ["pending", "confirmed"],
    label:       "New Orders",
    shortLabel:  "NEW",
    borderClass: "border-orange-500",
    dotClass:    "bg-orange-500",
    badgeClass:  "bg-orange-500 text-white",
    textClass:   "text-orange-400",
    buttonClass: "bg-orange-500 hover:bg-orange-400 active:bg-orange-600",
    colBg:       "bg-orange-500/5",
    nextStatus:  "preparing",
    nextLabel:   "Start Preparing",
  },
  {
    statuses:    ["preparing"],
    label:       "Preparing",
    shortLabel:  "PREP",
    borderClass: "border-blue-500",
    dotClass:    "bg-blue-500",
    badgeClass:  "bg-blue-500 text-white",
    textClass:   "text-blue-400",
    buttonClass: "bg-blue-500 hover:bg-blue-400 active:bg-blue-600",
    colBg:       "bg-blue-500/5",
    nextStatus:  "ready",
    nextLabel:   "Mark Ready",
  },
  {
    statuses:    ["ready"],
    label:       "Ready",
    shortLabel:  "READY",
    borderClass: "border-green-500",
    dotClass:    "bg-green-500",
    badgeClass:  "bg-green-500 text-white",
    textClass:   "text-green-400",
    buttonClass: "",
    colBg:       "bg-green-500/5",
    // No nextStatus — kitchen's job ends here. Driver handles delivery,
    // admin handles collection (ready → delivered) via the admin panel.
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function elapsedMin(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000);
}

function fmtElapsed(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function urgencyClass(mins: number) {
  if (mins < 15) return { badge: "bg-emerald-600", ring: "", pulse: false };
  if (mins < 30) return { badge: "bg-amber-500",   ring: "ring-2 ring-amber-500/30", pulse: false };
  return             { badge: "bg-red-500",      ring: "ring-2 ring-red-500/40",   pulse: true  };
}

// ─── Live clock ───────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        })
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-white font-bold tracking-widest tabular-nums text-lg">
      {time}
    </span>
  );
}

// ─── Elapsed badge (self-updating every 30 s) ─────────────────────────────────
// Initialises as null so SSR and first client render are identical — actual
// elapsed time is set in useEffect (client-only) to avoid hydration mismatches.

function ElapsedBadge({ date }: { date: string }) {
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    setMins(elapsedMin(date));
    const id = setInterval(() => setMins(elapsedMin(date)), 30_000);
    return () => clearInterval(id);
  }, [date]);

  // Neutral placeholder shown on SSR and before first effect fires
  if (mins === null) {
    return (
      <span className="bg-gray-600 text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 flex-shrink-0">
        <Clock size={10} />
        <span className="opacity-0">--</span>
      </span>
    );
  }

  const u = urgencyClass(mins);
  return (
    <span
      className={`${u.badge} ${u.ring} text-white text-xs font-bold px-2.5 py-1 rounded-full tabular-nums flex items-center gap-1.5 flex-shrink-0 ${u.pulse ? "animate-pulse" : ""}`}
    >
      <Clock size={10} />
      {fmtElapsed(mins)}
    </span>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({
  flat,
  col,
  onAdvance,
}: {
  flat: FlatOrder;
  col: ColumnConfig;
  onAdvance?: () => void;
}) {
  const { order, customerName } = flat;
  const isDelivery = order.fulfillment === "delivery";

  // Client-only: initialise null to avoid SSR/client hydration mismatch
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    setMins(elapsedMin(order.date));
    const id = setInterval(() => setMins(elapsedMin(order.date)), 60_000);
    return () => clearInterval(id);
  }, [order.date]);

  // "Mark as Collected" — two-tap confirm to prevent accidental dismissal
  const [confirming, setConfirming] = useState(false);
  const [marking, setMarking]       = useState(false);
  const confirmTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCollectClick() {
    setConfirming(true);
    confirmTimer.current = setTimeout(() => setConfirming(false), 4000);
  }
  async function handleConfirmCollect() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    setMarking(true);
    try {
      await fetch(`/api/pos/orders/${order.id}/collected`, { method: "PUT" });
    } catch {
      setMarking(false);
    }
  }
  function handleCancelCollect() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
  }
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const u = mins !== null ? urgencyClass(mins) : { ring: "", pulse: false };

  return (
    <div
      className={`bg-gray-800 rounded-2xl border-l-[5px] ${col.borderClass} ${u.ring} flex flex-col overflow-hidden transition-shadow hover:shadow-xl`}
    >
      {/* Card header */}
      <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
            #{order.id.slice(-8).toUpperCase()}
          </p>
          <p className="text-white font-bold text-lg leading-tight truncate mt-0.5">
            {customerName}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <ElapsedBadge date={order.date} />
          <span
            className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              isDelivery
                ? "bg-indigo-900/60 text-indigo-300"
                : "bg-emerald-900/60 text-emerald-300"
            }`}
          >
            {isDelivery ? <Truck size={10} /> : <ShoppingBag size={10} />}
            {isDelivery ? "Delivery" : "Collection"}
          </span>
        </div>
      </div>

      {/* Address / scheduled */}
      {(order.address || order.scheduledTime) && (
        <div className="px-4 pb-2 space-y-0.5">
          {order.address && (
            <p className="text-gray-400 text-xs truncate">
              📍 {order.address}
            </p>
          )}
          {order.scheduledTime && (
            <p className="text-amber-400 text-xs font-semibold flex items-center gap-1.5">
              <CalendarClock size={11} />
              {order.scheduledTime}
            </p>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="mx-4 border-t border-gray-700/60" />

      {/* Items */}
      <div className="px-4 py-3 flex-1 space-y-2.5">
        {order.items.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className={`${col.textClass} font-extrabold text-2xl leading-none tabular-nums w-8 text-center flex-shrink-0`}>
              {item.qty}
            </span>
            <span className="text-white font-semibold text-base leading-snug">
              {item.name}
            </span>
          </div>
        ))}
      </div>

      {/* Note */}
      {order.note && (
        <div className="mx-4 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
          <p className="text-amber-400 text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
            <AlertTriangle size={10} /> Special Note
          </p>
          <p className="text-amber-200 text-sm leading-snug">{order.note}</p>
        </div>
      )}

      {/* Urgency warning for very late orders (client-only — mins is null on SSR) */}
      {mins !== null && mins >= 30 && (
        <div className="mx-4 mb-3 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-1.5 flex items-center gap-2">
          <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-xs font-semibold">Order waiting {fmtElapsed(mins)}</p>
        </div>
      )}

      {/* Action button — only shown for columns that have a next step */}
      {col.nextStatus ? (
        <div className="px-4 pb-4">
          <button
            onClick={onAdvance}
            className={`w-full ${col.buttonClass} text-white font-bold text-sm py-3.5 rounded-xl transition-all active:scale-[0.97] shadow-lg shadow-black/20`}
          >
            {col.nextLabel} →
          </button>
        </div>
      ) : (
        /* Ready column — delivery awaits driver; collection can be marked here */
        <div className="px-4 pb-4 flex flex-col gap-2">
          <div className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-semibold border ${
            isDelivery
              ? "bg-indigo-900/20 border-indigo-700/30 text-indigo-300"
              : "bg-emerald-900/20 border-emerald-700/30 text-emerald-300"
          }`}>
            {isDelivery ? <Truck size={13} /> : <ShoppingBag size={13} />}
            {isDelivery ? "Awaiting driver pickup" : "Awaiting customer collection"}
          </div>

          {/* Collection orders: staff can mark as collected directly from KDS */}
          {!isDelivery && (
            confirming ? (
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmCollect}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.97] text-white font-black text-xs py-2.5 rounded-xl transition-all"
                >
                  ✓ Confirm Collected
                </button>
                <button
                  onClick={handleCancelCollect}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 active:scale-[0.97] text-gray-300 font-semibold text-xs py-2.5 rounded-xl transition-all"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleCollectClick}
                disabled={marking}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold text-emerald-500 border border-emerald-800 hover:bg-emerald-900/30 active:scale-[0.97] transition-all disabled:opacity-40"
              >
                {marking ? (
                  <span className="animate-spin">⟳</span>
                ) : (
                  <>
                    <CheckCircle2 size={12} />
                    Mark as Collected
                  </>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

function KanbanColumn({
  col,
  orders,
  onAdvance,
}: {
  col: ColumnConfig;
  orders: FlatOrder[];
  onAdvance?: (flat: FlatOrder) => void;
}) {
  return (
    <div className={`flex flex-col rounded-2xl ${col.colBg} border border-gray-700/40 overflow-hidden`}>
      {/* Column header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-700/60 flex-shrink-0">
        <span className={`w-2.5 h-2.5 rounded-full ${col.dotClass} flex-shrink-0`} />
        <h2 className="text-gray-200 font-bold text-sm uppercase tracking-widest flex-1">
          {col.label}
        </h2>
        <span className={`${col.badgeClass} text-xs font-bold px-2.5 py-0.5 rounded-full min-w-[1.5rem] text-center`}>
          {orders.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600 select-none">
            <UtensilsCrossed size={40} className="mb-3 opacity-20" />
            <p className="text-sm font-medium">No orders</p>
          </div>
        ) : (
          orders.map((flat) => (
            <OrderCard
              key={flat.order.id}
              flat={flat}
              col={col}
              onAdvance={onAdvance ? () => onAdvance(flat) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function KitchenPage() {
  const { customers, updateOrderStatus, settings } = useApp();
  const [completedToday, setCompletedToday] = useState(0);
  const [isFullscreen, setIsFullscreen]     = useState(false);

  // Flatten all active orders across all customers, oldest-first (most urgent first)
  const allActive: FlatOrder[] = customers
    .flatMap((c) =>
      c.orders
        .filter((o) =>
          (["pending", "confirmed", "preparing", "ready"] as OrderStatus[]).includes(o.status)
        )
        .map((o) => ({ order: o, customerId: c.id, customerName: c.name }))
    )
    .sort(
      (a, b) =>
        new Date(a.order.date).getTime() - new Date(b.order.date).getTime()
    );

  function handleAdvance(flat: FlatOrder, nextStatus: OrderStatus) {
    updateOrderStatus(flat.customerId, flat.order.id, nextStatus);
    // Kitchen's job ends when an order is marked ready — count it as completed
    if (nextStatus === "ready") setCompletedToday((n) => n + 1);
  }

  // Fullscreen toggle
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const totalActive = allActive.length;

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 sm:px-5 py-3 flex items-center justify-between gap-4 flex-shrink-0">
        {/* Left — branding */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
            <ChefHat size={18} className="text-white" />
          </div>
          <div className="hidden sm:block">
            <p className="text-white font-bold text-sm leading-tight">Kitchen Display</p>
            <p className="text-gray-400 text-[11px] leading-tight">{settings.restaurant.name}</p>
          </div>
        </div>

        {/* Centre — status pill counters */}
        <div className="flex items-center gap-2 sm:gap-4 flex-1 justify-center">
          {COLUMNS.map((col) => {
            const count = allActive.filter((f) =>
              col.statuses.includes(f.order.status)
            ).length;
            return (
              <div key={col.label} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${col.dotClass}`} />
                <span className="text-gray-400 text-xs font-semibold hidden sm:inline">
                  {col.shortLabel}
                </span>
                <span
                  className={`${col.badgeClass} text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center`}
                >
                  {count}
                </span>
              </div>
            );
          })}
          {completedToday > 0 && (
            <div className="flex items-center gap-1.5 text-gray-500">
              <CheckCircle2 size={12} />
              <span className="text-xs">{completedToday} done</span>
            </div>
          )}
        </div>

        {/* Right — clock + controls */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <LiveClock />
          <button
            onClick={toggleFullscreen}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <Link
            href="/admin"
            className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg transition"
          >
            <LayoutDashboard size={13} />
            Admin
          </Link>
        </div>
      </header>

      {/* ── Kanban board ────────────────────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 sm:p-4 min-h-0">
        {COLUMNS.map((col) => {
          const colOrders = allActive.filter((f) =>
            col.statuses.includes(f.order.status)
          );
          return (
            <KanbanColumn
              key={col.label}
              col={col}
              orders={colOrders}
              onAdvance={col.nextStatus ? (flat) => handleAdvance(flat, col.nextStatus!) : undefined}
            />
          );
        })}
      </div>

      {/* ── Footer bar ──────────────────────────────────────────────────────── */}
      <footer className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <span className="text-gray-500 text-xs">
          {totalActive > 0
            ? `${totalActive} active order${totalActive !== 1 ? "s" : ""}`
            : "No active orders"}
        </span>
        <span className="text-gray-600 text-xs flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Real-time sync active
        </span>
      </footer>
    </div>
  );
}
