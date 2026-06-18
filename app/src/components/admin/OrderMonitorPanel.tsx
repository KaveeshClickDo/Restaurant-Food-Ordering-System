"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { fullOrderNumber } from "@/lib/orderNumber";
import { parseTableLabelFromNote } from "@/lib/tableLabel";
import {
  Circle, CheckCircle2, ChefHat, Package, Truck, Ban,
  RefreshCw, ShoppingBag, TrendingUp, Clock, UtensilsCrossed, Tablet,
  Receipt,
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
  customer?: { name?: string | null } | null;
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

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

function isToday(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
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

export default function OrderMonitorPanel({ source }: { source: Source }) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const [orders, setOrders] = useState<RawOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const lastKey = useRef<string>("");

  // State for receipt modal
  const [viewingReceipt, setViewingReceipt] = useState<RawOrder | null>(null);

  const fetchOrders = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const r = await fetch(`/api/admin/orders?source=${source}&limit=2000`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; orders?: RawOrder[] };
      if (json.ok) {
        const next = json.orders ?? [];
        const key = JSON.stringify(next);
        if (key !== lastKey.current) { lastKey.current = key; setOrders(next); }
      }
    } catch { /* network blip — keep last-known */ }
    finally { if (isInitial) setLoading(false); }
  }, [source]);

  useEffect(() => { fetchOrders(true); }, [fetchOrders]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchOrders();
    }, 8_000);
    return () => clearInterval(id);
  }, [fetchOrders]);

  // Refund state lives on payment_status (dine-in refunds keep status
  // "delivered").
  const isRefunded = (o: RawOrder) =>
    o.payment_status === "refunded" || o.payment_status === "partially_refunded";

  const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const completedToday = orders.filter((o) => isToday(o.date) && o.status === "delivered" && !isRefunded(o))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const earnedToday = completedToday.reduce((s, o) => s + Number(o.total ?? 0), 0);
  // Voided POS sales land on the mirror order as "cancelled" (with refund state
  // on payment_status); refunded dine-in orders stay "delivered" but carry
  // payment_status. Surface all of them for today.
  const voidedToday = orders.filter((o) => isToday(o.date) && (o.status === "cancelled" || isRefunded(o)))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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
          onClick={() => fetchOrders(true)}
          disabled={loading}
          className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition bg-white"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Active now" value={active.length} sub={active.length === 0 ? "All clear" : "in progress"} icon={<ShoppingBag size={16} />} accent="orange" />
        <StatCard label="Completed today" value={completedToday.length} sub="orders" icon={<CheckCircle2 size={16} />} accent="green" />
        <StatCard label="Earned today" value={`${sym}${earnedToday.toFixed(2)}`} sub="completed orders" icon={<TrendingUp size={16} />} accent="purple" />
      </div>

      {/* Active orders */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          <p className="text-sm font-bold text-gray-700">Active orders</p>
          {active.length > 0 && <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{active.length}</span>}
        </div>
        {active.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-14 text-center">
            <HeadIcon size={36} className="mx-auto text-gray-200 mb-2.5" />
            <p className="font-semibold text-gray-400">No active {noun} orders</p>
            <p className="text-sm text-gray-300 mt-1">New orders appear here automatically.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((o) => <OrderCard key={o.id} o={o} source={source} sym={sym} onViewReceipt={setViewingReceipt} />)}
          </div>
        )}
      </div>

      {/* Completed today */}
      {completedToday.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500" />
            <p className="text-sm font-bold text-gray-700">Completed today</p>
            <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{completedToday.length}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {completedToday.map((o) => <OrderCard key={o.id} o={o} source={source} sym={sym} onViewReceipt={setViewingReceipt} />)}
          </div>
        </div>
      )}

      {/* Voided / refunded today */}
      {voidedToday.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Ban size={14} className="text-red-400" />
            <p className="text-sm font-bold text-gray-700">Voided / refunded today</p>
            <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{voidedToday.length}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {voidedToday.map((o) => <OrderCard key={o.id} o={o} source={source} sym={sym} onViewReceipt={setViewingReceipt} />)}
          </div>
        </div>
      )}

      {/* Receipt modal */}
      {viewingReceipt && (
        <ReceiptModal
          order={{
            id: viewingReceipt.id,
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
            tableLabel: viewingReceipt.table_label || undefined,
            staffName: viewingReceipt.staff_name || undefined,
          } as unknown as Order}

          customer={{
            id: viewingReceipt.customer_id || "guest",
            name: viewingReceipt.customer?.name || "Guest Customer",
          } as unknown as Customer}
          onClose={() => setViewingReceipt(null)}
        />
      )}
    </div>
  );
}
