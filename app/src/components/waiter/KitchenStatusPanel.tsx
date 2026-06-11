"use client";

/**
 * Kitchen status — foldable panel on the waiter tables view.
 * The waiter's read-only window into the dine-in tickets (fed by
 * /api/waiter/orders — the same poll that drives occupancy, no KDS API
 * involved). Ready orders float to the top so the waiter knows to go grab
 * the plates; "Got it" hides a grabbed one on THIS device only (the order
 * stays "ready" until the bill settles).
 */

import { ChefHat, ChevronDown, ChevronUp, Clock } from "lucide-react";
import type { WaiterActiveOrder } from "./_types";

export default function KitchenStatusPanel({ orders, dismissedReady, open, onToggle, onDismiss }: {
  /** All active dine-in orders (any waiter). */
  orders: WaiterActiveOrder[];
  /** Ready orders the waiter already dismissed ("Got it") on this device. */
  dismissedReady: Set<string>;
  open: boolean;
  onToggle: () => void;
  onDismiss: (orderId: string) => void;
}) {
  const kitchenOrders = orders.filter(
    (o) => !(o.status === "ready" && dismissedReady.has(o.id)),
  );
  const newCount   = kitchenOrders.filter((o) => o.status === "pending" || o.status === "confirmed").length;
  const prepCount  = kitchenOrders.filter((o) => o.status === "preparing").length;
  const readyCount = kitchenOrders.filter((o) => o.status === "ready").length;
  const rank = (s: string) => (s === "ready" ? 0 : s === "preparing" ? 1 : 2);
  const sorted = [...kitchenOrders].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.date.localeCompare(b.date),
  );
  const pillFor = (s: string) =>
    s === "ready"
      ? { label: "READY",     cls: "bg-green-500/15 text-green-400 border-green-500/40" }
      : s === "preparing"
        ? { label: "PREPARING", cls: "bg-orange-500/15 text-orange-400 border-orange-500/40" }
        : { label: "NEW",       cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" };
  const elapsed = (iso: string) => {
    const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  return (
    <div className="flex-shrink-0 border-b border-slate-800">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-5 py-2.5 hover:bg-slate-900/60 transition"
      >
        <ChefHat size={14} className={readyCount > 0 ? "text-green-400" : "text-slate-500"} />
        <span className="text-slate-300 text-xs font-bold uppercase tracking-widest">Kitchen</span>
        {kitchenOrders.length === 0 ? (
          <span className="text-slate-600 text-[11px]">no active orders</span>
        ) : (
          <span className="flex items-center gap-2 text-[11px]">
            {newCount > 0 && <span className="text-amber-300 whitespace-nowrap">{newCount} new</span>}
            {prepCount > 0 && <span className="text-orange-400 whitespace-nowrap">{prepCount} preparing</span>}
            {readyCount > 0 && (
              <span className="flex items-center gap-1 text-green-400 font-bold whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                {readyCount} ready
              </span>
            )}
          </span>
        )}
        {open
          ? <ChevronUp size={14} className="ml-auto text-slate-500 flex-shrink-0" />
          : <ChevronDown size={14} className="ml-auto text-slate-500 flex-shrink-0" />}
      </button>
      {open && kitchenOrders.length > 0 && (
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60 border-t border-slate-800/60">
          {sorted.map((o) => {
            const p = pillFor(o.status);
            return (
              <div key={o.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className={`flex-shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full border ${p.cls}`}>
                  {p.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold leading-tight">Table {o.tableLabel}</p>
                  <p className="text-slate-400 text-xs truncate">
                    {o.items.map((it) => `${it.qty}× ${it.name}`).join(" · ") || "—"}
                  </p>
                </div>
                <span className="flex-shrink-0 text-slate-500 text-[11px] flex items-center gap-1">
                  <Clock size={10} /> {elapsed(o.date)}
                </span>
                {o.status === "ready" && (
                  <button
                    onClick={() => onDismiss(o.id)}
                    title="Hide from this list — the order stays ready until the bill is settled"
                    className="flex-shrink-0 text-[11px] font-bold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 px-2.5 py-1 rounded-lg transition"
                  >
                    Got it
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
