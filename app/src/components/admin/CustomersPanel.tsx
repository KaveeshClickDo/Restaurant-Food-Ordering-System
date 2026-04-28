"use client";

import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { Customer, Order, OrderStatus } from "@/types";
import {
  sendEmailViaApi, buildVarMap, applyVars, buildEmailDocument,
} from "@/lib/emailTemplates";
import {
  Users, Search, ChevronRight, X, Phone, Mail, MapPin,
  ShoppingBag, Clock, TrendingUp, Star, ArrowUpDown,
  CheckCircle2, ChefHat, Package, Truck, Ban,
  Circle, RefreshCw, Receipt, Printer, Send,
  CheckCheck, AlertCircle, RotateCcw,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OrderStatus, { label: string; className: string; icon: React.ReactNode }> = {
  pending:    { label: "Pending",    className: "bg-yellow-50 text-yellow-700 border-yellow-200",  icon: <Circle size={11} className="fill-yellow-400 text-yellow-400" /> },
  confirmed:  { label: "Confirmed",  className: "bg-blue-50 text-blue-700 border-blue-200",        icon: <CheckCircle2 size={11} className="text-blue-500" /> },
  preparing:  { label: "Preparing",  className: "bg-orange-50 text-orange-700 border-orange-200",  icon: <ChefHat size={11} className="text-orange-500" /> },
  ready:      { label: "Ready",      className: "bg-purple-50 text-purple-700 border-purple-200",  icon: <Package size={11} className="text-purple-500" /> },
  delivered:  { label: "Delivered",  className: "bg-green-50 text-green-700 border-green-200",     icon: <Truck size={11} className="text-green-600" /> },
  cancelled:          { label: "Cancelled",          className: "bg-red-50 text-red-700 border-red-200",     icon: <Ban size={11} className="text-red-500" /> },
  refunded:           { label: "Refunded",           className: "bg-teal-50 text-teal-700 border-teal-200",   icon: <RotateCcw size={11} className="text-teal-600" /> },
  partially_refunded: { label: "Partially Refunded", className: "bg-cyan-50 text-cyan-700 border-cyan-200",   icon: <RotateCcw size={11} className="text-cyan-600" /> },
};

const ORDER_STATUS_FLOW: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "delivered"];

const TAG_COLORS: Record<string, string> = {
  VIP:      "bg-amber-100 text-amber-700 border-amber-200",
  Regular:  "bg-blue-100 text-blue-700 border-blue-200",
  New:      "bg-green-100 text-green-700 border-green-200",
  Inactive: "bg-gray-100 text-gray-500 border-gray-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function totalSpent(c: Customer) {
  return c.orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);
}
function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <div className="text-orange-400">{icon}</div>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type SortKey = "name" | "orders" | "spent" | "joined";
type SortDir = "asc" | "desc";

export default function CustomersPanel() {
  const { customers, updateOrderStatus } = useApp();
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("spent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Quick stats
  const totalRevenue = customers.reduce((s, c) => s + totalSpent(c), 0);
  const totalOrders  = customers.reduce((s, c) => s + c.orders.length, 0);
  const activeToday  = customers.filter((c) => c.orders.some((o) => daysSince(o.date) === 0)).length;
  const allTags = Array.from(new Set(customers.flatMap((c) => c.tags)));

  // Sort
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  // Filtered + sorted customers
  const displayed = useMemo(() => {
    const list = customers.filter((c) => {
      const q = search.toLowerCase();
      const matchSearch = !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q);
      const matchTag = tagFilter === "all" || c.tags.includes(tagFilter);
      return matchSearch && matchTag;
    });
    list.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortKey === "name")   { av = a.name; bv = b.name; }
      if (sortKey === "orders") { av = a.orders.length; bv = b.orders.length; }
      if (sortKey === "spent")  { av = totalSpent(a); bv = totalSpent(b); }
      if (sortKey === "joined") { av = a.createdAt; bv = b.createdAt; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [customers, search, tagFilter, sortKey, sortDir]);

  function SortBtn({ k, children }: { k: SortKey; children: React.ReactNode }) {
    return (
      <button
        onClick={() => toggleSort(k)}
        className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition ${
          sortKey === k ? "text-orange-500" : "text-gray-400 hover:text-gray-600"
        }`}
      >
        {children}
        <ArrowUpDown size={10} className={sortKey === k ? "text-orange-400" : "text-gray-300"} />
      </button>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total customers"  value={customers.length}         sub={`${activeToday} active today`}    icon={<Users size={18} />} />
        <StatCard label="Total orders"     value={totalOrders}              sub="all time"                          icon={<ShoppingBag size={18} />} />
        <StatCard label="Total revenue"    value={`£${totalRevenue.toFixed(2)}`} sub="delivered orders only"      icon={<TrendingUp size={18} />} />
        <StatCard label="Avg. order value" value={`£${totalOrders ? (totalRevenue / totalOrders).toFixed(2) : "0.00"}`} sub="per order"  icon={<Star size={18} />} />
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users size={16} className="text-orange-600" />
            </div>
            <div>
              <span className="font-bold text-gray-900 text-sm">Customers</span>
              <span className="text-xs text-gray-400 ml-2">{displayed.length} shown</span>
            </div>
          </div>

          {/* Tag filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            {["all", ...allTags].map((t) => (
              <button
                key={t}
                onClick={() => setTagFilter(t)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition capitalize ${
                  tagFilter === t
                    ? "bg-orange-500 text-white border-orange-500"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-auto">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers…"
              className="pl-8 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition w-full sm:w-52"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-5 py-3"><SortBtn k="name">Customer</SortBtn></th>
                <th className="text-left px-4 py-3 hidden md:table-cell"><span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Contact</span></th>
                <th className="text-left px-4 py-3"><SortBtn k="orders">Orders</SortBtn></th>
                <th className="text-left px-4 py-3"><SortBtn k="spent">Spent</SortBtn></th>
                <th className="text-left px-4 py-3 hidden lg:table-cell"><SortBtn k="joined">Joined</SortBtn></th>
                <th className="text-left px-4 py-3 hidden sm:table-cell"><span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Tags</span></th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                    No customers match your search.
                  </td>
                </tr>
              )}
              {displayed.map((c) => {
                const lastOrder = [...c.orders].sort((a, b) => b.date.localeCompare(a.date))[0];
                const spent = totalSpent(c);
                return (
                  <tr key={c.id} className="hover:bg-orange-50/20 transition-colors group">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-red-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900 text-sm">{c.name}</div>
                          {lastOrder && (
                            <div className="text-[11px] text-gray-400">Last order {fmtDate(lastOrder.date)}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      <div className="text-sm text-gray-600">{c.email}</div>
                      <div className="text-xs text-gray-400">{c.phone}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-gray-900 text-sm">{c.orders.length}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-bold text-gray-900 text-sm">£{spent.toFixed(2)}</span>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell text-sm text-gray-500">{fmtDate(c.createdAt)}</td>
                    <td className="px-4 py-3.5 hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TAG_COLORS[t] ?? "bg-gray-100 text-gray-500"}`}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => setSelectedCustomer(c)}
                        className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-700 font-medium transition sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        View <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer detail drawer */}
      {selectedCustomer && (
        <CustomerDrawer
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          onStatusChange={(cid, oid, s) => {
            updateOrderStatus(cid, oid, s);
            // Keep drawer in sync
            setSelectedCustomer((prev) =>
              prev
                ? {
                    ...prev,
                    orders: prev.orders.map((o) => (o.id === oid ? { ...o, status: s } : o)),
                  }
                : null
            );
          }}
        />
      )}
    </div>
  );
}

// ─── Pure print helper (no DOM ref required) ──────────────────────────────────

function buildPrintHtml(
  order: Order,
  customer: Customer,
  rs: { showLogo: boolean; logoUrl: string; restaurantName: string; phone: string; website: string; email: string; vatNumber: string; thankYouMessage: string; customMessage: string },
  restaurantAddress: string,
): string {
  const subtotal     = order.items.reduce((s, l) => s + l.price * l.qty, 0);
  const deliveryFee  = order.deliveryFee  ?? 0;
  const serviceFee   = order.serviceFee   ?? 0;
  const couponDisc   = order.couponDiscount ?? 0;
  const vatAmt       = order.vatAmount    ?? 0;
  const vatInclusive = order.vatInclusive ?? true;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Receipt #${order.id.slice(-8).toUpperCase()}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',monospace;font-size:12px;color:#111;background:#fff;padding:16px}
    .r{max-width:300px;margin:0 auto}
    .c{text-align:center}
    .b{font-weight:bold}
    .d{border-top:1px dashed #999;margin:8px 0}
    .row{display:flex;justify-content:space-between;margin:3px 0}
    .tot{display:flex;justify-content:space-between;font-weight:bold;font-size:14px;margin-top:4px}
    .sm{font-size:10px;color:#555}
    .logo{max-height:60px;max-width:160px;object-fit:contain;margin:0 auto 6px;display:block}
  </style>
</head>
<body onload="window.print();window.close();">
<div class="r">
  ${rs.showLogo && rs.logoUrl ? `<img src="${rs.logoUrl}" class="logo" alt="Logo"/>` : ""}
  <div class="c b" style="font-size:15px">${rs.restaurantName}</div>
  ${restaurantAddress ? `<div class="c sm">${restaurantAddress}</div>` : ""}
  ${rs.phone   ? `<div class="c sm">${rs.phone}</div>`              : ""}
  ${rs.website ? `<div class="c sm">${rs.website}</div>`            : ""}
  ${rs.email   ? `<div class="c sm">${rs.email}</div>`              : ""}
  ${rs.vatNumber ? `<div class="c sm">VAT: ${rs.vatNumber}</div>`   : ""}
  <div class="d"></div>
  <div class="c b">RECEIPT</div>
  <div class="c sm">#${order.id.slice(-8).toUpperCase()}</div>
  <div class="c sm">${fmtDate(order.date)} at ${fmtTime(order.date)}</div>
  <div class="d"></div>
  <div class="row"><span>Customer:</span><span>${customer.name}</span></div>
  <div class="row"><span>Type:</span><span>${order.fulfillment === "delivery" ? "Delivery" : "Collection"}</span></div>
  ${order.address     ? `<div class="row"><span>Address:</span><span style="text-align:right;max-width:180px">${order.address}</span></div>` : ""}
  ${order.scheduledTime ? `<div class="row"><span>Scheduled:</span><span>${order.scheduledTime}</span></div>` : ""}
  <div class="d"></div>
  ${order.items.map((l) => `<div class="row"><span>${l.qty}x ${l.name}</span><span>£${(l.price * l.qty).toFixed(2)}</span></div>`).join("")}
  <div class="d"></div>
  <div class="row"><span>Subtotal</span><span>£${subtotal.toFixed(2)}</span></div>
  ${order.fulfillment === "delivery" ? `<div class="row"><span>Delivery fee</span><span>£${deliveryFee.toFixed(2)}</span></div>` : ""}
  ${serviceFee > 0 ? `<div class="row"><span>Service fee</span><span>£${serviceFee.toFixed(2)}</span></div>` : ""}
  ${couponDisc > 0 ? `<div class="row" style="color:#16a34a;font-weight:600"><span>Coupon (${order.couponCode ?? ""})</span><span>-£${couponDisc.toFixed(2)}</span></div>` : ""}
  ${vatAmt > 0 ? `<div class="row" style="color:${vatInclusive ? "#9ca3af" : "#ea580c"};font-weight:600"><span>${vatInclusive ? "Incl. VAT" : "VAT"}</span><span>${vatInclusive ? "" : "+"}£${vatAmt.toFixed(2)}</span></div>` : ""}
  <div class="d"></div>
  <div class="tot"><span>TOTAL</span><span>£${order.total.toFixed(2)}</span></div>
  ${vatAmt > 0 && vatInclusive ? `<div class="c sm" style="margin-top:3px">Prices include VAT</div>` : ""}
  ${order.paymentMethod ? `<div class="row" style="margin-top:6px"><span>Payment:</span><span>${order.paymentMethod}</span></div>` : ""}
  <div class="row"><span>Status:</span><span>${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span></div>
  <div class="d"></div>
  ${rs.thankYouMessage ? `<div class="c b" style="margin-bottom:3px">${rs.thankYouMessage}</div>` : ""}
  ${rs.customMessage   ? `<div class="c sm" style="margin-bottom:3px;white-space:pre-wrap">${rs.customMessage}</div>` : ""}
  <div class="c sm">${rs.restaurantName}</div>
</div>
</body>
</html>`;
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────

function ReceiptModal({
  order,
  customer,
  onClose,
}: {
  order: Order;
  customer: Customer;
  onClose: () => void;
}) {
  const { settings } = useApp();
  const { restaurant, receiptSettings: rs } = settings;
  const restaurantAddress = [restaurant.addressLine1, restaurant.city, restaurant.postcode].filter(Boolean).join(", ");

  const subtotal    = order.items.reduce((s, l) => s + l.price * l.qty, 0);
  const deliveryFee = order.deliveryFee   ?? 0;
  const serviceFee  = order.serviceFee    ?? 0;
  const couponDisc  = order.couponDiscount ?? 0;
  const vatAmt      = order.vatAmount     ?? 0;
  const vatRate     = settings.taxSettings?.rate ?? 0;

  function handlePrint() {
    const html = buildPrintHtml(order, customer, rs, restaurantAddress);
    const win  = window.open("", "_blank", "width=420,height=720");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-orange-500" />
            <h2 className="font-bold text-gray-900 text-sm">Receipt #{order.id.slice(-8).toUpperCase()}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition"
            >
              <Printer size={12} /> Print
            </button>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition">
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Receipt body */}
        <div className="flex-1 overflow-y-auto p-5 font-mono text-xs space-y-3 text-gray-800">
          {/* Restaurant header */}
          <div className="text-center space-y-0.5">
            {rs.showLogo && rs.logoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={rs.logoUrl} alt="Logo" className="h-12 object-contain mx-auto mb-1" />
            )}
            <p className="font-bold text-base text-gray-900">{rs.restaurantName}</p>
            {restaurantAddress && <p className="text-gray-500 text-[10px]">{restaurantAddress}</p>}
            {rs.phone   && <p className="text-gray-500">{rs.phone}</p>}
            {rs.website && <p className="text-gray-500">{rs.website}</p>}
            {rs.email   && <p className="text-gray-500">{rs.email}</p>}
            {rs.vatNumber && <p className="text-gray-500">VAT: {rs.vatNumber}</p>}
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="text-center space-y-0.5">
            <p className="font-bold text-sm">RECEIPT</p>
            <p className="text-gray-500">#{order.id.slice(-8).toUpperCase()}</p>
            <p className="text-gray-500">{fmtDate(order.date)} at {fmtTime(order.date)}</p>
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Customer</span>
              <span className="font-medium">{customer.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className="font-medium">{order.fulfillment === "delivery" ? "🚚 Delivery" : "🏪 Collection"}</span>
            </div>
            {order.address && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 flex-shrink-0">Address</span>
                <span className="text-right font-medium">{order.address}</span>
              </div>
            )}
            {order.scheduledTime && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 flex-shrink-0">Scheduled</span>
                <span className="text-right font-medium text-green-700">{order.scheduledTime}</span>
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="space-y-1.5">
            {order.items.map((line, i) => (
              <div key={i} className="flex justify-between">
                <span>{line.qty}× {line.name}</span>
                <span className="font-medium">£{(line.price * line.qty).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="space-y-1">
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span><span>£{subtotal.toFixed(2)}</span>
            </div>
            {order.fulfillment === "delivery" && (
              <div className="flex justify-between text-gray-500">
                <span>Delivery fee</span><span>£{deliveryFee.toFixed(2)}</span>
              </div>
            )}
            {serviceFee > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Service fee</span><span>£{serviceFee.toFixed(2)}</span>
              </div>
            )}
            {couponDisc > 0 && (
              <div className="flex justify-between text-green-700 font-semibold">
                <span>Coupon ({order.couponCode})</span>
                <span>−£{couponDisc.toFixed(2)}</span>
              </div>
            )}
            {vatAmt > 0 && (
              <div className={`flex justify-between font-semibold ${order.vatInclusive ? "text-gray-400" : "text-orange-600"}`}>
                <span>{order.vatInclusive ? `Incl. VAT (${vatRate}%)` : `VAT (${vatRate}%)`}</span>
                <span>{order.vatInclusive ? `£${vatAmt.toFixed(2)}` : `+£${vatAmt.toFixed(2)}`}</span>
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="flex justify-between font-bold text-base">
            <span>TOTAL</span><span>£{order.total.toFixed(2)}</span>
          </div>
          {vatAmt > 0 && order.vatInclusive && (
            <p className="text-[10px] text-gray-400 text-right">Prices include {vatRate}% VAT</p>
          )}

          {(order.paymentMethod || order.status) && (
            <div className="space-y-1">
              {order.paymentMethod && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Payment</span>
                  <span className="font-medium">{order.paymentMethod}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={`font-semibold ${STATUS_CONFIG[order.status].className.split(" ").find((c) => c.startsWith("text-")) ?? "text-gray-900"}`}>
                  {STATUS_CONFIG[order.status].label}
                </span>
              </div>
            </div>
          )}

          {order.note && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-700">
              Note: {order.note}
            </div>
          )}

          <div className="border-t border-dashed border-gray-300" />

          <div className="text-center space-y-0.5 text-gray-500">
            {rs.thankYouMessage && <p className="font-medium text-gray-700">{rs.thankYouMessage}</p>}
            {rs.customMessage   && <p className="text-[10px] leading-snug whitespace-pre-wrap">{rs.customMessage}</p>}
            <p>{rs.restaurantName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Customer Drawer ──────────────────────────────────────────────────────────

function CustomerDrawer({
  customer, onClose, onStatusChange,
}: {
  customer: Customer;
  onClose: () => void;
  onStatusChange: (cid: string, oid: string, status: OrderStatus) => void;
}) {
  const { settings } = useApp();
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [emailToast, setEmailToast] = useState<{ orderId: string; state: "sending" | "sent" | "error" } | null>(null);

  const spent = totalSpent(customer);
  const sortedOrders = [...customer.orders].sort((a, b) => b.date.localeCompare(a.date));

  async function handleResendEmail(order: Order) {
    setEmailToast({ orderId: order.id, state: "sending" });

    const template = settings.emailTemplates?.find(
      (t) => t.event === "order_confirmation" && t.enabled,
    );
    if (!template) {
      setEmailToast({ orderId: order.id, state: "error" });
      setTimeout(() => setEmailToast(null), 3000);
      return;
    }

    const vars    = buildVarMap(order, customer, settings);
    const subject = applyVars(template.subject, vars);
    const body    = applyVars(template.body, vars);
    const addr    = [settings.restaurant.addressLine1, settings.restaurant.city, settings.restaurant.postcode].filter(Boolean).join(", ");
    const html    = buildEmailDocument(body, settings.restaurant.name, addr, settings.restaurant.phone, settings.receiptSettings);

    try {
      const result = await sendEmailViaApi({ to: customer.email, subject, html });
      setEmailToast({ orderId: order.id, state: result.ok ? "sent" : "error" });
    } catch {
      setEmailToast({ orderId: order.id, state: "error" });
    }
    setTimeout(() => setEmailToast(null), 3000);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-red-400 flex items-center justify-center text-white text-xl font-bold shadow-lg">
              {customer.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-lg">{customer.name}</h2>
              <p className="text-sm text-gray-500">Customer since {fmtDate(customer.createdAt)}</p>
              <div className="flex gap-1.5 mt-1">
                {customer.tags.map((t) => (
                  <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TAG_COLORS[t] ?? "bg-gray-100 text-gray-500"}`}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition text-gray-500">
            <X size={15} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Contact + stats */}
          <div className="px-6 py-4 grid grid-cols-2 gap-4 border-b border-gray-100">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail size={14} className="text-gray-400 flex-shrink-0" />
                <span className="truncate">{customer.email}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone size={14} className="text-gray-400 flex-shrink-0" />
                {customer.phone}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-orange-50 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-orange-600">{customer.orders.length}</div>
                <div className="text-[10px] text-orange-400 font-medium">Orders</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-green-600">£{spent.toFixed(0)}</div>
                <div className="text-[10px] text-green-500 font-medium">Spent</div>
              </div>
            </div>
          </div>

          {/* Order history */}
          <div className="px-6 py-4">
            <h3 className="font-semibold text-gray-900 text-sm mb-4 flex items-center gap-2">
              <ShoppingBag size={15} className="text-orange-500" />
              Order history ({customer.orders.length})
            </h3>
            <div className="space-y-3">
              {sortedOrders.map((order) => {
                const isExpanded = expandedOrder === order.id;
                const cfg = STATUS_CONFIG[order.status];
                return (
                  <div key={order.id} className="border border-gray-100 rounded-xl overflow-hidden">
                    {/* Order header */}
                    <button
                      onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-gray-400">#{order.id.slice(-6).toUpperCase()}</span>
                          <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}>
                            {cfg.icon} {cfg.label}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            order.fulfillment === "delivery"
                              ? "bg-blue-50 text-blue-600 border border-blue-100"
                              : "bg-teal-50 text-teal-600 border border-teal-100"
                          }`}>
                            {order.fulfillment === "delivery" ? "🚚 Delivery" : "🏪 Collection"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock size={10} /> {fmtDate(order.date)} at {fmtTime(order.date)}
                          </span>
                          <span className="font-bold text-gray-900 text-sm">£{order.total.toFixed(2)}</span>
                        </div>
                      </div>
                      <ChevronRight size={15} className={`text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-4 bg-gray-50/60 space-y-4">
                        {/* Items */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-2">Items</p>
                          <div className="space-y-1">
                            {order.items.map((line, idx) => (
                              <div key={idx} className="flex justify-between text-sm">
                                <span className="text-gray-700">{line.qty}× {line.name}</span>
                                <span className="text-gray-900 font-medium">£{(line.price * line.qty).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Address */}
                        {order.address && (
                          <div className="flex items-start gap-2 text-xs text-gray-500">
                            <MapPin size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
                            {order.address}
                          </div>
                        )}

                        {/* Note */}
                        {order.note && (
                          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700">
                            {order.note}
                          </div>
                        )}

                        {/* Status updater */}
                        {order.status !== "cancelled" && order.status !== "delivered" && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                              <RefreshCw size={11} /> Update status
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {ORDER_STATUS_FLOW.map((s) => {
                                const sCfg = STATUS_CONFIG[s];
                                const isActive = s === order.status;
                                const isPast = ORDER_STATUS_FLOW.indexOf(s) < ORDER_STATUS_FLOW.indexOf(order.status);
                                return (
                                  <button
                                    key={s}
                                    disabled={isPast || isActive}
                                    onClick={() => onStatusChange(customer.id, order.id, s)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                                      isActive
                                        ? sCfg.className + " opacity-100 cursor-default"
                                        : isPast
                                        ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed"
                                        : sCfg.className + " opacity-60 hover:opacity-100"
                                    }`}
                                  >
                                    {sCfg.icon}
                                    {sCfg.label}
                                  </button>
                                );
                              })}
                              <button
                                onClick={() => onStatusChange(customer.id, order.id, "cancelled")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-red-50 text-red-600 border-red-200 hover:bg-red-100 transition"
                              >
                                <Ban size={11} /> Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Receipt actions */}
                        <div className="pt-1">
                          <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                            <Receipt size={11} /> Receipt
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {/* View Receipt */}
                            <button
                              onClick={() => setReceiptOrder(order)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-white text-gray-700 border-gray-200 hover:border-orange-300 hover:text-orange-600 transition"
                            >
                              <Receipt size={11} /> View Receipt
                            </button>

                            {/* Reprint */}
                            <button
                              onClick={() => {
                                setReceiptOrder(order);
                                // small delay so modal renders before auto-print
                                setTimeout(() => {
                                  document.getElementById(`print-btn-${order.id}`)?.click();
                                }, 80);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:text-blue-600 transition"
                            >
                              <Printer size={11} /> Reprint
                            </button>

                            {/* Resend email */}
                            {emailToast?.orderId === order.id ? (
                              <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                                emailToast.state === "sending"
                                  ? "bg-blue-50 text-blue-600 border-blue-100"
                                  : emailToast.state === "sent"
                                  ? "bg-green-50 text-green-600 border-green-100"
                                  : "bg-red-50 text-red-600 border-red-100"
                              }`}>
                                {emailToast.state === "sending" && <><RefreshCw size={11} className="animate-spin" /> Sending…</>}
                                {emailToast.state === "sent"    && <><CheckCheck size={11} /> Sent to {customer.email}</>}
                                {emailToast.state === "error"   && <><AlertCircle size={11} /> Failed — retry</>}
                              </span>
                            ) : (
                              <button
                                onClick={() => handleResendEmail(order)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-white text-gray-700 border-gray-200 hover:border-green-300 hover:text-green-600 transition"
                              >
                                <Send size={11} /> Resend Email
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Receipt modal */}
      {receiptOrder && (
        <ReceiptModal
          order={receiptOrder}
          customer={customer}
          onClose={() => setReceiptOrder(null)}
        />
      )}
    </div>
  );
}
