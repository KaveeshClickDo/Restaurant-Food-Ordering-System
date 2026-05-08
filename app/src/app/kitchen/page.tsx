"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import type { KitchenStaff } from "@/types";
import {
  ChefHat, Clock, Truck, ShoppingBag, CheckCircle2,
  LayoutDashboard, Maximize2, Minimize2, UtensilsCrossed,
  AlertTriangle, CalendarClock, LogOut,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type KDSStatus = "pending" | "confirmed" | "preparing" | "ready";

interface KDSOrder {
  id: string;
  displayName: string;
  kitchenNote: string | undefined;
  items: { name: string; qty: number; price: number }[];
  status: KDSStatus;
  fulfillment: string;
  date: string;
  address?: string;
  scheduledTime?: string;
}

type ColumnConfig = {
  statuses: KDSStatus[];
  label: string;
  shortLabel: string;
  borderClass: string;
  dotClass: string;
  badgeClass: string;
  textClass: string;
  buttonClass: string;
  colBg: string;
  nextStatus?: KDSStatus;
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
  },
];

const ACTIVE_STATUSES: KDSStatus[] = ["pending", "confirmed", "preparing", "ready"];

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

/**
 * Derive a human-readable display name for the kitchen card header.
 * - Waiter / dine-in orders: "Table T4"
 * - POS walk-in orders: customer name extracted from note, or "Walk-in"
 * - Online orders: customer name passed in from the join
 */
function deriveDisplayName(
  fulfillment: string,
  note: string | null,
  customerName: string | null,
): string {
  const n = note ?? "";
  if (fulfillment === "dine-in" || n.startsWith("[WAITER]")) {
    const m = n.match(/Table\s+(\S+)/);
    return m ? `Table ${m[1]}` : "Dine-in";
  }
  if (n.startsWith("[POS]")) {
    const m = n.match(/Customer:\s*([^|]+)/);
    return m ? m[1].trim() : "Walk-in";
  }
  return customerName?.trim() || "Online Order";
}

/**
 * Extract the kitchen-facing note from an order note string.
 * - Waiter: everything after the "Staff: XYZ · " segment (the actual kitchen instruction)
 * - POS: nothing — the note is internal metadata, not for kitchen staff
 * - Online: the raw note the customer typed
 */
function deriveKitchenNote(fulfillment: string, note: string | null): string | undefined {
  const n = note ?? "";
  if (!n) return undefined;
  if (fulfillment === "dine-in" || n.startsWith("[WAITER]")) {
    // Format: "[WAITER] Table T1 · 2 covers · Staff: Alex · No onions"
    const staffIdx = n.indexOf("Staff:");
    if (staffIdx === -1) return undefined;
    // Find the separator after the staff name
    const afterStaff = n.slice(staffIdx);
    const nextSep = afterStaff.indexOf(" · ");
    if (nextSep === -1) return undefined;  // no kitchen note after staff
    return afterStaff.slice(nextSep + 3).trim() || undefined;
  }
  if (n.startsWith("[POS]")) return undefined;  // metadata only, not for kitchen
  return n || undefined;
}

function mapRow(row: Record<string, unknown>): KDSOrder {
  const fulfillment = String(row.fulfillment ?? "collection");
  const note        = (row.note as string | null) ?? null;
  // The join gives us customer: { name: string } | null
  const customerRow = row.customer as { name?: string } | null;
  return {
    id:            String(row.id),
    displayName:   deriveDisplayName(fulfillment, note, customerRow?.name ?? null),
    kitchenNote:   deriveKitchenNote(fulfillment, note),
    items:         (row.items as KDSOrder["items"]) ?? [],
    status:        row.status as KDSStatus,
    fulfillment,
    date:          String(row.date),
    address:       (row.address as string) || undefined,
    scheduledTime: (row.scheduled_time as string) || undefined,
  };
}

// ─── Live clock ───────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-white font-bold tracking-widest tabular-nums text-lg">{time}</span>;
}

// ─── Elapsed badge (self-updating) ────────────────────────────────────────────

function ElapsedBadge({ date }: { date: string }) {
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    setMins(elapsedMin(date));
    const id = setInterval(() => setMins(elapsedMin(date)), 30_000);
    return () => clearInterval(id);
  }, [date]);

  if (mins === null) {
    return (
      <span className="bg-gray-600 text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 flex-shrink-0">
        <Clock size={10} /><span className="opacity-0">--</span>
      </span>
    );
  }
  const u = urgencyClass(mins);
  return (
    <span className={`${u.badge} ${u.ring} text-white text-xs font-bold px-2.5 py-1 rounded-full tabular-nums flex items-center gap-1.5 flex-shrink-0 ${u.pulse ? "animate-pulse" : ""}`}>
      <Clock size={10} />
      {fmtElapsed(mins)}
    </span>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({
  order,
  col,
  onAdvance,
}: {
  order: KDSOrder;
  col: ColumnConfig;
  onAdvance?: () => void;
}) {
  const isDelivery = order.fulfillment === "delivery";
  const isDineIn   = order.fulfillment === "dine-in";

  const tableLabel = isDineIn
    ? (order.displayName.startsWith("Table ") ? order.displayName.slice(6) : null)
    : null;

  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    setMins(elapsedMin(order.date));
    const id = setInterval(() => setMins(elapsedMin(order.date)), 60_000);
    return () => clearInterval(id);
  }, [order.date]);

  const [confirming, setConfirming] = useState(false);
  const [marking,    setMarking]    = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCollectClick() {
    setConfirming(true);
    confirmTimer.current = setTimeout(() => setConfirming(false), 4000);
  }
  async function handleConfirmCollect() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    setMarking(true);
    try { await fetch(`/api/pos/orders/${order.id}/collected`, { method: "PUT" }); }
    catch { setMarking(false); }
  }
  function handleCancelCollect() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
  }
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const u = mins !== null ? urgencyClass(mins) : { ring: "", pulse: false };

  return (
    <div className={`bg-gray-800 rounded-2xl border-l-[5px] ${col.borderClass} ${u.ring} flex flex-col overflow-hidden transition-shadow hover:shadow-xl`}>
      {/* Card header */}
      <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
            #{order.id.slice(-8).toUpperCase()}
          </p>
          <p className="text-white font-bold text-lg leading-tight truncate mt-0.5">
            {order.displayName}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <ElapsedBadge date={order.date} />
          <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            isDineIn   ? "bg-purple-900/60 text-purple-300"
            : isDelivery ? "bg-indigo-900/60 text-indigo-300"
            :              "bg-emerald-900/60 text-emerald-300"
          }`}>
            {isDineIn
              ? <>{`🍽️`} {tableLabel ? `Table ${tableLabel}` : "Dine-in"}</>
              : isDelivery
                ? <><Truck size={10} /> Delivery</>
                : <><ShoppingBag size={10} /> Collection</>
            }
          </span>
        </div>
      </div>

      {/* Address / scheduled */}
      {(order.address || order.scheduledTime) && (
        <div className="px-4 pb-2 space-y-0.5">
          {order.address && (
            <p className="text-gray-400 text-xs truncate">📍 {order.address}</p>
          )}
          {order.scheduledTime && (
            <p className="text-amber-400 text-xs font-semibold flex items-center gap-1.5">
              <CalendarClock size={11} />{order.scheduledTime}
            </p>
          )}
        </div>
      )}

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

      {/* Kitchen note — only for waiter kitchen instructions and online customer notes */}
      {order.kitchenNote && (
        <div className="mx-4 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
          <p className="text-amber-400 text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
            <AlertTriangle size={10} /> Special Note
          </p>
          <p className="text-amber-200 text-sm leading-snug">{order.kitchenNote}</p>
        </div>
      )}

      {mins !== null && mins >= 30 && (
        <div className="mx-4 mb-3 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-1.5 flex items-center gap-2">
          <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-xs font-semibold">Order waiting {fmtElapsed(mins)}</p>
        </div>
      )}

      {/* Action buttons */}
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
        <div className="px-4 pb-4 flex flex-col gap-2">
          <div className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-semibold border ${
            isDineIn
              ? "bg-purple-900/20 border-purple-700/30 text-purple-300"
              : isDelivery
                ? "bg-indigo-900/20 border-indigo-700/30 text-indigo-300"
                : "bg-emerald-900/20 border-emerald-700/30 text-emerald-300"
          }`}>
            {isDineIn
              ? <>{`🍽️`} Serve at {tableLabel ? `Table ${tableLabel}` : "table"}</>
              : isDelivery
                ? <><Truck size={13} /> Awaiting driver pickup</>
                : <><ShoppingBag size={13} /> Awaiting customer collection</>
            }
          </div>
          {!isDelivery && !isDineIn && (
            confirming ? (
              <div className="flex gap-2">
                <button onClick={handleConfirmCollect}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.97] text-white font-black text-xs py-2.5 rounded-xl transition-all">
                  ✓ Confirm Collected
                </button>
                <button onClick={handleCancelCollect}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 active:scale-[0.97] text-gray-300 font-semibold text-xs py-2.5 rounded-xl transition-all">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={handleCollectClick} disabled={marking}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold text-emerald-500 border border-emerald-800 hover:bg-emerald-900/30 active:scale-[0.97] transition-all disabled:opacity-40">
                {marking ? <span className="animate-spin">⟳</span> : <><CheckCircle2 size={12} /> Mark as Collected</>}
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
  orders: KDSOrder[];
  onAdvance: (order: KDSOrder) => void;
}) {
  return (
    <div className={`flex flex-col rounded-2xl ${col.colBg} border border-gray-700/40 overflow-hidden`}>
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-700/60 flex-shrink-0">
        <span className={`w-2.5 h-2.5 rounded-full ${col.dotClass} flex-shrink-0`} />
        <h2 className="text-gray-200 font-bold text-sm uppercase tracking-widest flex-1">{col.label}</h2>
        <span className={`${col.badgeClass} text-xs font-bold px-2.5 py-0.5 rounded-full min-w-[1.5rem] text-center`}>
          {orders.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600 select-none">
            <UtensilsCrossed size={40} className="mb-3 opacity-20" />
            <p className="text-sm font-medium">No orders</p>
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              col={col}
              onAdvance={col.nextStatus ? () => onAdvance(order) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export default function KitchenPage() {
  const { settings } = useApp();          // only used for restaurant name in header
  const router = useRouter();
  const [orders,          setOrders]          = useState<KDSOrder[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [completedToday,  setCompletedToday]  = useState(0);
  const [isFullscreen,    setIsFullscreen]    = useState(false);
  const [currentStaff,    setCurrentStaff]    = useState<Omit<KitchenStaff, "pin"> | null>(null);

  // Fetch current kitchen session on mount (best-effort — doesn't block KDS)
  useEffect(() => {
    fetch("/api/kitchen/auth")
      .then((r) => r.json())
      .then((d: { ok: boolean; staff?: Omit<KitchenStaff, "pin"> }) => {
        if (d.ok && d.staff) setCurrentStaff(d.staff);
      })
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/kitchen/logout", { method: "POST" }).catch(() => {});
    router.replace("/kitchen/login");
  }

  // ── Initial load — direct orders query, no customer-state dependency ─────────
  useEffect(() => {
    supabase
      .from("orders")
      .select("id, items, total, note, status, fulfillment, date, address, scheduled_time, customer:customers(name)")
      .in("status", ACTIVE_STATUSES)
      .order("date", { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error("KDS initial load:", error.message);
        setOrders((data ?? []).map((r) => mapRow(r as Record<string, unknown>)));
        setLoading(false);
      });
  }, []);

  // ── Realtime subscription — direct on orders table ────────────────────────
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    // Remove any stale channel with this name before subscribing.
    // Guards against the React Strict Mode double-mount race where the cleanup
    // of the first mount hasn't completed before the second mount fires.
    supabase.getChannels().forEach((ch) => {
      if ((ch as { topic?: string }).topic === "realtime:kds-orders-live") {
        supabase.removeChannel(ch);
      }
    });

    function handlePayload(payload: Parameters<Parameters<ReturnType<typeof supabase.channel>["on"]>[2]>[0]) {
      if (payload.eventType === "DELETE") {
        setOrders((prev) => prev.filter((o) => o.id !== (payload.old as { id: string }).id));
        return;
      }

      const newRow = payload.new as Record<string, unknown>;
      const status = newRow.status as string;

      // If status is not a kitchen-active status, remove from KDS
      if (!ACTIVE_STATUSES.includes(status as KDSStatus)) {
        setOrders((prev) => prev.filter((o) => o.id !== newRow.id));
        return;
      }

      // Fetch the full row with the customer JOIN (Realtime payload doesn't carry join data)
      supabase
        .from("orders")
        .select("id, items, total, note, status, fulfillment, date, address, scheduled_time, customer:customers(name)")
        .eq("id", newRow.id as string)
        .single()
        .then(({ data }) => {
          if (!data || !active) return;
          const mapped = mapRow(data as Record<string, unknown>);
          setOrders((prev) => {
            const idx = prev.findIndex((o) => o.id === mapped.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = mapped;
              return next;
            }
            return [...prev, mapped].sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );
          });
        });
    }

    let channel: ReturnType<typeof supabase.channel>;

    function subscribe() {
      channel = supabase
        .channel("kds-orders-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, handlePayload)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("KDS: Realtime connected");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("KDS: Realtime error (%s) — retrying in 5 s", status);
            supabase.removeChannel(channel);
            if (active) retryTimer = setTimeout(subscribe, 5_000);
          }
        });
    }

    subscribe();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Advance order to next kitchen status ──────────────────────────────────
  async function advanceOrder(order: KDSOrder, nextStatus: KDSStatus) {
    // Optimistic update
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o))
    );
    if (nextStatus === "ready") setCompletedToday((n) => n + 1);

    const res = await fetch(`/api/kds/orders/${order.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      // Rollback on failure
      const j = await res.json().catch(() => ({})) as { error?: string };
      console.error("KDS advance failed:", j.error);
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: order.status } : o))
      );
    }
  }

  // ── Fullscreen ────────────────────────────────────────────────────────────
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

  const totalActive = orders.length;

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
            const count = orders.filter((o) => col.statuses.includes(o.status)).length;
            return (
              <div key={col.label} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${col.dotClass}`} />
                <span className="text-gray-400 text-xs font-semibold hidden sm:inline">{col.shortLabel}</span>
                <span className={`${col.badgeClass} text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center`}>
                  {count}
                </span>
              </div>
            );
          })}
          <span className="text-gray-600 text-xs hidden sm:inline">|</span>
          <span className="text-gray-400 text-xs hidden sm:flex items-center gap-1">
            <CheckCircle2 size={12} className="text-green-500" />
            {completedToday} done
          </span>
        </div>

        {/* Right — staff badge + clock + links */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <LiveClock />
          {currentStaff && (
            <div className="hidden sm:flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0"
                style={{ backgroundColor: currentStaff.avatarColor }}
              >
                {initials(currentStaff.name)}
              </div>
              <span className="text-gray-300 text-xs font-medium">{currentStaff.name}</span>
            </div>
          )}
          <Link
            href="/admin"
            className="hidden sm:flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-xs font-medium"
          >
            <LayoutDashboard size={14} /> Admin
          </Link>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-red-400 transition-colors"
            title="Log out"
          >
            <LogOut size={16} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="text-gray-400 hover:text-white transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </header>

      {/* ── Kanban board ────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <ChefHat size={40} className="text-orange-500 mx-auto animate-pulse" />
            <p className="text-gray-400 text-sm">Loading orders…</p>
          </div>
        </div>
      ) : totalActive === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <UtensilsCrossed size={56} className="mx-auto text-gray-700" />
            <p className="text-gray-500 text-lg font-medium">No active orders</p>
            <p className="text-gray-600 text-sm">New orders will appear here in real-time</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-3 gap-4 p-4 min-h-0 overflow-hidden">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.label}
              col={col}
              orders={orders.filter((o) => col.statuses.includes(o.status))}
              onAdvance={(order) => col.nextStatus && advanceOrder(order, col.nextStatus)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
