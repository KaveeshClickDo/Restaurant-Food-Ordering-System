"use client";

import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import type { Order, Refund, RefundMethod } from "@/types";
import {
  RotateCcw, Search, ChevronDown, ChevronUp, X,
  AlertCircle, CheckCircle2, Clock, DollarSign,
  FileText, CreditCard, Banknote, Gift,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const REFUND_REASONS = [
  "Customer request",
  "Wrong item delivered",
  "Missing item",
  "Quality issue",
  "Overcharged / incorrect total",
  "Duplicate payment",
  "Order cancelled after payment",
  "Other",
] as const;

const METHOD_CONFIG: Record<RefundMethod, { label: string; icon: React.ReactNode; desc: string }> = {
  original_payment: {
    label: "Original payment method",
    icon: <CreditCard size={14} />,
    desc: "Return to the card / PayPal used at checkout",
  },
  store_credit: {
    label: "Store credit",
    icon: <Gift size={14} />,
    desc: "Credit added to the customer's account",
  },
  cash: {
    label: "Cash",
    icon: <Banknote size={14} />,
    desc: "Hand cash back in person",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function fmtAmt(n: number) {
  return `£${n.toFixed(2)}`;
}

type EligibleFilter = "all" | "delivered" | "partially_refunded" | "refunded";

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    delivered:           "bg-green-100 text-green-700",
    partially_refunded:  "bg-amber-100 text-amber-700",
    refunded:            "bg-teal-100 text-teal-700",
  };
  const label: Record<string, string> = {
    delivered:           "Delivered",
    partially_refunded:  "Partially Refunded",
    refunded:            "Refunded",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg[status] ?? "bg-gray-100 text-gray-600"}`}>
      {label[status] ?? status}
    </span>
  );
}

// ─── Refund history row ───────────────────────────────────────────────────────

function RefundHistoryRow({ refund }: { refund: Refund }) {
  const method = METHOD_CONFIG[refund.method];
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-t border-gray-50 first:border-t-0">
      <div className="flex items-start gap-2 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0 text-teal-600 mt-0.5">
          <RotateCcw size={13} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">
            {refund.type === "full" ? "Full refund" : "Partial refund"} — {fmtAmt(refund.amount)}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{refund.reason}</p>
          {refund.note && (
            <p className="text-xs text-gray-400 mt-0.5 italic">{refund.note}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
            {method.icon}
            {method.label} · {fmtDate(refund.processedAt)} at {fmtTime(refund.processedAt)} · by {refund.processedBy}
          </p>
        </div>
      </div>
      <span className="text-sm font-bold text-teal-700 flex-shrink-0">{fmtAmt(refund.amount)}</span>
    </div>
  );
}

// ─── Order refund card ────────────────────────────────────────────────────────

function OrderRefundCard({
  order,
  customerName,
  onProcess,
}: {
  order: Order;
  customerName: string;
  onProcess: (order: Order, customerName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const refunds = order.refunds ?? [];
  const refundedAmount = order.refundedAmount ?? 0;
  const refundable = Math.max(0, order.total - refundedAmount);
  const isFullyRefunded = order.status === "refunded";

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-gray-400 font-semibold">
              #{order.id.slice(0, 8).toUpperCase()}
            </span>
            <StatusBadge status={order.status} />
            {refunds.length > 0 && (
              <span className="text-[10px] font-semibold bg-teal-50 text-teal-600 border border-teal-100 rounded-full px-2 py-0.5">
                {refunds.length} refund{refunds.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-sm font-bold text-gray-900 mt-1">{customerName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {fmtDate(order.date)} · {order.fulfillment === "delivery" ? "Delivery" : "Collection"}
            {order.paymentMethod && ` · ${order.paymentMethod}`}
          </p>
        </div>

        {/* Amounts */}
        <div className="text-right flex-shrink-0">
          <p className="text-base font-extrabold text-gray-900">{fmtAmt(order.total)}</p>
          {refundedAmount > 0 && (
            <p className="text-xs text-teal-600 font-semibold">{fmtAmt(refundedAmount)} refunded</p>
          )}
          {!isFullyRefunded && refundable > 0 && (
            <p className="text-xs text-gray-400">{fmtAmt(refundable)} refundable</p>
          )}
        </div>
      </div>

      {/* Actions row */}
      <div className="px-5 pb-4 flex items-center gap-2">
        <button
          onClick={() => onProcess(order, customerName)}
          disabled={isFullyRefunded}
          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
            isFullyRefunded
              ? "bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-100"
              : "bg-teal-500 hover:bg-teal-400 text-white"
          }`}
        >
          <RotateCcw size={12} />
          {isFullyRefunded ? "Fully refunded" : "Process refund"}
        </button>

        {refunds.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 font-medium px-2 py-1.5 rounded-lg hover:bg-gray-50 transition"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? "Hide" : "View"} history
          </button>
        )}
      </div>

      {/* Refund history */}
      {expanded && refunds.length > 0 && (
        <div className="px-5 pb-4 border-t border-gray-50">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pt-3 pb-1">
            Refund history
          </p>
          {refunds.map((r) => (
            <RefundHistoryRow key={r.id} refund={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Refund modal ─────────────────────────────────────────────────────────────

function RefundModal({
  order,
  customerName,
  onClose,
  onSubmit,
}: {
  order: Order;
  customerName: string;
  onClose: () => void;
  onSubmit: (refund: Omit<Refund, "id" | "processedAt" | "processedBy">) => void;
}) {
  const refundedAmount = order.refundedAmount ?? 0;
  const maxRefundable = Math.max(0, order.total - refundedAmount);

  const [amount, setAmount]     = useState(maxRefundable.toFixed(2));
  const [reason, setReason]     = useState("");
  const [method, setMethod]     = useState<RefundMethod>("original_payment");
  const [note,   setNote]       = useState("");
  const [errors, setErrors]     = useState<Record<string, string>>({});

  const amountNum = parseFloat(amount) || 0;

  function validate() {
    const e: Record<string, string> = {};
    if (!amount || amountNum <= 0) e.amount = "Enter a refund amount greater than £0.";
    if (amountNum > maxRefundable) e.amount = `Maximum refundable is ${fmtAmt(maxRefundable)}.`;
    if (!reason) e.reason = "Select a reason for this refund.";
    return e;
  }

  function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    onSubmit({
      orderId:  order.id,
      amount:   amountNum,
      type:     amountNum >= maxRefundable ? "full" : "partial",
      reason,
      method,
      note:     note.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="bg-teal-500 px-6 py-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <RotateCcw size={18} className="text-white" />
              <h2 className="text-white font-bold text-lg">Process Refund</h2>
            </div>
            <p className="text-teal-100 text-sm mt-0.5">
              #{order.id.slice(0, 8).toUpperCase()} · {customerName}
            </p>
          </div>
          <button onClick={onClose} className="text-teal-200 hover:text-white transition mt-0.5">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">

          {/* Order summary */}
          <div className="bg-gray-50 rounded-xl px-4 py-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Order total</p>
              <p className="text-sm font-extrabold text-gray-900 mt-0.5">{fmtAmt(order.total)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Already refunded</p>
              <p className="text-sm font-extrabold text-teal-600 mt-0.5">{fmtAmt(refundedAmount)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Refundable</p>
              <p className="text-sm font-extrabold text-gray-900 mt-0.5">{fmtAmt(maxRefundable)}</p>
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-semibold text-gray-700">Refund amount</label>
              <button
                onClick={() => { setAmount(maxRefundable.toFixed(2)); setErrors((e) => ({ ...e, amount: "" })); }}
                className="text-xs text-teal-600 hover:text-teal-700 font-semibold"
              >
                Full refund ({fmtAmt(maxRefundable)})
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">£</span>
              <input
                type="number"
                min="0.01"
                max={maxRefundable}
                step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setErrors((prev) => ({ ...prev, amount: "" })); }}
                className={`w-full pl-8 pr-3 py-2.5 border rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-400 ${errors.amount ? "border-red-400" : "border-gray-200"}`}
                placeholder="0.00"
              />
            </div>
            {errors.amount && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle size={11} /> {errors.amount}
              </p>
            )}
            {amountNum > 0 && amountNum <= maxRefundable && (
              <p className="text-xs text-gray-400 mt-1">
                {amountNum >= maxRefundable ? "Full refund" : `Partial refund — ${fmtAmt(maxRefundable - amountNum)} remaining`}
              </p>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-1.5">Reason <span className="text-red-400">*</span></label>
            <select
              value={reason}
              onChange={(e) => { setReason(e.target.value); setErrors((prev) => ({ ...prev, reason: "" })); }}
              className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white ${errors.reason ? "border-red-400" : "border-gray-200"}`}
            >
              <option value="">Select a reason…</option>
              {REFUND_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {errors.reason && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle size={11} /> {errors.reason}
              </p>
            )}
          </div>

          {/* Method */}
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-2">Refund method</label>
            <div className="space-y-2">
              {(Object.entries(METHOD_CONFIG) as [RefundMethod, typeof METHOD_CONFIG[RefundMethod]][]).map(([key, cfg]) => (
                <label
                  key={key}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition ${
                    method === key
                      ? "border-teal-400 bg-teal-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="refund-method"
                    value={key}
                    checked={method === key}
                    onChange={() => setMethod(key)}
                    className="mt-0.5 accent-teal-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold flex items-center gap-1.5 ${method === key ? "text-teal-700" : "text-gray-700"}`}>
                      {cfg.icon} {cfg.label}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{cfg.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Internal note */}
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-1.5">
              Internal note <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. Customer contacted via email, agreed to refund…"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3">
          <button
            onClick={handleSubmit}
            className="flex-1 bg-teal-500 hover:bg-teal-400 active:bg-teal-600 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2"
          >
            <RotateCcw size={15} />
            Confirm refund {amountNum > 0 && amountNum <= maxRefundable ? `of ${fmtAmt(amountNum)}` : ""}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Success toast ────────────────────────────────────────────────────────────

function SuccessToast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
      <div className="bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-3">
        <CheckCircle2 size={18} className="text-teal-400 flex-shrink-0" />
        <p className="text-sm font-semibold flex-1">{message}</p>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function RefundsPanel() {
  const { customers, addRefund } = useApp();

  const [search,      setSearch]      = useState("");
  const [filter,      setFilter]      = useState<EligibleFilter>("all");
  const [modalOrder,  setModalOrder]  = useState<{ order: Order; customerName: string } | null>(null);
  const [toast,       setToast]       = useState<string | null>(null);

  // Flatten all eligible orders across all customers
  const eligibleStatuses = new Set(["delivered", "partially_refunded", "refunded"]);

  const allEligible = useMemo(() => {
    return customers.flatMap((c) =>
      c.orders
        .filter((o) => eligibleStatuses.has(o.status))
        .map((o) => ({ order: o, customerName: c.name, customerId: c.id }))
    ).sort((a, b) => new Date(b.order.date).getTime() - new Date(a.order.date).getTime());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers]);

  // Stats
  const totalRefunded     = allEligible.reduce((s, { order }) => s + (order.refundedAmount ?? 0), 0);
  const fullRefundCount   = allEligible.filter(({ order }) => order.status === "refunded").length;
  const partialCount      = allEligible.filter(({ order }) => order.status === "partially_refunded").length;
  const refundableCount   = allEligible.filter(({ order }) => order.status !== "refunded").length;

  // Filtered + searched
  const displayed = allEligible.filter(({ order, customerName }) => {
    const matchFilter =
      filter === "all" ||
      order.status === filter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      order.id.toLowerCase().includes(q) ||
      customerName.toLowerCase().includes(q) ||
      (order.paymentMethod ?? "").toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  function handleSubmitRefund(fields: Omit<Refund, "id" | "processedAt" | "processedBy">) {
    if (!modalOrder) return;
    const { order, customerId } = allEligible.find((e) => e.order.id === modalOrder.order.id)!;
    const refund: Refund = {
      ...fields,
      id: crypto.randomUUID(),
      processedAt: new Date().toISOString(),
      processedBy: "Admin",
    };
    addRefund(customerId, order.id, refund);
    setModalOrder(null);
    setToast(`Refund of £${fields.amount.toFixed(2)} processed successfully.`);
    setTimeout(() => setToast(null), 4000);
  }

  const FILTER_OPTIONS: { value: EligibleFilter; label: string }[] = [
    { value: "all",                label: "All eligible" },
    { value: "delivered",          label: "Delivered" },
    { value: "partially_refunded", label: "Partially refunded" },
    { value: "refunded",           label: "Fully refunded" },
  ];

  return (
    <div className="space-y-6">

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total refunded",     value: fmtAmt(totalRefunded), icon: <DollarSign size={18} />, color: "text-teal-600 bg-teal-50 border-teal-100" },
          { label: "Full refunds",        value: fullRefundCount,        icon: <RotateCcw size={18} />,  color: "text-blue-600 bg-blue-50 border-blue-100"  },
          { label: "Partial refunds",     value: partialCount,           icon: <Clock size={18} />,      color: "text-amber-600 bg-amber-50 border-amber-100"},
          { label: "Still refundable",    value: refundableCount,        icon: <FileText size={18} />,   color: "text-orange-600 bg-orange-50 border-orange-100" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${color}`}>
              {icon}
            </div>
            <div>
              <p className="text-xl font-extrabold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400 font-medium mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Search + filter ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order ID, customer name, or payment method…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
                filter === value
                  ? "bg-teal-500 text-white border-teal-500"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Order list ─────────────────────────────────────────────────────── */}
      {displayed.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-16 text-center text-gray-400">
          <RotateCcw size={40} className="mx-auto mb-3 opacity-20" />
          <p className="font-semibold text-gray-500">No orders found</p>
          <p className="text-sm mt-1">
            {search || filter !== "all"
              ? "Try adjusting your search or filter."
              : "Refundable orders appear here once orders are delivered."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 font-semibold px-1">
            {displayed.length} order{displayed.length !== 1 ? "s" : ""}
          </p>
          {displayed.map(({ order, customerName }) => (
            <OrderRefundCard
              key={order.id}
              order={order}
              customerName={customerName}
              onProcess={(o, name) => setModalOrder({ order: o, customerName: name })}
            />
          ))}
        </div>
      )}

      {/* ── Refund modal ───────────────────────────────────────────────────── */}
      {modalOrder && (
        <RefundModal
          order={modalOrder.order}
          customerName={modalOrder.customerName}
          onClose={() => setModalOrder(null)}
          onSubmit={handleSubmitRefund}
        />
      )}

      {/* ── Success toast ──────────────────────────────────────────────────── */}
      {toast && <SuccessToast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
