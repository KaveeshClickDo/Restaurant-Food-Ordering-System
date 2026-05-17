"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CreditCard, Search, ExternalLink, RotateCcw,
  ArrowDownCircle, FileText, DollarSign, Loader2, AlertCircle,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { PaymentStatusBadge, StripeIntentLink } from "@/components/admin/PaymentStatusBadge";
import type { PaymentStatus } from "@/types";

/**
 * PaymentsPanel — admin transaction history for money that actually moved.
 *
 * Lists every order with payment_status in (paid, refunded, partially_refunded)
 * — the same set the /api/admin/payments route returns. Cash orders that are
 * still unpaid never appear here; once a cashier marks one as paid they will.
 *
 * For Stripe transactions the PaymentIntent id is rendered as a clickable
 * link to the Stripe Dashboard so the admin can pull up the full charge
 * record (CVC check, AVS, dispute status, etc.) without context-switching.
 */

interface PaymentRow {
  id: string;
  date: string;
  total: number;
  payment_method: string | null;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  refunded_amount: number | null;
  refunds: unknown[];
  status: string;
  fulfillment: string;
  customer_id: string;
  customers: { name: string; email: string } | null;
}

type StatusFilter = "all" | "paid" | "refunded" | "partially_refunded";

export default function PaymentsPanel() {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";

  const [rows,     setRows]     = useState<PaymentRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [search,   setSearch]   = useState("");
  const [filter,   setFilter]   = useState<StatusFilter>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/admin/payments?limit=500", { cache: "no-store" });
        const j = await r.json() as { ok: boolean; payments?: PaymentRow[]; error?: string };
        if (!cancelled) {
          if (!j.ok) setError(j.error ?? "Could not load payments.");
          else       setRows(j.payments ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const paidRows    = rows.filter((r) => r.payment_status === "paid");
    const refundedRows = rows.filter((r) => r.payment_status === "refunded" || r.payment_status === "partially_refunded");
    const totalGross  = rows.reduce((s, r) => s + Number(r.total), 0);
    const totalNet    = rows.reduce((s, r) => s + Number(r.total) - Number(r.refunded_amount ?? 0), 0);
    const refundedSum = rows.reduce((s, r) => s + Number(r.refunded_amount ?? 0), 0);
    const stripeCount = rows.filter((r) => r.stripe_payment_intent_id).length;
    return {
      txCount:    rows.length,
      paidCount:  paidRows.length,
      refundedCount: refundedRows.length,
      stripeCount,
      totalGross, totalNet, refundedSum,
    };
  }, [rows]);

  // ── Filter ──────────────────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchFilter = filter === "all" || r.payment_status === filter;
      if (!matchFilter) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        (r.customers?.name?.toLowerCase().includes(q) ?? false) ||
        (r.customers?.email?.toLowerCase().includes(q) ?? false) ||
        (r.payment_method ?? "").toLowerCase().includes(q) ||
        (r.stripe_payment_intent_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, filter]);

  const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all",                 label: "All" },
    { value: "paid",                label: "Paid" },
    { value: "partially_refunded",  label: "Partial refund" },
    { value: "refunded",            label: "Refunded" },
  ];

  return (
    <div className="space-y-6">
      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Gross collected",  value: fmt(stats.totalGross, sym),  icon: <DollarSign size={18} />,   color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
          { label: "Net after refunds", value: fmt(stats.totalNet, sym),    icon: <ArrowDownCircle size={18} />, color: "text-blue-600 bg-blue-50 border-blue-100"  },
          { label: "Refunded",          value: fmt(stats.refundedSum, sym), icon: <RotateCcw size={18} />,    color: "text-teal-600 bg-teal-50 border-teal-100"   },
          { label: "Stripe charges",    value: stats.stripeCount,           icon: <CreditCard size={18} />,   color: "text-indigo-600 bg-indigo-50 border-indigo-100" },
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

      {/* ── Search + filter ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order ID, customer, payment method, or Stripe PI…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
                filter === value
                  ? "bg-indigo-500 text-white border-indigo-500"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-16 text-center text-gray-400">
          <Loader2 size={28} className="mx-auto mb-3 animate-spin" />
          <p className="text-sm">Loading payments…</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Could not load payment history</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && displayed.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-16 text-center text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-20" />
          <p className="font-semibold text-gray-500">No payments to show</p>
          <p className="text-sm mt-1">
            {search || filter !== "all"
              ? "Try adjusting your search or filter."
              : "Once a customer pays by card or staff marks a cash order paid, it will appear here."}
          </p>
        </div>
      )}

      {!loading && !error && displayed.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500">
              {displayed.length} transaction{displayed.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Date</th>
                  <th className="px-5 py-3 text-left font-semibold">Order</th>
                  <th className="px-5 py-3 text-left font-semibold">Customer</th>
                  <th className="px-5 py-3 text-left font-semibold">Method</th>
                  <th className="px-5 py-3 text-left font-semibold">Stripe</th>
                  <th className="px-5 py-3 text-left font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Gross</th>
                  <th className="px-5 py-3 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.map((r) => {
                  const refunded = Number(r.refunded_amount ?? 0);
                  const net = Number(r.total) - refunded;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 transition">
                      <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">
                        {fmtDateTime(r.date)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-500">
                        #{r.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-gray-800 text-sm truncate max-w-[180px]">
                          {r.customers?.name ?? "Guest"}
                        </p>
                        {r.customers?.email && (
                          <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{r.customers.email}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600 text-xs">
                        {r.payment_method ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        {r.stripe_payment_intent_id ? (
                          <span className="inline-flex items-center gap-1">
                            <StripeIntentLink paymentIntentId={r.stripe_payment_intent_id} />
                            <ExternalLink size={9} className="text-indigo-400" />
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <PaymentStatusBadge status={r.payment_status} />
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900">
                        {sym}{Number(r.total).toFixed(2)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`font-semibold ${refunded > 0 ? "text-teal-600" : "text-gray-700"}`}>
                          {sym}{net.toFixed(2)}
                        </span>
                        {refunded > 0 && (
                          <p className="text-[10px] text-teal-500">−{sym}{refunded.toFixed(2)} refunded</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(n: number, sym: string) {
  return `${sym}${n.toFixed(2)}`;
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}
