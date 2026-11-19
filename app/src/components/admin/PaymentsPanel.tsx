"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreditCard, Search, ExternalLink, RotateCcw,
  ArrowDownCircle, FileText, DollarSign, Loader2, AlertCircle,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { PaymentStatusBadge, StripeIntentLink } from "@/components/admin/PaymentStatusBadge";
import { paymentMethodLabel } from "@/lib/paymentMethodLabel";
import type { PaymentStatus } from "@/types";

/**
 * PaymentsPanel — admin transaction history for money that actually moved.
 *
 * Backed by the admin_payment_transactions SQL view (supabase/schema.sql),
 * which unions online orders, VIP booking fees, and Stripe gift-card sales
 * — see /api/admin/payments. Cash orders that are still unpaid never appear
 * here; once a cashier marks one as paid they will.
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
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  refunded_amount: number | null;
  refunds: unknown[];
  status: string;
  fulfillment: string;
  customer_name: string | null;
  customer_email: string | null;
}

interface Totals {
  txCount: number;
  paidCount: number;
  refundedCount: number;
  stripeCount: number;
  totalGross: number;
  totalNet: number;
  refundedSum: number;
}

const EMPTY_TOTALS: Totals = { txCount: 0, paidCount: 0, refundedCount: 0, stripeCount: 0, totalGross: 0, totalNet: 0, refundedSum: 0 };

type StatusFilter = "all" | "paid" | "refunded" | "partially_refunded";
type RangePreset = "all" | "today" | "7d" | "30d" | "custom";

// This panel is online-only (the view already excludes dine-in / POS
// walk-in orders), so the method label never needs the staffOrder branch —
// it's always false here.
function methodLabel(method: string | null): string {
  return paymentMethodLabel(method, false);
}

export default function PaymentsPanel() {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";

  const [rows,     setRows]     = useState<PaymentRow[]>([]);
  const [totals,   setTotals]   = useState<Totals>(EMPTY_TOTALS);
  const [totalCount, setTotalCount] = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [search,   setSearch]   = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter,   setFilter]   = useState<StatusFilter>("all");
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Date-range filter — same preset pattern as OrderHistoryPanel.
  const [preset, setPreset] = useState<RangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { fromISO, toISO } = useMemo(() => {
    const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const endOfDay   = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
    const now = new Date();
    if (preset === "today") return { fromISO: startOfDay(now).toISOString(), toISO: endOfDay(now).toISOString() };
    if (preset === "7d")  { const f = new Date(now); f.setDate(f.getDate() - 6);  return { fromISO: startOfDay(f).toISOString(), toISO: endOfDay(now).toISOString() }; }
    if (preset === "30d") { const f = new Date(now); f.setDate(f.getDate() - 29); return { fromISO: startOfDay(f).toISOString(), toISO: endOfDay(now).toISOString() }; }
    if (preset === "custom") {
      return {
        fromISO: customFrom ? startOfDay(new Date(customFrom)).toISOString() : null,
        toISO:   customTo   ? endOfDay(new Date(customTo)).toISOString()     : null,
      };
    }
    return { fromISO: null as string | null, toISO: null as string | null };
  }, [preset, customFrom, customTo]);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (filter !== "all") params.set("status", filter);
      if (fromISO) params.set("from", fromISO);
      if (toISO)   params.set("to", toISO);
      if (debouncedSearch) params.set("search", debouncedSearch);
      const r = await fetch(`/api/admin/payments?${params}`, { cache: "no-store" });
      const j = await r.json() as { ok: boolean; payments?: PaymentRow[]; totalCount?: number; totals?: Totals; error?: string };
      if (!j.ok) {
        setError(j.error ?? "Could not load payments.");
      } else {
        setRows(j.payments ?? []);
        setTotalCount(j.totalCount ?? 0);
        setTotals(j.totals ?? EMPTY_TOTALS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filter, fromISO, toISO, debouncedSearch]);

  // Reset to page 1 whenever the filter/date-range/search/page size
  // narrows/widens/reshapes the result set — without firing an extra fetch
  // at the stale page first (same guard used in CustomersPanel/GiftCardsPanel).
  const prevKey = useRef(`${filter}|${fromISO}|${toISO}|${debouncedSearch}|${pageSize}`);
  useEffect(() => {
    const key = `${filter}|${fromISO}|${toISO}|${debouncedSearch}|${pageSize}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      if (page !== 1) { setPage(1); return; }
    }
    void fetchPayments();
  }, [fetchPayments, filter, fromISO, toISO, debouncedSearch, pageSize, page]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all",                 label: "All" },
    { value: "paid",                label: "Paid" },
    { value: "partially_refunded",  label: "Partial refund" },
    { value: "refunded",            label: "Refunded" },
  ];

  const PRESETS: { id: RangePreset; label: string }[] = [
    { id: "all",   label: "All time" },
    { id: "today", label: "Today" },
    { id: "7d",    label: "7 days" },
    { id: "30d",   label: "30 days" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-6">
      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Gross collected",  value: fmt(totals.totalGross, sym),  icon: <DollarSign size={18} />,   color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
          { label: "Net after refunds", value: fmt(totals.totalNet, sym),    icon: <ArrowDownCircle size={18} />, color: "text-blue-600 bg-blue-50 border-blue-100"  },
          { label: "Refunded",          value: fmt(totals.refundedSum, sym), icon: <RotateCcw size={18} />,    color: "text-teal-600 bg-teal-50 border-teal-100"   },
          { label: "Stripe charges",    value: totals.stripeCount,           icon: <CreditCard size={18} />,   color: "text-indigo-600 bg-indigo-50 border-indigo-100" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 sm:px-5 py-4 flex flex-col sm:flex-row md:flex-col xl:flex-row items-start sm:items-center md:items-start xl:items-center gap-3 sm:gap-4">
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${color}`}>
              {icon}
            </div>
            <div>
              <p className="text-lg sm:text-xl font-extrabold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400 font-medium mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Date range ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap bg-gray-100 rounded-xl p-1 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${preset === p.id ? "bg-indigo-500 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="px-1 sm:px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <span className="text-gray-400 text-xs">→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="px-1 sm:px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        )}
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

      {!loading && !error && rows.length === 0 && (
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

      {!loading && !error && rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs font-semibold text-gray-500">
              {totalCount} transaction{totalCount !== 1 ? "s" : ""}
            </p>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Rows
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 pl-2 pr-1 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>{n} per page</option>
                ))}
              </select>
            </label>
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
                {rows.map((r) => {
                  const refunded = Number(r.refunded_amount ?? 0);
                  const net = Number(r.total) - refunded;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 transition">
                      <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">
                        {fmtDateTime(r.date)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                        #{r.id.slice(4, 12).toUpperCase()}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-gray-800 text-sm truncate max-w-[180px]">
                          {r.customer_name ?? "Guest"}
                        </p>
                        {r.customer_email && (
                          <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{r.customer_email}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600 text-xs">
                        {r.payment_method ? methodLabel(r.payment_method) : "—"}
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
                      <td className="px-5 py-3 whitespace-nowrap">
                        <PaymentStatusBadge status={r.payment_status} />
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900 whitespace-nowrap">
                        {sym}{Number(r.total).toFixed(2)}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
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

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
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
