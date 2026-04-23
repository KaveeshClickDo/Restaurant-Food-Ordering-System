"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  TrendingUp, ShoppingBag, RotateCcw, Percent, CreditCard,
  Download, Printer, RefreshCw, CalendarDays, ChevronDown,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawOrder {
  id:               string;
  date:             string;
  status:           string;
  total:            number;
  fulfillment:      string;
  refunded_amount:  number | null;
  vat_amount:       number | null;
  vat_inclusive:    boolean | null;
  payment_method:   string | null;
  customer_id:      string;
  items:            { name: string; qty: number; price: number }[];
}

type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "year" | "custom";
type Source  = "all" | "online" | "pos";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCur = (n: number) =>
  "£" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const pct = (n: number, d: number) =>
  d === 0 ? "0%" : (n / d * 100).toFixed(1) + "%";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getPresetRange(p: Preset): [Date, Date] {
  const now   = new Date();
  const today = startOfDay(now);
  switch (p) {
    case "today":     return [today, now];
    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const e = new Date(y);    e.setHours(23, 59, 59, 999);
      return [y, e];
    }
    case "7d": {
      const s = new Date(today); s.setDate(s.getDate() - 6);
      return [s, now];
    }
    case "30d": {
      const s = new Date(today); s.setDate(s.getDate() - 29);
      return [s, now];
    }
    case "month": {
      return [new Date(now.getFullYear(), now.getMonth(), 1), now];
    }
    case "lastMonth": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return [s, e];
    }
    case "year": {
      return [new Date(now.getFullYear(), 0, 1), now];
    }
    default: return [today, now];
  }
}

function fmtPresetLabel(p: Preset): string {
  return { today:"Today", yesterday:"Yesterday", "7d":"Last 7 Days", "30d":"Last 30 Days",
           month:"This Month", lastMonth:"Last Month", year:"This Year", custom:"Custom" }[p];
}

function isPOS(o: RawOrder) {
  return o.customer_id === "pos-walk-in" || String(o.payment_method ?? "").toLowerCase() === "pos";
}

function isActive(o: RawOrder) {
  return o.status !== "cancelled";
}

// Group daily totals for the bar chart
function groupByDay(orders: RawOrder[]): { label: string; revenue: number; count: number }[] {
  const map = new Map<string, { revenue: number; count: number }>();
  for (const o of orders) {
    if (!isActive(o)) continue;
    const key = o.date.slice(0, 10);
    const cur = map.get(key) ?? { revenue: 0, count: 0 };
    map.set(key, { revenue: cur.revenue + o.total, count: cur.count + 1 });
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, d]) => ({
      label: key.slice(5).replace("-", "/"), // MM/DD
      ...d,
    }));
}

function groupByMonth(orders: RawOrder[]): { label: string; revenue: number; count: number }[] {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const map = new Map<string, { revenue: number; count: number }>();
  for (const o of orders) {
    if (!isActive(o)) continue;
    const d = new Date(o.date);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,"0")}`;
    const cur = map.get(key) ?? { revenue: 0, count: 0 };
    map.set(key, { revenue: cur.revenue + o.total, count: cur.count + 1 });
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, d]) => {
      const [, m] = key.split("-");
      return { label: MONTHS[Number(m)], ...d };
    });
}

function dateRangeDays(start: Date, end: Date) {
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, accent, trend,
}: {
  label:  string;
  value:  string;
  sub?:   string;
  icon:   React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
  trend?: "up" | "down" | "neutral";
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon size={16} className="text-white" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-black text-gray-900 tracking-tight">{value}</p>
        {sub && (
          <p className={`text-xs font-medium mt-1 flex items-center gap-1 ${
            trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-gray-400"
          }`}>
            {trend && <TrendIcon size={11} />}
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

function BarChart({ data }: { data: { label: string; revenue: number; count: number }[] }) {
  if (!data.length) return (
    <div className="h-40 flex items-center justify-center text-gray-300 text-sm">
      No orders in this period
    </div>
  );

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const W = 600, H = 200;
  const pad = { t: 12, r: 12, b: 32, l: 52 };
  const cW  = W - pad.l - pad.r;
  const cH  = H - pad.t - pad.b;
  const n   = data.length;
  const slotW = cW / n;
  const barW  = Math.max(4, Math.min(slotW * 0.65, 32));

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
      {/* Gridlines + Y labels */}
      {ticks.map((t) => {
        const y = pad.t + cH * (1 - t);
        const v = maxRev * t;
        return (
          <g key={t}>
            <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="#f3f4f6" strokeWidth={1} />
            <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">
              {v >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${Math.round(v)}`}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const x  = pad.l + i * slotW + slotW / 2 - barW / 2;
        const bH = Math.max(2, (d.revenue / maxRev) * cH);
        const y  = pad.t + cH - bH;
        const showLabel = n <= 14 || i % Math.ceil(n / 14) === 0;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bH} rx={3} fill="#f97316" opacity={0.85}>
              <title>{d.label} · {fmtCur(d.revenue)} · {d.count} order{d.count !== 1 ? "s" : ""}</title>
            </rect>
            {showLabel && (
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#6b7280">
                {d.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Axes */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + cH} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={pad.l} y1={pad.t + cH} x2={W - pad.r} y2={pad.t + cH} stroke="#e5e7eb" strokeWidth={1} />
    </svg>
  );
}

function HBar({ label, value, total, color, fmt }: {
  label: string; value: number; total: number; color: string; fmt?: (v: number) => string;
}) {
  const width = total === 0 ? 0 : Math.round((value / total) * 100);
  const display = fmt ? fmt(value) : String(value);
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600 w-32 flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
        <div className={`${color} h-full rounded-full transition-all duration-500`} style={{ width: `${width}%` }} />
      </div>
      <div className="text-right flex-shrink-0 w-28">
        <span className="text-sm font-semibold text-gray-800">{display}</span>
        <span className="text-xs text-gray-400 ml-1.5">{width}%</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PRESETS: Preset[] = ["today", "yesterday", "7d", "30d", "month", "lastMonth", "year", "custom"];
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-400", confirmed: "bg-blue-400", preparing: "bg-orange-400",
  ready: "bg-indigo-400", delivered: "bg-emerald-500", cancelled: "bg-gray-300",
  refunded: "bg-red-400", partially_refunded: "bg-pink-400",
};

export default function OnlineReportsPanel() {
  const [preset,      setPreset]      = useState<Preset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd,   setCustomEnd]   = useState("");
  const [source,      setSource]      = useState<Source>("all");
  const [orders,      setOrders]      = useState<RawOrder[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  // ── Date range ─────────────────────────────────────────────────────────────

  const [startDate, endDate] = useMemo((): [Date, Date] => {
    if (preset === "custom" && customStart && customEnd) {
      return [new Date(customStart + "T00:00:00"), new Date(customEnd + "T23:59:59")];
    }
    return getPresetRange(preset);
  }, [preset, customStart, customEnd]);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("id, date, status, total, fulfillment, refunded_amount, vat_amount, vat_inclusive, payment_method, customer_id, items")
      .gte("date", startDate.toISOString())
      .lte("date", endDate.toISOString())
      .order("date", { ascending: true });

    if (!error && data) {
      setOrders(data as RawOrder[]);
      setLastFetched(new Date());
    }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // ── Filter by source ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (source === "online") return orders.filter((o) => !isPOS(o));
    if (source === "pos")    return orders.filter((o) => isPOS(o));
    return orders;
  }, [orders, source]);

  // ── Computed metrics ───────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const active    = filtered.filter(isActive);
    const cancelled = filtered.filter((o) => o.status === "cancelled");
    const revenue   = active.reduce((s, o) => s + o.total, 0);
    const refunds   = active.reduce((s, o) => s + (o.refunded_amount ?? 0), 0);
    const vat       = active.reduce((s, o) => s + (o.vat_amount ?? 0), 0);
    const netRev    = revenue - refunds;
    const count     = active.length;
    const aov       = count === 0 ? 0 : revenue / count;

    // Payment methods
    const payMap = new Map<string, { revenue: number; count: number }>();
    for (const o of active) {
      const key = o.payment_method || "Unknown";
      const cur = payMap.get(key) ?? { revenue: 0, count: 0 };
      payMap.set(key, { revenue: cur.revenue + o.total, count: cur.count + 1 });
    }
    const payMethods = [...payMap.entries()]
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .map(([method, d]) => ({ method, ...d }));

    // Status breakdown
    const statusMap = new Map<string, number>();
    for (const o of filtered) {
      statusMap.set(o.status, (statusMap.get(o.status) ?? 0) + 1);
    }
    const statuses = [...statusMap.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([status, count]) => ({ status, count }));

    // Fulfilment split
    const delivery   = active.filter((o) => o.fulfillment === "delivery").length;
    const collection = active.filter((o) => o.fulfillment === "collection").length;

    return { revenue, refunds, vat, netRev, count, aov, payMethods, statuses, delivery, collection,
             cancelledCount: cancelled.length };
  }, [filtered]);

  // ── Chart data ─────────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    const days = dateRangeDays(startDate, endDate);
    return days > 90 ? groupByMonth(filtered) : groupByDay(filtered);
  }, [filtered, startDate, endDate]);

  // ── Export CSV ─────────────────────────────────────────────────────────────

  function exportCSV() {
    const rows = [
      ["Date", "Order ID", "Status", "Source", "Fulfilment", "Total (£)", "Refunded (£)", "VAT (£)", "Net (£)", "Payment Method"],
      ...filtered.map((o) => [
        new Date(o.date).toLocaleDateString("en-GB"),
        o.id,
        o.status,
        isPOS(o) ? "POS" : "Online",
        o.fulfillment,
        o.total.toFixed(2),
        (o.refunded_amount ?? 0).toFixed(2),
        (o.vat_amount ?? 0).toFixed(2),
        (o.total - (o.refunded_amount ?? 0)).toFixed(2),
        o.payment_method ?? "",
      ]),
    ];
    const csv  = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `finance-report-${startDate.toISOString().slice(0, 10)}-to-${endDate.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const days = dateRangeDays(startDate, endDate);

  return (
    <div className="space-y-6">

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-center gap-3">

        {/* Preset picker */}
        <div className="relative">
          <button
            onClick={() => setShowPresetMenu((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition"
          >
            <CalendarDays size={15} className="text-orange-500" />
            {fmtPresetLabel(preset)}
            <ChevronDown size={14} />
          </button>
          {showPresetMenu && (
            <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[160px]">
              {PRESETS.filter((p) => p !== "custom").map((p) => (
                <button
                  key={p}
                  onClick={() => { setPreset(p); setShowPresetMenu(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition ${
                    preset === p ? "text-orange-600 font-semibold" : "text-gray-700"
                  }`}
                >
                  {fmtPresetLabel(p)}
                </button>
              ))}
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => { setPreset("custom"); setShowPresetMenu(false); }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition ${
                  preset === "custom" ? "text-orange-600 font-semibold" : "text-gray-700"
                }`}
              >
                Custom range…
              </button>
            </div>
          )}
        </div>

        {/* Custom date inputs */}
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-300" />
            <span className="text-gray-400 text-sm">→</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-300" />
          </div>
        )}

        {/* Source filter */}
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm font-medium">
          {(["all", "online", "pos"] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`px-3 py-2 transition ${
                source === s
                  ? "bg-orange-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s === "all" ? "All Orders" : s === "online" ? "Online" : "POS"}
            </button>
          ))}
        </div>

        {/* Spacer + actions */}
        <div className="ml-auto flex items-center gap-2">
          {lastFetched && (
            <span className="text-xs text-gray-400 hidden sm:block">
              Updated {lastFetched.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-100 transition disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition"
          >
            <Download size={13} />
            CSV
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 text-white text-sm font-semibold hover:bg-gray-700 transition"
          >
            <Printer size={13} />
            Print
          </button>
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard
          label="Gross Revenue"
          value={fmtCur(metrics.revenue)}
          sub={`${metrics.count} order${metrics.count !== 1 ? "s" : ""} · avg ${fmtCur(metrics.aov)}`}
          icon={TrendingUp}
          accent="bg-orange-500"
        />
        <StatCard
          label="Net Revenue"
          value={fmtCur(metrics.netRev)}
          sub={`After ${fmtCur(metrics.refunds)} in refunds`}
          icon={TrendingUp}
          accent="bg-emerald-500"
          trend={metrics.refunds > 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Total Orders"
          value={String(metrics.count + metrics.cancelledCount)}
          sub={`${metrics.cancelledCount} cancelled · ${metrics.count} completed`}
          icon={ShoppingBag}
          accent="bg-blue-500"
        />
        <StatCard
          label="Average Order"
          value={fmtCur(metrics.aov)}
          sub={`Over ${metrics.count} order${metrics.count !== 1 ? "s" : ""}`}
          icon={CreditCard}
          accent="bg-violet-500"
        />
        <StatCard
          label="Total Refunds"
          value={fmtCur(metrics.refunds)}
          sub={pct(metrics.refunds, metrics.revenue) + " refund rate"}
          icon={RotateCcw}
          accent="bg-red-500"
          trend={metrics.refunds > 0 ? "down" : "neutral"}
        />
        <StatCard
          label="VAT Collected"
          value={fmtCur(metrics.vat)}
          sub={pct(metrics.vat, metrics.revenue) + " of gross revenue"}
          icon={Percent}
          accent="bg-indigo-500"
        />
      </div>

      {/* ── Revenue over time ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-gray-900">Revenue over time</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {days > 90 ? "Monthly" : "Daily"} totals · {days} day{days !== 1 ? "s" : ""}
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-orange-50 text-orange-600 rounded-lg">
            {fmtCur(metrics.revenue)} total
          </span>
        </div>
        {loading ? (
          <div className="h-44 flex items-center justify-center">
            <RefreshCw size={20} className="animate-spin text-gray-300" />
          </div>
        ) : (
          <BarChart data={chartData} />
        )}
      </div>

      {/* ── Breakdowns ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Order status */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-bold text-gray-900">Orders by status</h3>
          {metrics.statuses.length === 0 ? (
            <p className="text-sm text-gray-400">No data</p>
          ) : (
            <div className="space-y-3">
              {metrics.statuses.map(({ status, count }) => (
                <HBar
                  key={status}
                  label={status.replace("_", " ")}
                  value={count}
                  total={filtered.length}
                  color={STATUS_COLORS[status] ?? "bg-gray-400"}
                  fmt={(v) => `${v} order${v !== 1 ? "s" : ""}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Payment methods */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-bold text-gray-900">Payment methods</h3>
          {metrics.payMethods.length === 0 ? (
            <p className="text-sm text-gray-400">No data</p>
          ) : (
            <div className="space-y-3">
              {metrics.payMethods.map(({ method, revenue }, i) => (
                <HBar
                  key={method}
                  label={method}
                  value={revenue}
                  total={metrics.revenue}
                  color={["bg-orange-400","bg-blue-400","bg-violet-400","bg-emerald-400","bg-pink-400"][i % 5]}
                  fmt={fmtCur}
                />
              ))}
              <div className="pt-2 border-t border-gray-100">
                {metrics.payMethods.map(({ method, count }) => (
                  <p key={method} className="text-xs text-gray-500">
                    {method}: {count} transaction{count !== 1 ? "s" : ""}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* VAT breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-bold text-gray-900">VAT / Tax breakdown</h3>
          <div className="space-y-3">
            {[
              { label: "Gross Revenue",     value: metrics.revenue,          color: "bg-orange-400" },
              { label: "VAT Collected",     value: metrics.vat,              color: "bg-indigo-400" },
              { label: "Net (ex-VAT)",      value: metrics.revenue - metrics.vat, color: "bg-emerald-400" },
            ].map(({ label, value, color }) => (
              <HBar key={label} label={label} value={value} total={metrics.revenue} color={color} fmt={fmtCur} />
            ))}
          </div>
          <div className="mt-2 bg-indigo-50 rounded-xl p-3">
            <p className="text-xs text-indigo-700 font-semibold">VAT Due to HMRC</p>
            <p className="text-xl font-black text-indigo-800 mt-0.5">{fmtCur(metrics.vat)}</p>
            <p className="text-xs text-indigo-600 mt-1">
              {pct(metrics.vat, metrics.revenue)} of gross · based on declared VAT per order
            </p>
          </div>
        </div>

        {/* Fulfilment split */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-bold text-gray-900">Fulfilment split</h3>
          <div className="space-y-3">
            <HBar
              label="Delivery"
              value={metrics.delivery}
              total={metrics.count}
              color="bg-blue-400"
              fmt={(v) => `${v} order${v !== 1 ? "s" : ""}`}
            />
            <HBar
              label="Collection"
              value={metrics.collection}
              total={metrics.count}
              color="bg-emerald-400"
              fmt={(v) => `${v} order${v !== 1 ? "s" : ""}`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[
              { label: "Delivery", value: metrics.delivery, color: "text-blue-600", bg: "bg-blue-50" },
              { label: "Collection", value: metrics.collection, color: "text-emerald-600", bg: "bg-emerald-50" },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                <p className={`text-2xl font-black ${color}`}>{value}</p>
                <p className={`text-xs font-semibold ${color} opacity-80 mt-0.5`}>{label}</p>
                <p className="text-xs text-gray-400">{pct(value, metrics.count)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Refunds detail ────────────────────────────────────────────────── */}
      {metrics.refunds > 0 && (() => {
        const refunded = filtered.filter((o) => (o.refunded_amount ?? 0) > 0);
        return (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Refunds detail</h3>
              <span className="text-sm font-semibold text-red-600">{fmtCur(metrics.refunds)} total refunded</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="pb-2 pr-4 font-semibold">Date</th>
                    <th className="pb-2 pr-4 font-semibold">Order ID</th>
                    <th className="pb-2 pr-4 font-semibold">Status</th>
                    <th className="pb-2 pr-4 font-semibold text-right">Order Total</th>
                    <th className="pb-2 font-semibold text-right">Refunded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {refunded.map((o) => (
                    <tr key={o.id} className="hover:bg-gray-50 transition">
                      <td className="py-2.5 pr-4 text-gray-500">
                        {new Date(o.date).toLocaleDateString("en-GB")}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-gray-500">
                        #{o.id.slice(-8).toUpperCase()}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold text-white ${STATUS_COLORS[o.status] ?? "bg-gray-400"}`}>
                          {o.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold">{fmtCur(o.total)}</td>
                      <td className="py-2.5 text-right font-semibold text-red-600">
                        −{fmtCur(o.refunded_amount ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td colSpan={4} className="pt-3 text-right text-sm font-bold text-gray-700">Total refunded</td>
                    <td className="pt-3 text-right font-black text-red-600">{fmtCur(metrics.refunds)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Summary footer ────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-5 text-white">
        <h3 className="font-bold text-sm text-gray-300 uppercase tracking-widest mb-4">Period Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Gross Revenue",   value: fmtCur(metrics.revenue) },
            { label: "Total Refunds",   value: fmtCur(metrics.refunds) },
            { label: "VAT Due",         value: fmtCur(metrics.vat) },
            { label: "Net Revenue",     value: fmtCur(metrics.netRev) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-gray-400 font-medium">{label}</p>
              <p className="text-xl font-black mt-0.5">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-4">
          {fmtPresetLabel(preset)} · {startDate.toLocaleDateString("en-GB")}–{endDate.toLocaleDateString("en-GB")} ·{" "}
          {source === "all" ? "All sources" : source === "online" ? "Online orders only" : "POS orders only"}
        </p>
      </div>

    </div>
  );
}
