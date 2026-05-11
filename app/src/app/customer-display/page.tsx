"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { ChefHat, CheckCircle2, Clock, UtensilsCrossed, Wifi } from "lucide-react";
import type { OrderLine } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveStatus = "pending" | "confirmed" | "preparing" | "ready";

interface DisplayOrder {
  id: string;
  label: string;
  status: ActiveStatus;
  items: OrderLine[];
  date: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: ActiveStatus[] = ["pending", "confirmed", "preparing", "ready"];
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

// ─── Smart Layout Hook ────────────────────────────────────────────────────────
// This dynamically calculates the perfect grid (rows and columns) 
// based on the EXACT pixel dimensions available on the current device.

function useSmartLayout(orderCount: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const[layout, setLayout] = useState({ cols: 1, maxRows: 3, pageSize: 3 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;

      // Minimum comfortably readable sizes for a card
      const minCardHeight = 180; 
      const minCardWidth = 200;

      // Calculate max possible rows/cols that fit physically (capped to maintain aesthetics)
      const maxRows = Math.min(5, Math.max(1, Math.floor(height / minCardHeight)));
      const maxPossibleCols = Math.max(1, Math.floor(width / minCardWidth));

      // Optimize column count based on active order count so cards don't stretch weirdly
      let cols = maxPossibleCols;
      if (orderCount <= maxRows) cols = 1;
      else if (orderCount <= maxRows * 2) cols = Math.min(2, maxPossibleCols);
      else cols = Math.min(4, maxPossibleCols); // Cap at 4 cols max for ultra-wides

      setLayout({ cols, maxRows, pageSize: cols * maxRows });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [orderCount]);

  return { containerRef, ...layout };
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
    <span className="font-mono text-white/50 font-semibold tabular-nums flex items-center gap-1.5 text-xs sm:text-base lg:text-lg">
      <Clock size={14} className="opacity-50 hidden sm:block" />
      {time}
    </span>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({
  order,
  isReady,
  cols,
  maxRows
}: {
  order: DisplayOrder;
  isReady: boolean;
  cols: number;
  maxRows: number;
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

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); },[]);

  // Highly responsive typography scaling based on grid density
  const numCls = cols === 1 ? "text-5xl sm:text-6xl lg:text-7xl 2xl:text-8xl" 
               : cols === 2 ? "text-[35px] sm:text-5xl lg:text-[41px] 2xl:text-[88px]" 
               : cols === 3 ? "text-[32px] sm:text-4xl lg:text-4xl 2xl:text-[45px]"
               : "text-2xl md:text-[32px] lg:text-4xl 2xl:text-4xl";
               
  const qtyTxt  = cols >= 3 ? "text-xs sm:text-sm" : "text-sm sm:text-base";
  const itemTxt = cols >= 3 ? "text-[11px] sm:text-xs" : "text-xs sm:text-sm";
  const pad     = cols >= 3 || maxRows >= 4 ? "p-1.5 sm:p-2.5" : "p-3 sm:p-4";
  const gap     = cols >= 3 || maxRows >= 4 ? "gap-1 sm:gap-1.5" : "gap-1.5 sm:gap-2.5";
  const btnTxt  = cols >= 3 ? "text-[9px] sm:text-[11px]" : "text-[11px] sm:text-xs";
  
  // Smartly truncate lists if cards are physically constrained
  const maxItems = maxRows >= 4 ? 2 : cols >= 3 ? 3 : 5;

  const shown    = order.items.slice(0, maxItems);
  const overflow = order.items.length - shown.length;

  return (
    <div
      className={`
        relative rounded-[1rem] sm:rounded-2xl overflow-hidden flex flex-col h-full
        transition-all duration-500 min-h-0
        ${isReady
          ? "bg-emerald-950 border-2 border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.15)] sm:shadow-[0_0_28px_rgba(52,211,153,0.22)]"
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
            <li className={`text-gray-500 pl-4 sm:pl-5 font-semibold ${itemTxt}`}>+{overflow} more</li>
          )}
        </ul>

        {isReady && (
          <div className="flex-shrink-0 space-y-1.5 mt-auto pt-1">
            <div className={`bg-emerald-400 rounded-lg sm:rounded-xl flex items-center justify-center gap-1 sm:gap-1.5 ${
              cols >= 3 || maxRows >= 4 ? "py-1 sm:py-1.5" : "py-1.5 sm:py-2"
            }`}>
              <CheckCircle2 size={cols >= 3 ? 12 : 16} className="text-emerald-950" />
              <span className={`text-emerald-950 font-black tracking-wide ${cols >= 3 ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm"}`}>
                COLLECT NOW
              </span>
            </div>

            {!confirming ? (
              <button
                onClick={handleCollectClick}
                disabled={marking}
                className={`w-full rounded-lg sm:rounded-xl flex items-center justify-center gap-1.5 font-bold text-emerald-600 border border-emerald-900 hover:bg-emerald-900/30 active:scale-[0.98] transition-all disabled:opacity-40 ${
                  cols >= 3 || maxRows >= 4 ? "py-1 text-[10px]" : "py-1.5 text-xs"
                }`}
              >
                {marking
                  ? <span className="animate-spin">⟳</span>
                  : <><CheckCircle2 size={12} /> Mark Collected</>
                }
              </button>
            ) : (
              <div className="flex gap-1 sm:gap-1.5">
                <button
                  onClick={handleConfirm}
                  className={`flex-1 rounded-lg sm:rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-black transition-all ${btnTxt} ${cols >= 3 ? "py-1" : "py-1.5"}`}
                >
                  ✓ Confirm
                </button>
                <button
                  onClick={handleCancel}
                  className={`flex-1 rounded-lg sm:rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold transition-all ${btnTxt} ${cols >= 3 ? "py-1" : "py-1.5"}`}
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
  const { containerRef, cols, maxRows, pageSize } = useSmartLayout(orders.length);
  const pageCount = Math.max(1, Math.ceil(orders.length / pageSize));

  const [page, setPage] = useState(0);
  const [fade, setFade] = useState(false);

  useEffect(() => setPage(0),[cols, maxRows]);

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
  },[pageCount]);

  const safePage = Math.min(page, pageCount - 1);
  const visible = orders.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
      <div className="flex items-center gap-1.5 sm:gap-2 px-1 pb-2 sm:pb-3 flex-shrink-0">
        <span className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-lg sm:text-xl leading-none select-none" aria-hidden>{emoji}</span>
        <h2 className={`font-black text-sm sm:text-lg md:text-xl uppercase tracking-widest flex-1 truncate ${accentClass}`}>
          {title}
        </h2>
        <span className={`text-[10px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 rounded-full bg-white/10 ${accentClass}`}>
          {orders.length}
        </span>
      </div>

      {orders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-600 select-none">
          <UtensilsCrossed size={40} className="mb-3 opacity-20 w-8 h-8 sm:w-10 sm:h-10" />
          <p className="text-xs sm:text-sm font-medium text-center leading-relaxed whitespace-pre-wrap">{emptyText}</p>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 min-h-0 relative">
          <div
            className={`absolute inset-0 transition-opacity duration-300 ${fade ? "opacity-0" : "opacity-100"}`}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              // This strictly locks height ensuring perfectly equal cards that never break out
              gridTemplateRows: `repeat(${maxRows}, minmax(0, 1fr))`, 
              gap: '8px'
            }}
          >
            {visible.map((order) => (
              <OrderCard key={order.id} order={order} isReady={isReady} cols={cols} maxRows={maxRows} />
            ))}
          </div>
        </div>
      )}

      {/* Pagination wrapper reserved space (prevents layout jumping) */}
      <div className="h-6 sm:h-8 flex-shrink-0 flex items-center justify-center">
        {pageCount > 1 && (
          <div className="flex justify-center items-center gap-1.5 sm:gap-2">
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                onClick={() => { setPage(i); setFade(false); }}
                aria-label={`Page ${i + 1}`}
                className={`rounded-full transition-all ${
                  i === safePage
                    ? `h-1.5 w-4 sm:w-5 ${isReady ? "bg-emerald-400" : "bg-orange-500"}`
                    : "h-1.5 w-1.5 bg-gray-600 hover:bg-gray-400"
                }`}
              />
            ))}
            <span className="text-gray-600 text-[9px] sm:text-[11px] font-mono ml-1 tabular-nums">
              {safePage + 1}/{pageCount}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomerDisplayPage() {
  const[orders, setOrders] = useState<DisplayOrder[]>([]);
  const [restaurantName, setRestaurantName] = useState("Our Restaurant");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("app_settings").select("data").limit(1).single()
      .then(({ data }) => {
        const name = data?.data?.restaurant?.name;
        if (name) setRestaurantName(name);
      });
  },[]);

  useEffect(() => {
    supabase
      .from("orders")
      .select("*")
      .in("status", ACTIVE_STATUSES)
      .order("date", { ascending: true })
      .then(({ data }) => {
        setOrders((data ??[]).flatMap((r) => { const d = rowToDisplay(r); return d ? [d] :[]; }));
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
            setOrders((prev) => prev.filter((o) => o.id !== newRow.id));
            return;
          }
          setOrders((prev) => {
            const idx = prev.findIndex((o) => o.id === display.id);
            if (idx >= 0) {
              const next = [...prev]; next[idx] = display; return next;
            }
            return[...prev, display].sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            );
          });
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => { supabase.removeChannel(channel); };
  }, []);

  const preparing = orders.filter((o) =>["pending", "confirmed", "preparing"].includes(o.status));
  const ready = orders.filter((o) => o.status === "ready");

  return (
    <div className="h-[100dvh] bg-gray-950 flex flex-col overflow-hidden select-none font-sans">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-gray-900 border-b border-gray-800 px-3 sm:px-5 py-2 sm:py-3 flex items-center justify-between gap-2 sm:gap-4 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-7 h-7 sm:w-9 sm:h-9 bg-orange-500 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
            <ChefHat size={16} className="text-white sm:w-[18px] sm:h-[18px]" />
          </div>
          <div className="flex flex-col justify-center">
            <p className="text-white font-black leading-none text-[13px] sm:text-base mb-0.5">{restaurantName}</p>
            <p className="text-gray-400 text-[8px] sm:text-[10px] font-bold tracking-widest uppercase leading-none">Order Status</p>
          </div>
        </div>

        <p className="hidden md:block text-gray-400 text-sm text-center max-w-sm">
          Watch for your order number &mdash; we&apos;ll call you when it&apos;s ready!
        </p>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className={`hidden sm:flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold ${connected ? "text-emerald-400" : "text-gray-500"}`}>
            <Wifi size={13} />
            <span className="hidden lg:inline">{connected ? "Live" : "Connecting…"}</span>
          </div>
          <LiveClock />
        </div>
      </header>

      {/* ── Board ───────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <ChefHat size={48} className="text-orange-500/25 animate-pulse sm:w-14 sm:h-14" />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1 divide-y lg:divide-y-0 lg:divide-x divide-gray-800 min-h-0 overflow-hidden">
          
          {/* Left — Being Prepared */}
          <div className="flex p-3 sm:p-4 lg:p-5 min-h-0 overflow-hidden bg-gray-950/40">
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
          <div className="flex p-3 sm:p-4 lg:p-5 min-h-0 overflow-hidden bg-gray-950/20">
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
      <footer className="bg-gray-900 border-t border-gray-800 px-3 sm:px-5 py-1.5 sm:py-2 flex items-center justify-between flex-shrink-0">
        <p className="text-gray-600 text-[9px] sm:text-xs">Updates automatically <span className="hidden sm:inline">—  no refresh needed</span></p>
        <p className="text-gray-600 text-[9px] sm:text-xs text-right">Thank you for dining with us!</p>
      </footer>
    </div>
  );
}
