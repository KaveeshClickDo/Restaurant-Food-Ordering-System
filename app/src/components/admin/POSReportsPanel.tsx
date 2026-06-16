"use client";

import { useState, useEffect, useMemo } from "react";
import {
  TrendingUp, Receipt, BarChart3, Users, Percent, BadgeDollarSign,
  Download, RefreshCw, Tag, CreditCard, Banknote, Shuffle,
  Trophy, Package, ChevronUp, ChevronDown, AlertTriangle, RotateCcw, Crown, Gift,
} from "lucide-react";
import { moneyPaidGross } from "@/lib/giftCardMoney";

interface VipFeeRow {
  id: string;
  created_at: string;
  vip_fee: number;
  payment_method: string | null;
  // "pos:cash" / "admin:card" etc. — the prefix tells a till booking apart from
  // a back-office (admin) booking. Admin bookings belong on the admin finance
  // tab, NOT in POS reports, so we filter them out below.
  payment_ref: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  table_label: string | null;
  date: string | null;
  time: string | null;
}
import { POSSale, POSProduct } from "@/types/pos";
import { useApp } from "@/context/AppContext";

// ─── localStorage helper (still used for POS products — cost data lives only
// on the admin's browser cache today; menu_items table has no `cost` column
// yet, so cost / margin numbers are best-effort until that column is added).

function loadPOS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

// Fetch all POS sales from the DB. The pos_sales table is the source of
// truth — every terminal POSTs through /api/pos/sales, so reports here
// aggregate across all tills regardless of which device the admin is on.
async function fetchAllSales(): Promise<POSSale[]> {
  try {
    // no-store: without it the browser serves the cached sales response, so
    // the Refresh button spins but the numbers never change.
    const res = await fetch("/api/admin/pos-sales?limit=5000", { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json() as { ok: boolean; sales?: POSSale[] };
    return json.ok && Array.isArray(json.sales) ? json.sales : [];
  } catch {
    return [];
  }
}

// VIP booking fees collected at the till (cash/card, no gateway). Lives on the
// reservations row, not in pos_sales — fetch separately and surface as its own
// revenue line in POS reports.
async function fetchPosVipFees(): Promise<VipFeeRow[]> {
  try {
    const res = await fetch("/api/admin/booking-fees?source=pos&limit=2000", { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json() as { ok: boolean; fees?: VipFeeRow[] };
    return json.ok && Array.isArray(json.fees) ? json.fees : [];
  } catch {
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtCur = (n: number, sym = "£") => `${sym}${n.toFixed(2)}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

type Period = "today" | "yesterday" | "week" | "month" | "last30" | "custom";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today",     label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week",      label: "This Week" },
  { id: "month",     label: "This Month" },
  { id: "last30",    label: "Last 30 Days" },
  { id: "custom",    label: "Custom" },
];

function getDateRange(period: Period, customStart: string, customEnd: string): [Date, Date] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Upper bound for open-ended periods is the END of today, not the current
  // instant. Using `now` froze the range at page-load time, so a sale rung up
  // afterwards fell past endDate and never appeared — even after Refresh
  // re-fetched it (QA: "refresh button works but content not updated").
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (period) {
    case "today":     return [today, endOfToday];
    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const ye = new Date(today); ye.setMilliseconds(-1);
      return [y, ye];
    }
    case "week": {
      const w = new Date(today); w.setDate(w.getDate() - 6);
      return [w, endOfToday];
    }
    case "month": return [new Date(today.getFullYear(), today.getMonth(), 1), endOfToday];
    case "last30": { const l = new Date(today); l.setDate(l.getDate() - 29); return [l, endOfToday]; }
    case "custom": return [
      customStart ? new Date(customStart) : new Date(0),
      customEnd   ? new Date(customEnd + "T23:59:59") : endOfToday,
    ];
  }
}

// Build daily buckets for a date range
function buildDailyBuckets(sales: POSSale[], start: Date, end: Date) {
  const map: Record<string, number> = {};
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay  = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= endDay) {
    map[cursor.toDateString()] = 0;
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const s of sales) {
    const key = new Date(s.date).toDateString();
    if (key in map) map[key] = (map[key] ?? 0) + s.total;
  }
  return Object.entries(map).map(([key, revenue]) => {
    const d = new Date(key);
    const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    return { label, revenue };
  });
}

// Build hourly buckets 0-23
function buildHourlyBuckets(sales: POSSale[]) {
  const map: number[] = Array(24).fill(0);
  for (const s of sales) map[new Date(s.date).getHours()] += s.total;
  return map;
}

// CSV export
function exportCSV(sales: POSSale[], sym: string) {
  const header = ["Receipt No","Date","Time","Staff","Customer","Items",`Subtotal (${sym})`,`Discount (${sym})`,`VAT (${sym})`,`Tip (${sym})`,`Service Fee (${sym})`,`Total (${sym})`,"Payment","Voided","Void Reason"].join(",");
  const rows = sales.map((s) => [
    s.receiptNo,
    fmtDate(s.date),
    fmtTime(s.date),
    `"${s.staffName}"`,
    `"${s.customerName ?? ""}"`,
    s.items.length,
    s.subtotal.toFixed(2),
    s.discountAmount.toFixed(2),
    s.taxAmount.toFixed(2),
    s.tipAmount.toFixed(2),
    s.serviceFeeAmount.toFixed(2),
    s.total.toFixed(2),
    s.paymentMethod,
    s.voided ? "Yes" : "No",
    `"${s.voidReason ?? ""}"`,
  ].join(","));
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `pos-report-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color, bg }: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string; bg: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center mb-3`}>
        <Icon size={20} className={color} />
      </div>
      <p className={`text-lg sm:text-xl md:text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-gray-400 text-xs mt-0.5">{sub}</p>}
      <p className="text-gray-500 text-xs mt-1">{label}</p>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function POSReportsPanel() {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const [sales, setSales]       = useState<POSSale[]>([]);
  const [products, setProducts] = useState<POSProduct[]>([]);
  const [vipFees, setVipFees]   = useState<VipFeeRow[]>([]);
  const [loaded, setLoaded]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [period, setPeriod]         = useState<Period>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd,   setCustomEnd]   = useState("");

  type ReportTab = "overview" | "items" | "staff" | "transactions";
  const [tab, setTab] = useState<ReportTab>("overview");

  const [txSearch, setTxSearch]     = useState("");
  const [sortField, setSortField]   = useState<"date" | "total">("date");
  const [sortDir, setSortDir]       = useState<"desc" | "asc">("desc");
  const [showVoided, setShowVoided] = useState(false);

  // Sales come from the DB (pos_sales table) so reports aggregate across all
  // tills. Products are still read from localStorage because the cost field
  // isn't in the menu_items DB schema yet — see comment on loadPOS above.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [fetched, fees] = await Promise.all([fetchAllSales(), fetchPosVipFees()]);
      if (!cancelled) {
        setSales(fetched);
        setVipFees(fees);
        setProducts(loadPOS<POSProduct[]>("pos_products", []));
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const [fetched, fees] = await Promise.all([fetchAllSales(), fetchPosVipFees()]);
      setSales(fetched);
      setVipFees(fees);
      setProducts(loadPOS<POSProduct[]>("pos_products", []));
    } finally {
      setRefreshing(false);
    }
  }

  // ── Date range ──────────────────────────────────────────────────────────────
  const [startDate, endDate] = useMemo(
    () => getDateRange(period, customStart, customEnd),
    [period, customStart, customEnd]
  );

  // ── Filtered sales ──────────────────────────────────────────────────────────
  const inRange = useMemo(() =>
    sales.filter((s) => {
      const d = new Date(s.date);
      return d >= startDate && d <= endDate;
    }), [sales, startDate, endDate]);

  const filtered = useMemo(() => inRange.filter((s) => !s.voided), [inRange]);
  // Money-bearing = sales whose money (partly) stuck: non-voided, PLUS voided
  // sales that were only partially refunded (the retained portion is real
  // revenue). A void with NO refund is a cancelled sale and contributes nothing.
  // Mirrors the POS Dashboard Overview, so a partial refund reduces revenue by
  // the refunded amount — not the whole sale.
  const moneyBearing = useMemo(
    () => inRange.filter((s) => !s.voided || (s.refundAmount ?? 0) > 0),
    [inRange],
  );
  // Net money kept on a sale = money paid (gift card excluded) − refund.
  const saleNet = (s: POSSale) => Math.max(0, moneyPaidGross(s.total, s.giftCardUsed) - (s.refundAmount ?? 0));

  // VIP booking fees collected at the till in the same date window. Back-office
  // (admin) bookings share the cash/card payment_method, so the server's
  // source=pos slice still includes them — exclude any "admin:" prefixed fee
  // here so it lands only on the admin finance tab, not POS reports.
  const vipFeesInRange = useMemo(() =>
    vipFees.filter((f) => {
      if ((f.payment_ref ?? "").startsWith("admin:")) return false;
      const d = new Date(f.created_at);
      return d >= startDate && d <= endDate;
    }), [vipFees, startDate, endDate]);
  const vipFeesTotal = useMemo(
    () => vipFeesInRange.reduce((s, f) => s + Number(f.vip_fee ?? 0), 0),
    [vipFeesInRange],
  );

  // ── KPIs ────────────────────────────────────────────────────────────────────
  // Revenue = real money collected and KEPT. A gift card is prepaid money
  // (income booked when the card is SOLD), so its redeemed portion is netted
  // out; refunds are subtracted so a partial refund only reduces revenue by the
  // amount returned, not the whole sale.
  const revenue       = moneyBearing.reduce((s, x) => s + saleNet(x), 0);
  // Gift card value redeemed in this window — informational reconciliation only
  // (already recognised as income at card sale, so NOT added to revenue).
  const giftCardRedeemed = filtered.reduce((s, x) => s + (x.giftCardUsed ?? 0), 0);
  const taxCollected  = filtered.reduce((s, x) => s + x.taxAmount, 0);
  const tipsTotal     = filtered.reduce((s, x) => s + x.tipAmount, 0);
  const serviceFeesTotal = filtered.reduce((s, x) => s + x.serviceFeeAmount, 0);
  const discountTotal = filtered.reduce((s, x) => s + x.discountAmount, 0);
  const avgOrder      = moneyBearing.length > 0 ? revenue / moneyBearing.length : 0;
  const voidedCount   = inRange.filter((s) => s.voided).length;
  // Bug #1b: refunds were silently hidden — voided sales were dropped from
  // `filtered` and there was no separate refund total. Compute from the voided
  // slice so admin can see how much money went back out.
  const refundedSales = inRange.filter((s) => s.voided && (s.refundAmount ?? 0) > 0);
  const refundedTotal = refundedSales.reduce((sum, s) => sum + (s.refundAmount ?? 0), 0);
  const refundedCount = refundedSales.length;

  // Cost / margin
  const costMap: Record<string, number> = {};
  for (const p of products) if (p.cost) costMap[p.id] = p.cost;
  const totalCost = filtered.reduce((sum, sale) =>
    sum + sale.items.reduce((s, item) => s + (costMap[item.productId] ?? 0) * item.quantity, 0), 0);
  const grossProfit = revenue - totalCost;
  const marginPct   = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

  // ── Payment mix ─────────────────────────────────────────────────────────────
  const payMix = { cash: 0, card: 0, split: 0 };
  for (const s of filtered) { const k = s.paymentMethod as keyof typeof payMix; payMix[k] = (payMix[k] ?? 0) + 1; }
  const payTotal = filtered.length || 1;

  // ── Daily chart ─────────────────────────────────────────────────────────────
  const dailyBuckets = useMemo(() => buildDailyBuckets(filtered, startDate, endDate), [filtered, startDate, endDate]);
  const maxDaily = Math.max(...dailyBuckets.map((d) => d.revenue), 1);

  // ── Hourly heatmap ──────────────────────────────────────────────────────────
  const hourlyBuckets = useMemo(() => buildHourlyBuckets(filtered), [filtered]);
  const maxHourly = Math.max(...hourlyBuckets, 1);

  // ── Best sellers ────────────────────────────────────────────────────────────
  const itemStats: Record<string, { name: string; qty: number; revenue: number }> = {};
  for (const sale of filtered) {
    for (const item of sale.items) {
      if (!itemStats[item.productId]) itemStats[item.productId] = { name: item.name, qty: 0, revenue: 0 };
      itemStats[item.productId].qty += item.quantity;
      itemStats[item.productId].revenue += item.price * item.quantity;
    }
  }
  const bestSellers = Object.values(itemStats).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  const maxItemRev  = bestSellers[0]?.revenue || 1;

  // ── Staff performance ────────────────────────────────────────────────────────
  const staffStats: Record<string, { name: string; sales: number; revenue: number; avgOrder: number }> = {};
  for (const sale of filtered) {
    if (!staffStats[sale.staffId]) staffStats[sale.staffId] = { name: sale.staffName, sales: 0, revenue: 0, avgOrder: 0 };
    staffStats[sale.staffId].sales++;
    staffStats[sale.staffId].revenue += moneyPaidGross(sale.total, sale.giftCardUsed);
  }
  const staffPerf = Object.values(staffStats)
    .map((s) => ({ ...s, avgOrder: s.sales > 0 ? s.revenue / s.sales : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const maxStaffRev = staffPerf[0]?.revenue || 1;

  // ── Transactions tab ────────────────────────────────────────────────────────
  const txSource = showVoided ? inRange : filtered;
  const txFiltered = txSource.filter((s) => {
    if (!txSearch.trim()) return true;
    const q = txSearch.toLowerCase();
    return s.receiptNo.includes(q) || s.staffName.toLowerCase().includes(q) ||
           (s.customerName ?? "").toLowerCase().includes(q);
  });
  const txSorted = [...txFiltered].sort((a, b) => {
    const dir = sortDir === "desc" ? -1 : 1;
    if (sortField === "date") return dir * (new Date(a.date).getTime() - new Date(b.date).getTime());
    return dir * (a.total - b.total);
  });

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) =>
    sortField === field
      ? sortDir === "desc" ? <ChevronDown size={12} className="inline ml-0.5" /> : <ChevronUp size={12} className="inline ml-0.5" />
      : null;

  if (!loaded) return <div className="p-8 text-gray-400 text-sm">Loading POS data…</div>;

  return (
    <div className="space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">POS Finance Reports</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            {filtered.length} transactions · {fmtCur(revenue + vipFeesTotal, sym)} revenue
            {vipFeesInRange.length > 0 && <span className="ml-1 text-amber-500">(incl. {fmtCur(vipFeesTotal, sym)} VIP fees)</span>}
            {voidedCount > 0 && <span className="ml-2 text-red-400">({voidedCount} voided)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-[13px] sm:text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={() => exportCSV(showVoided ? inRange : filtered, sym)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-[13px] sm:text-sm font-semibold transition-colors">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* ── Period selector ───────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 mb-3">
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                period === p.id ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">From</label>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">To</label>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400" />
            </div>
          </div>
        )}
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {filtered.length === 0 && vipFeesInRange.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center shadow-sm">
          <BarChart3 size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No sales found for this period</p>
          <p className="text-gray-400 text-sm mt-1">Sales and VIP booking fees recorded on the POS will appear here.</p>
        </div>
      )}

      {(filtered.length > 0 || vipFeesInRange.length > 0) && (
        <>
          {/* ── KPI cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
            <KpiCard label="Total Revenue"    value={fmtCur(revenue + vipFeesTotal, sym)} sub={vipFeesTotal > 0 ? `${filtered.length} sales + ${fmtCur(vipFeesTotal, sym)} VIP fees` : `${filtered.length} txns`} icon={TrendingUp} color="text-green-600"  bg="bg-green-50" />
            <KpiCard label="Average Order"    value={fmtCur(avgOrder, sym)}       sub={`${filtered.length} sales`}         icon={Receipt}         color="text-blue-600"   bg="bg-blue-50" />
            <KpiCard label="Gross Profit"     value={fmtCur(grossProfit, sym)}    sub={`Margin ${fmtPct(marginPct)}`}      icon={BarChart3}       color="text-purple-600" bg="bg-purple-50" />
            <KpiCard label="VAT Collected"    value={fmtCur(taxCollected, sym)}   sub="excl. voided"                       icon={Percent}         color="text-amber-600"  bg="bg-amber-50" />
            <KpiCard label="VIP Booking Fees" value={fmtCur(vipFeesTotal, sym)}   sub={`${vipFeesInRange.length} reservation${vipFeesInRange.length === 1 ? "" : "s"} · till`} icon={Crown} color="text-amber-700" bg="bg-amber-50" />
            <KpiCard label="Tips"             value={fmtCur(tipsTotal, sym)}      sub="staff tips"                         icon={BadgeDollarSign} color="text-pink-600"   bg="bg-pink-50" />
            <KpiCard label="Discounts Given"  value={fmtCur(discountTotal, sym)}  sub="reductions applied"                 icon={Tag}             color="text-red-600"    bg="bg-red-50" />
            <KpiCard label="Service Fees"     value={fmtCur(serviceFeesTotal, sym)} sub={`${filtered.length} sales`}       icon={CreditCard}     color="text-indigo-600" bg="bg-indigo-50" />
            <KpiCard label="Refunded"         value={fmtCur(refundedTotal, sym)}  sub={`${refundedCount} txn${refundedCount === 1 ? "" : "s"}`} icon={RotateCcw} color="text-teal-600"  bg="bg-teal-50" />
            {giftCardRedeemed > 0 && (
              <KpiCard label="Gift Card Redeemed" value={fmtCur(giftCardRedeemed, sym)} sub="settled · not revenue" icon={Gift} color="text-fuchsia-600" bg="bg-fuchsia-50" />
            )}
          </div>

          {/* ── VIP booking fees — detail with reserved customers ──────────── */}
          {vipFeesInRange.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-amber-100 bg-amber-50/60 flex items-center justify-between">
                <h3 className="text-gray-900 font-semibold text-sm flex items-center gap-2">
                  <Crown size={16} className="text-amber-500" /> VIP Booking Fees — Reserved Customers
                </h3>
                <span className="text-sm font-bold text-amber-800">{fmtCur(vipFeesTotal, sym)} · {vipFeesInRange.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Booked</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Customer</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Contact</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Table</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Reserved for</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Method</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...vipFeesInRange]
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .map((f) => (
                      <tr key={f.id} className="hover:bg-amber-50/40 transition-colors">
                        <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">
                          {fmtDate(f.created_at)}<br />
                          <span className="text-gray-400">{fmtTime(f.created_at)}</span>
                        </td>
                        <td className="px-5 py-3 text-gray-800 font-medium whitespace-nowrap">{f.customer_name || "Guest"}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs">
                          {f.customer_email && <div className="truncate max-w-[180px]">{f.customer_email}</div>}
                          {f.customer_phone && <div>{f.customer_phone}</div>}
                          {!f.customer_email && !f.customer_phone && <span>—</span>}
                        </td>
                        <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{f.table_label || "—"}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {f.date ? `${f.date}${f.time ? ` · ${f.time}` : ""}` : "—"}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                            f.payment_method === "cash" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                          }`}>{f.payment_method ?? "—"}</span>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-amber-700 whitespace-nowrap">{fmtCur(Number(f.vip_fee ?? 0), sym)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-amber-50/60 border-t-2 border-amber-200">
                      <td colSpan={6} className="px-5 py-3 text-xs font-semibold text-gray-600">Total VIP booking fees</td>
                      <td className="px-5 py-3 text-right font-bold text-amber-800">{fmtCur(vipFeesTotal, sym)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── Tab bar ────────────────────────────────────────────────────── */}
          <div className="flex gap-1.5 bg-gray-100 p-1 rounded-xl">
            {(["overview","items","staff","transactions"] as ReportTab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 px-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${
                  tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}>
                {t === "transactions" ? "Transactions" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* ── Overview tab ───────────────────────────────────────────────── */}
          {tab === "overview" && (
            <div className="space-y-4">
              {/* Daily revenue chart */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                <h3 className="text-gray-900 font-semibold text-sm mb-4 flex items-center gap-2">
                  <BarChart3 size={16} className="text-orange-500" /> Revenue by Day
                </h3>
                {dailyBuckets.length <= 1 ? (
                  <p className="text-gray-400 text-sm">Select a wider date range to see the daily chart.</p>
                ) : (
                  <div className="flex items-end gap-1.5" style={{ height: 140 }}>
                    {dailyBuckets.map((d, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.label}: ${fmtCur(d.revenue, sym)}`}>
                        <div className="w-full flex items-end justify-center" style={{ height: 110 }}>
                          <div
                            className={`w-full rounded-t-md transition-all ${d.revenue > 0 ? "bg-orange-400" : "bg-gray-100"}`}
                            style={{ height: `${Math.max(4, (d.revenue / maxDaily) * 100)}%` }}
                          />
                        </div>
                        {dailyBuckets.length <= 14 && (
                          <span className="text-[9px] text-gray-400 text-center leading-tight">{d.label.split(" ").slice(0,2).join(" ")}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Payment mix */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <h3 className="text-gray-900 font-semibold text-sm mb-4 flex items-center gap-2">
                    <CreditCard size={16} className="text-blue-500" /> Payment Methods
                  </h3>
                  <div className="space-y-3">
                    {([["cash","Cash","bg-green-500","text-green-700",Banknote],
                       ["card","Card","bg-blue-500","text-blue-700",CreditCard],
                       ["split","Split","bg-purple-500","text-purple-700",Shuffle]] as [string,string,string,string,React.ComponentType<{size?:number;className?:string}>][]).map(([key,label,bar,txt,Icon]) => {
                      const count = payMix[key as keyof typeof payMix] ?? 0;
                      const pct   = (count / payTotal) * 100;
                      const rev   = filtered.filter((s) => s.paymentMethod === key).reduce((s, x) => s + moneyPaidGross(x.total, x.giftCardUsed), 0);
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-gray-700 flex items-center gap-1.5"><Icon size={14} /> {label}</span>
                            <span className="text-sm font-semibold text-gray-900">{fmtCur(rev, sym)}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className={`text-xs ${txt} mt-0.5`}>{count} transactions · {fmtPct(pct)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Hourly heatmap */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <h3 className="text-gray-900 font-semibold text-sm mb-4 flex items-center gap-2">
                    <TrendingUp size={16} className="text-green-500" /> Busiest Hours
                  </h3>
                  <div className="grid grid-cols-12 gap-0.5">
                    {hourlyBuckets.map((rev, h) => {
                      const pct = rev / maxHourly;
                      const intensity = pct > 0.75 ? "bg-orange-500" : pct > 0.5 ? "bg-orange-400" : pct > 0.25 ? "bg-orange-300" : pct > 0 ? "bg-orange-100" : "bg-gray-100";
                      return (
                        <div key={h} title={`${h}:00 — ${fmtCur(rev, sym)}`}
                          className={`${intensity} rounded aspect-square cursor-default`} />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                    <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                  </div>
                  <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                    <div className="flex gap-1">
                      {["bg-gray-100","bg-orange-100","bg-orange-300","bg-orange-400","bg-orange-500"].map((c) => (
                        <div key={c} className={`w-3 h-3 rounded ${c}`} />
                      ))}
                    </div>
                    <span>Low → High revenue</span>
                  </div>
                </div>
              </div>

              {/* Summary table */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm overflow-x-auto">
                <h3 className="text-gray-900 font-semibold text-sm mb-4 flex items-center gap-2">
                  <Receipt size={16} className="text-gray-400" /> Financial Summary
                </h3>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-50">
                    {([
                      ["Gross Sales (subtotal)",   fmtCur(filtered.reduce((s,x)=>s+x.subtotal,0), sym),  "text-gray-900"],
                      ["Discounts Applied",        `–${fmtCur(discountTotal, sym)}`,                      "text-red-600"],
                      ["Net Sales",               fmtCur(revenue - tipsTotal - taxCollected - serviceFeesTotal, sym),        "text-gray-900"],
                      ["VAT Collected",            fmtCur(taxCollected, sym),                             "text-amber-600"],
                      ["Tips",                    fmtCur(tipsTotal, sym),                                 "text-pink-600"],
                      ["Service Fees",            fmtCur(serviceFeesTotal, sym),                          "text-indigo-600"],
                      ["Sales Revenue",           fmtCur(revenue, sym),                                   "text-gray-900"],
                      ...(vipFeesTotal > 0
                        ? [["VIP Booking Fees",    fmtCur(vipFeesTotal, sym),                             "text-amber-700"] as [string, string, string]]
                        : []),
                      ["Total Revenue",           fmtCur(revenue + vipFeesTotal, sym),                    "font-bold text-gray-900"],
                      ["Estimated COGS",          `–${fmtCur(totalCost, sym)}`,                            "text-gray-500"],
                      ["Gross Profit",            fmtCur(grossProfit, sym),                               "font-semibold text-green-700"],
                      ["Gross Margin",            fmtPct(marginPct),                                      "text-purple-600"],
                    ] as [string, string, string][]).map(([label, value, cls]) => (
                      <tr key={label}>
                        <td className="py-2 text-gray-500">{label}</td>
                        <td className={`py-2 text-right ${cls}`}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Items tab ──────────────────────────────────────────────────── */}
          {tab === "items" && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-gray-900 font-semibold text-sm flex items-center gap-2">
                  <Package size={16} className="text-orange-500" /> Best-Selling Items
                </h3>
              </div>
              {bestSellers.length === 0 ? (
                <p className="p-6 text-gray-400 text-sm">No item data for this period.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {bestSellers.map((item, i) => (
                    <div key={item.name} className="px-5 py-4 flex items-center gap-4">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        i === 0 ? "bg-amber-400 text-white" : i === 1 ? "bg-gray-400 text-white" : i === 2 ? "bg-orange-700 text-white" : "bg-gray-100 text-gray-500"
                      }`}>
                        {i === 0 ? <Trophy size={12} /> : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-900 text-sm font-medium truncate">{item.name}</p>
                        <div className="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                          <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(item.revenue / maxItemRev) * 100}%` }} />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-gray-900 font-semibold text-sm">{fmtCur(item.revenue, sym)}</p>
                        <p className="text-gray-400 text-xs">{item.qty} sold</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Staff tab ──────────────────────────────────────────────────── */}
          {tab === "staff" && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-gray-900 font-semibold text-sm flex items-center gap-2">
                  <Users size={16} className="text-blue-500" /> Staff Performance
                </h3>
              </div>
              {staffPerf.length === 0 ? (
                <p className="p-6 text-gray-400 text-sm">No staff data for this period.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {staffPerf.map((s, i) => (
                    <div key={s.name} className="px-5 py-4 flex flex-wrap items-center gap-4">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        i === 0 ? "bg-amber-400 text-white" : "bg-gray-100 text-gray-500"
                      }`}>
                        {i === 0 ? <Trophy size={12} /> : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-900 text-sm font-medium">{s.name}</p>
                        <div className="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(s.revenue / maxStaffRev) * 100}%` }} />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 space-y-0.5">
                        <p className="text-gray-900 font-semibold text-sm">{fmtCur(s.revenue, sym)}</p>
                        <p className="text-gray-400 text-xs">{s.sales} sales · avg {fmtCur(s.avgOrder, sym)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Transactions tab ───────────────────────────────────────────── */}
          {tab === "transactions" && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              {/* Toolbar */}
              <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
                <input
                  value={txSearch} onChange={(e) => setTxSearch(e.target.value)}
                  placeholder="Search receipt, staff, customer…"
                  className="flex-1 min-w-48 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-orange-400 placeholder-gray-400"
                />
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)}
                    className="rounded accent-orange-500" />
                  Show voided
                </label>
                <p className="text-gray-400 text-xs ml-auto">{txSorted.length} rows</p>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Receipt</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-700"
                          onClick={() => toggleSort("date")}>Date <SortIcon field="date" /></th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Staff</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Customer</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Items</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold">Payment</th>
                      <th className="px-5 py-3 text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-700 text-right"
                          onClick={() => toggleSort("total")}>Total <SortIcon field="total" /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {txSorted.length === 0 ? (
                      <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400 text-sm">No transactions found</td></tr>
                    ) : txSorted.map((sale) => (
                      <tr key={sale.id} className={`hover:bg-gray-50 transition-colors ${sale.voided ? "opacity-60" : ""}`}>
                        <td className="px-5 py-3 font-mono text-xs text-gray-900">
                          #{sale.receiptNo}
                          {sale.voided && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold">
                              <AlertTriangle size={9} /> VOID
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">
                          {fmtDate(sale.date)}<br />
                          <span className="text-gray-400">{fmtTime(sale.date)}</span>
                        </td>
                        <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{sale.staffName}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">{sale.customerName ?? "—"}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">{sale.items.length} item{sale.items.length !== 1 ? "s" : ""}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                            sale.paymentMethod === "cash" ? "bg-green-100 text-green-700" :
                            sale.paymentMethod === "card" ? "bg-blue-100 text-blue-700" :
                            "bg-purple-100 text-purple-700"
                          }`}>{sale.paymentMethod}</span>
                          {(sale.giftCardUsed ?? 0) > 0 && (
                            <span className="ml-1 text-xs px-2 py-0.5 rounded-full font-medium bg-fuchsia-100 text-fuchsia-700 inline-flex items-center gap-0.5">
                              <Gift size={10} /> {fmtCur(sale.giftCardUsed ?? 0, sym)}
                            </span>
                          )}
                        </td>
                        <td className={`px-5 py-3 text-right font-semibold ${sale.voided ? "text-red-400 line-through" : "text-gray-900"}`}>
                          {fmtCur(sale.total, sym)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {txSorted.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td colSpan={6} className="px-5 py-3 text-xs font-semibold text-gray-600">Total ({txSorted.filter(s=>!s.voided).length} sales)</td>
                        <td className="px-5 py-3 text-right font-bold text-gray-900">
                          {fmtCur(txSorted.filter(s=>!s.voided).reduce((s,x)=>s+x.total,0), sym)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
