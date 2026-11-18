"use client";

import { useCallback, useEffect, useState } from "react";
import { apiBase } from "@/lib/apiBase";
import {
  ShoppingBag, Banknote, CheckCircle2, RefreshCw, Clock,
  User, Loader2, ChefHat, CalendarClock, AlertCircle,
  History as HistoryIcon, Search, Receipt,
} from "lucide-react";
import { usePOS } from "@/context/POSContext";
import { useConnectivity } from "@/lib/connectivity";
import { fmt, relTime, fmtTime } from "./_utils";
import PaymentModal from "./PaymentModal";
import type { DojoSaleResult } from "@/lib/dojo/types";
import CollectionReceiptModal from "@/components/collection/CollectionReceiptModal";
import type { Customer, Order, PaymentStatus } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CollectionItem {
  name: string;
  qty: number;
  price?: number;
  selectedVariations?: { variationId: string; optionId: string; label: string }[];
  selectedAddOns?: { id: string; name: string; price: number }[];
  specialInstructions?: string;
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
  // Money fields, used only to render the receipt after payment.
  service_fee?: number | null;
  coupon_code?: string | null;
  coupon_discount?: number | null;
  vat_amount?: number | null;
  vat_inclusive?: boolean | null;
  store_credit_used?: number | null;
  gift_card_used?: number | null;
  /** Tip added on the card machine (Dojo's figure), apart from the total. */
  card_tip_amount?: number | null;
}

type Tender = "cash" | "card" | "split";
// Mirrors TENDER_LABEL in lib/collectionOrders.ts (server-only), which is what
// the settle call stores in payment_method.
const TENDER_LABEL: Record<Tender, string> = { cash: "Cash", card: "Card", split: "Split (cash + card)" };

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

// The receipt shown right after payment, or from a History row. Right after a
// settle the call only returns { ok }, so `method` (the tender the staff chose)
// is passed and the receipt uses that + "paid" (the values the server just
// stored). For a History row `method` is left out and the order's own stored
// payment method/status are used instead (also correctly surfaces REFUNDED /
// PAID (partly refunded), which CollectionReceiptModal already renders).
function toReceipt(o: CollectionOrder, method?: Tender, cardTip?: number): { order: Order; customer: Customer } {
  const order: Order = {
    id: o.id,
    customerId: o.customer_id,
    date: o.date,
    status: "delivered",
    fulfillment: "collection",
    total: o.total,
    items: o.items.map((i) => ({
      name: i.name,
      qty: i.qty,
      price: i.price ?? 0,
      selectedVariations: i.selectedVariations,
      selectedAddOns: i.selectedAddOns,
      specialInstructions: i.specialInstructions,
    })),
    note: o.note ?? undefined,
    paymentMethod: method ? TENDER_LABEL[method] : (o.payment_method ?? undefined),
    paymentStatus: method ? "paid" : (o.payment_status as PaymentStatus),
    serviceFee: o.service_fee ?? 0,
    couponCode: o.coupon_code ?? undefined,
    couponDiscount: o.coupon_discount ?? 0,
    vatAmount: o.vat_amount ?? 0,
    vatInclusive: o.vat_inclusive ?? true,
    storeCreditUsed: o.store_credit_used ?? 0,
    giftCardUsed: o.gift_card_used ?? 0,
    cardTipAmount: cardTip ?? Number(o.card_tip_amount ?? 0),
    scheduledTime: o.scheduled_time ?? undefined,
  };
  const customer = {
    id: o.customer_id ?? "guest",
    name: customerName(o),
    phone: o.customers?.phone ?? "",
  } as unknown as Customer;
  return { order, customer };
}

type CollectionScope = "all" | "online" | "walkin";

// ── Component ─────────────────────────────────────────────────────────────────

export default function CollectionView() {
  const { settings, dojoEnabled } = usePOS();
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
  // Receipt for the order just paid. Kept apart from `orders`: settling moves the
  // order off the active board, so the next refresh drops it before the receipt closes.
  const [receipt, setReceipt] = useState<{ order: Order; customer: Customer } | null>(null);

  // Pickups / History sub-tabs — only shown/relevant while scope === "online".
  // Kept apart from `orders`/`refresh` (the active board) so toggling into
  // History never disturbs the All/Walk-in board's own polling.
  const [onlineTab, setOnlineTab] = useState<"pickups" | "history">("pickups");
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("today");
  const [search, setSearch] = useState("");
  const [historyOrders, setHistoryOrders] = useState<CollectionOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const refreshHistory = useCallback(async (showSpinner = false) => {
    if (showSpinner) setHistoryLoading(true);
    try {
      const r = await fetch(`${apiBase()}/api/pos/orders/collection?view=history&period=${period}`, { cache: "no-store" });
      if (!r.ok) { if (showSpinner) setHistoryOrders([]); return; }
      const json = await r.json() as { ok: boolean; orders?: CollectionOrder[] };
      if (json.ok && Array.isArray(json.orders)) setHistoryOrders(json.orders);
    } catch {
      /* network blip — keep last-known list */
    } finally {
      if (showSpinner) setHistoryLoading(false);
    }
  }, [period]);

  // Fetch history on entering it or changing the period — never polled (matches
  // /collection's own History tab: fetch-on-demand only, not live).
  useEffect(() => {
    if (scope === "online" && onlineTab === "history") refreshHistory(true);
  }, [scope, onlineTab, refreshHistory]);

  // Take payment for an unpaid order → settle (paid + delivered + loyalty).
  /** Returns true when saved, else the reason. After a card machine payment a
   *  failed save keeps the payment screen open: it shows the reason and retries
   *  without charging again. */
  async function settlePayment(order: CollectionOrder, method: Tender, dojo?: DojoSaleResult): Promise<true | string> {
    setError("");
    let message: string | null = null;
    let cardTip = 0;
    try {
      const r = await fetch(`${apiBase()}/api/pos/orders/${order.id}/settle`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ paymentMethod: method, ...(dojo ? { dojo } : {}) }),
      });
      const json = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; cardTipAmount?: number };
      if (!r.ok || !json.ok) message = json.error ?? "Could not take payment. Please try again.";
      // A tip added on the card machine, as the server recorded it from Dojo.
      else cardTip = json.cardTipAmount ?? dojo?.tipAmount ?? 0;
    } catch {
      message = "Network error. Please try again.";
    }
    if (message && dojo) return message;
    if (message) {
      setError(message);
    } else {
      setReceipt(toReceipt(order, method, cardTip));
    }
    setPayTarget(null);
    refresh();
    return message ?? true;
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

  // Pickups/History only exist for the "Online" scope — All and Walk-in always
  // show the live board, unchanged.
  const isHistoryView = scope === "online" && onlineTab === "history";
  const historyQ = search.trim().toLowerCase();
  const historyFiltered = historyOrders.filter((o) =>
    !historyQ || customerName(o).toLowerCase().includes(historyQ) || o.id.toLowerCase().includes(historyQ),
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <ShoppingBag size={20} className="text-orange-400" /> Collection Pickups
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            {isHistoryView ? `${historyFiltered.length} completed pickups` : `${filtered.length} active · ${readyCount} ready to collect`}
          </p>
        </div>
        <button
          onClick={() => (isHistoryView ? refreshHistory(true) : refresh(true))}
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

      {/* Pickups / History — only under the Online scope */}
      {scope === "online" && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700">
            {([["pickups", "Pickups", ShoppingBag], ["history", "History", HistoryIcon]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setOnlineTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  onlineTab === id ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {isHistoryView && (
            <>
              {(["today", "7d", "30d"] as const).map((p) => (
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
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
          <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm flex-1">{error}</p>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>
        </div>
      )}

      {isHistoryView ? (
        historyLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading history…
          </div>
        ) : historyFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-600">
            <HistoryIcon size={40} className="mb-3 opacity-40" />
            <p className="text-sm">No completed pickups for this period.</p>
          </div>
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
                <button
                  onClick={() => setReceipt(toReceipt(order))}
                  title="View receipt"
                  aria-label={`View receipt for ${customerName(order)}`}
                  className="flex-shrink-0 flex items-center justify-center gap-1.5 min-h-8 min-w-8 sm:px-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition-colors"
                >
                  <Receipt size={18} />
                </button>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
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
            const isPos     = isPosOrder(order);
            // Walk-ins are settled at the till by definition — rows minted
            // before the mirror stamped payment_status='paid' still carry the
            // legacy 'unpaid' default, so treat POS orders as paid regardless.
            const isPaid    = order.payment_status === "paid" || isPos;
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
          // One instance per order: its card machine payment belongs to this order.
          key={payTarget.id}
          total={payTarget.total}
          currencySymbol={sym}
          isOffline={!isOnline}
          allowGiftCard={false}
          dojoEnabled={dojoEnabled}
          saleReference={`Collection ${payTarget.id}`}
          onClose={() => setPayTarget(null)}
          onComplete={(method, _payments, _cash, _gc, dojo) => {
            const pm = method === "card" ? "card" : method === "split" ? "split" : "cash";
            return settlePayment(payTarget, pm, dojo);
          }}
        />
      )}

      {/* Receipt after payment — Print goes to the Receipt / POS printer, PDF opens the print window. */}
      {receipt && (
        <CollectionReceiptModal
          order={receipt.order}
          customer={receipt.customer}
          printEndpoint="/api/print"
          printCategory="pos"
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}
