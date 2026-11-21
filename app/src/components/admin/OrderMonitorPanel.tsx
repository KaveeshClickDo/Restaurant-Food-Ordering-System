"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { fullOrderNumber } from "@/lib/orderNumber";
import { parseTableLabelFromNote } from "@/lib/tableLabel";
import {
  Circle, CheckCircle2, ChefHat, Package, Truck, Ban,
  RefreshCw, ShoppingBag, TrendingUp, Clock, UtensilsCrossed, Tablet,
  Receipt, ChevronLeft, ChevronRight,
} from "lucide-react";
import { ReceiptModal } from "./ReceiptModal";
import { Customer, Order } from "@/types";

// Read-only monitoring board for POS counter sales or dine-in (table-service)
// orders. Mirrors the Online Orders board's at-a-glance stats + live status,
// but with NO management controls — the cashier (POS) and waiters (dine-in)
// own those flows. Admin just watches: what's in progress, what's done today,
// and how much was earned.

type Source = "pos" | "dine-in";

interface RawOrder {
  id: string;
  date: string;
  status: string;
  payment_status: string | null;
  total: number;
  items: { name: string; qty: number; price: number }[] | null;
  note: string | null;
  fulfillment: string | null;
  payment_method: string | null;
  customer_id: string | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  scheduled_time?: string | null;
  // Financial / detail fields used to render the receipt. Optional because they
  // are only present when the orders query selects them.
  delivery_fee?: number | null;
  service_fee?: number | null;
  discount_amount?: number | null;
  discount_note?: string | null;
  coupon_discount?: number | null;
  coupon_code?: string | null;
  vat_amount?: number | null;
  vat_inclusive?: boolean | null;
  tip_amount?: number | null;
  store_credit_used?: number | null;
  gift_card_used?: number | null;
  address?: string | null;
  table_label?: string | null;
  staff_name?: string | null;
}

// Refund state lives on payment_status, so any status can carry it — a voided
// sale is "Cancelled · Refunded" (QA #37), an admin partial refund on a
// completed order is "Completed · Partial refund".
function statusLabel(o: RawOrder): string {
  const base = STATUS_CONFIG[o.status]?.label ?? o.status;
  if (o.payment_status === "refunded") return `${base} · Refunded`;
  if (o.payment_status === "partially_refunded") return `${base} · Partial refund`;
  return base;
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; dot: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", badge: "bg-yellow-50 text-yellow-700 border-yellow-200", dot: "bg-yellow-400", icon: <Circle size={11} className="fill-yellow-400 text-yellow-400" /> },
  confirmed: { label: "Confirmed", badge: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500", icon: <CheckCircle2 size={11} className="text-blue-500" /> },
  preparing: { label: "Preparing", badge: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500", icon: <ChefHat size={11} className="text-orange-500" /> },
  ready: { label: "Ready", badge: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-500", icon: <Package size={11} className="text-purple-500" /> },
  delivered: { label: "Completed", badge: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500", icon: <Truck size={11} className="text-green-600" /> },
  cancelled: { label: "Cancelled", badge: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-400", icon: <Ban size={11} className="text-red-500" /> },
};

// Today's start/end bounds (local time), for the two day-scoped views.
function todayBounds(): [string, string] {
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const end = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59, 999);
  return [start.toISOString(), end.toISOString()];
}

// Date + time — ongoing orders can be from a previous day, so time alone is
// ambiguous on this board.
function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function orderLabel(o: RawOrder, source: Source): string {
  const note = o.note ?? "";
  if (source === "dine-in") {
    const label = parseTableLabelFromNote(note);
    return label ? `Table ${label}` : "Dine-in";
  }
  const m = note.match(/Receipt:\s*(\S+)/);
  return m ? `Receipt ${m[1]}` : fullOrderNumber(o.id);
}

function StatCard({ label, value, sub, icon, accent }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; accent: "orange" | "green" | "purple" | "blue";
}) {
  const colors = {
    orange: "bg-orange-50 text-orange-500",
    green: "bg-green-50 text-green-500",
    purple: "bg-purple-50 text-purple-500",
    blue: "bg-blue-50 text-blue-500",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[accent]}`}>{icon}</div>
      </div>
      <div className="text-lg sm:text-xl xl:text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function OrderCard({ o, source, sym, onViewReceipt }: { o: RawOrder; source: Source; sym: string; onViewReceipt: (o: RawOrder) => void }) {
  const cfg = STATUS_CONFIG[o.status] ?? STATUS_CONFIG.pending;
  const itemCount = (o.items ?? []).reduce((s, i) => s + (i.qty ?? 0), 0);
  const itemSummary = (o.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(", ");
  return (
    <div className="relative bg-white rounded-xl border border-gray-100 shadow-sm pl-4 pr-4 py-3.5 flex items-center justify-between gap-3 overflow-hidden hover:border-gray-200 transition">
      {/* status accent bar */}
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-gray-900 text-sm">{orderLabel(o, source)}</span>
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
            {cfg.icon} {statusLabel(o)}
          </span>
          <span className="text-xs text-gray-400 flex items-center gap-1"><Clock size={10} /> {fmtDateTime(o.date)}</span>
        </div>
        {itemSummary && (
          <p className="text-xs text-gray-500 mt-1 truncate">
            <span className="text-gray-400">{itemCount} item{itemCount !== 1 ? "s" : ""} ·</span> {itemSummary}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="font-bold text-gray-900 text-base tabular-nums">{sym}{Number(o.total ?? 0).toFixed(2)}</span>
        <button
          onClick={() => onViewReceipt(o)}
          title="View Receipt"
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 transition-colors border border-gray-200"
        >
          <Receipt size={14} />
        </button>
      </div>
    </div>
  );
}

// Shared Prev/Next footer for the three sections below — only rendered by
// the caller when totalPages > 1.
function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <ChevronLeft size={13} /> Prev
        </button>
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          Next <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

export default function OrderMonitorPanel({ source }: { source: Source }) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  // The paginated /api/admin/orders mode uses "walk-in" for what this panel
  // calls "pos" (both mean the same thing: customer_id = the POS walk-in
  // sentinel — see applySource in the route).
  const apiSource = source === "pos" ? "walk-in" : "dine-in";

  const [loading, setLoading] = useState(true);

  // Active orders — no date bound, any status in ACTIVE_STATUSES. Fetched in
  // full (unpaginated): this is a live "what's in progress" board, not a
  // browsable archive, and paginating it risks an order sitting just past the
  // page boundary where a cashier never sees it. activeTotalCount comes from
  // the server's own exact count (same mechanism as the other two sections),
  // not from activeOrders.length, so the stat card is a DB count rather than
  // a client-side array length.
  const [activeOrders, setActiveOrders] = useState<RawOrder[]>([]);
  const [activeTotalCount, setActiveTotalCount] = useState(0);

  // Completed today — status delivered, not refunded.
  const [completedOrders, setCompletedOrders] = useState<RawOrder[]>([]);
  const [completedTotalCount, setCompletedTotalCount] = useState(0);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedPage, setCompletedPage] = useState(1);
  const completedTotalPages = Math.max(1, Math.ceil(completedTotalCount / PAGE_SIZE));

  // Voided / refunded today.
  const [voidedOrders, setVoidedOrders] = useState<RawOrder[]>([]);
  const [voidedTotalCount, setVoidedTotalCount] = useState(0);
  const [voidedPage, setVoidedPage] = useState(1);
  const voidedTotalPages = Math.max(1, Math.ceil(voidedTotalCount / PAGE_SIZE));

  // State for receipt modal
  const [viewingReceipt, setViewingReceipt] = useState<RawOrder | null>(null);

  // The initial-load spinner (button only — no skeleton in this panel) flips
  // off once all three sections have completed their first fetch, tracked by
  // a ref rather than effect deps so later page changes / poll ticks don't
  // re-trigger it.
  const firstLoadDone = useRef({ active: false, completed: false, voided: false });
  const markFirstLoadDone = useCallback((key: "active" | "completed" | "voided") => {
    firstLoadDone.current[key] = true;
    const { active, completed, voided } = firstLoadDone.current;
    if (active && completed && voided) setLoading(false);
  }, []);

  const fetchActive = useCallback(async () => {
    try {
      // Unpaginated on purpose — the route's unpaginated mode has no row cap
      // and applies `view` filtering too, so this is a full, uncapped fetch
      // of every currently-active order.
      const params = new URLSearchParams({ source, view: "active" });
      const r = await fetch(`/api/admin/orders?${params}`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; orders?: RawOrder[]; totalCount?: number };
      if (json.ok) { setActiveOrders(json.orders ?? []); setActiveTotalCount(json.totalCount ?? 0); }
    } catch { /* network blip — keep last-known */ }
    finally { markFirstLoadDone("active"); }
  }, [source, markFirstLoadDone]);

  const fetchCompleted = useCallback(async () => {
    try {
      const [from, to] = todayBounds();
      const params = new URLSearchParams({
        source: apiSource, view: "completed-today", page: String(completedPage), pageSize: String(PAGE_SIZE), from, to,
      });
      const r = await fetch(`/api/admin/orders?${params}`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; orders?: RawOrder[]; totalCount?: number; totalForFilter?: number };
      if (json.ok) {
        setCompletedOrders(json.orders ?? []);
        setCompletedTotalCount(json.totalCount ?? 0);
        setCompletedTotal(json.totalForFilter ?? 0);
      }
    } catch { /* network blip — keep last-known */ }
    finally { markFirstLoadDone("completed"); }
  }, [apiSource, completedPage, markFirstLoadDone]);

  const fetchVoided = useCallback(async () => {
    try {
      const [from, to] = todayBounds();
      const params = new URLSearchParams({
        source: apiSource, view: "voided-today", page: String(voidedPage), pageSize: String(PAGE_SIZE), from, to,
      });
      const r = await fetch(`/api/admin/orders?${params}`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; orders?: RawOrder[]; totalCount?: number };
      if (json.ok) { setVoidedOrders(json.orders ?? []); setVoidedTotalCount(json.totalCount ?? 0); }
    } catch { /* network blip — keep last-known */ }
    finally { markFirstLoadDone("voided"); }
  }, [apiSource, voidedPage, markFirstLoadDone]);

  // Each section refetches whenever its own page changes — this also covers
  // the initial load (effects run once on mount regardless of deps).
  useEffect(() => { void fetchActive(); }, [fetchActive]);
  useEffect(() => { void fetchCompleted(); }, [fetchCompleted]);
  useEffect(() => { void fetchVoided(); }, [fetchVoided]);

  // Clamp each paginated section's page down if a refetch shrinks the set
  // out from under it.
  useEffect(() => { setCompletedPage((p) => Math.min(p, completedTotalPages)); }, [completedTotalPages]);
  useEffect(() => { setVoidedPage((p) => Math.min(p, voidedTotalPages)); }, [voidedTotalPages]);

  // 8-second live poll, kept at a stable cadence independent of pagination —
  // reads the latest fetchers via a ref so navigating a page doesn't reset
  // the interval's countdown.
  const fetchersRef = useRef({ fetchActive, fetchCompleted, fetchVoided });
  useEffect(() => { fetchersRef.current = { fetchActive, fetchCompleted, fetchVoided }; });
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchersRef.current.fetchActive();
      void fetchersRef.current.fetchCompleted();
      void fetchersRef.current.fetchVoided();
    }, 8_000);
    return () => clearInterval(id);
  }, []);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchActive(), fetchCompleted(), fetchVoided()]);
    setLoading(false);
  }, [fetchActive, fetchCompleted, fetchVoided]);

  const isPos = source === "pos";
  const heading = isPos ? "POS Orders" : "Dine-in Orders";
  const HeadIcon = isPos ? Tablet : UtensilsCrossed;
  const noun = isPos ? "POS" : "dine-in";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
            <HeadIcon size={18} />
          </div>
          <div className="flex flex-col leading-snug">
            <h2 className="font-bold text-gray-900 text-lg leading-tight">{heading} · Today / Ongoing</h2>
            <span className="text-[11px] font-semibold text-gray-400 mt-0.5">Live · read-only · ongoing orders &amp; today&apos;s completed / voided / refunded</span>
          </div>
        </div>
        <button
          onClick={() => void handleRefresh()}
          disabled={loading}
          className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition bg-white"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Active now" value={activeTotalCount} sub={activeTotalCount === 0 ? "All clear" : "in progress"} icon={<ShoppingBag size={16} />} accent="orange" />
        <StatCard label="Completed today" value={completedTotalCount} sub="orders" icon={<CheckCircle2 size={16} />} accent="green" />
        <StatCard label="Earned today" value={`${sym}${completedTotal.toFixed(2)}`} sub="completed orders" icon={<TrendingUp size={16} />} accent="purple" />
      </div>

      {/* Active orders */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          <p className="text-sm font-bold text-gray-700">Active orders</p>
          {activeTotalCount > 0 && <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{activeTotalCount}</span>}
        </div>
        {activeOrders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-14 text-center">
            <HeadIcon size={36} className="mx-auto text-gray-200 mb-2.5" />
            <p className="font-semibold text-gray-400">No active {noun} orders</p>
            <p className="text-sm text-gray-300 mt-1">New orders appear here automatically.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {activeOrders.map((o) => <OrderCard key={o.id} o={o} source={source} sym={sym} onViewReceipt={setViewingReceipt} />)}
          </div>
        )}
      </div>

      {/* Completed today */}
      {completedTotalCount > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500" />
            <p className="text-sm font-bold text-gray-700">Completed today</p>
            <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{completedTotalCount}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {completedOrders.map((o) => <OrderCard key={o.id} o={o} source={source} sym={sym} onViewReceipt={setViewingReceipt} />)}
          </div>
          {completedTotalPages > 1 && <Pager page={completedPage} totalPages={completedTotalPages} onChange={setCompletedPage} />}
        </div>
      )}

      {/* Voided / refunded today */}
      {voidedTotalCount > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Ban size={14} className="text-red-400" />
            <p className="text-sm font-bold text-gray-700">Voided / refunded today</p>
            <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{voidedTotalCount}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {voidedOrders.map((o) => <OrderCard key={o.id} o={o} source={source} sym={sym} onViewReceipt={setViewingReceipt} />)}
          </div>
          {voidedTotalPages > 1 && <Pager page={voidedPage} totalPages={voidedTotalPages} onChange={setVoidedPage} />}
        </div>
      )}

      {/* Receipt modal */}
      {viewingReceipt && (
        <ReceiptModal
          order={{
            id: (() => {
              const note = viewingReceipt.note || "";
              if (source === "pos") {
                // Extracts "R1002" from "... Receipt: R1002"
                const match = note.match(/Receipt:\s*(\S+)/);
                return match ? match[1] : (viewingReceipt.id);
              }
              if (source === "dine-in") {
                // Extracts "T1" from "... Table T1 ..." using your lib helper
                const label = parseTableLabelFromNote(note);
                return label ? `Table ${label}` : (viewingReceipt.id);
              }
              // Online orders use the standard order number
              return (viewingReceipt.id);
            })(),
            date: viewingReceipt.date,
            status: viewingReceipt.status,
            fulfillment: viewingReceipt.fulfillment || "collection",
            paymentMethod: viewingReceipt.payment_method || "cash",
            paymentStatus: viewingReceipt.payment_status,
            total: viewingReceipt.total,
            items: viewingReceipt.items || [],
            note: viewingReceipt.note || undefined,
            // Financial fields — present only when the orders query selects them.
            deliveryFee: viewingReceipt.delivery_fee || 0,
            serviceFee: viewingReceipt.service_fee || 0,
            discountAmount: viewingReceipt.discount_amount || 0,
            discountNote: viewingReceipt.discount_note || undefined,
            couponDiscount: viewingReceipt.coupon_discount || 0,
            couponCode: viewingReceipt.coupon_code || undefined,
            vatAmount: viewingReceipt.vat_amount || 0,
            vatInclusive: viewingReceipt.vat_inclusive ?? true,
            tipAmount: viewingReceipt.tip_amount || 0,
            storeCreditUsed: viewingReceipt.store_credit_used || 0,
            giftCardUsed: viewingReceipt.gift_card_used || 0,
            address: viewingReceipt.address || undefined,
            scheduledTime: viewingReceipt.scheduled_time || undefined,
            tableLabel: viewingReceipt.table_label || undefined,
            staffName: viewingReceipt.staff_name || undefined,
          } as unknown as Order}

          customer={{
            id: viewingReceipt.customer_id || "guest",
            name: viewingReceipt.customer?.name || "Guest Customer",
            phone: viewingReceipt.customer?.phone || "",
          } as unknown as Customer}
          onClose={() => setViewingReceipt(null)}
        />
      )}
    </div>
  );
}
