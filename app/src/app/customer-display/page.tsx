"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ChefHat, CheckCircle2, Clock, UtensilsCrossed, Wifi } from "lucide-react";
import type { OrderLine } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveStatus = "pending" | "confirmed" | "preparing" | "ready";

interface DisplayOrder {
  id:    string;
  label: string;
  status: ActiveStatus;
  items: OrderLine[];
  date:  string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: ActiveStatus[] = ["pending", "confirmed", "preparing", "ready"];
/** Max card rows per page — keeps cards tall enough to read at distance */
const MAX_ROWS      = 4;
/** Auto-rotate pages every N ms when there are more orders than fit */
const PAGE_INTERVAL = 8_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractReceiptNo(note?: string | null): string | null {
  if (!note) return null;
  const m = note.match(/Receipt:\s*(R\d+)/);
  return m ? m[1] : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDisplay(row: any): DisplayOrder | null {
  if (!ACTIVE_STATUSES.includes(row.status)) return null;
  const receipt = extractReceiptNo(row.note);
  const label   = receipt ?? "#" + String(row.id).slice(-6).toUpperCase();
  return {
    id:     row.id,
    label,
    status: row.status as ActiveStatus,
    items:  (row.items ?? []) as OrderLine[],
    date:   typeof row.date === "string" ? row.date : new Date(row.date).toISOString(),
  };
}

/**
 * Determine grid columns and page capacity for a given order count.
 * Columns grow so cards never shrink below a readable size.
 * Page capacity = cols × MAX_ROWS (beyond that we paginate).
 */
function layoutFor(count: number): { cols: number; pageSize: number } {
  const cols = count <= MAX_ROWS ? 1 : count <= MAX_ROWS * 2 ? 2 : 3;
  return { cols, pageSize: cols * MAX_ROWS };
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
    <span className="font-mono text-white/50 font-semibold tabular-nums flex items-center gap-1.5 text-base sm:text-lg">
      <Clock size={14} className="opacity-50" />
      {time}
    </span>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({
  order,
  isReady,
  cols,
}: {
  order:   DisplayOrder;
  isReady: boolean;
  cols:    number;
}) {
  const prevReady    = useRef(isReady);
  const [flash,      setFlash]      = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [marking,    setMarking]    = useState(false);
  const confirmTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!prevReady.current && isReady) {
      setFlash(true);
      setTimeout(() => setFlash(false), 2_000);
    }
    prevReady.current = isReady;
  }, [isReady]);

  function handleCollectClick() {
    if (confirming) return;
    setConfirming(true);
    confirmTimer.current = setTimeout(() => setConfirming(false), 4_000);
  }

  async function handleConfirm() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    setMarking(true);
    try { await fetch(`/api/pos/orders/${order.id}/collected`, { method: "PUT" }); }
    catch { setMarking(false); }
  }

  function handleCancel() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
  }

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  // Scale typography and padding by column density
  const numCls  = cols === 1 ? "text-6xl sm:text-7xl" : cols === 2 ? "text-4xl sm:text-5xl" : "text-3xl";
  const qtyTxt  = cols === 3 ? "text-sm"  : "text-base";
  const itemTxt = cols === 3 ? "text-xs"  : "text-sm";
  const pad     = cols === 3 ? "p-2.5"    : "p-3.5";
  const gap     = cols === 3 ? "gap-1.5"  : "gap-2.5";
  const btnTxt  = cols === 3 ? "text-[11px]" : "text-xs";
  const maxItems = cols === 1 ? 5 : cols === 2 ? 4 : 3;

  const shown    = order.items.slice(0, maxItems);
  const overflow = order.items.length - shown.length;

  return (
    <div
      className={`
        relative rounded-2xl overflow-hidden flex flex-col h-full
        transition-all duration-500
        ${isReady
          ? "bg-emerald-950 border-2 border-emerald-400 shadow-[0_0_28px_rgba(52,211,153,0.22)]"
          : "bg-gray-800/90 border border-orange-500/30"}
        ${flash ? "ring-4 ring-emerald-400/60" : ""}
      `}
    >
      {/* Status stripe */}
      <div className={`h-1 w-full flex-shrink-0 ${isReady ? "bg-emerald-400" : "bg-orange-500"}`} />

      <div className={`flex flex-col flex-1 min-h-0 ${pad} ${gap}`}>
        {/* Order number — primary visual */}
        <p className={`font-black tracking-widest text-center leading-none flex-shrink-0 ${numCls} ${
          isReady ? "text-emerald-300" : "text-orange-400"
        }`}>
          {order.label}
        </p>

        <div className={`flex-shrink-0 border-t ${isReady ? "border-emerald-800/60" : "border-gray-700/70"}`} />

        {/* Item list — secondary reference for customers */}
        <ul className="flex-1 min-h-0 overflow-hidden space-y-0.5">
          {shown.map((item, i) => (
            <li key={i} className="flex items-baseline gap-1.5 leading-tight">
              <span className={`font-extrabold tabular-nums flex-shrink-0 ${qtyTxt} ${
                isReady ? "text-emerald-400" : "text-orange-400"
              }`}>
                {item.qty}×
              </span>
              <span className={`text-white/85 font-medium line-clamp-1 ${itemTxt}`}>
                {item.name}
              </span>
            </li>
          ))}
          {overflow > 0 && (
            <li className={`text-gray-500 pl-5 ${itemTxt}`}>+{overflow} more</li>
          )}
        </ul>

        {/* Ready treatment: customer banner + staff collect button */}
        {isReady && (
          <div className="flex-shrink-0 space-y-1.5 mt-auto pt-1">
            <div className={`bg-emerald-400 rounded-xl flex items-center justify-center gap-1.5 ${
              cols === 3 ? "py-1.5" : "py-2"
            }`}>
              <CheckCircle2 size={cols === 3 ? 13 : 16} className="text-emerald-950" />
              <span className={`text-emerald-950 font-black tracking-wide ${cols === 3 ? "text-xs" : "text-sm"}`}>
                COLLECT NOW
              </span>
            </div>

            {!confirming ? (
              <button
                onClick={handleCollectClick}
                disabled={marking}
                className={`w-full rounded-xl flex items-center justify-center gap-1.5 font-semibold text-emerald-600 border border-emerald-900 hover:bg-emerald-900/30 active:scale-[0.98] transition-all disabled:opacity-40 ${
                  cols === 3 ? "py-1 text-[11px]" : "py-1.5 text-xs"
                }`}
              >
                {marking
                  ? <span className="animate-spin">⟳</span>
                  : <><CheckCircle2 size={12} /> Mark Collected</>
                }
              </button>
            ) : (
              <div className="flex gap-1.5">
                <button
                  onClick={handleConfirm}
                  className={`flex-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-black transition-all ${btnTxt} ${cols === 3 ? "py-1" : "py-1.5"}`}
                >
                  ✓ Confirm
                </button>
                <button
                  onClick={handleCancel}
                  className={`flex-1 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold transition-all ${btnTxt} ${cols === 3 ? "py-1" : "py-1.5"}`}
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

// ─── Order panel ──────────────────────────────────────────────────────────────
// Self-contained column: adaptive CSS grid + auto-pagination, never scrolls.

function OrderPanel({
  orders,
  isReady,
  title,
  emoji,
  accentClass,
  dotClass,
  emptyText,
}: {
  orders:      DisplayOrder[];
  isReady:     boolean;
  title:       string;
  emoji:       string;
  accentClass: string;
  dotClass:    string;
  emptyText:   string;
}) {
  const { cols, pageSize } = useMemo(() => layoutFor(orders.length), [orders.length]);
  const pageCount = Math.max(1, Math.ceil(orders.length / pageSize));

  const [page, setPage] = useState(0);
  const [fade, setFade] = useState(false);

  // Reset to first page when the column count changes (order count crosses a threshold)
  useEffect(() => setPage(0), [cols]);

  // Auto-advance pages with a 300 ms opacity fade
  useEffect(() => {
    if (pageCount <= 1) return;
    const id = setInterval(() => {
      setFade(true);
      setTimeout(() => {
        setPage((p) => (p + 1) % pageCount);
        setFade(false);
      }, 300);
    }, PAGE_INTERVAL);
    return () => clearInterval(id);
  }, [pageCount]);

  const safePage = Math.min(page, pageCount - 1);
  const visible  = orders.slice(safePage * pageSize, (safePage + 1) * pageSize);
  // Rows fill exactly the visible cards (min 1 so the grid always renders)
  const rows = Math.max(1, Math.ceil(visible.length / cols));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-1 pb-3 flex-shrink-0">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-xl leading-none select-none" aria-hidden>{emoji}</span>
        <h2 className={`font-black text-lg sm:text-xl uppercase tracking-widest flex-1 ${accentClass}`}>
          {title}
        </h2>
        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full bg-white/10 ${accentClass}`}>
          {orders.length}
        </span>
      </div>

      {/* Empty state */}
      {orders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-600 select-none">
          <UtensilsCrossed size={40} className="mb-3 opacity-20" />
          <p className="text-sm font-medium text-center leading-relaxed">{emptyText}</p>
        </div>
      ) : (
        <>
          {/*
            CSS Grid fills the full available height.
            grid-template-rows: repeat(rows, 1fr) — each row is equal height,
            guaranteed to fill the panel with no overflow or scrollbar.
          */}
          <div
            className={`flex-1 min-h-0 transition-opacity duration-300 ${fade ? "opacity-0" : "opacity-100"}`}
            style={{
              display:             "grid",
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows:    `repeat(${rows}, 1fr)`,
              gap:                 "8px",
            }}
          >
            {visible.map((order) => (
              <OrderCard key={order.id} order={order} isReady={isReady} cols={cols} />
            ))}
          </div>

          {/* Pagination dots — only shown when orders exceed one page */}
          {pageCount > 1 && (
            <div className="flex justify-center items-center gap-2 pt-2.5 flex-shrink-0">
              {Array.from({ length: pageCount }, (_, i) => (
                <button
                  key={i}
                  onClick={() => { setPage(i); setFade(false); }}
                  aria-label={`Page ${i + 1}`}
                  className={`rounded-full transition-all ${
                    i === safePage
                      ? `h-1.5 w-5 ${isReady ? "bg-emerald-400" : "bg-orange-500"}`
                      : "h-1.5 w-1.5 bg-gray-600 hover:bg-gray-400"
                  }`}
                />
              ))}
              <span className="text-gray-600 text-[11px] font-mono ml-1 tabular-nums">
                {safePage + 1}/{pageCount}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomerDisplayPage() {
  const [orders,         setOrders]         = useState<DisplayOrder[]>([]);
  const [restaurantName, setRestaurantName] = useState("Our Restaurant");
  const [connected,      setConnected]      = useState(false);
  const [loading,        setLoading]        = useState(true);

  // Load restaurant name
  useEffect(() => {
    supabase
      .from("app_settings").select("data").limit(1).single()
      .then(({ data }) => {
        const name = data?.data?.restaurant?.name;
        if (name) setRestaurantName(name);
      });
  }, []);

  // Initial fetch + Realtime subscription
  useEffect(() => {
    supabase
      .from("orders")
      .select("*")
      .in("status", ACTIVE_STATUSES)
      .order("date", { ascending: true })
      .then(({ data }) => {
        setOrders((data ?? []).flatMap((r) => { const d = rowToDisplay(r); return d ? [d] : []; }));
        setLoading(false);
      });

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
            // Order moved to non-active status (delivered/cancelled) — remove card
            setOrders((prev) => prev.filter((o) => o.id !== newRow.id));
            return;
          }
          setOrders((prev) => {
            const idx = prev.findIndex((o) => o.id === display.id);
            if (idx >= 0) {
              const next = [...prev]; next[idx] = display; return next;
            }
            return [...prev, display].sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            );
          });
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => { supabase.removeChannel(channel); };
  }, []);

  const preparing = orders.filter((o) => ["pending", "confirmed", "preparing"].includes(o.status));
  const ready     = orders.filter((o) => o.status === "ready");

  return (
    <div className="h-screen bg-gray-950 flex flex-col overflow-hidden select-none">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-gray-900 border-b border-gray-800 px-5 py-3 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <ChefHat size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-black leading-tight">{restaurantName}</p>
            <p className="text-gray-400 text-[11px] font-medium tracking-widest uppercase">Order Status</p>
          </div>
        </div>

        <p className="hidden md:block text-gray-400 text-sm text-center max-w-sm">
          Watch for your order number &mdash; we&apos;ll call you when it&apos;s ready!
        </p>

        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${connected ? "text-emerald-400" : "text-gray-500"}`}>
            <Wifi size={13} />
            <span className="hidden sm:inline">{connected ? "Live" : "Connecting…"}</span>
          </div>
          <LiveClock />
        </div>
      </header>

      {/* ── Board ───────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <ChefHat size={56} className="text-orange-500/25 animate-pulse" />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 divide-x divide-gray-800 min-h-0 overflow-hidden">

          {/* Left — Being Prepared */}
          <div className="flex p-4 sm:p-5 min-h-0 overflow-hidden">
            <OrderPanel
              orders={preparing}
              isReady={false}
              title="Being Prepared"
              emoji="🔥"
              accentClass="text-orange-400"
              dotClass="bg-orange-500"
              emptyText={"No orders being prepared\nright now"}
            />
          </div>

          {/* Right — Ready for Collection */}
          <div className="flex p-4 sm:p-5 min-h-0 overflow-hidden">
            <OrderPanel
              orders={ready}
              isReady={true}
              title="Ready to Collect"
              emoji="✅"
              accentClass="text-emerald-400"
              dotClass="bg-emerald-400"
              emptyText={"No orders ready yet —\ncheck back soon!"}
            />
          </div>
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="bg-gray-900 border-t border-gray-800 px-5 py-2 flex items-center justify-between flex-shrink-0">
        <p className="text-gray-600 text-xs">Updates automatically — no refresh needed</p>
        <p className="text-gray-600 text-xs">Thank you for dining with us!</p>
      </footer>
    </div>
  );
}
