"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePOS } from "@/context/POSContext";
import { useApp } from "@/context/AppContext";
import { POSSale } from "@/types/pos";
import {
  AlertTriangle, BadgeDollarSign, Banknote, BarChart3, CreditCard, Download,
  Flame, Gift, Mail, Package, Percent, Printer, Receipt, RefreshCw,
  RotateCcw, Search, Shuffle, Tag, Trash2, TrendingUp, Trophy, Users, Utensils, DollarSign,
} from "lucide-react";
import { fmt, fmtPct, fmtDate, fmtTime, relTime } from "./_utils";
import { buildDineInReceiptHtml, dineInRefundState, type DineInOrder } from "./_receipts";
import { moneyPaidGross } from "@/lib/giftCardMoney";
import { parseTableLabelFromNote } from "@/lib/tableLabel";
import {
  type POSPeriod, POS_PERIODS, getPOSDateRange,
  posDailyBuckets, posHourlyBuckets, posExportCSV,
} from "./dashboard/_helpers";
import VoidSaleModal from "./dashboard/VoidSaleModal";
import DineInActionModal, { type DineInAction } from "./dashboard/DineInActionModal";

export default function DashboardView() {
  const { sales, products, settings, currentStaff } = usePOS();
  const { settings: appSettings } = useApp();
  const sym = settings.currencySymbol;

  // Top-level tab
  const [dashTab, setDashTab] = useState<"overview" | "reports" | "dine-in">("overview");

  // Void + refund modal (POS sales)
  const [voidTargetSale, setVoidTargetSale] = useState<POSSale | null>(null);

  // Dine-in void / refund
  const [diAction, setDiAction] = useState<DineInAction | null>(null);

  // ── Dine-in orders (fetched from Supabase) ─────────────────────────────────
  const [dineInOrders, setDineInOrders] = useState<DineInOrder[]>([]);
  const [dineInLoading, setDineInLoading] = useState(false);
  const [dineInEmail, setDineInEmail] = useState<Record<string, string>>({});
  const [dineInEmailSt, setDineInEmailSt] = useState<Record<string, "idle" | "sending" | "sent" | "error">>({});
  // ── Today's dine-in: always-loaded for Overview KPIs ───────────────────────
  const [todayDineIn, setTodayDineIn] = useState<DineInOrder[]>([]);

  // ── Reports dine-in: all settled dine-in orders for the selected period ─────
  const [reportsDineIn, setReportsDineIn] = useState<DineInOrder[]>([]);
  const [reportsDineInLoading, setReportsDineInLoading] = useState(false);

  // Shared row mapper ─────────────────────────────────────────────────────────
  function mapDineInRow(o: Record<string, unknown>): DineInOrder {
    const n = String(o.note ?? "");
    return {
      id: o.id as string,
      tableLabel: parseTableLabelFromNote(n) ?? "?",
      staffName: n.match(/Staff:\s*([^·\n]+)/)?.[1]?.trim() ?? "—",
      covers: parseInt(n.match(/(\d+)\s+cover/)?.[1] ?? "0"),
      items: (o.items as DineInOrder["items"]) ?? [],
      discountAmount: o.discount_amount != null ? Number(o.discount_amount) : undefined,
      discountNote: n.match(/Discount:\s*([^·\n]+)/)?.[1]?.trim() ?? undefined,
      vatAmount: o.vat_amount != null ? Number(o.vat_amount) : undefined,
      vatInclusive: o.vat_inclusive != null ? Boolean(o.vat_inclusive) : undefined,
      tipAmount: o.tip_amount != null ? Number(o.tip_amount) : undefined,
      serviceFeeAmount: o.service_fee != null ? Number(o.service_fee) : undefined,
      total: Number(o.total),
      status: o.status as string,
      paymentStatus: (o.payment_status as string) ?? undefined,
      paymentMethod: (o.payment_method as string) ?? "table-service",
      date: o.date as string,
      refundedAmount: o.refunded_amount != null ? Number(o.refunded_amount) : undefined,
      giftCardUsed: o.gift_card_used != null ? Number(o.gift_card_used) : undefined,
    };
  }

  const refreshTodayDineIn = useCallback(async () => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const params = new URLSearchParams({
      from: todayStart.toISOString(),
      to: todayEnd.toISOString(),
    });
    try {
      const r = await fetch(`/api/pos/orders/dine-in?${params}`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; orders?: Record<string, unknown>[] };
      if (!json.ok || !json.orders) return;
      setTodayDineIn(json.orders.map(mapDineInRow));
    } catch { /* network blip — keep last-known */ }
  }, []);

  // Refresh today's dine-in whenever the Overview tab is (re)entered. It feeds
  // the Overview KPIs only, so there's no reason to poll it from other tabs.
  useEffect(() => {
    if (dashTab === "overview") refreshTodayDineIn();
  }, [dashTab, refreshTodayDineIn]);

  // isInitial=true shows the loading spinner (first open / tab switch). Background
  // polls run silently and keep the last-known list on a network blip — no flicker.
  // Scoped to TODAY only — the Dine-In tab is an operational view (Open / Settled
  // Today / Voided-Refunded), historical orders belong in admin Order History.
  const refreshDineInTab = useCallback(async (isInitial = false) => {
    if (isInitial) setDineInLoading(true);
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
      const params = new URLSearchParams({
        from: todayStart.toISOString(),
        to:   todayEnd.toISOString(),
      });
      const r = await fetch(`/api/pos/orders/dine-in?${params}`, { cache: "no-store" });
      if (!r.ok) { if (isInitial) setDineInOrders([]); return; }
      const json = await r.json() as { ok: boolean; orders?: Record<string, unknown>[] };
      if (!json.ok || !json.orders) { if (isInitial) setDineInOrders([]); return; }
      setDineInOrders(json.orders.map(mapDineInRow));
    } catch { /* network blip — keep last-known */ }
    finally {
      if (isInitial) setDineInLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dashTab !== "dine-in") return;
    refreshDineInTab(true);
  }, [dashTab, refreshDineInTab]);

  const emailInFlight = useRef<Set<string>>(new Set());

  async function sendDineInEmail(order: DineInOrder) {
    if (emailInFlight.current.has(order.id)) return;
    const email = dineInEmail[order.id]?.trim();
    if (!email) return;
    emailInFlight.current.add(order.id);
    setDineInEmailSt((p) => ({ ...p, [order.id]: "sending" }));
    try {
      const effectiveName = appSettings.restaurant?.name || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant";
      const html = buildDineInReceiptHtml(order, settings, effectiveName);
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email, subject: `Your receipt from ${effectiveName} — Table ${order.tableLabel}`, html }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean };
      setDineInEmailSt((p) => ({ ...p, [order.id]: d.ok ? "sent" : "error" }));
    } finally {
      emailInFlight.current.delete(order.id);
    }
  }

  function printDineInReceipt(order: DineInOrder) {
    const effectiveName = appSettings.restaurant?.name || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant";
    const html = buildDineInReceiptHtml(order, settings, effectiveName);
    const win = window.open("", "_blank", "width=420,height=650");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.onafterprint = () => win.close();
  }

  function openVoidModal(saleId: string) {
    const sale = sales.find((s) => s.id === saleId);
    if (sale) setVoidTargetSale(sale);
  }

  // ── Overview computations ───────────────────────────────────────────────────
  const today = new Date().toDateString();
  // A refunded POS sale (voided=true with refundAmount>0) is still a transaction
  // that happened — we count it, then deduct the refunded amount from revenue. A
  // void with NO refund kept 100% of the money, so it counts in full. Only a
  // fully-refunded void nets to £0 and drops out. Same shape applied to dine-in
  // below, where refund state lives in paymentStatus (legacy rows: on status).
  const todaySales = sales.filter((s) => {
    if (new Date(s.date).toDateString() !== today) return false;
    if (!s.voided) return true;
    // Voided but money (partly) kept — no-refund = full, partial = retained slice.
    return moneyPaidGross(s.total, s.giftCardUsed) - (s.refundAmount ?? 0) > 0;
  });
  // Fully-kept slice — tips/service fees on a refunded sale went back with the
  // refund, so only never-voided + voided-with-no-refund rows feed those KPIs.
  const todaySalesActive = todaySales.filter((s) => !s.voided || (s.refundAmount ?? 0) === 0);
  // Refunded dine-in orders keep status "delivered" (refund state lives in
  // paymentStatus), so "delivered" alone covers settled + refunded tables.
  const todayDineInSettled = todayDineIn.filter(o => o.status === "delivered");

  // Revenue = money paid (gift card netted out) − refund. A gift card is
  // prepaid money, so its redeemed portion isn't revenue at spend time.
  const posRevenue = todaySales.reduce(
    (sum, s) => sum + Math.max(0, moneyPaidGross(s.total, s.giftCardUsed) - (s.refundAmount ?? 0)),
    0,
  );
  const diRevToday = todayDineInSettled.reduce(
    (sum, o) => sum + Math.max(0, moneyPaidGross(o.total, o.giftCardUsed) - (o.refundedAmount ?? 0)),
    0,
  );
  const totalRevenue = posRevenue + diRevToday;
  const totalTransactions = todaySales.length + todayDineInSettled.length;
  const todayAvgOrder = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
  const totalTips = todaySalesActive.reduce((sum, s) => sum + s.tipAmount, 0);
  const totalServiceFees = todaySalesActive.reduce((sum, s) => sum + s.serviceFeeAmount, 0);

  // "Kept" = never-voided + voided-with-no-refund (money fully retained).
  const isKept = (s: POSSale) => !s.voided || (s.refundAmount ?? 0) === 0;
  const itemCounts: Record<string, { name: string; count: number; revenue: number }> = {};
  for (const sale of sales.filter(isKept)) {
    for (const item of sale.items) {
      if (!itemCounts[item.productId]) itemCounts[item.productId] = { name: item.name, count: 0, revenue: 0 };
      itemCounts[item.productId].count += item.quantity;
      itemCounts[item.productId].revenue += item.price * item.quantity;
    }
  }
  const bestSellersOverview = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 8);

  const last7: { label: string; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const rev = sales.filter((s) => isKept(s) && new Date(s.date).toDateString() === d.toDateString()).reduce((s, x) => s + x.total, 0);
    last7.push({ label: d.toLocaleDateString("en-GB", { weekday: "short" }), revenue: rev });
  }
  const maxRev = Math.max(...last7.map((d) => d.revenue), 1);

  const overviewPayMix = { cash: 0, card: 0, split: 0, gift_card: 0 };
  for (const s of todaySales) overviewPayMix[s.paymentMethod] = (overviewPayMix[s.paymentMethod] || 0) + 1;
  const overviewPayTotal = totalTransactions || 1;

  const costMap: Record<string, number> = {};
  for (const p of products) if (p.cost) costMap[p.id] = p.cost;
  const totalCostAll = sales.filter(isKept).reduce((sum, sale) =>
    sum + sale.items.reduce((s, item) => s + (costMap[item.productId] ?? 0) * item.quantity, 0), 0);
  const totalRevAll = sales.filter(isKept).reduce((s, x) => s + x.total, 0);
  const overviewMargin = totalRevAll > 0 ? ((totalRevAll - totalCostAll) / totalRevAll) * 100 : 0;

  // ── Reports state ───────────────────────────────────────────────────────────
  const [period, setPeriod] = useState<POSPeriod>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  type ReportTab = "overview" | "items" | "staff" | "transactions";
  const [reportTab, setReportTab] = useState<ReportTab>("overview");
  const [txSearch, setTxSearch] = useState("");
  const [sortField, setSortField] = useState<"date" | "total">("date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  // Default ON: voided sales are real history (money is often kept), so they
  // should be visible without hunting for a toggle.
  const [showVoided, setShowVoided] = useState(true);

  const [startDate, endDate] = useMemo(
    () => getPOSDateRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  );

  const refreshReportsDineIn = useCallback(async (isInitial = false) => {
    if (isInitial) setReportsDineInLoading(true);
    try {
      const params = new URLSearchParams({
        from: startDate.toISOString(),
        to: endDate.toISOString(),
        limit: "500",
      });
      const r = await fetch(`/api/pos/orders/dine-in?${params}`, { cache: "no-store" });
      if (!r.ok) { if (isInitial) setReportsDineIn([]); return; }
      const json = await r.json() as { ok: boolean; orders?: Record<string, unknown>[] };
      if (!json.ok || !json.orders) { if (isInitial) setReportsDineIn([]); return; }
      setReportsDineIn(json.orders.map(mapDineInRow));
    } catch { /* network blip — keep last-known */ }
    finally {
      if (isInitial) setReportsDineInLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (dashTab !== "reports") return;
    refreshReportsDineIn(true);
  }, [dashTab, refreshReportsDineIn]);

  // ── Polling: every 6 s refresh the active tab's data ──────────────────────
  // Replaces the prior supabase Realtime channel; anon will no longer get
  // postgres_changes events after RLS revoke.
  useEffect(() => {
    const id = setInterval(() => {
      // Poll only the active tab's data — and silently (default isInitial=false),
      // so background refreshes never tear down the visible list/cards.
      if (dashTab === "overview") refreshTodayDineIn();
      if (dashTab === "dine-in")  refreshDineInTab();
      if (dashTab === "reports")  refreshReportsDineIn();
    }, 6_000);
    return () => clearInterval(id);
  }, [dashTab, refreshTodayDineIn, refreshDineInTab, refreshReportsDineIn]);

  const inRange = useMemo(
    () => sales.filter((s) => { const d = new Date(s.date); return d >= startDate && d <= endDate; }),
    [sales, startDate, endDate],
  );
  // Strictly non-voided — drives the transactions "Show voided" toggle only.
  const rNonVoided = useMemo(() => inRange.filter((s) => !s.voided), [inRange]);
  // `rFiltered` = completed sales whose money fully stuck: never-voided PLUS
  // voided-with-NO-refund (the till took the money and never gave it back, so
  // it's a real sale for every GROSS figure). Partially/fully refunded voids are
  // excluded here — their retained slice is counted by `rMoneyBearing` instead.
  const rFiltered = useMemo(
    () => inRange.filter((s) => !s.voided || (s.refundAmount ?? 0) === 0),
    [inRange],
  );
  // Revenue-bearing = `rFiltered` PLUS partially-refunded voids (retained slice
  // is real income). Fully-refunded voids net to £0 via rSaleNet and drop out.
  const rMoneyBearing = useMemo(
    () => inRange.filter((s) => !s.voided || moneyPaidGross(s.total, s.giftCardUsed) - (s.refundAmount ?? 0) > 0),
    [inRange],
  );
  // useCallback so it's reference-stable and safe to use in chart useMemo deps.
  const rSaleNet = useCallback(
    (s: POSSale) => Math.max(0, moneyPaidGross(s.total, s.giftCardUsed) - (s.refundAmount ?? 0)),
    [],
  );
  const voidedCount = inRange.filter((s) => s.voided).length;
  // Income retained from voided sales (no-refund = full, partial = kept slice).
  const rVoidKeptRevenue = rMoneyBearing.filter((s) => s.voided).reduce((sum, s) => sum + rSaleNet(s), 0);

  // KPIs — revenue is money paid (gift card netted out) − refund, so a partial
  // refund reduces it by the amount returned, not the whole sale.
  const rRevenue = rMoneyBearing.reduce((s, x) => s + rSaleNet(x), 0);
  const rTax = rFiltered.reduce((s, x) => s + x.taxAmount, 0);
  const rTips = rFiltered.reduce((s, x) => s + x.tipAmount, 0);
  const rServiceFees = rFiltered.reduce((s, x) => s + x.serviceFeeAmount, 0);
  const rDiscounts = rFiltered.reduce((s, x) => s + x.discountAmount, 0);
  const rAvgOrder = rMoneyBearing.length > 0 ? rRevenue / rMoneyBearing.length : 0;
  const rCost = rFiltered.reduce((sum, sale) =>
    sum + sale.items.reduce((s, item) => s + (costMap[item.productId] ?? 0) * item.quantity, 0), 0);
  const grossProfit = rRevenue - rCost;
  const marginPct = rRevenue > 0 ? (grossProfit / rRevenue) * 100 : 0;

  // Payment mix (reports)
  // Payment mix counts money-bearing sales (incl. partial-refund voids) — method
  // + net amount are both known per sale, so this split is exact (unlike items).
  const rPayMix = { cash: 0, card: 0, split: 0, gift_card: 0 };
  for (const s of rMoneyBearing) rPayMix[s.paymentMethod] = (rPayMix[s.paymentMethod] ?? 0) + 1;
  const rPayTotal = rMoneyBearing.length || 1;

  // Charts run off `rMoneyBearing` with the NET value (rSaleNet), so a partially-
  // refunded void contributes its retained slice and the chart reconciles with
  // the revenue KPI. Best-sellers below stay on `rFiltered` (item-level refund
  // split isn't recorded, so a partial refund can't be apportioned per item).
  const dailyBuckets = useMemo(() => posDailyBuckets(rMoneyBearing, startDate, endDate, rSaleNet), [rMoneyBearing, startDate, endDate, rSaleNet]);
  const maxDaily = Math.max(...dailyBuckets.map((d) => d.revenue), 1);
  const hourlyBuckets = useMemo(() => posHourlyBuckets(rMoneyBearing, rSaleNet), [rMoneyBearing, rSaleNet]);
  const maxHourly = Math.max(...hourlyBuckets, 1);

  // Best sellers (reports)
  const rItemStats: Record<string, { name: string; qty: number; revenue: number }> = {};
  for (const sale of rFiltered) {
    for (const item of sale.items) {
      if (!rItemStats[item.productId]) rItemStats[item.productId] = { name: item.name, qty: 0, revenue: 0 };
      rItemStats[item.productId].qty += item.quantity;
      rItemStats[item.productId].revenue += item.price * item.quantity;
    }
  }
  const rBestSellers = Object.values(rItemStats).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  const maxItemRev = rBestSellers[0]?.revenue || 1;

  // Staff performance (reports) — `rMoneyBearing` with NET revenue (rSaleNet), so
  // a partially-refunded void credits only the retained slice and the leaderboard
  // reconciles with overall revenue.
  const staffStats: Record<string, { name: string; sales: number; revenue: number }> = {};
  for (const sale of rMoneyBearing) {
    if (!staffStats[sale.staffId]) staffStats[sale.staffId] = { name: sale.staffName, sales: 0, revenue: 0 };
    staffStats[sale.staffId].sales++;
    staffStats[sale.staffId].revenue += rSaleNet(sale);
  }
  const staffPerf = Object.values(staffStats).map((s) => ({ ...s, avgOrder: s.sales > 0 ? s.revenue / s.sales : 0 })).sort((a, b) => b.revenue - a.revenue);
  const maxStaffRev = staffPerf[0]?.revenue || 1;

  // Dine-in stats for reports. A refunded order keeps status "delivered", so
  // "settled" excludes refund state to keep the two buckets disjoint.
  const diSettled = reportsDineIn.filter(o => o.status === "delivered" && dineInRefundState(o) === null);
  const diVoided = reportsDineIn.filter(o => o.status === "cancelled");
  const diRefundedOrders = reportsDineIn.filter(o => dineInRefundState(o) !== null);
  // Revenue-bearing dine-in = settled PLUS (partially) refunded — the retained
  // portion is real revenue. Net out gift card + refund, just like POS sales,
  // so a partial refund reduces revenue by the amount returned, not the whole bill.
  const diMoneyBearing = [...diSettled, ...diRefundedOrders];
  const diRevenue = diMoneyBearing.reduce(
    (s, o) => s + Math.max(0, moneyPaidGross(o.total, o.giftCardUsed) - (o.refundedAmount ?? 0)),
    0,
  );
  const diAvgOrder = diMoneyBearing.length > 0 ? diRevenue / diMoneyBearing.length : 0;
  const diPayMix = { cash: 0, card: 0, "table-service": 0 } as Record<string, number>;
  for (const o of diSettled) diPayMix[o.paymentMethod] = (diPayMix[o.paymentMethod] ?? 0) + 1;
  const diTotalCovers = diSettled.reduce((s, o) => s + o.covers, 0);
  const diStaffStats: Record<string, { name: string; orders: number; revenue: number; covers: number; items: number }> = {};
  for (const o of diSettled) {
    const k = o.staffName || "—";
    if (!diStaffStats[k]) diStaffStats[k] = { name: k, orders: 0, revenue: 0, covers: 0, items: 0 };
    diStaffStats[k].orders++;
    diStaffStats[k].revenue += o.total;
    diStaffStats[k].covers += o.covers;
    diStaffStats[k].items += o.items.reduce((s, it) => s + it.qty, 0);
  }
  const diStaffPerf = Object.values(diStaffStats).sort((a, b) => b.revenue - a.revenue);
  const maxDiRevenue = diStaffPerf[0]?.revenue || 1;
  const combinedRevenue = rRevenue + diRevenue;

  // Transactions
  const txSource = showVoided ? inRange : rNonVoided;
  const txFiltered = txSource.filter((s) => {
    if (!txSearch.trim()) return true;
    const q = txSearch.toLowerCase();
    return s.receiptNo.includes(q) || s.staffName.toLowerCase().includes(q) || (s.customerName ?? "").toLowerCase().includes(q);
  });
  const txSorted = [...txFiltered].sort((a, b) => {
    const dir = sortDir === "desc" ? -1 : 1;
    return sortField === "date"
      ? dir * (new Date(a.date).getTime() - new Date(b.date).getTime())
      : dir * (a.total - b.total);
  });
  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  // ── Payment-row helper ──────────────────────────────────────────────────────
  const reportPaymentRows = [
    { key: "gift_card", label: "Gift Card", bar: "bg-purple-400", Icon: Gift },
    { key: "cash", label: "Cash", bar: "bg-green-500", Icon: Banknote },
    { key: "card", label: "Card", bar: "bg-blue-500", Icon: CreditCard },
    { key: "split", label: "Split", bar: "bg-purple-700", Icon: Shuffle },
  ] as const;

  return (
    <div className="flex-1 overflow-y-auto p-6 pr-5">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-white font-bold text-xl">Sales Dashboard</h2>
            <p className="text-slate-400 text-sm mt-1">
              {dashTab === "overview" ? (
                `Today · ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`
              ) : dashTab === "dine-in" ? (
                (() => {
                  const settled = dineInOrders.filter((o) => o.status === "delivered" && dineInRefundState(o) === null).length;
                  const open    = dineInOrders.filter((o) => o.status !== "delivered" && o.status !== "cancelled").length;
                  const refunded = dineInOrders.filter((o) => dineInRefundState(o) !== null).length;
                  const revenue = dineInOrders
                    .filter((o) => o.status === "delivered")
                    .reduce((s, o) => s + (o.total - (o.refundedAmount ?? 0)), 0);
                  return `${open} open · ${settled} settled · ${fmt(revenue, sym)} revenue${refunded > 0 ? ` · ${refunded} refunded` : ""}`;
                })()
              ) : (
                `${rMoneyBearing.length} transactions · ${fmt(rRevenue, sym)} revenue${voidedCount > 0 ? ` · ${voidedCount} voided${rVoidKeptRevenue > 0 ? ` (${fmt(rVoidKeptRevenue, sym)} kept)` : ""}` : ""}`
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dashTab === "reports" && (
              <button
                onClick={() => posExportCSV(showVoided ? inRange : rNonVoided, sym)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold transition-colors"
              >
                <Download size={13} /> Export CSV
              </button>
            )}
            {dashTab === "dine-in" && (
              <button
                onClick={() => refreshDineInTab(true)}
                disabled={dineInLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={13} className={dineInLoading ? "animate-spin" : ""} /> Refresh
              </button>
            )}
            <div className="flex gap-1 bg-slate-800 border border-slate-700 p-1 rounded-xl">
              {([
                { id: "overview", label: "Overview" },
                { id: "reports", label: "Reports" },
                { id: "dine-in", label: "Dine-In" },
              ] as { id: "overview" | "reports" | "dine-in"; label: string }[]).map((t) => (
                <button key={t.id} onClick={() => setDashTab(t.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${dashTab === t.id ? "bg-orange-500 text-white shadow" : "text-slate-400 hover:text-white"
                    }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ════════════════ OVERVIEW TAB ════════════════ */}
        {dashTab === "overview" && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
              {[
                { label: "Today's Revenue", value: fmt(totalRevenue, sym), sub: diRevToday > 0 ? `incl. ${fmt(diRevToday, sym)} dine-in` : undefined, icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/10" },
                { label: "Transactions", value: `${totalTransactions}`, sub: todayDineInSettled.length > 0 ? `${todaySales.length} POS · ${todayDineInSettled.length} dine-in` : undefined, icon: Receipt, color: "text-blue-400", bg: "bg-blue-500/10" },
                { label: "Average Order", value: fmt(todayAvgOrder, sym), sub: "POS + dine-in", icon: BarChart3, color: "text-purple-400", bg: "bg-purple-500/10" },
                { label: "Tips Collected", value: fmt(totalTips, sym), sub: "POS only", icon: BadgeDollarSign, color: "text-amber-400", bg: "bg-amber-500/10" },
                { label: "Service Fees", value: fmt(totalServiceFees, sym), sub: "POS only", icon: DollarSign, color: "text-blue-400", bg: "bg-blue-500/10" },
              ].map((card) => (
                <div key={card.label} className="bg-slate-800 border border-slate-700 rounded-2xl p-3 sm:p-5">
                  <div className={`w-10 h-10 ${card.bg} rounded-xl flex items-center justify-center mb-3`}>
                    <card.icon size={20} className={card.color} />
                  </div>
                  <p className={`text-lg sm:text-xl xl:text-2xl font-bold ${card.color}`}>{card.value}</p>
                  <p className="text-slate-400 text-xs mt-1">{card.label}</p>
                  {card.sub && <p className="text-slate-500 text-[10px] mt-0.5">{card.sub}</p>}
                </div>
              ))}
            </div>

            {/* Dine-in today strip */}
            {diRevToday > 0 && (
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl px-5 py-3 flex flex-wrap items-center gap-4">
                <Utensils size={16} className="text-violet-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-violet-200 text-sm font-semibold">Dine-In Today</p>
                  <p className="text-slate-400 text-xs">{todayDineInSettled.length} settled table{todayDineInSettled.length !== 1 ? "s" : ""} · {todayDineIn.filter(o => o.status !== "delivered" && o.status !== "cancelled").length} still open</p>
                </div>
                <div className="flex gap-6">
                  <div className="text-right">
                    <p className="text-violet-200 font-bold text-lg whitespace-nowrap">{fmt(diRevToday, sym)}</p>
                    <p className="text-slate-500 text-[10px]">Revenue</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold text-lg whitespace-nowrap">{fmt(todayDineInSettled.length > 0 ? diRevToday / todayDineInSettled.length : 0, sym)}</p>
                    <p className="text-slate-500 text-[10px]">Avg Bill</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Revenue last-7 chart */}
              <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-2xl p-5">
                <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <BarChart3 size={16} className="text-orange-400" /> Revenue — Last 7 Days
                </h3>
                <div className="flex items-end gap-2 h-32">
                  {last7.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex items-end justify-center" style={{ height: "100px" }}>
                        <div className={`w-full rounded-t-lg transition-all ${i === 6 ? "bg-orange-500" : "bg-slate-600"}`}
                          style={{ height: `${Math.max(4, (d.revenue / maxRev) * 100)}%` }} />
                      </div>
                      <span className="text-slate-500 text-[10px]">{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment mix */}
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <CreditCard size={16} className="text-blue-400" /> Payment Mix
                </h3>
                <div className="space-y-3">
                  {([["gift_card", "Gift Card", "bg-purple-400"], ["cash", "Cash", "bg-green-500"], ["card", "Card", "bg-blue-500"], ["split", "Split", "bg-purple-700"]] as [string, string, string][]).map(([key, label, color]) => {
                    const pct = ((overviewPayMix[key as keyof typeof overviewPayMix] ?? 0) / overviewPayTotal) * 100;
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span>{label}</span><span>{overviewPayMix[key as keyof typeof overviewPayMix] ?? 0} txns</span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <p className="text-slate-400 text-xs">Overall Margin</p>
                  <p className="text-white font-bold text-xl">{fmtPct(overviewMargin)}</p>
                  <p className="text-slate-500 text-xs">All-time · excl. voided</p>
                </div>
              </div>
            </div>

            {/* Best sellers */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                <Flame size={16} className="text-orange-400" /> Best Sellers (All Time)
              </h3>
              {bestSellersOverview.length === 0 ? (
                <p className="text-slate-500 text-sm">No sales recorded yet</p>
              ) : (
                <div className="space-y-2">
                  {bestSellersOverview.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-4">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i === 0 ? "bg-amber-500 text-white" : i === 1 ? "bg-slate-500 text-white" : i === 2 ? "bg-orange-700 text-white" : "bg-slate-700 text-slate-300"
                        }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{item.name}</p>
                        <div className="h-1.5 bg-slate-700 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(item.count / bestSellersOverview[0].count) * 100}%` }} />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-white text-sm font-bold">{item.count} sold</p>
                        <p className="text-slate-400 text-xs">{fmt(item.revenue, sym)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent transactions — POS + dine-in merged */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                <Receipt size={16} className="text-slate-400" /> Recent Transactions
              </h3>
              {sales.length === 0 && todayDineIn.length === 0 ? (
                <p className="text-slate-500 text-sm">No transactions yet</p>
              ) : (
                <div className="space-y-2">
                  {/* Merge today's POS sales + today's dine-in, sort by date desc, show 12.
                      Scoped to today only — historical sales would otherwise crowd out
                      today's refunds when there are 12+ older POS entries. */}
                  {[
                    ...sales
                      .filter((s) => new Date(s.date).toDateString() === today)
                      .map(s => ({ type: "pos" as const, date: s.date, data: s })),
                    ...todayDineIn.map(o => ({ type: "dine-in" as const, date: o.date, data: o })),
                  ]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .slice(0, 12)
                    .map((entry) => {
                      if (entry.type === "pos") {
                        const sale = entry.data;
                        return (
                          <div key={sale.id} className={`flex flex-wrap items-start justify-between gap-4 px-4 py-3 rounded-xl ${sale.voided ? "bg-red-500/5 border border-red-500/20" : "bg-slate-700/50"}`}>
                            <div className="flex flex-row gap-2">
                              <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${sale.voided ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
                                {sale.voided ? "V" : "✓"}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white text-sm font-medium">#{sale.receiptNo} · {sale.staffName}</p>
                                <p className="text-slate-400 text-xs">{sale.items.length} item{sale.items.length !== 1 ? "s" : ""} · {sale.paymentMethod} · {relTime(sale.date)}</p>
                                {sale.voided && sale.voidReason && <p className="text-red-400 text-xs italic">Void: {sale.voidReason}</p>}
                                {sale.voided && sale.refundMethod && sale.refundMethod !== "none" && (
                                  <p className="text-xs mt-0.5 flex items-center gap-1">
                                    {sale.refundMethod === "cash" ? <Banknote size={10} className="text-green-400 flex-shrink-0" /> : <CreditCard size={10} className="text-blue-400 flex-shrink-0" />}
                                    <span className={sale.refundMethod === "cash" ? "text-green-400" : "text-blue-400"}>
                                      Refunded {fmt(sale.refundAmount ?? 0, settings.currencySymbol)} via {sale.refundMethod}
                                    </span>
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-5 ml-8">
                              <p className={`font-bold text-sm flex-shrink-0 ${sale.voided ? "text-red-400 line-through" : "text-white"}`}>
                                {fmt(sale.total, sym)}
                              </p>
                              {!sale.voided && currentStaff?.permissions.canVoidSale && (
                                <button onClick={() => openVoidModal(sale.id)} className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0" title="Void sale">
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      } else {
                        const order = entry.data;
                        const refundState = dineInRefundState(order);
                        const isRefunded = refundState !== null;
                        const isSettled = order.status === "delivered" && !isRefunded;
                        const isCancelled = order.status === "cancelled";
                        const containerCls = isRefunded
                          ? "bg-amber-500/5 border-amber-500/20"
                          : isCancelled
                            ? "bg-red-500/5 border-red-500/20"
                            : "bg-violet-500/5 border-violet-500/15";
                        const iconWrapCls = isRefunded
                          ? "bg-amber-500/20"
                          : isCancelled
                            ? "bg-red-500/20"
                            : isSettled
                              ? "bg-violet-500/20"
                              : "bg-blue-500/20";
                        const iconCls = isRefunded
                          ? "text-amber-400"
                          : isCancelled
                            ? "text-red-400"
                            : isSettled
                              ? "text-violet-400"
                              : "text-blue-400";
                        const labelCls = isRefunded
                          ? "text-amber-400"
                          : isCancelled
                            ? "text-red-400"
                            : isSettled
                              ? "text-violet-400"
                              : "text-blue-400";
                        const label = isRefunded
                          ? (refundState === "refunded" ? "Refunded" : "Partial Refund")
                          : isCancelled
                            ? "Voided"
                            : isSettled
                              ? "Settled"
                              : order.status.charAt(0).toUpperCase() + order.status.slice(1);
                        const refundedAmt = order.refundedAmount ?? 0;
                        return (
                          <div key={order.id} className={`flex flex-wrap items-start justify-between gap-4 px-4 py-3 rounded-xl border ${containerCls}`}>
                            <div className="flex flex-row gap-2">
                              <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${iconWrapCls}`}>
                                <Utensils size={13} className={iconCls} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white text-sm font-medium">
                                  Table {order.tableLabel}
                                  {order.staffName && order.staffName !== "—" && <span className="text-slate-400"> · {order.staffName}</span>}
                                </p>
                                <p className="text-slate-400 text-xs">
                                  {order.items.reduce((s, i) => s + i.qty, 0)} items · {order.paymentMethod === "cash" ? "Cash" : order.paymentMethod === "card" ? "Card" : "Table Service"} · {relTime(order.date)}
                                </p>
                                {isRefunded && refundedAmt > 0 && (
                                  <p className="text-amber-400 text-xs mt-0.5 flex items-center gap-1">
                                    <RotateCcw size={10} className="flex-shrink-0" />
                                    Refunded {fmt(refundedAmt, sym)}
                                  </p>
                                )}
                              </div>

                            </div>
                            <div className="flex gap-5 ml-8">
                              <div className="text-right flex-shrink-0">
                                <p className={`font-bold text-sm ${isRefunded || isCancelled ? "text-amber-400 line-through opacity-80" : "text-white"}`}>
                                  {fmt(order.total, sym)}
                                </p>
                                <p className={`text-[10px] ${labelCls}`}>{label}</p>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ════════════════ REPORTS TAB ════════════════ */}
        {dashTab === "reports" && (
          <>
            {/* Period selector */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
              <div className="flex flex-wrap gap-2">
                {POS_PERIODS.map((p) => (
                  <button key={p.id} onClick={() => setPeriod(p.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${period === p.id ? "bg-orange-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      }`}>
                    {p.label}
                  </button>
                ))}
              </div>
              {period === "custom" && (
                <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-slate-700">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">From</label>
                    <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                      className="bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">To</label>
                    <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                      className="bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-orange-500" />
                  </div>
                </div>
              )}
            </div>

            {/* Empty state — only when both POS and dine-in have nothing. Guard on
                inRange (all POS sales incl. voided), NOT rFiltered, so a period of
                only voided/refunded sales still renders the report. */}
            {inRange.length === 0 && diSettled.length === 0 && !reportsDineInLoading && (
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-12 text-center">
                <BarChart3 size={36} className="mx-auto text-slate-600 mb-3" />
                <p className="text-slate-400 font-medium">No sales found for this period</p>
                <p className="text-slate-600 text-sm mt-1">Try selecting a different date range.</p>
              </div>
            )}

            {/* Dine-In loading placeholder */}
            {inRange.length === 0 && reportsDineInLoading && (
              <div className="flex items-center justify-center py-12 text-slate-500 gap-2 text-sm">
                <RefreshCw size={16} className="animate-spin" /> Loading dine-in data…
              </div>
            )}

            {/* Dine-In only KPI strip — visible when POS has no sales but dine-in does */}
            {inRange.length === 0 && diSettled.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {[
                    { label: "Dine-In Revenue", value: fmt(diRevenue, sym), color: "text-violet-300", bg: "bg-violet-500/10", icon: Utensils },
                    { label: "Tables Served", value: String(diSettled.length), color: "text-white", bg: "bg-slate-700", icon: Receipt },
                    { label: "Avg Bill", value: fmt(diAvgOrder, sym), color: "text-emerald-300", bg: "bg-emerald-500/10", icon: TrendingUp },
                    { label: "Covers", value: diTotalCovers > 0 ? String(diTotalCovers) : "—", color: "text-blue-300", bg: "bg-blue-500/10", icon: Users },
                  ].map(({ label, value, color, bg, icon: Icon }) => (
                    <div key={label} className="bg-slate-800 border border-slate-700 rounded-2xl p-3 sm:p-4">
                      <div className={`w-9 h-9 ${bg} rounded-xl flex items-center justify-center mb-2.5`}>
                        <Icon size={17} className={color} />
                      </div>
                      <p className={`text-lg sm:text-xl font-bold ${color}`}>{value}</p>
                      <p className="text-slate-400 text-[11px] mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(inRange.length > 0 || diSettled.length > 0 || reportsDineInLoading) && (
              <>
                {/* POS KPI cards — only shown when POS has data */}
                {inRange.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
                    {[
                      { label: "POS Revenue", value: fmt(rRevenue, sym), sub: `${rMoneyBearing.length} txns`, icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/10" },
                      { label: "Avg Order", value: fmt(rAvgOrder, sym), sub: "per transaction", icon: Receipt, color: "text-blue-400", bg: "bg-blue-500/10" },
                      { label: "Gross Profit", value: fmt(grossProfit, sym), sub: `${fmtPct(marginPct)} margin`, icon: BarChart3, color: "text-purple-400", bg: "bg-purple-500/10" },
                      { label: "VAT Collected", value: fmt(rTax, sym), sub: "excl. refunded", icon: Percent, color: "text-amber-400", bg: "bg-amber-500/10" },
                      { label: "Tips", value: fmt(rTips, sym), sub: "staff tips", icon: BadgeDollarSign, color: "text-pink-400", bg: "bg-pink-500/10" },
                      { label: "Discounts", value: fmt(rDiscounts, sym), sub: "reductions applied", icon: Tag, color: "text-red-400", bg: "bg-red-500/10" },
                      { label: "Service Fees", value: fmt(rServiceFees, sym), sub: `${rFiltered.length} txns`, icon: DollarSign, color: "text-blue-400", bg: "bg-blue-500/10" },
                    ].map((card) => (
                      <div key={card.label} className="bg-slate-800 border border-slate-700 rounded-2xl p-3 sm:p-4">
                        <div className={`w-9 h-9 ${card.bg} rounded-xl flex items-center justify-center mb-2.5`}>
                          <card.icon size={17} className={card.color} />
                        </div>
                        <p className={`text-lg sm:text-xl font-bold ${card.color}`}>{card.value}</p>
                        {card.sub && <p className="text-slate-500 text-[10px] mt-0.5">{card.sub}</p>}
                        <p className="text-slate-400 text-[11px] mt-0.5">{card.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sub-tab bar */}
                <div className="flex gap-1 bg-slate-900 border border-slate-700 p-1 rounded-xl">
                  {(["overview", "items", "staff", "transactions"] as ReportTab[]).map((t) => (
                    <button key={t} onClick={() => setReportTab(t)}
                      className={`flex-1 px-1.5 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${reportTab === t ? "bg-slate-700 text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
                        }`}>
                      {t === "transactions" ? "Transactions" : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                {/* ── Overview sub-tab ─────────────────────────────────────── */}
                {reportTab === "overview" && (
                  <div className="space-y-4">
                    {/* Daily chart */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                      <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                        <BarChart3 size={16} className="text-orange-400" /> Revenue by Day
                      </h3>
                      {dailyBuckets.length <= 1 ? (
                        <p className="text-slate-500 text-sm">Select a wider date range to see the daily chart.</p>
                      ) : (
                        <div className="flex items-end gap-1" style={{ height: 140 }}>
                          {dailyBuckets.map((d, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.label}: ${fmt(d.revenue, sym)}`}>
                              <div className="w-full flex items-end justify-center" style={{ height: 110 }}>
                                <div className={`w-full rounded-t-md transition-all ${d.revenue > 0 ? "bg-orange-500" : "bg-slate-700"}`}
                                  style={{ height: `${Math.max(4, (d.revenue / maxDaily) * 100)}%` }} />
                              </div>
                              {dailyBuckets.length <= 14 && (
                                <span className="text-[9px] text-slate-500 text-center leading-tight">{d.label.split(" ").slice(0, 2).join(" ")}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Payment methods */}
                      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                        <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                          <CreditCard size={16} className="text-blue-400" /> Payment Methods
                        </h3>
                        <div className="space-y-3">
                          {reportPaymentRows.map(({ key, label, bar, Icon }) => {
                            const count = rPayMix[key];
                            const pct = (count / rPayTotal) * 100;
                            const rev = rMoneyBearing.filter((s) => s.paymentMethod === key).reduce((s, x) => s + rSaleNet(x), 0);
                            return (
                              <div key={key}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm text-slate-300 flex items-center gap-1.5"><Icon size={13} /> {label}</span>
                                  <span className="text-sm font-semibold text-white">{fmt(rev, sym)}</span>
                                </div>
                                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                  <div className={`h-full ${bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5">{count} transactions · {fmtPct(pct)}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Hourly heatmap */}
                      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                        <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                          <TrendingUp size={16} className="text-green-400" /> Busiest Hours
                        </h3>
                        <div className="grid grid-cols-12 gap-0.5">
                          {hourlyBuckets.map((rev, h) => {
                            const p = rev / maxHourly;
                            const intensity = p > 0.75 ? "bg-orange-500" : p > 0.5 ? "bg-orange-400" : p > 0.25 ? "bg-orange-300" : p > 0 ? "bg-orange-900" : "bg-slate-700";
                            return <div key={h} title={`${h}:00 — ${fmt(rev, sym)}`} className={`${intensity} rounded aspect-square`} />;
                          })}
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
                          <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-slate-500">
                          {["bg-slate-700", "bg-orange-900", "bg-orange-300", "bg-orange-400", "bg-orange-500"].map((c) => (
                            <div key={c} className={`w-3 h-3 rounded ${c}`} />
                          ))}
                          <span>Low → High</span>
                        </div>
                      </div>
                    </div>

                    {/* Financial summary */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                      <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                        <Receipt size={16} className="text-slate-400" /> Financial Summary
                      </h3>
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-slate-700/40">
                          {[
                            ["Gross Sales", fmt(rFiltered.reduce((s, x) => s + x.subtotal, 0), sym), "text-slate-200"],
                            ["Discounts", `–${fmt(rDiscounts, sym)}`, "text-red-400"],
                            ["VAT Collected", fmt(rTax, sym), "text-amber-400"],
                            ["Tips", fmt(rTips, sym), "text-pink-400"],
                            ["Service Fees", fmt(rServiceFees, sym), "text-blue-400"],
                            ["Total Revenue", fmt(rRevenue, sym), "font-bold text-white"],
                            ["Est. COGS", `–${fmt(rCost, sym)}`, "text-slate-500"],
                            ["Gross Profit", fmt(grossProfit, sym), "font-semibold text-green-400"],
                            ["Gross Margin", fmtPct(marginPct), "text-purple-400"],
                          ].map(([label, value, cls]) => (
                            <tr key={label}>
                              <td className="py-2 text-slate-400 text-xs">{label}</td>
                              <td className={`py-2 text-right text-sm ${cls}`}>{value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Combined total */}
                    <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 gap-2 sm:gap-3">
                      <div className="bg-slate-700/40 rounded-xl p-3">
                        <p className="text-slate-400 text-xs">POS Revenue</p>
                        <p className="text-white font-bold text-[17px] sm:text-lg">{fmt(rRevenue, sym)}</p>
                        <p className="text-slate-500 text-xs">{rFiltered.length} transactions</p>
                      </div>
                      <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3">
                        <p className="text-violet-300 text-xs">Dine-In Revenue</p>
                        <p className="text-white font-bold text-[17px] sm:text-lg">{fmt(diRevenue, sym)}</p>
                        <p className="text-slate-500 text-xs">{diSettled.length} settled orders</p>
                      </div>
                      <div className="col-span-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <p className="text-emerald-300 text-xs font-bold uppercase tracking-wider">Combined Revenue</p>
                          <p className="text-slate-400 text-xs">{rFiltered.length + diSettled.length} total orders</p>
                        </div>
                        <p className="text-emerald-300 font-black text-xl sm:text-2xl">{fmt(combinedRevenue, sym)}</p>
                      </div>
                      {(diVoided.length > 0 || diRefundedOrders.length > 0) && (
                        <div className="col-span-2 flex gap-3">
                          {diVoided.length > 0 && (
                            <div className="flex-1 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                              <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
                              <div>
                                <p className="text-red-300 text-xs font-semibold">{diVoided.length} Voided</p>
                                <p className="text-slate-500 text-[10px]">Dine-in orders cancelled</p>
                              </div>
                            </div>
                          )}
                          {diRefundedOrders.length > 0 && (
                            <div className="flex-1 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                              <RotateCcw size={13} className="text-amber-400 flex-shrink-0" />
                              <div>
                                <p className="text-amber-300 text-xs font-semibold">{diRefundedOrders.length} Refunded</p>
                                <p className="text-slate-500 text-[10px]">Dine-in orders refunded</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Dine-In breakdown card */}
                    {reportsDineInLoading ? (
                      <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
                        <RefreshCw size={14} className="animate-spin" /> Loading dine-in data…
                      </div>
                    ) : diSettled.length > 0 && (
                      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                          <Utensils size={16} className="text-violet-400" /> Dine-In Performance
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="bg-slate-700/40 rounded-xl p-3 text-center">
                            <p className="text-violet-300 font-bold text-lg">{fmt(diRevenue, sym)}</p>
                            <p className="text-slate-500 text-xs">Revenue</p>
                          </div>
                          <div className="bg-slate-700/40 rounded-xl p-3 text-center">
                            <p className="text-white font-bold text-lg">{diSettled.length}</p>
                            <p className="text-slate-500 text-xs">Tables Served</p>
                          </div>
                          <div className="bg-slate-700/40 rounded-xl p-3 text-center">
                            <p className="text-white font-bold text-lg">{fmt(diAvgOrder, sym)}</p>
                            <p className="text-slate-500 text-xs">Avg Bill</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Payment Methods</p>
                          {(Object.entries(diPayMix) as [string, number][]).filter(([, v]) => v > 0).map(([key, count]) => {
                            const pct = (count / diSettled.length) * 100;
                            const label = key === "cash" ? "Cash" : key === "card" ? "Card" : "Table Service";
                            const color = key === "cash" ? "bg-green-500" : key === "card" ? "bg-blue-500" : "bg-violet-500";
                            return (
                              <div key={key}>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                  <span>{label}</span><span>{count} orders · {fmtPct(pct)}</span>
                                </div>
                                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                  <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Items sub-tab ────────────────────────────────────────── */}
                {reportTab === "items" && (
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-700">
                      <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                        <Package size={16} className="text-orange-400" /> Best-Selling Items
                      </h3>
                    </div>
                    {rBestSellers.length === 0 ? (
                      <p className="p-6 text-slate-500 text-sm">No item data for this period.</p>
                    ) : (
                      <div className="divide-y divide-slate-700/40">
                        {rBestSellers.map((item, i) => (
                          <div key={item.name} className="px-5 py-4 flex items-center gap-3 sm:gap-4">
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i === 0 ? "bg-amber-500 text-white" : i === 1 ? "bg-slate-500 text-white" : i === 2 ? "bg-orange-700 text-white" : "bg-slate-700 text-slate-300"
                              }`}>
                              {i === 0 ? <Trophy size={12} /> : i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm font-medium truncate">{item.name}</p>
                              <div className="h-1.5 bg-slate-700 rounded-full mt-1.5 overflow-hidden">
                                <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(item.revenue / maxItemRev) * 100}%` }} />
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-white font-semibold text-sm">{fmt(item.revenue, sym)}</p>
                              <p className="text-slate-400 text-xs">{item.qty} sold</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Staff sub-tab ────────────────────────────────────────── */}
                {reportTab === "staff" && (
                  <div className="space-y-4">
                    {/* POS Staff */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-700">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                          <Users size={16} className="text-blue-400" /> POS Staff Performance
                        </h3>
                      </div>
                      {staffPerf.length === 0 ? (
                        <p className="p-6 text-slate-500 text-sm">No POS staff data for this period.</p>
                      ) : (
                        <div className="divide-y divide-slate-700/40">
                          {staffPerf.map((s, i) => (
                            <div key={s.name} className="px-5 py-4 flex flex-wrap items-center gap-3 sm:gap-4">
                              <div className="flex flex-1 gap-2">
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i === 0 ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-300"
                                  }`}>
                                  {i === 0 ? <Trophy size={12} /> : i + 1}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-white text-sm font-medium">{s.name}</p>
                                  <div className="h-1.5 bg-slate-700 rounded-full mt-1.5 overflow-hidden">
                                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(s.revenue / maxStaffRev) * 100}%` }} />
                                  </div>
                                </div>
                              </div>

                              <div className="text-right flex-shrink-0 ml-8">
                                <p className="text-white font-semibold text-sm">{fmt(s.revenue, sym)}</p>
                                <p className="text-slate-400 text-xs">{s.sales} sales · avg {fmt(s.avgOrder, sym)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Waiter Staff */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                      {/* Header */}
                      <div className="px-5 py-4 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                          <Utensils size={16} className="text-violet-400" /> Waiter Performance | Dine-In
                        </h3>
                        {!reportsDineInLoading && diSettled.length > 0 && (
                          <span className="text-xs text-slate-500">{diSettled.length} settled orders</span>
                        )}
                      </div>

                      {reportsDineInLoading ? (
                        <div className="p-6 flex items-center gap-2 text-slate-500 text-sm">
                          <RefreshCw size={14} className="animate-spin" /> Loading dine-in data…
                        </div>
                      ) : diStaffPerf.length === 0 ? (
                        <div className="p-10 text-center">
                          <Utensils size={32} className="mx-auto text-slate-700 mb-3" />
                          <p className="text-slate-500 text-sm">No dine-in orders for this period.</p>
                        </div>
                      ) : (
                        <>
                          {/* Period KPI strip */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-700 border-b border-slate-700">
                            {[
                              { label: "Revenue", value: fmt(diRevenue, sym), color: "text-violet-300" },
                              { label: "Tables", value: String(diSettled.length), color: "text-white" },
                              { label: "Covers", value: diTotalCovers > 0 ? String(diTotalCovers) : "—", color: "text-white" },
                              { label: "Avg Bill", value: fmt(diAvgOrder, sym), color: "text-emerald-300" },
                            ].map(({ label, value, color }) => (
                              <div key={label} className="px-4 py-3 text-center">
                                <p className={`font-bold text-base ${color}`}>{value}</p>
                                <p className="text-slate-500 text-[10px] mt-0.5 uppercase tracking-wider">{label}</p>
                              </div>
                            ))}
                          </div>

                          {/* Per-waiter rows */}
                          <div className="divide-y divide-slate-700/40">
                            {diStaffPerf.map((s, i) => {
                              const pct = (s.revenue / maxDiRevenue) * 100;
                              const avgBill = s.orders > 0 ? s.revenue / s.orders : 0;
                              const initials = s.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();
                              const medals = ["bg-amber-500", "bg-slate-400", "bg-orange-700"];
                              return (
                                <div key={s.name} className="px-5 py-4">
                                  <div className="flex items-center gap-3 mb-2.5">
                                    {/* Rank + Avatar */}
                                    <div className="relative flex-shrink-0">
                                      <div className="w-9 h-9 rounded-full bg-violet-600/30 border border-violet-500/40 flex items-center justify-center text-violet-200 font-bold text-xs">
                                        {initials}
                                      </div>
                                      <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white ${medals[i] ?? "bg-slate-600"}`}>
                                        {i + 1}
                                      </span>
                                    </div>

                                    {/* Name + bar */}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-white text-sm font-semibold leading-none mb-1.5">{s.name}</p>
                                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                      </div>
                                    </div>

                                    {/* Revenue */}
                                    <div className="text-right flex-shrink-0">
                                      <p className="text-white font-bold text-sm">{fmt(s.revenue, sym)}</p>
                                      <p className="text-violet-400 text-xs">{fmtPct(pct)} of total</p>
                                    </div>
                                  </div>

                                  {/* Stat pills */}
                                  <div className="flex flex-wrap gap-2 ml-12">
                                    <span className="text-[11px] bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-full">
                                      🍽 {s.orders} table{s.orders !== 1 ? "s" : ""}
                                    </span>
                                    {s.covers > 0 && (
                                      <span className="text-[11px] bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-full">
                                        👥 {s.covers} cover{s.covers !== 1 ? "s" : ""}
                                      </span>
                                    )}
                                    <span className="text-[11px] bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-full">
                                      📦 {s.items} item{s.items !== 1 ? "s" : ""}
                                    </span>
                                    <span className="text-[11px] bg-violet-900/40 text-violet-300 px-2.5 py-1 rounded-full">
                                      avg {fmt(avgBill, sym)} / table
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Transactions sub-tab ─────────────────────────────────── */}
                {reportTab === "transactions" && (
                  <div className="space-y-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                      {/* Toolbar */}
                      <div className="px-5 py-4 border-b border-slate-700 flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-48 relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                          <input value={txSearch} onChange={(e) => setTxSearch(e.target.value)}
                            placeholder="Search receipt, staff, customer…"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-9 pr-4 py-2 text-sm text-white outline-none focus:border-orange-500 placeholder-slate-500" />
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                          <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} className="rounded accent-orange-500" />
                          Show voided
                        </label>
                        <p className="text-slate-600 text-xs ml-auto">{txSorted.length} rows</p>
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-900/60 text-left">
                              <th className="px-5 py-3 text-xs text-slate-500 font-semibold">Receipt</th>
                              <th className="px-5 py-3 text-xs text-slate-500 font-semibold cursor-pointer hover:text-slate-300"
                                onClick={() => toggleSort("date")}>
                                Date {sortField === "date" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                              </th>
                              <th className="px-5 py-3 text-xs text-slate-500 font-semibold">Staff</th>
                              <th className="px-5 py-3 text-xs text-slate-500 font-semibold">Customer</th>
                              <th className="px-5 py-3 text-xs text-slate-500 font-semibold">Payment</th>
                              <th className="px-5 py-3 text-xs text-slate-500 font-semibold cursor-pointer hover:text-slate-300 text-right"
                                onClick={() => toggleSort("total")}>
                                Total {sortField === "total" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                              </th>
                              {currentStaff?.permissions.canVoidSale && (
                                <th className="px-4 py-3 text-xs text-slate-500 font-semibold" />
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/30">
                            {txSorted.length === 0 ? (
                              <tr><td colSpan={currentStaff?.permissions.canVoidSale ? 7 : 6} className="px-5 py-8 text-center text-slate-500 text-sm">No transactions found</td></tr>
                            ) : txSorted.map((sale) => {
                              const net = rSaleNet(sale);
                              // Fully refunded = money truly gone → dim + strike. A
                              // no-refund/partial void kept money, so keep it legible.
                              const fullyRefunded = sale.voided && net === 0;
                              return (
                              <tr key={sale.id} className={`hover:bg-slate-700/30 transition-colors ${fullyRefunded ? "opacity-40" : sale.voided ? "opacity-70" : ""}`}>
                                <td className="px-5 py-3 font-mono text-xs text-slate-300">
                                  <div>#{sale.receiptNo}</div>
                                  {sale.voided && (
                                    <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-semibold">VOID</span>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-slate-400 text-xs whitespace-nowrap">
                                  {fmtDate(sale.date)}<br />
                                  <span className="text-slate-600">{fmtTime(sale.date)}</span>
                                </td>
                                <td className="px-5 py-3 text-slate-300">{sale.staffName}</td>
                                <td className="px-5 py-3 text-slate-500 text-xs">{sale.customerName ?? "—"}</td>
                                <td className="px-5 py-3">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${sale.paymentMethod === "cash" ? "bg-green-500/20 text-green-400" :
                                    sale.paymentMethod === "card" ? "bg-blue-500/20  text-blue-400" :
                                      "bg-purple-500/20 text-purple-400"
                                    }`}>{sale.paymentMethod}</span>
                                  {sale.voided && sale.refundMethod && sale.refundMethod !== "none" && (
                                    <div className={`mt-1 text-[10px] flex items-center gap-1 font-semibold ${sale.refundMethod === "cash" ? "text-green-400" : "text-blue-400"
                                      }`}>
                                      {sale.refundMethod === "cash" ? <Banknote size={10} /> : <CreditCard size={10} />}
                                      Refund {fmt(sale.refundAmount ?? 0, sym)}
                                    </div>
                                  )}
                                  {sale.voided && sale.refundMethod === "none" && (
                                    <div className="mt-1 text-[10px] text-slate-500 font-semibold">No refund</div>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-right">
                                  <span className={`font-semibold ${fullyRefunded ? "text-red-400 line-through" : "text-white"}`}>
                                    {fmt(sale.total, sym)}
                                  </span>
                                  {sale.voided && net > 0 && (
                                    <div className="text-[10px] text-amber-400 mt-0.5">{fmt(net, sym)} kept</div>
                                  )}
                                </td>
                                {currentStaff?.permissions.canVoidSale && (
                                  <td className="px-4 py-3 text-center">
                                    {!sale.voided ? (
                                      <button
                                        onClick={() => { openVoidModal(sale.id); }}
                                        title="Void transaction"
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 transition-all"
                                      >
                                        <Trash2 size={11} /> Void
                                      </button>
                                    ) : (
                                      <span className="text-slate-600 text-[11px]">Voided</span>
                                    )}
                                  </td>
                                )}
                              </tr>
                              );
                            })}
                          </tbody>
                          {txSorted.length > 0 && (
                            <tfoot>
                              <tr className="bg-slate-900/60 border-t-2 border-slate-600">
                                <td colSpan={currentStaff?.permissions.canVoidSale ? 6 : 5} className="px-5 py-3 text-xs font-semibold text-slate-400">
                                  Retained income ({txSorted.filter((s) => !s.voided || rSaleNet(s) > 0).length} money-bearing)
                                </td>
                                <td className="px-5 py-3 text-right font-bold text-white">
                                  {fmt(txSorted.reduce((s, x) => s + rSaleNet(x), 0), sym)}
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>

                    {/* Dine-In transactions */}
                    {reportsDineIn.length > 0 && (
                      <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                            <Utensils size={16} className="text-violet-400" /> Dine-In Orders
                          </h3>
                          <span className="text-slate-500 text-xs">{reportsDineIn.length} orders</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-700 text-left">
                                <th className="px-5 py-3 text-xs font-semibold text-slate-400">Date / Time</th>
                                <th className="px-5 py-3 text-xs font-semibold text-slate-400">Table</th>
                                <th className="px-5 py-3 text-xs font-semibold text-slate-400">Waiter</th>
                                <th className="px-5 py-3 text-xs font-semibold text-slate-400">Items</th>
                                <th className="px-5 py-3 text-xs font-semibold text-slate-400">Status</th>
                                <th className="px-5 py-3 text-xs font-semibold text-slate-400 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/40">
                              {reportsDineIn.map((o) => {
                                const refundState = dineInRefundState(o);
                                return (
                                <tr key={o.id} className="hover:bg-slate-700/30 transition-colors">
                                  <td className="px-5 py-3 text-slate-400 text-xs whitespace-nowrap">
                                    {new Date(o.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{" "}
                                    {new Date(o.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </td>
                                  <td className="px-5 py-3 text-white font-semibold">T{o.tableLabel}</td>
                                  <td className="px-5 py-3 text-slate-300">{o.staffName}</td>
                                  <td className="px-5 py-3 text-slate-400 text-xs max-w-[180px] truncate">
                                    {o.items.map(it => `${it.qty}× ${it.name}`).join(", ")}
                                  </td>
                                  <td className="px-5 py-3">
                                    <span className={`text-xs whitespace-nowrap font-semibold px-2 py-0.5 rounded-full ${
                                      refundState === "refunded" ? "bg-amber-500/20 text-amber-300" :
                                        refundState === "partially_refunded" ? "bg-amber-500/15 text-amber-400" :
                                          o.status === "delivered" ? "bg-emerald-500/20 text-emerald-300" :
                                            o.status === "cancelled" ? "bg-red-500/20 text-red-400" :
                                              "bg-blue-500/20 text-blue-300"
                                      }`}>
                                      {refundState === "refunded" ? "Refunded" :
                                        refundState === "partially_refunded" ? "Part. Refund" :
                                          o.status === "delivered" ? "Settled" :
                                            o.status === "cancelled" ? "Voided" :
                                              o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                                    </span>
                                  </td>
                                  <td className={`px-5 py-3 text-right font-bold ${o.status === "cancelled" ? "text-red-400 line-through opacity-50" :
                                    refundState === "refunded" ? "text-amber-400 line-through opacity-70" :
                                      "text-white"
                                    }`}>{fmt(o.total, sym)}</td>
                                </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-slate-900/60 border-t-2 border-slate-600">
                                <td colSpan={5} className="px-5 py-3 text-xs font-semibold text-slate-400">
                                  Dine-In Total ({diSettled.length} settled)
                                </td>
                                <td className="px-5 py-3 text-right font-bold text-violet-300">
                                  {fmt(diSettled.reduce((s, o) => s + o.total, 0), sym)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Dine-In Orders tab ───────────────────────────────────────────── */}
        {dashTab === "dine-in" && (
          <div className="space-y-8">
            {dineInLoading ? (
              <div className="flex items-center justify-center py-20 text-slate-400">
                <RefreshCw size={24} className="animate-spin mr-3" />
                Loading dine-in orders…
              </div>
            ) : dineInOrders.length === 0 ? (
              <div className="flex flex-col text-center items-center justify-center py-20 text-slate-500">
                <Utensils size={48} className="mb-4 opacity-30" />
                <p className="text-lg font-medium">No dine-in orders found</p>
                <p className="text-sm mt-1">Waiter orders will appear here once placed</p>
              </div>
            ) : (
              <>
                {/* Open / active orders */}
                {dineInOrders.filter(o => o.status !== "delivered" && o.status !== "cancelled").length > 0 && (
                  <div>
                    <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3">
                      Open Tables ({dineInOrders.filter(o => o.status !== "delivered" && o.status !== "cancelled").length})
                    </h3>
                    <div className="space-y-3">
                      {dineInOrders
                        .filter(o => o.status !== "delivered" && o.status !== "cancelled")
                        .map(order => (
                          <div key={order.id} className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                            <div className="flex items-start justify-between gap-4 mb-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-white font-bold text-lg">Table {order.tableLabel}</span>
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${order.status === "confirmed" ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" :
                                    order.status === "preparing" ? "bg-orange-500/20 text-orange-300 border border-orange-500/30" :
                                      order.status === "ready" ? "bg-green-500/20 text-green-300 border border-green-500/30" :
                                        "bg-slate-600/50 text-slate-300 border border-slate-600"
                                    }`}>
                                    {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                                  </span>
                                </div>
                                <p className="text-slate-400 text-sm mt-0.5">
                                  {order.staffName && <span>{order.staffName} · </span>}
                                  {order.covers > 0 && <span>{order.covers} covers · </span>}
                                  <span>{new Date(order.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-white font-bold text-lg sm:text-xl">{settings.currencySymbol}{order.total.toFixed(2)}</p>
                              </div>
                            </div>
                            <div className="border-t border-slate-700 pt-3">
                              <div className="flex flex-wrap gap-2">
                                {order.items.map((item, i) => (
                                  <span key={i} className="text-xs bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg">
                                    {item.qty}× {item.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 mt-4">
                              <button
                                onClick={() => printDineInReceipt(order)}
                                className="flex items-center justify-center sm:justify-start gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors"
                              >
                                <Printer size={14} />
                                Print
                              </button>
                              <div className="flex-1 flex flex-col sm:flex-row gap-2">
                                <input
                                  type="email"
                                  placeholder="Email receipt…"
                                  value={dineInEmail[order.id] ?? ""}
                                  onChange={e => setDineInEmail(prev => ({ ...prev, [order.id]: e.target.value }))}
                                  className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-violet-500 placeholder-slate-500 min-w-0"
                                />
                                <button
                                  onClick={() => sendDineInEmail(order)}
                                  disabled={dineInEmailSt[order.id] === "sending" || !dineInEmail[order.id]}
                                  className="flex items-center justify-center sm:justify-start gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                                >
                                  <Mail size={14} />
                                  {dineInEmailSt[order.id] === "sending" ? "Sending…" :
                                    dineInEmailSt[order.id] === "sent" ? "Sent!" :
                                      dineInEmailSt[order.id] === "error" ? "Failed" : "Send"}
                                </button>
                              </div>
                              {currentStaff?.permissions.canVoidSale && (
                                <button
                                  onClick={() => setDiAction({ mode: "void", order })}
                                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-2 bg-red-900/30 hover:bg-red-900/60 border border-red-800/50 text-red-400 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                                >
                                  <AlertTriangle size={13} /> Void
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Settled orders (refunded ones keep status "delivered" but move
                    to the Voided / Refunded section below) */}
                {dineInOrders.filter(o => o.status === "delivered" && dineInRefundState(o) === null).length > 0 && (
                  <div>
                    <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3">
                      Settled Today ({dineInOrders.filter(o => o.status === "delivered" && dineInRefundState(o) === null).length})
                    </h3>
                    <div className="space-y-3">
                      {dineInOrders
                        .filter(o => o.status === "delivered" && dineInRefundState(o) === null)
                        .map(order => (
                          <div key={order.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 opacity-80">
                            <div className="flex items-start justify-between gap-4 mb-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-slate-300 font-bold text-lg">Table {order.tableLabel}</span>
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    Settled
                                  </span>
                                  {order.paymentMethod && order.paymentMethod !== "table-service" && (
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-600/50 text-slate-400 border border-slate-600">
                                      {order.paymentMethod.charAt(0).toUpperCase() + order.paymentMethod.slice(1)}
                                    </span>
                                  )}
                                </div>
                                <p className="text-slate-500 text-sm mt-0.5">
                                  {order.staffName && <span>{order.staffName} · </span>}
                                  <span>{new Date(order.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-slate-300 font-bold text-lg sm:text-xl">{settings.currencySymbol}{order.total.toFixed(2)}</p>
                              </div>
                            </div>
                            <div className="border-t border-slate-700/50 pt-3 mb-4">
                              <div className="flex flex-wrap gap-2">
                                {order.items.map((item, i) => (
                                  <span key={i} className="text-xs bg-slate-700/50 text-slate-400 px-2.5 py-1 rounded-lg">
                                    {item.qty}× {item.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <button
                                onClick={() => printDineInReceipt(order)}
                                className="flex items-center justify-center sm:justify-start gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors"
                              >
                                <Printer size={14} />
                                Reprint
                              </button>
                              <div className="flex-1 flex flex-col sm:flex-row gap-2">
                                <input
                                  type="email"
                                  placeholder="Email receipt…"
                                  value={dineInEmail[order.id] ?? ""}
                                  onChange={e => setDineInEmail(prev => ({ ...prev, [order.id]: e.target.value }))}
                                  className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-violet-500 placeholder-slate-500 min-w-0"
                                />
                                <button
                                  onClick={() => sendDineInEmail(order)}
                                  disabled={dineInEmailSt[order.id] === "sending" || !dineInEmail[order.id]}
                                  className="flex items-center justify-center sm:justify-start gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                                >
                                  <Mail size={14} />
                                  {dineInEmailSt[order.id] === "sending" ? "Sending…" :
                                    dineInEmailSt[order.id] === "sent" ? "Sent!" :
                                      dineInEmailSt[order.id] === "error" ? "Failed" : "Send"}
                                </button>
                              </div>
                              {currentStaff?.permissions.canIssueRefund && (
                                <button
                                  onClick={() => setDiAction({ mode: "refund", order })}
                                  className="flex items-center justify-center sm:justify-start gap-1.5 px-3 py-2 bg-amber-900/30 hover:bg-amber-900/60 border border-amber-800/50 text-amber-400 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                                >
                                  <RotateCcw size={13} /> Refund
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Voided & Refunded orders */}
                {dineInOrders.filter(o => o.status === "cancelled" || dineInRefundState(o) !== null).length > 0 && (
                  <div>
                    <h3 className="text-slate-400 font-semibold text-sm uppercase tracking-wider mb-3">
                      Voided / Refunded ({dineInOrders.filter(o => o.status === "cancelled" || dineInRefundState(o) !== null).length})
                    </h3>
                    <div className="space-y-3">
                      {dineInOrders
                        .filter(o => o.status === "cancelled" || dineInRefundState(o) !== null)
                        .map(order => (
                          <div key={order.id} className="bg-slate-800/30 border border-slate-700/30 rounded-2xl p-5 opacity-60">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-slate-400 font-bold">Table {order.tableLabel}</span>
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${order.status === "cancelled"
                                    ? "bg-red-500/15 text-red-400 border-red-500/25"
                                    : "bg-amber-500/15 text-amber-400 border-amber-500/25"
                                    }`}>
                                    {order.status === "cancelled" ? "Voided" : dineInRefundState(order) === "refunded" ? "Refunded" : "Partial Refund"}
                                  </span>
                                </div>
                                <p className="text-slate-500 text-sm mt-0.5">
                                  {order.staffName && <span>{order.staffName} · </span>}
                                  <span>{new Date(order.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                </p>
                              </div>
                              <p className="text-slate-500 font-bold text-lg sm:text-xl line-through">{sym}{order.total.toFixed(2)}</p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>



      {/* Dine-in Void / Refund modal */}
      {diAction && (
        <DineInActionModal
          action={diAction}
          onClose={() => setDiAction(null)}
          onComplete={() => { refreshDineInTab(); refreshTodayDineIn(); }}
        />
      )}

      {/* Void + Refund modal (POS sale) */}
      {voidTargetSale && (
        <VoidSaleModal sale={voidTargetSale} onClose={() => setVoidTargetSale(null)} />
      )}
    </div>
  );
}
