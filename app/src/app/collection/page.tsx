"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PackageCheck, LogOut, RefreshCw, Banknote, CheckCircle2, Clock,
  User, Loader2, ChefHat, CalendarClock, AlertCircle, ShoppingBag,
  History as HistoryIcon, Search,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useConnectivity } from "@/lib/connectivity";
import { fmt, relTime, fmtTime } from "@/components/pos/_utils";
import PaymentModal from "@/components/pos/PaymentModal";
import CollectionFooter from "@/components/collection/CollectionFooter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CollectionItem { name: string; qty: number; price?: number }
interface CollectionOrder {
  id: string;
  items: CollectionItem[];
  total: number;
  note: string | null;
  status: string;
  payment_method: string | null;
  payment_status: string;
  date: string;
  scheduled_time: string | null;
  customer_id: string | null;
  customers: { name: string | null; phone: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", confirmed: "Confirmed", preparing: "Preparing", ready: "Ready",
};
const STATUS_STYLE: Record<string, string> = {
  pending:   "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  confirmed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  preparing: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  ready:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function customerName(o: CollectionOrder): string {
  return o.customers?.name?.trim() || "Online customer";
}
function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

type Tab = "pickups" | "history";
type Period = "today" | "7d" | "30d";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CollectionPage() {
  const router = useRouter();
  const { settings } = useApp();
  const { isOnline } = useConnectivity();
  const sym = settings.currency?.symbol ?? "£";

  const [staffName, setStaffName] = useState<string>("");
  const [staffColor, setStaffColor] = useState<string>("#f97316");

  const [tab, setTab] = useState<Tab>("pickups");
  const [orders, setOrders] = useState<CollectionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [period, setPeriod] = useState<Period>("today");
  const [search, setSearch] = useState("");

  const [payTarget, setPayTarget] = useState<CollectionOrder | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Hydrate the staff identity for the header (middleware already gates the route).
  useEffect(() => {
    fetch("/api/collection/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ok?: boolean; staff?: { name: string; avatarColor?: string } } | null) => {
        if (d?.ok && d.staff) {
          setStaffName(d.staff.name);
          if (d.staff.avatarColor) setStaffColor(d.staff.avatarColor);
        }
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const qs = tab === "history" ? `?view=history&period=${period}` : "?view=active";
      const r = await fetch(`/api/collection/orders${qs}`, { cache: "no-store" });
      if (!r.ok) { if (showSpinner) setOrders([]); return; }
      const json = await r.json() as { ok: boolean; orders?: CollectionOrder[] };
      if (json.ok && Array.isArray(json.orders)) setOrders(json.orders);
    } catch {
      /* network blip — keep last-known */
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [tab, period]);

  // Refetch on tab/period change; poll the active board while visible.
  useEffect(() => {
    refresh(true);
    if (tab !== "pickups") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [refresh, tab]);

  async function logout() {
    try { await fetch("/api/collection/auth", { method: "DELETE" }); } catch { /* ignore */ }
    router.replace("/collection/login");
  }

  async function settlePayment(order: CollectionOrder, method: "cash" | "card" | "split") {
    setError("");
    const r = await fetch(`/api/collection/orders/${order.id}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethod: method }),
    });
    const json = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!r.ok || !json.ok) setError(json.error ?? "Could not take payment. Please try again.");
    setPayTarget(null);
    refresh();
  }

  async function markCollected(order: CollectionOrder) {
    setError("");
    setMarkingId(order.id);
    try {
      const r = await fetch(`/api/collection/orders/${order.id}/collected`, { method: "PUT" });
      const json = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!r.ok || !json.ok) setError(json.error ?? "Could not mark collected. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setMarkingId(null);
      refresh();
    }
  }

  const q = search.trim().toLowerCase();
  const historyFiltered = orders.filter((o) =>
    !q || customerName(o).toLowerCase().includes(q) || o.id.toLowerCase().includes(q),
  );
  const readyCount = orders.filter((o) => o.status === "ready").length;

  return (
    <div className="h-full min-h-screen flex flex-col bg-slate-950">
      {/* Top bar */}
      <header className="flex-shrink-0 h-14 bg-slate-900 border-b border-slate-700/50 flex items-center px-4 gap-3">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center">
            <PackageCheck size={14} className="text-white" />
          </div>
          <span className="text-white font-bold text-sm hidden sm:block">
            {settings.restaurant?.name || "Collection"}
          </span>
        </div>
        <div className="h-6 w-px bg-slate-700 flex-shrink-0" />
        <p className="text-slate-300 text-sm font-medium">Collection Pickups</p>
        <div className="flex-1" />
        {staffName && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: staffColor }}>
              {initials(staffName)}
            </div>
            <span className="text-white text-xs font-semibold hidden sm:block">{staffName}</span>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-slate-400 hover:text-red-400 text-xs font-medium transition-colors px-2 sm:px-3 py-2 rounded-lg hover:bg-red-500/10"
        >
          <LogOut size={14} />
          <span className="hidden sm:block">Logout</span>
        </button>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-3">
          <AlertCircle size={14} className="text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-xs font-medium">No internet connection — actions are paused until you reconnect.</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex-shrink-0 bg-slate-900/60 border-b border-slate-800 px-4 flex items-center gap-1">
        {([["pickups", "Pickups", ShoppingBag], ["history", "History", HistoryIcon]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition ${
              tab === id ? "text-orange-400 border-orange-500" : "text-slate-400 border-transparent hover:text-slate-200"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => refresh(true)}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs font-medium px-3 py-2 rounded-lg hover:bg-slate-800 transition"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
            <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm flex-1">{error}</p>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>
          </div>
        )}

        {/* History controls */}
        {tab === "history" && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {(["today", "7d", "30d"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  period === p ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {p === "today" ? "Today" : p === "7d" ? "Last 7 days" : "Last 30 days"}
              </button>
            ))}
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name / order id"
                className="bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-white text-xs placeholder-slate-500 outline-none focus:border-orange-500 w-52"
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading…
          </div>
        ) : tab === "pickups" ? (
          /* ── Pickups board ── */
          orders.length === 0 ? (
            <Empty label="No collection orders right now." />
          ) : (
            <>
              <p className="text-slate-400 text-xs mb-3">{orders.length} active · {readyCount} ready to collect</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {orders.map((order) => {
                  const isReady = order.status === "ready";
                  const isPaid  = order.payment_status === "paid";
                  const itemCount = order.items.reduce((s, i) => s + (i.qty ?? 0), 0);
                  return (
                    <div key={order.id} className={`bg-slate-800 rounded-2xl border flex flex-col overflow-hidden ${isReady ? "border-emerald-500/40" : "border-slate-700"}`}>
                      <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-white font-bold text-sm flex items-center gap-1.5 truncate">
                            <User size={13} className="text-slate-400 flex-shrink-0" /> {customerName(order)}
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
                      <div className="px-4 py-2.5 flex-1 space-y-1">
                        {order.items.map((item, i) => (
                          <div key={i} className="text-xs text-slate-300 truncate">
                            <span className="text-slate-500 tabular-nums">{item.qty}×</span> {item.name}
                          </div>
                        ))}
                        <p className="text-slate-600 text-[10px] pt-0.5">{itemCount} item{itemCount !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="px-4 py-2 bg-slate-900/40 flex items-center justify-between">
                        <span className="text-slate-400 text-xs">Total</span>
                        <div className="text-right">
                          <span className="text-white font-bold text-base">{fmt(order.total, sym)}</span>
                          <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isPaid ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                            {isPaid ? "PAID" : "UNPAID"}
                          </span>
                        </div>
                      </div>
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
                            {markingId === order.id ? <Loader2 size={15} className="animate-spin" /> : <><CheckCircle2 size={15} /> Mark Collected</>}
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
            </>
          )
        ) : (
          /* ── History ── */
          historyFiltered.length === 0 ? (
            <Empty label="No completed pickups for this period." />
          ) : (
            <div className="space-y-2">
              {historyFiltered.map((order) => (
                <div key={order.id} className="bg-slate-800 rounded-xl border border-slate-700/70 px-4 py-3 flex items-center gap-3">
                  <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-semibold truncate">{customerName(order)}</p>
                    <p className="text-slate-500 text-[11px] truncate">
                      {order.items.reduce((s, i) => s + (i.qty ?? 0), 0)} items · {order.payment_method ?? "—"} · {fmtTime(order.date)}
                    </p>
                  </div>
                  <span className="text-white font-bold text-sm flex-shrink-0">{fmt(order.total, sym)}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

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

      <CollectionFooter />
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-600">
      <ShoppingBag size={40} className="mb-3 opacity-40" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
