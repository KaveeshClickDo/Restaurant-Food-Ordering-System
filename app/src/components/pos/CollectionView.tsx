"use client";

import { useCallback, useEffect, useState } from "react";
import { apiBase } from "@/lib/apiBase";
import {
  ShoppingBag, Banknote, CheckCircle2, RefreshCw, Clock,
  User, Loader2, ChefHat, CalendarClock, AlertCircle,
} from "lucide-react";
import { usePOS } from "@/context/POSContext";
import { useConnectivity } from "@/lib/connectivity";
import { fmt, relTime } from "./_utils";
import PaymentModal from "./PaymentModal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CollectionItem {
  name: string;
  qty: number;
  price?: number;
}

interface CollectionOrder {
  id: string;
  items: CollectionItem[];
  total: number;
  note: string | null;
  status: string;            // pending | confirmed | preparing | ready
  payment_method: string | null;
  payment_status: string;    // unpaid | paid | refunded | partially_refunded
  date: string;
  scheduled_time: string | null;
  customer_id: string | null;
  customers: { name: string | null; phone: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending:   "Pending",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready:     "Ready",
};

const STATUS_STYLE: Record<string, string> = {
  pending:   "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  confirmed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  preparing: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  ready:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

// Sentinel customer id used for POS walk-in orders (mirrors pushToKDS + the
// server filter). Orders with this id are "Walk-in" (rung up at the POS); all
// others are "Online". Both still go through the kitchen before collection.
const POS_CUSTOMER_ID = "pos-walk-in";

function isPosOrder(o: CollectionOrder): boolean {
  return o.customer_id === POS_CUSTOMER_ID;
}

function customerName(o: CollectionOrder): string {
  if (isPosOrder(o)) return o.customers?.name?.trim() || "Walk-in";
  return o.customers?.name?.trim() || "Online customer";
}

type CollectionScope = "all" | "online" | "walkin";

// ── Component ─────────────────────────────────────────────────────────────────

export default function CollectionView() {
  const { settings } = usePOS();
  const { isOnline } = useConnectivity();
  const sym = settings.currencySymbol ?? "£";

  const [orders, setOrders]   = useState<CollectionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [scope, setScope]     = useState<CollectionScope>("all");

  // The order whose payment modal is open.
  const [payTarget, setPayTarget] = useState<CollectionOrder | null>(null);
  // Id of the order currently being marked collected (paid path) — drives the
  // per-card spinner.
  const [markingId, setMarkingId] = useState<string | null>(null);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const r = await fetch(apiBase() + "/api/pos/orders/collection", { cache: "no-store" });
      if (!r.ok) { if (showSpinner) setOrders([]); return; }
      const json = await r.json() as { ok: boolean; orders?: CollectionOrder[] };
      if (json.ok && Array.isArray(json.orders)) setOrders(json.orders);
    } catch {
      /* network blip — keep last-known list */
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  // Initial load + light polling while the tab is visible.
  useEffect(() => {
    refresh(true);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Take payment for an unpaid order → settle (paid + delivered + loyalty).
  async function settlePayment(order: CollectionOrder, method: "cash" | "card" | "split") {
    setError("");
    const r = await fetch(`${apiBase()}/api/pos/orders/${order.id}/settle`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ paymentMethod: method }),
    });
    const json = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!r.ok || !json.ok) {
      setError(json.error ?? "Could not take payment. Please try again.");
    }
    setPayTarget(null);
    refresh();
  }

  // Mark an already-paid order collected → delivered (no payment).
  async function markCollected(order: CollectionOrder) {
    setError("");
    setMarkingId(order.id);
    try {
      const r = await fetch(`${apiBase()}/api/pos/orders/${order.id}/collected`, { method: "PUT" });
      const json = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!r.ok || !json.ok) setError(json.error ?? "Could not mark collected. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setMarkingId(null);
      refresh();
    }
  }

  const onlineCount = orders.filter((o) => !isPosOrder(o)).length;
  const walkinCount = orders.filter((o) => isPosOrder(o)).length;
  const filtered = orders.filter((o) =>
    scope === "all" ? true : scope === "walkin" ? isPosOrder(o) : !isPosOrder(o),
  );
  const readyCount = filtered.filter((o) => o.status === "ready").length;

  const SCOPES: { key: CollectionScope; label: string; count: number }[] = [
    { key: "all",    label: "All",     count: orders.length },
    { key: "online", label: "Online",  count: onlineCount },
    { key: "walkin", label: "Walk-in", count: walkinCount },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <ShoppingBag size={20} className="text-orange-400" /> Collection Pickups
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            {filtered.length} active · {readyCount} ready to collect
          </p>
        </div>
        <button
          onClick={() => refresh(true)}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs font-medium px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* All / Online / Walk-in sub-tabs */}
      <div className="flex gap-1.5 bg-slate-800/50 p-1 rounded-xl border border-slate-700 mb-5 max-w-md">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={`flex-1 px-2 py-2 rounded-lg text-xs font-semibold transition-all ${
              scope === s.key ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {s.label} <span className="text-slate-500">({s.count})</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
          <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm flex-1">{error}</p>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading pickups…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600">
          <ShoppingBag size={40} className="mb-3 opacity-40" />
          <p className="text-sm">
            {scope === "walkin" ? "No walk-in collection orders right now."
              : scope === "online" ? "No online collection orders right now."
              : "No collection orders right now."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((order) => {
            const isReady   = order.status === "ready";
            const isPaid    = order.payment_status === "paid";
            const isPos     = isPosOrder(order);
            const itemCount = order.items.reduce((s, i) => s + (i.qty ?? 0), 0);

            return (
              <div
                key={order.id}
                className={`bg-slate-800 rounded-2xl border flex flex-col overflow-hidden ${
                  isReady ? "border-emerald-500/40" : "border-slate-700"
                }`}
              >
                {/* Card header */}
                <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white font-bold text-sm flex items-center gap-1.5 truncate">
                      <User size={13} className="text-slate-400 flex-shrink-0" /> {customerName(order)}
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border flex-shrink-0 ${
                          isPos
                            ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                            : "bg-sky-500/15 text-sky-300 border-sky-500/30"
                        }`}
                      >
                        {isPos ? "Walk-in" : "Online"}
                      </span>
                    </p>
                    <p className="text-slate-500 text-[11px] font-mono mt-0.5 flex items-center gap-1.5">
                      <Clock size={9} /> {relTime(order.date)}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border flex-shrink-0 ${STATUS_STYLE[order.status] ?? "bg-slate-700 text-slate-300 border-slate-600"}`}>
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </div>

                {order.scheduled_time && (
                  <p className="px-4 pb-1 text-amber-400 text-[11px] font-semibold flex items-center gap-1.5">
                    <CalendarClock size={11} /> {order.scheduled_time}
                  </p>
                )}

                <div className="mx-4 border-t border-slate-700/60" />

                {/* Items */}
                <div className="px-4 py-2.5 flex-1 space-y-1">
                  {order.items.map((item, i) => (
                    <div key={i} className="flex justify-between gap-2 text-xs">
                      <span className="text-slate-300 truncate">
                        <span className="text-slate-500 tabular-nums">{item.qty}×</span> {item.name}
                      </span>
                    </div>
                  ))}
                  <p className="text-slate-600 text-[10px] pt-0.5">{itemCount} item{itemCount !== 1 ? "s" : ""}</p>
                </div>

                {/* Total + payment status */}
                <div className="px-4 py-2 bg-slate-900/40 flex items-center justify-between">
                  <span className="text-slate-400 text-xs">Total</span>
                  <div className="text-right">
                    <span className="text-white font-bold text-base">{fmt(order.total, sym)}</span>
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      isPaid ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                    }`}>
                      {isPaid ? "PAID" : "UNPAID"}
                    </span>
                  </div>
                </div>

                {/* Action */}
                <div className="p-3">
                  {!isReady ? (
                    <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold bg-slate-700/40 text-slate-400 border border-slate-700">
                      <ChefHat size={13} /> Waiting for kitchen
                    </div>
                  ) : isPaid ? (
                    <button
                      onClick={() => markCollected(order)}
                      disabled={markingId === order.id || !isOnline}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/40 text-white transition-all active:scale-[0.98]"
                    >
                      {markingId === order.id
                        ? <Loader2 size={15} className="animate-spin" />
                        : <><CheckCircle2 size={15} /> Mark Collected</>}
                    </button>
                  ) : (
                    <button
                      onClick={() => setPayTarget(order)}
                      disabled={!isOnline}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-orange-500 hover:bg-orange-400 disabled:bg-orange-500/40 text-white transition-all active:scale-[0.98]"
                    >
                      <Banknote size={15} /> Take Payment · {fmt(order.total, sym)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payment modal — gift card hidden (already applied at online checkout). */}
      {payTarget && (
        <PaymentModal
          total={payTarget.total}
          currencySymbol={sym}
          isOffline={!isOnline}
          allowGiftCard={false}
          onClose={() => setPayTarget(null)}
          onComplete={(method) => {
            const pm = method === "card" ? "card" : method === "split" ? "split" : "cash";
            settlePayment(payTarget, pm);
          }}
        />
      )}
    </div>
  );
}
