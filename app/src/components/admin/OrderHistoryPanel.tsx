"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { fullOrderNumber } from "@/lib/orderNumber";
import { parseTableLabelFromNote } from "@/lib/tableLabel";
import {
  Circle, CheckCircle2, ChefHat, Package, Truck, Ban,
  RefreshCw, Search, Bike, ShoppingBag, Tablet, UtensilsCrossed, ClipboardList,
  Receipt,
} from "lucide-react";
import { ReceiptModal } from "./ReceiptModal";

type RangePreset = "all" | "today" | "7d" | "30d" | "custom";

// Read-only all-time order history, split into the four real order sources:
// Delivery / Collection (online), Walk-in (POS counter), Dine-in (table
// service). The three operational boards show *today*; this is the browsable
// archive across all dates. No management controls.

const POS_CUSTOMER_ID = "pos-walk-in";

type SourceTab = "delivery" | "collection" | "walk-in" | "dine-in";

interface RawOrder {
  id: string;
  date: string;
  status: string;
  payment_status: string | null;
  total: number;
  items: { name: string; qty: number; price: number; selectedVariations?: { variationId: string; optionId: string; label: string }[]; selectedAddOns?: { id: string; name: string; price: number }[]; }[] | null;
  note: string | null;
  fulfillment: string | null;
  payment_method: string | null;
  customer_id: string | null;
  customer?: { name?: string | null } | null;
}

// A refunded order must surface both states — a bare "Cancelled" or
// "Completed" badge hides the fact that the customer's money already went
// back (QA #37). Refund state lives on payment_status (dine-in refunds keep
// status "delivered").
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

const TAB_ACCENT: Record<SourceTab, string> = {
  delivery: "bg-blue-50 text-blue-500",
  collection: "bg-purple-50 text-purple-500",
  "walk-in": "bg-orange-50 text-orange-500",
  "dine-in": "bg-teal-50 text-teal-500",
};

const TABS: { id: SourceTab; label: string; icon: React.ReactNode }[] = [
  { id: "delivery", label: "Delivery", icon: <Bike size={14} /> },
  { id: "collection", label: "Collection", icon: <ShoppingBag size={14} /> },
  { id: "walk-in", label: "Walk-in", icon: <Tablet size={14} /> },
  { id: "dine-in", label: "Dine-in", icon: <UtensilsCrossed size={14} /> },
];

function classify(o: RawOrder): SourceTab {
  if (o.fulfillment === "dine-in") return "dine-in";
  if (o.customer_id === POS_CUSTOMER_ID) return "walk-in"; // POS counter mirror
  if (o.fulfillment === "delivery") return "delivery";
  return "collection";
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Friendly label per source — table # / receipt # / customer name / order #.
function orderLabel(o: RawOrder, tab: SourceTab): string {
  const note = o.note ?? "";
  if (tab === "dine-in") {
    const label = parseTableLabelFromNote(note);
    return label ? `Table ${label}` : "Dine-in";
  }
  if (tab === "walk-in") {
    const m = note.match(/Receipt:\s*(\S+)/);
    return m ? `Receipt ${m[1]}` : fullOrderNumber(o.id);
  }
  return o.customer?.name?.trim() || fullOrderNumber(o.id);
}

export default function OrderHistoryPanel() {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const [orders, setOrders] = useState<RawOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<SourceTab>("delivery");
  const [search, setSearch] = useState("");
  // Date-range filter. preset drives the from/to bounds; "custom" reveals the
  // date inputs. Bounds are passed to the API so old ranges aren't capped by
  // the recent-rows limit.
  const [preset, setPreset] = useState<RangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const lastKey = useRef<string>("");

  // State for receipt modal
  const [viewingReceipt, setViewingReceipt] = useState<RawOrder | null>(null);

  // Resolve the preset into ISO from/to bounds (local-day aligned).
  const { fromISO, toISO } = useMemo(() => {
    const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
    const now = new Date();
    if (preset === "today") return { fromISO: startOfDay(now).toISOString(), toISO: endOfDay(now).toISOString() };
    if (preset === "7d") { const f = new Date(now); f.setDate(f.getDate() - 6); return { fromISO: startOfDay(f).toISOString(), toISO: endOfDay(now).toISOString() }; }
    if (preset === "30d") { const f = new Date(now); f.setDate(f.getDate() - 29); return { fromISO: startOfDay(f).toISOString(), toISO: endOfDay(now).toISOString() }; }
    if (preset === "custom") {
      return {
        fromISO: customFrom ? startOfDay(new Date(customFrom)).toISOString() : null,
        toISO: customTo ? endOfDay(new Date(customTo)).toISOString() : null,
      };
    }
    return { fromISO: null as string | null, toISO: null as string | null };
  }, [preset, customFrom, customTo]);

  const fetchOrders = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      // All sources for the selected range (most recent first). Single fetch →
      // instant tab switching client-side. from/to scope the DB query so older
      // ranges aren't truncated by the recent-rows cap.
      const params = new URLSearchParams({ limit: "5000" });
      if (fromISO) params.set("from", fromISO);
      if (toISO) params.set("to", toISO);
      const r = await fetch(`/api/admin/orders?${params}`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; orders?: RawOrder[] };
      if (json.ok) {
        const next = json.orders ?? [];
        const key = JSON.stringify(next);
        if (key !== lastKey.current) { lastKey.current = key; setOrders(next); }
      }
    } catch { /* keep last-known */ }
    finally { if (isInitial) setLoading(false); }
  }, [fromISO, toISO]);

  useEffect(() => { fetchOrders(true); }, [fetchOrders]);

  const buckets = useMemo(() => {
    const b: Record<SourceTab, RawOrder[]> = { delivery: [], collection: [], "walk-in": [], "dine-in": [] };
    for (const o of orders) b[classify(o)].push(o);
    return b;
  }, [orders]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = buckets[tab];
    if (!q) return list;
    return list.filter((o) =>
      orderLabel(o, tab).toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) ||
      (o.customer?.name ?? "").toLowerCase().includes(q),
    );
  }, [buckets, tab, search]);

  const tabTotal = rows.reduce((s, o) => s + (o.status === "cancelled" ? 0 : Number(o.total ?? 0)), 0);

  const PRESETS: { id: RangePreset; label: string }[] = [
    { id: "all", label: "All time" },
    { id: "today", label: "Today" },
    { id: "7d", label: "7 days" },
    { id: "30d", label: "30 days" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
            <ClipboardList size={18} />
          </div>
          <div className="flex flex-col leading-snug">
            <h2 className="font-bold text-gray-900 text-lg leading-tight">Order History</h2>
            <span className="text-[11px] font-semibold text-gray-400 mt-0.5">All sources · read-only</span>
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

      {/* Source tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSearch(""); }}
              className={`flex items-center gap-2 pl-2.5 pr-2.5 sm:pr-3 py-2 rounded-xl text-sm font-semibold border transition ${isActive
                ? "bg-white border-orange-300 text-gray-900 shadow-sm ring-1 ring-orange-200"
                : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                }`}
            >
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${isActive ? TAB_ACCENT[t.id] : "bg-gray-100 text-gray-400"}`}>
                {t.icon}
              </span>
              {t.label}
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-500"}`}>
                {buckets[t.id].length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Date range filter */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap bg-gray-100 rounded-xl p-1 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${preset === p.id ? "bg-orange-500 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="px-1 sm:px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-300" />
            <span className="text-gray-400 text-xs">→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="px-1 sm:px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-300" />
          </div>
        )}
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search #, name, table, receipt…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-orange-300 transition"
          />
        </div>
      </div>

      {/* Summary line */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">{rows.length} {TABS.find((t) => t.id === tab)?.label.toLowerCase()} order{rows.length !== 1 ? "s" : ""}</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-500">Total <span className="font-bold text-gray-800 tabular-nums">{sym}{tabTotal.toFixed(2)}</span></span>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <RefreshCw size={28} className="mx-auto text-gray-200 mb-2 animate-spin" />
          <p className="text-sm text-gray-400">Loading orders…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <ClipboardList size={36} className="mx-auto text-gray-200 mb-2.5" />
          <p className="font-semibold text-gray-400">No {TABS.find((t) => t.id === tab)?.label.toLowerCase()} orders</p>
          <p className="text-sm text-gray-300 mt-1">Try a wider date range or another source tab.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((o) => {
            const cfg = STATUS_CONFIG[o.status] ?? STATUS_CONFIG.pending;
            const itemCount = (o.items ?? []).reduce((s, i) => s + (i.qty ?? 0), 0);
            const itemSummary = (o.items ?? []).map((i) => {
              const v = i.selectedVariations?.map(v => v.label).join(", ");
              const a = i.selectedAddOns?.map(a => a.name).join(", ");
              const details = [v, a].filter(Boolean).join(" / ");
              return `${i.qty}× ${i.name}${details ? ` (${details})` : ""}`;
            }).join(", ");
            return (
              <div key={o.id} className="relative bg-white rounded-xl border border-gray-100 shadow-sm pl-4 pr-4 py-3.5 flex items-center justify-between gap-3 overflow-hidden hover:border-gray-200 transition">
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 text-sm">{orderLabel(o, tab)}</span>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                      {cfg.icon} {statusLabel(o)}
                    </span>
                    <span className="text-xs text-gray-400">{fmtDateTime(o.date)}</span>
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
                    onClick={() => setViewingReceipt(o)}
                    title="View Receipt"
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 transition-colors border border-gray-200"
                  >
                    <Receipt size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center pt-1">
        {preset === "all"
          ? "Showing the most recent 5,000 orders. Narrow the date range to see older records."
          : "Showing all orders in the selected date range (up to 5,000)."}
      </p>

      {/* Receipt modal */}
      {viewingReceipt && (
        <ReceiptModal
          order={{
            id: viewingReceipt.id,
            date: viewingReceipt.date,
            status: viewingReceipt.status as any,
            fulfillment: viewingReceipt.fulfillment as any || "collection",
            paymentMethod: viewingReceipt.payment_method || "cash",
            paymentStatus: viewingReceipt.payment_status as any,
            total: viewingReceipt.total,
            items: viewingReceipt.items as any || [],
            note: viewingReceipt.note || undefined,
            // Map the missing financial fields
            // If they aren't fetched in `RawOrder`, you may need to add them to your SQL query and RawOrder interface.
            deliveryFee: (viewingReceipt as any).delivery_fee || 0,
            serviceFee: (viewingReceipt as any).service_fee || 0,
            discountAmount: (viewingReceipt as any).discount_amount || 0,
            discountNote: (viewingReceipt as any).discount_note || undefined,
            couponDiscount: (viewingReceipt as any).coupon_discount || 0,
            couponCode: (viewingReceipt as any).coupon_code || undefined,
            vatAmount: (viewingReceipt as any).vat_amount || 0,
            vatInclusive: (viewingReceipt as any).vat_inclusive ?? true,
            tipAmount: (viewingReceipt as any).tip_amount || 0,
            storeCreditUsed: (viewingReceipt as any).store_credit_used || 0,
            giftCardUsed: (viewingReceipt as any).gift_card_used || 0,
            address: (viewingReceipt as any).address || undefined,
            tableLabel: (viewingReceipt as any).table_label || undefined,
            staffName: (viewingReceipt as any).staff_name || undefined,
          } as any} 
          
          customer={{
            id: viewingReceipt.customer_id || "guest",
            name: viewingReceipt.customer?.name || "Guest Customer",
          } as any}
          onClose={() => setViewingReceipt(null)}
        />
      )}
    </div>
  );
}
