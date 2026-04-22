"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { ChefHat, CheckCircle2, Clock, UtensilsCrossed, Wifi } from "lucide-react";
import type { OrderLine } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveStatus = "pending" | "confirmed" | "preparing" | "ready";

interface DisplayOrder {
  id:         string;
  label:      string;   // "R1042" for POS, "#AB12CD" for online
  status:     ActiveStatus;
  items:      OrderLine[];
  date:       string;
  isPOS:      boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: ActiveStatus[] = ["pending", "confirmed", "preparing", "ready"];

function extractReceiptNo(note?: string | null): string | null {
  if (!note) return null;
  const m = note.match(/Receipt:\s*(R\d+)/);
  return m ? m[1] : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDisplay(row: any): DisplayOrder | null {
  if (!ACTIVE_STATUSES.includes(row.status)) return null;
  const isPOS   = row.customer_id === "pos-walk-in" || String(row.note ?? "").startsWith("[POS]");
  const receipt = extractReceiptNo(row.note);
  const label   = receipt ?? "#" + String(row.id).slice(-6).toUpperCase();
  return {
    id:     row.id,
    label,
    status: row.status as ActiveStatus,
    items:  (row.items ?? []) as OrderLine[],
    date:   typeof row.date === "string" ? row.date : new Date(row.date).toISOString(),
    isPOS,
  };
}

// ─── Live clock ───────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-white/60 font-semibold text-lg tabular-nums flex items-center gap-2">
      <Clock size={16} className="opacity-50" />
      {time}
    </span>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({ order, isReady }: { order: DisplayOrder; isReady: boolean }) {
  // Pulse animation triggers once when an order first becomes ready
  const prevReady = useRef(isReady);
  const [flash, setFlash]           = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [marking, setMarking]       = useState(false);
  const confirmTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!prevReady.current && isReady) { setFlash(true); setTimeout(() => setFlash(false), 2000); }
    prevReady.current = isReady;
  }, [isReady]);

  // Auto-cancel confirmation after 4 s of inactivity
  function handleCollectClick() {
    if (confirming) return;
    setConfirming(true);
    confirmTimer.current = setTimeout(() => setConfirming(false), 4000);
  }

  async function handleConfirm() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    setMarking(true);
    try {
      await fetch(`/api/pos/orders/${order.id}/collected`, { method: "PUT" });
      // Realtime will remove the card automatically once status → "delivered"
    } catch {
      setMarking(false);
    }
  }

  function handleCancel() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
  }

  // Cleanup timer on unmount
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const itemsToShow = order.items.slice(0, 5);
  const overflow    = order.items.length - itemsToShow.length;

  return (
    <div
      className={`
        relative rounded-3xl overflow-hidden flex flex-col
        transition-all duration-500
        ${isReady
          ? "bg-emerald-950 border-2 border-emerald-400 shadow-[0_0_40px_rgba(52,211,153,0.25)]"
          : "bg-gray-800/80 border-2 border-orange-500/40"}
        ${flash ? "animate-pulse" : ""}
      `}
    >
      {/* Status stripe */}
      <div className={`h-1.5 w-full ${isReady ? "bg-emerald-400" : "bg-orange-500"}`} />

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Order number */}
        <div className="text-center">
          <p className={`font-black tracking-widest text-5xl sm:text-6xl leading-none ${
            isReady ? "text-emerald-300" : "text-orange-400"
          }`}>
            {order.label}
          </p>
        </div>

        {/* Divider */}
        <div className={`border-t ${isReady ? "border-emerald-700/50" : "border-gray-700"}`} />

        {/* Items */}
        <ul className="space-y-2 flex-1">
          {itemsToShow.map((item, i) => (
            <li key={i} className="flex items-baseline gap-3">
              <span className={`font-extrabold text-2xl tabular-nums w-8 text-right flex-shrink-0 leading-tight ${
                isReady ? "text-emerald-400" : "text-orange-400"
              }`}>
                {item.qty}
              </span>
              <span className="text-white font-semibold text-base leading-snug">
                {item.name}
              </span>
            </li>
          ))}
          {overflow > 0 && (
            <li className="text-gray-400 text-sm pl-11">+{overflow} more item{overflow > 1 ? "s" : ""}</li>
          )}
        </ul>

        {/* Ready section — customer banner + staff collect button */}
        {isReady && (
          <div className="mt-2 flex flex-col gap-2">
            {/* Customer-facing banner */}
            <div className="bg-emerald-400 rounded-2xl py-3 flex items-center justify-center gap-2">
              <CheckCircle2 size={20} className="text-emerald-950" />
              <span className="text-emerald-950 font-black text-base tracking-wide">
                COLLECT YOUR ORDER
              </span>
            </div>

            {/* Staff-facing action — two-tap to prevent accidental dismissal */}
            {!confirming ? (
              <button
                onClick={handleCollectClick}
                disabled={marking}
                className="w-full rounded-2xl py-2.5 flex items-center justify-center gap-2 text-sm font-semibold text-emerald-600 border border-emerald-800 hover:bg-emerald-900/40 active:scale-[0.98] transition-all disabled:opacity-40"
              >
                {marking ? (
                  <span className="animate-spin text-base">⟳</span>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    Mark as Collected
                  </>
                )}
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  className="flex-1 rounded-2xl py-2.5 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-white font-black text-sm transition-all"
                >
                  ✓ Confirm
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 rounded-2xl py-2.5 bg-gray-700 hover:bg-gray-600 active:scale-[0.98] text-gray-300 font-semibold text-sm transition-all"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

function Column({
  title,
  icon,
  count,
  accentClass,
  dotClass,
  children,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  accentClass: string;
  dotClass: string;
  children: React.ReactNode;
  emptyText: string;
}) {
  return (
    <div className="flex flex-col min-h-0">
      {/* Column header */}
      <div className={`flex items-center gap-3 px-2 pb-4`}>
        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${dotClass}`} />
        {icon}
        <h2 className={`font-black text-xl sm:text-2xl uppercase tracking-widest flex-1 ${accentClass}`}>
          {title}
        </h2>
        <span className={`text-xs font-bold px-3 py-1 rounded-full ${accentClass} bg-white/10`}>
          {count}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {count === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-600 select-none">
            <UtensilsCrossed size={48} className="mb-4 opacity-20" />
            <p className="text-sm font-medium text-center">{emptyText}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomerDisplayPage() {
  const [orders, setOrders]       = useState<DisplayOrder[]>([]);
  const [restaurantName, setRestaurantName] = useState("Our Restaurant");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading]     = useState(true);

  // ── Load restaurant name from app_settings ────────────────────────────────
  useEffect(() => {
    supabase
      .from("app_settings")
      .select("data")
      .limit(1)
      .single()
      .then(({ data }) => {
        const name = data?.data?.restaurant?.name;
        if (name) setRestaurantName(name);
      });
  }, []);

  // ── Initial fetch + Realtime subscription ─────────────────────────────────
  useEffect(() => {
    // Load all currently active orders
    supabase
      .from("orders")
      .select("*")
      .in("status", ACTIVE_STATUSES)
      .order("date", { ascending: true })
      .then(({ data }) => {
        const mapped = (data ?? []).flatMap((r) => {
          const d = rowToDisplay(r);
          return d ? [d] : [];
        });
        setOrders(mapped);
        setLoading(false);
      });

    // Realtime: patch state on every order change
    const channel = supabase
      .channel("customer-display")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ eventType, new: newRow, old: oldRow }: any) => {
          if (eventType === "DELETE") {
            setOrders((prev) => prev.filter((o) => o.id !== oldRow.id));
            return;
          }
          const display = rowToDisplay(newRow);
          if (!display) {
            // Order moved to a non-active status (delivered / cancelled) — remove it
            setOrders((prev) => prev.filter((o) => o.id !== newRow.id));
            return;
          }
          setOrders((prev) => {
            const idx = prev.findIndex((o) => o.id === display.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = display;
              return next;
            }
            // New order — insert in chronological order
            return [...prev, display].sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );
          });
        }
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  const preparing = orders.filter((o) => ["pending", "confirmed", "preparing"].includes(o.status));
  const ready     = orders.filter((o) => o.status === "ready");

  return (
    <div className="h-screen bg-gray-950 flex flex-col overflow-hidden select-none">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <ChefHat size={20} className="text-white" />
          </div>
          <div>
            <p className="text-white font-black text-lg leading-tight">{restaurantName}</p>
            <p className="text-gray-400 text-xs font-medium tracking-widest uppercase">Order Status</p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-6">
          <p className="text-gray-400 text-sm text-center max-w-xs">
            Watch for your order number — we'll call you when it's ready!
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${connected ? "text-emerald-400" : "text-gray-500"}`}>
            <Wifi size={13} />
            <span className="hidden sm:inline">{connected ? "Live" : "Connecting…"}</span>
          </div>
          <LiveClock />
        </div>
      </header>

      {/* ── Board ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <ChefHat size={48} className="mx-auto mb-4 opacity-20 animate-pulse" />
            <p className="text-sm">Loading orders…</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-0 min-h-0 overflow-hidden">

          {/* Being Prepared */}
          <div className="flex flex-col p-5 sm:p-6 border-r border-gray-800 min-h-0 overflow-hidden">
            <Column
              title="Being Prepared"
              icon={<span className="text-2xl leading-none">🔥</span>}
              count={preparing.length}
              accentClass="text-orange-400"
              dotClass="bg-orange-500"
              emptyText="No orders being prepared right now"
            >
              {preparing.map((order) => (
                <OrderCard key={order.id} order={order} isReady={false} />
              ))}
            </Column>
          </div>

          {/* Ready for Collection */}
          <div className="flex flex-col p-5 sm:p-6 min-h-0 overflow-hidden">
            <Column
              title="Ready for Collection"
              icon={<span className="text-2xl leading-none">✅</span>}
              count={ready.length}
              accentClass="text-emerald-400"
              dotClass="bg-emerald-400"
              emptyText="No orders ready yet"
            >
              {ready.map((order) => (
                <OrderCard key={order.id} order={order} isReady={true} />
              ))}
            </Column>
          </div>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="bg-gray-900 border-t border-gray-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <p className="text-gray-500 text-xs">
          Updates automatically — no refresh needed
        </p>
        <p className="text-gray-600 text-xs">
          Thank you for dining with us!
        </p>
      </footer>

    </div>
  );
}
