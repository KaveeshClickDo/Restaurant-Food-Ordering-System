"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { Customer, CustomerPosSale, Order, OrderStatus } from "@/types";
import { fullOrderNumber } from "@/lib/orderNumber";
import { cleanPhone } from "@/lib/inputUtils";
import {
  sendEmailViaApi, buildVarMap, applyVars, buildEmailDocument,
} from "@/lib/emailTemplates";
import {
  Users, Search, ChevronRight, X, Phone, Mail, MapPin,
  ShoppingBag, Clock, TrendingUp, Star, ArrowUpDown,
  CheckCircle2, ChefHat, Package, Truck, Ban,
  Circle, RefreshCw, Receipt, Printer, Send,
  CheckCheck, AlertCircle, RotateCcw,
  Gift, Award, FileText, Save,
  Trash2, Key, Pencil, Loader2, ShieldCheck, ExternalLink, AlertTriangle, UserCog,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OrderStatus, { label: string; className: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", className: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: <Circle size={11} className="fill-yellow-400 text-yellow-400" /> },
  confirmed: { label: "Confirmed", className: "bg-blue-50 text-blue-700 border-blue-200", icon: <CheckCircle2 size={11} className="text-blue-500" /> },
  preparing: { label: "Preparing", className: "bg-orange-50 text-orange-700 border-orange-200", icon: <ChefHat size={11} className="text-orange-500" /> },
  ready: { label: "Ready", className: "bg-purple-50 text-purple-700 border-purple-200", icon: <Package size={11} className="text-purple-500" /> },
  delivered: { label: "Delivered", className: "bg-green-50 text-green-700 border-green-200", icon: <Truck size={11} className="text-green-600" /> },
  cancelled: { label: "Cancelled", className: "bg-red-50 text-red-700 border-red-200", icon: <Ban size={11} className="text-red-500" /> },
};

// A refunded order must surface both states — a bare "Cancelled" or
// "Delivered" badge hides the fact that the customer's money already went
// back (QA #37). Refund state lives on paymentStatus (dine-in refunds keep
// status "delivered").
function orderStatusLabel(o: { status: OrderStatus; paymentStatus?: string | null }): string {
  const base = STATUS_CONFIG[o.status]?.label ?? String(o.status);
  if (o.paymentStatus === "refunded") return `${base} · Refunded`;
  if (o.paymentStatus === "partially_refunded") return `${base} · Partial refund`;
  return base;
}

const ORDER_STATUS_FLOW: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "delivered"];

const TAG_COLORS: Record<string, string> = {
  VIP: "bg-amber-100 text-amber-700 border-amber-200",
  Regular: "bg-blue-100 text-blue-700 border-blue-200",
  New: "bg-green-100 text-green-700 border-green-200",
  Inactive: "bg-gray-100 text-gray-500 border-gray-200",
};

// Preset tags one-tap-toggleable in both the admin Customers drawer and the
// POS CustomersView. Stays in sync with the POS list so both surfaces present
// the same vocabulary.
const PRESET_TAGS = ["VIP", "Regular", "Halal", "Vegan", "Vegetarian", "Gluten-Free", "Allergy", "Staff"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function totalSpent(c: Customer) {
  // Bug #11 — prefer the API-computed totalSpend (covers POS sales too)
  // when present; fall back to summing online orders for older snapshots.
  if (typeof c.totalSpend === "number") return c.totalSpend;
  return c.orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);
}
// All-channel order count — online orders + in-person POS sales. The admin view
// shows the combined figure everywhere a count appears (list column, header
// stat, sorting) so it reflects everything the customer has ever ordered.
function orderCount(c: Customer) {
  return c.orders.length + (c.posSales?.length ?? 0);
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
      <div className="text-lg sm:text-xl xl:text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type SortKey = "name" | "orders" | "spent" | "joined";
type SortDir = "asc" | "desc";

export default function CustomersPanel() {
  const { customers, updateOrderStatus, addCustomer, settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("spent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Quick stats
  const totalRevenue = customers.reduce((s, c) => s + totalSpent(c), 0);
  const totalOrders = customers.reduce((s, c) => s + orderCount(c), 0);
  const activeToday = customers.filter((c) =>
    c.orders.some((o) => daysSince(o.date) === 0) ||
    (c.posSales ?? []).some((s) => daysSince(s.date) === 0),
  ).length;
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
      if (sortKey === "name") { av = a.name; bv = b.name; }
      if (sortKey === "orders") { av = orderCount(a); bv = orderCount(b); }
      if (sortKey === "spent") { av = totalSpent(a); bv = totalSpent(b); }
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
        className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition ${sortKey === k ? "text-orange-500" : "text-gray-400 hover:text-gray-600"
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
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total customers" value={customers.length} sub={`${activeToday} active today`} icon={<Users size={18} />} />
        <StatCard label="Total orders" value={totalOrders} sub="all time" icon={<ShoppingBag size={18} />} />
        <StatCard label="Total revenue" value={`${sym}${totalRevenue.toFixed(2)}`} sub="delivered orders only" icon={<TrendingUp size={18} />} />
        <StatCard label="Avg. order value" value={`${sym}${totalOrders ? (totalRevenue / totalOrders).toFixed(2) : "0.00"}`} sub="per order" icon={<Star size={18} />} />
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
                className={`px-3 py-1 rounded-full text-xs font-medium border transition capitalize ${tagFilter === t
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

          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex-shrink-0"
          >
            <UserCog size={14} /> Add Customer
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-5 py-3 min-w-[150px]"><SortBtn k="name">Customer</SortBtn></th>
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
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
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
                      <span className="font-semibold text-gray-900 text-sm">{orderCount(c)}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-bold text-gray-900 text-sm">{sym}{spent.toFixed(2)}</span>
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
                        className="flex items-center gap-1 text-xs text-orange-400 group-hover:text-orange-800 font-medium transition"
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

      {/* Add customer modal */}
      {showAdd && (
        <AddCustomerModal
          existingEmails={customers.map((c) => c.email.toLowerCase())}
          onClose={() => setShowAdd(false)}
          onCreate={async (data) => {
            const newCustomer: Customer = {
              id: `cust-${crypto.randomUUID()}`,
              name: data.name.trim(),
              email: data.email.trim().toLowerCase(),
              phone: data.phone.trim(),
              createdAt: new Date().toISOString(),
              tags: [],
              orders: [],
              favourites: [],
              savedAddresses: [],
              storeCredit: 0,
              emailVerified: true,
              active: true,
            };
            await addCustomer(newCustomer, data.password.trim() || undefined);
          }}
        />
      )}

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

// ─── Add customer modal ───────────────────────────────────────────────────────

function AddCustomerModal({
  existingEmails,
  onCreate,
  onClose,
}: {
  existingEmails: string[];
  onCreate: (data: { name: string; email: string; phone: string; password: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setError("");
  }

  function validate(): string | null {
    if (!form.name.trim()) return "Name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid email address.";
    if (existingEmails.includes(form.email.trim().toLowerCase())) return "A customer with this email already exists.";
    if (form.password && form.password.length < 6) return "Password must be at least 6 characters.";
    return null;
  }

  async function handleSubmit() {
    if (saving) return;
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    try {
      await onCreate(form);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add customer.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center">
              <UserCog size={18} className="text-orange-600" />
            </div>
            <h2 className="font-bold text-gray-900">Add customer</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition text-gray-500">
            <X size={15} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Full name</label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Jane Smith"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Email address</label>
            <input
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="jane@example.com"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Phone <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set("phone", cleanPhone(e.target.value))}
              placeholder="+44 7700 900000"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Password <span className="text-gray-400 font-normal">(optional — lets them sign in)</span>
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="Min. 6 characters"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Leave blank to create the account without a password — set one later from the customer, or they can use “Forgot password”.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-bold transition flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Adding…" : "Add customer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pure print helper (no DOM ref required) ──────────────────────────────────

function buildPrintHtml(
  order: Order,
  customer: Customer,
  rs: { showLogo: boolean; logoUrl: string; restaurantName: string; phone: string; website: string; email: string; vatNumber: string; thankYouMessage: string; customMessage: string },
  restaurantAddress: string,
  sym: string,
): string {
  const subtotal = order.items.reduce((s, l) => s + l.price * l.qty, 0);
  const deliveryFee = order.deliveryFee ?? 0;
  const serviceFee = order.serviceFee ?? 0;
  const couponDisc = order.couponDiscount ?? 0;
  const vatAmt = order.vatAmount ?? 0;
  const vatInclusive = order.vatInclusive ?? true;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Receipt ${fullOrderNumber(order.id)}</title>
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
  ${rs.phone ? `<div class="c sm">${rs.phone}</div>` : ""}
  ${rs.website ? `<div class="c sm">${rs.website}</div>` : ""}
  ${rs.email ? `<div class="c sm">${rs.email}</div>` : ""}
  ${rs.vatNumber ? `<div class="c sm">VAT: ${rs.vatNumber}</div>` : ""}
  <div class="d"></div>
  <div class="c b">RECEIPT</div>
  <div class="c sm" style="word-break:break-all">${fullOrderNumber(order.id)}</div>
  <div class="c sm">${fmtDate(order.date)} at ${fmtTime(order.date)}</div>
  <div class="d"></div>
  <div class="row"><span>Customer:</span><span>${customer.name}</span></div>
  <div class="row"><span>Type:</span><span>${order.fulfillment === "delivery" ? "Delivery" : "Collection"}</span></div>
  ${order.address ? `<div class="row"><span>Address:</span><span style="text-align:right;max-width:180px">${order.address}</span></div>` : ""}
  ${order.scheduledTime ? `<div class="row"><span>Scheduled:</span><span>${order.scheduledTime}</span></div>` : ""}
  <div class="d"></div>
  ${order.items.map((l) => `<div class="row"><span>${l.qty}x ${l.name}</span><span>${sym}${(l.price * l.qty).toFixed(2)}</span></div>`).join("")}
  <div class="d"></div>
  <div class="row"><span>Subtotal</span><span>${sym}${subtotal.toFixed(2)}</span></div>
  ${order.fulfillment === "delivery" ? `<div class="row"><span>Delivery fee</span><span>${sym}${deliveryFee.toFixed(2)}</span></div>` : ""}
  ${serviceFee > 0 ? `<div class="row"><span>Service fee</span><span>${sym}${serviceFee.toFixed(2)}</span></div>` : ""}
  ${couponDisc > 0 ? `<div class="row" style="color:#16a34a;font-weight:600"><span>Coupon (${order.couponCode ?? ""})</span><span>-${sym}${couponDisc.toFixed(2)}</span></div>` : ""}
  ${vatAmt > 0 ? `<div class="row" style="color:${vatInclusive ? "#9ca3af" : "#ea580c"};font-weight:600"><span>${vatInclusive ? "Incl. VAT" : "VAT"}</span><span>${vatInclusive ? "" : "+"}${sym}${vatAmt.toFixed(2)}</span></div>` : ""}
  <div class="d"></div>
  <div class="tot"><span>TOTAL</span><span>${sym}${order.total.toFixed(2)}</span></div>
  ${vatAmt > 0 && vatInclusive ? `<div class="c sm" style="margin-top:3px">Prices include VAT</div>` : ""}
  ${order.paymentMethod ? `<div class="row" style="margin-top:6px"><span>Payment:</span><span>${order.paymentMethod}</span></div>` : ""}
  <div class="row"><span>Status:</span><span>${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span></div>
  <div class="d"></div>
  ${rs.thankYouMessage ? `<div class="c b" style="margin-bottom:3px">${rs.thankYouMessage}</div>` : ""}
  ${rs.customMessage ? `<div class="c sm" style="margin-bottom:3px;white-space:pre-wrap">${rs.customMessage}</div>` : ""}
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
  const sym = settings.currency?.symbol ?? "£";
  const { restaurant, receiptSettings: rs } = settings;
  const restaurantAddress = [restaurant.addressLine1, restaurant.city, restaurant.postcode].filter(Boolean).join(", ");

  const subtotal = order.items.reduce((s, l) => s + l.price * l.qty, 0);
  const deliveryFee = order.deliveryFee ?? 0;
  const serviceFee = order.serviceFee ?? 0;
  const couponDisc = order.couponDiscount ?? 0;
  const vatAmt = order.vatAmount ?? 0;
  const vatRate = settings.taxSettings?.rate ?? 0;
  const storeCreditUsed = order.storeCreditUsed ?? 0;
  const giftCardUsed = order.giftCardUsed ?? 0;

  function handlePrint() {
    const html = buildPrintHtml(order, customer, rs, restaurantAddress, sym);
    const win = window.open("", "_blank", "width=420,height=720");
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
            <h2 title={`Receipt ${fullOrderNumber(order.id)}`} className="font-bold text-gray-900 text-sm truncate">Receipt {fullOrderNumber(order.id)}</h2>
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
            {rs.phone && <p className="text-gray-500">{rs.phone}</p>}
            {rs.website && <p className="text-gray-500">{rs.website}</p>}
            {rs.email && <p className="text-gray-500">{rs.email}</p>}
            {rs.vatNumber && <p className="text-gray-500">VAT: {rs.vatNumber}</p>}
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="text-center space-y-0.5">
            <p className="font-bold text-sm">RECEIPT</p>
            <p title={fullOrderNumber(order.id)} className="text-gray-500 break-all">{fullOrderNumber(order.id)}</p>
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

          <div className="space-y-3">
            {order.items.map((line, i) => {
              // 1. Process details
              const v = line.selectedVariations?.map(v => v.label).join(", ");
              const a = line.selectedAddOns?.map(a => a.name).join(", ");
              const details = [v, a].filter(Boolean).join(" / ");

              return (
                <div key={i} className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <span className="block text-sm">
                      {line.qty}× {line.name}
                    </span>

                    {/* 2. Only show details if they exist */}
                    {details && (
                      <p className="text-[11px] text-gray-400 leading-tight mt-0.5">
                        {details}
                      </p>
                    )}
                  </div>

                  <span className="text-sm font-medium tabular-nums ml-4">
                    {sym}{(line.price * line.qty).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="space-y-1">
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span><span>{sym}{subtotal.toFixed(2)}</span>
            </div>
            {order.fulfillment === "delivery" && (
              <div className="flex justify-between text-gray-500">
                <span>Delivery fee</span><span>{sym}{deliveryFee.toFixed(2)}</span>
              </div>
            )}
            {serviceFee > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Service fee</span><span>{sym}{serviceFee.toFixed(2)}</span>
              </div>
            )}
            {couponDisc > 0 && (
              <div className="flex justify-between text-green-700 font-semibold">
                <span>Coupon ({order.couponCode})</span>
                <span>−{sym}{couponDisc.toFixed(2)}</span>
              </div>
            )}
            {vatAmt > 0 && (
              <div className={`flex justify-between font-semibold ${order.vatInclusive ? "text-gray-400" : "text-orange-600"}`}>
                <span>{order.vatInclusive ? `Incl. VAT (${vatRate}%)` : `VAT (${vatRate}%)`}</span>
                <span>{order.vatInclusive ? `${sym}${vatAmt.toFixed(2)}` : `+${sym}${vatAmt.toFixed(2)}`}</span>
              </div>
            )}
            {storeCreditUsed > 0 && (
              <div className="flex justify-between text-blue-600 font-semibold">
                <span>Store credit applied</span>
                <span>−{sym}{storeCreditUsed.toFixed(2)}</span>
              </div>
            )}
            {giftCardUsed > 0 && (
              <div className="flex justify-between text-purple-600 font-semibold">
                <span>Gift card applied</span>
                <span>−{sym}{giftCardUsed.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="flex justify-between font-bold text-base">
            <span>TOTAL</span><span>{sym}{order.total.toFixed(2)}</span>
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
                  {orderStatusLabel(order)}
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
            {rs.customMessage && <p className="text-[10px] leading-snug whitespace-pre-wrap">{rs.customMessage}</p>}
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
  const router = useRouter();
  const { settings, loadAllCustomers } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [emailToast, setEmailToast] = useState<{ orderId: string; state: "sending" | "sent" | "error" } | null>(null);

  // ── Bug #11 — POS-shared editable fields. Loyalty points + store credit
  // are display-only (driven by the system); gift card balance is gone with
  // the move to code-based gift cards. `tags` + `notes` are admin-editable
  // and the values are visible at the till on the next customer-list refresh.
  const [tags, setTags] = useState<string[]>(customer.tags ?? []);
  const [customTag, setCustomTag] = useState("");
  const [notes, setNotes] = useState<string>(customer.notes ?? "");
  const [posSaving, setPosSaving] = useState(false);
  const [posMessage, setPosMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }
  function addCustomTag() {
    const t = customTag.trim();
    if (!t || tags.includes(t)) { setCustomTag(""); return; }
    setTags((prev) => [...prev, t]);
    setCustomTag("");
  }

  // ── Account management state ─────────────────────────────────────────────
  // The "Deleted customer" pseudo-row (id "__deleted__") surfaces orphan
  // orders for audit only; none of these controls apply to it.
  const isDeletedRow = customer.id === "__deleted__";
  const [active, setActive] = useState<boolean>(customer.active ?? true);
  const [savingActive, setSavingActive] = useState(false);
  const [actionToast, setActionToast] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [activeOrders, setActiveOrders] = useState<{ id: string; status: string }[] | null>(null);
  const toggleInFlight = useRef(false);
  const deleteInFlight = useRef(false);
  const resetInFlight = useRef(false);

  function flashToast(kind: "ok" | "error", text: string) {
    setActionToast({ kind, text });
    setTimeout(() => setActionToast(null), 3000);
  }

  async function savePosFields() {
    setPosSaving(true);
    setPosMessage(null);
    try {
      // Tags + notes are the editable fields from this panel — loyalty +
      // store credit are display-only, gift cards are code-based. Both
      // columns live on the customers row and are visible at the POS too.
      const res = await fetch(`/api/admin/customers/${customer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags, notes }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setPosMessage({ kind: "error", text: json.error ?? "Failed to save" });
      } else {
        setPosMessage({ kind: "ok", text: "Saved" });
        await loadAllCustomers();
      }
    } catch (err) {
      setPosMessage({ kind: "error", text: err instanceof Error ? err.message : "Network error" });
    }
    setPosSaving(false);
    setTimeout(() => setPosMessage(null), 2500);
  }

  // ── Toggle active ────────────────────────────────────────────────────────
  async function toggleActive() {
    if (toggleInFlight.current) return;
    toggleInFlight.current = true;
    setSavingActive(true);
    // Optimistic update — revert on failure.
    const next = !active;
    setActive(next);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setActive(!next);
        flashToast("error", json.error ?? "Failed to update status.");
      } else {
        flashToast("ok", next ? "Account enabled." : "Account disabled.");
        await loadAllCustomers();
      }
    } catch {
      setActive(!next);
      flashToast("error", "Connection error.");
    } finally {
      toggleInFlight.current = false;
      setSavingActive(false);
    }
  }

  // ── Send reset email ─────────────────────────────────────────────────────
  async function sendResetEmail() {
    if (resetInFlight.current) return;
    if (!customer.email) { flashToast("error", "No email address on file."); return; }
    resetInFlight.current = true;
    setResetSending(true);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}/send-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: customer.email }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        flashToast("error", json.error ?? "Failed to send reset email.");
      } else {
        flashToast("ok", `Reset link sent to ${customer.email}.`);
      }
    } catch {
      flashToast("error", "Connection error.");
    } finally {
      resetInFlight.current = false;
      setResetSending(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleteConfirming(true);
    setActiveOrders(null);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        activeOrders?: { id: string; status: string }[];
      };
      if (json.ok) {
        flashToast("ok", `${customer.name} deleted.`);
        await loadAllCustomers();
        setDeleteOpen(false);
        onClose();
      } else if (res.status === 409 && json.activeOrders?.length) {
        // Swap the confirm dialog into the blocking active-orders view.
        setActiveOrders(json.activeOrders);
      } else {
        flashToast("error", json.error ?? "Failed to delete.");
      }
    } catch {
      flashToast("error", "Connection error.");
    } finally {
      deleteInFlight.current = false;
      setDeleteConfirming(false);
    }
  }

  function goToDelivery() {
    setDeleteOpen(false);
    setActiveOrders(null);
    onClose();
    router.push("/admin?tab=online-orders");
  }

  const spent = totalSpent(customer);
  // All-channel history — online orders + in-person POS sales, newest first.
  type HistoryEntry =
    | { kind: "online"; date: string; order: Order }
    | { kind: "pos"; date: string; sale: CustomerPosSale };
  const historyItems: HistoryEntry[] = [
    ...customer.orders.map((o): HistoryEntry => ({ kind: "online", date: o.date, order: o })),
    ...(customer.posSales ?? []).map((s): HistoryEntry => ({ kind: "pos", date: s.date, sale: s })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const totalOrderCount = orderCount(customer);

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

    const vars = buildVarMap(order, customer, settings);
    const subject = applyVars(template.subject, vars);
    const body = applyVars(template.body, vars);
    const addr = [settings.restaurant.addressLine1, settings.restaurant.city, settings.restaurant.postcode].filter(Boolean).join(", ");
    const html = buildEmailDocument(body, settings.restaurant.name, addr, settings.restaurant.phone, settings.receiptSettings);

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
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xl font-bold shadow-lg">
              {customer.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-lg">{customer.name}</h2>
              <p className="text-[12px] sm:text-sm text-gray-500">Customer since {fmtDate(customer.createdAt)}</p>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {customer.tags.map((t) => (
                  <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${TAG_COLORS[t] ?? "bg-gray-100 text-gray-500"}`}>
                    {t}
                  </span>
                ))}
                {!isDeletedRow && !active && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium bg-gray-100 text-gray-600 border-gray-200">
                    Disabled
                  </span>
                )}
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
          <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-gray-100">
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
                <div className="text-lg md:text-xl font-bold text-orange-600">{totalOrderCount}</div>
                <div className="text-[10px] text-orange-400 font-medium">Orders</div>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-lg md:text-xl font-bold text-green-600">{sym}{spent.toFixed(0)}</div>
                <div className="text-[10px] text-green-500 font-medium">Spent</div>
              </div>
            </div>
          </div>

          {/* ── Account actions ──────────────────────────────────────────────
              Suppressed for the synthetic "__deleted__" pseudo-row that the
              list endpoint emits to keep orphan orders visible. */}
          {!isDeletedRow && (
            <div className="px-6 py-4 border-b border-gray-100 space-y-3">
              <h3 className="font-semibold text-gray-900 text-sm flex flex-wrap items-center gap-2">
                <UserCog size={15} className="text-orange-500" />
                Account
                {actionToast && (
                  <span className={`text-[11px] font-medium ml-auto px-2 py-0.5 rounded-full ${actionToast.kind === "ok"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                    }`}>
                    {actionToast.text}
                  </span>
                )}
              </h3>
              <div className="flex flex-wrap gap-2">
                {/* Edit profile */}
                <button
                  onClick={() => setEditProfileOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:text-blue-600 transition"
                >
                  <Pencil size={11} /> Edit Profile
                </button>

                {/* Active toggle */}
                <button
                  onClick={() => void toggleActive()}
                  disabled={savingActive}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-60 ${active
                    ? "bg-white text-gray-700 border-gray-200 hover:border-amber-300 hover:text-amber-600"
                    : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                    }`}
                  title={active ? "Disable login for this customer" : "Re-enable login"}
                >
                  {savingActive
                    ? <Loader2 size={11} className="animate-spin" />
                    : <ShieldCheck size={11} />}
                  {active ? "Disable Account" : "Enable Account"}
                </button>

                {/* Change password */}
                <button
                  onClick={() => setPasswordOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-white text-gray-700 border-gray-200 hover:border-orange-300 hover:text-orange-600 transition"
                >
                  <Key size={11} /> Change Password
                </button>

                {/* Send reset email */}
                <button
                  onClick={() => void sendResetEmail()}
                  disabled={resetSending || !customer.email}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-white text-gray-700 border-gray-200 hover:border-purple-300 hover:text-purple-600 transition disabled:opacity-50"
                  title={customer.email ? "Email a one-time reset link" : "No email on file"}
                >
                  {resetSending
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Send size={11} />}
                  Send Password Reset Email
                </button>

                {/* Delete */}
                <button
                  onClick={() => setDeleteOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-white text-red-600 border-red-200 hover:bg-red-50 transition ml-auto"
                >
                  <Trash2 size={11} /> Delete
                </button>
              </div>
            </div>
          )}

          {/* ── Balances + notes (Bug #11) ──────────────────────────────────
              Store credit + loyalty points are read-only — their balances
              are driven by the system (refunds for store credit, future
              order-completion accrual for loyalty), so a manual editor would
              just create drift from the audit trail. Gift cards are now
              code-based (Admin > Gift Cards) — the old account-bound balance
              field was unused by the new flow and has been dropped. Notes
              stay editable for staff dietary / preference jotting. */}
          {!isDeletedRow && (
            <div className="px-6 py-4 border-b border-gray-100 space-y-3">
              <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <Award size={15} className="text-orange-500" />
                Balances &amp; Notes
                <span className="text-[10px] font-normal text-gray-400 ml-auto">shared with POS</span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col sm:flex-row items-center justify-between bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-teal-700 min-w-0">
                    <Gift size={13} className="text-teal-500 flex-shrink-0" />
                    <span className="font-semibold">Store credit</span>
                  </div>
                  <span className="text-sm font-bold text-teal-700 tabular-nums flex-shrink-0">
                    {sym}{(customer.storeCredit ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-amber-700 min-w-0">
                    <Award size={13} className="text-amber-500 flex-shrink-0" />
                    <span className="font-semibold truncate">Loyalty points</span>
                  </div>
                  <span className="text-sm font-bold text-amber-700 tabular-nums flex-shrink-0">
                    {(customer.loyaltyPoints ?? 0).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Tags — preset toggles + custom add. Mirrors the POS CustomersView
                vocabulary so a tag added at the till is recognised here, and
                vice versa. */}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide flex items-center gap-1">Tags</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PRESET_TAGS.map((t) => {
                    const active = tags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition ${active
                          ? (TAG_COLORS[t] ?? "bg-orange-500 text-white border-orange-500")
                          : "bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300"
                          }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
                {/* Custom tag input */}
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
                    placeholder="Custom tag…"
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={addCustomTag}
                    disabled={!customTag.trim()}
                    className="px-3 rounded-lg bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold transition"
                  >
                    Add
                  </button>
                </div>
                {/* Active custom tags — non-preset chips with remove */}
                {tags.filter((t) => !PRESET_TAGS.includes(t)).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.filter((t) => !PRESET_TAGS.includes(t)).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        title="Remove tag"
                        className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border font-medium bg-gray-100 text-gray-700 border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
                      >
                        {t} <X size={10} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 flex items-center gap-1"><FileText size={11} /> Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Dietary requirements, preferences, allergies…"
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={savePosFields}
                  disabled={posSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white transition disabled:opacity-50"
                >
                  <Save size={12} /> {posSaving ? "Saving…" : "Save tags & notes"}
                </button>
                {posMessage && (
                  <span className={`text-xs ${posMessage.kind === "ok" ? "text-green-600" : "text-red-600"}`}>
                    {posMessage.text}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Order history */}
          <div className="px-6 py-4">
            <h3 className="font-semibold text-gray-900 text-sm mb-4 flex items-center gap-2">
              <ShoppingBag size={15} className="text-orange-500" />
              Order history ({totalOrderCount})
            </h3>
            <div className="space-y-3">
              {historyItems.map((entry) => {
                // In-person POS sale — rendered as a compact, distinct card
                // (no online-only actions like status flow / delivery / email).
                if (entry.kind === "pos") {
                  const sale = entry.sale;
                  const isExpanded = expandedOrder === sale.id;
                  const posBadge = sale.voided
                    ? { label: "Voided", className: "bg-red-50 text-red-700 border-red-200", icon: <Ban size={11} className="text-red-500" /> }
                    : (sale.refundAmount ?? 0) > 0
                      ? { label: "Refunded", className: "bg-teal-50 text-teal-700 border-teal-200", icon: <RotateCcw size={11} className="text-teal-600" /> }
                      : { label: "Completed", className: "bg-green-50 text-green-700 border-green-200", icon: <CheckCircle2 size={11} className="text-green-600" /> };
                  return (
                    <div key={sale.id} className="border border-gray-100 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedOrder(isExpanded ? null : sale.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                      >
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono text-gray-400 truncate max-w-[140px]">{sale.receiptNo ?? sale.id}</span>
                            <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${posBadge.className}`}>
                              {posBadge.icon} {posBadge.label}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-600 border border-indigo-100">
                              🏪 In-store
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-2">
                            <span className="text-xs text-gray-500 flex items-center gap-1 mr-2">
                              <Clock size={10} className="flex-shrink-0" /> {fmtDate(sale.date)} at {fmtTime(sale.date)}
                            </span>
                            {sale.tableNumber != null && (
                              <span className="text-xs text-gray-500 mr-2">Table {sale.tableNumber}</span>
                            )}
                            <span className="font-bold text-gray-900 text-sm">{sym}{sale.total.toFixed(2)}</span>
                          </div>
                        </div>
                        <ChevronRight size={15} className={`text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100 px-4 py-4 bg-gray-50/60 space-y-4">
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-2">Items</p>
                            <div className="space-y-1">
                              {sale.items.map((line, idx) => (
                                <div key={idx} className="flex justify-between text-sm">
                                  <span className="text-gray-700">{line.qty}× {line.name}</span>
                                  <span className="text-gray-900 font-medium">{sym}{(line.price * line.qty).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            {sale.paymentMethod && <span>Paid by <span className="font-medium text-gray-700 capitalize">{sale.paymentMethod.replace("_", " ")}</span></span>}
                            {sale.staffName && <span>Served by <span className="font-medium text-gray-700">{sale.staffName}</span></span>}
                          </div>
                          {(sale.refundAmount ?? 0) > 0 && (
                            <div className="bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 text-xs text-teal-700">
                              Refunded {sym}{(sale.refundAmount ?? 0).toFixed(2)}
                            </div>
                          )}
                          {sale.voided && (
                            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">
                              Voided{sale.voidReason ? ` — ${sale.voidReason}` : ""}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                const order = entry.order;
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
                          <span title={fullOrderNumber(order.id)} className="text-xs font-mono text-gray-400 truncate max-w-[140px]">{fullOrderNumber(order.id)}</span>
                          <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}>
                            {cfg.icon} {orderStatusLabel(order)}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${order.fulfillment === "delivery"
                            ? "bg-blue-50 text-blue-600 border border-blue-100"
                            : "bg-teal-50 text-teal-600 border border-teal-100"
                            }`}>
                            {order.fulfillment === "delivery" ? "🚚 Delivery" : "🏪 Collection"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-2">
                          <span className="text-xs text-gray-500 flex items-center gap-1 mr-2">
                            <Clock size={10} className="flex-shrink-0" /> {fmtDate(order.date)} at {fmtTime(order.date)}
                          </span>
                          <span className="font-bold text-gray-900 text-sm">{sym}{order.total.toFixed(2)}</span>
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
                          <div className="space-y-3"> {/* Increased spacing slightly for readability */}
                            {order.items.map((line, idx) => {
                              // 1. Process variations and add-ons
                              const v = line.selectedVariations?.map(v => v.label).join(", ");
                              const a = line.selectedAddOns?.map(a => a.name).join(", ");
                              const details = [v, a].filter(Boolean).join(" / ");

                              return (
                                <div key={idx} className="flex justify-between items-start text-sm">
                                  <div className="flex-1 min-w-0">
                                    <span className="text-gray-700 block">
                                      {line.qty}× {line.name}
                                    </span>
                                    {/* 2. Display details on a separate line if they exist */}
                                    {details && (
                                      <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">
                                        {details}
                                      </p>
                                    )}
                                  </div>
                                  <span className="text-gray-900 font-medium ml-4 tabular-nums">
                                    {sym}{(line.price * line.qty).toFixed(2)}
                                  </span>
                                </div>
                              );
                            })}
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
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${isActive
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
                              <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${emailToast.state === "sending"
                                ? "bg-blue-50 text-blue-600 border-blue-100"
                                : emailToast.state === "sent"
                                  ? "bg-green-50 text-green-600 border-green-100"
                                  : "bg-red-50 text-red-600 border-red-100"
                                }`}>
                                {emailToast.state === "sending" && <><RefreshCw size={11} className="animate-spin" /> Sending…</>}
                                {emailToast.state === "sent" && <><CheckCheck size={11} /> Sent to {customer.email}</>}
                                {emailToast.state === "error" && <><AlertCircle size={11} /> Failed — retry</>}
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

      {/* Edit profile modal */}
      {editProfileOpen && (
        <EditProfileModal
          customer={customer}
          onClose={() => setEditProfileOpen(false)}
          onSaved={async () => {
            await loadAllCustomers();
            flashToast("ok", "Profile updated.");
            setEditProfileOpen(false);
            onClose();
          }}
          onError={(msg) => flashToast("error", msg)}
        />
      )}

      {/* Change password modal */}
      {passwordOpen && (
        <ChangePasswordModal
          customer={customer}
          onClose={() => setPasswordOpen(false)}
          onSaved={() => {
            flashToast("ok", "Password updated.");
            setPasswordOpen(false);
          }}
          onError={(msg) => flashToast("error", msg)}
        />
      )}

      {/* Delete confirmation / active-orders block */}
      {deleteOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-sm w-full border border-gray-100">
            {activeOrders ? (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                    <AlertTriangle size={18} className="text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Cannot delete customer</h3>
                    <p className="text-xs text-gray-500">Active orders must be resolved first.</p>
                  </div>
                </div>
                <p className="text-sm text-gray-700 mb-3">
                  <strong>{customer.name}</strong> has {activeOrders.length} active order{activeOrders.length === 1 ? "" : "s"}.
                  Cancel or complete {activeOrders.length === 1 ? "it" : "them"} before deleting.
                </p>
                <div className="bg-gray-50 border border-gray-100 rounded-xl divide-y divide-gray-100 mb-5 max-h-48 overflow-y-auto">
                  {activeOrders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className="font-mono text-gray-800 truncate">#{o.id}</span>
                      <span className="inline-flex items-center font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                        {o.status}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setDeleteOpen(false); setActiveOrders(null); }}
                    className="flex px-6 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition items-center"
                  >
                    Close
                  </button>
                  <button
                    onClick={goToDelivery}
                    className="flex-1 px-2 sm:px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition flex items-center justify-center gap-1.5"
                  >
                    Go to Online Orders <ExternalLink size={13} className="flex-shrink-0" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                    <Trash2 size={18} className="text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Delete customer</h3>
                    <p className="text-xs text-gray-500">This action cannot be undone.</p>
                  </div>
                </div>
                <p className="text-sm text-gray-700 mb-5">
                  Are you sure you want to delete <strong>{customer.name}</strong>?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteOpen(false)}
                    className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void confirmDelete()}
                    disabled={deleteConfirming}
                    className="flex-1 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition disabled:opacity-60"
                  >
                    {deleteConfirming ? <Loader2 size={15} className="animate-spin mx-auto" /> : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── EditProfileModal ─────────────────────────────────────────────────────────

function EditProfileModal({
  customer, onClose, onSaved, onError,
}: {
  customer: Customer;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(customer.name);
  const [email, setEmail] = useState(customer.email);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required.";
    if (!email.trim()) e.email = "Email is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (inFlight.current) return;
    if (!validate()) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        onError(json.error ?? "Failed to update profile.");
      } else {
        await onSaved();
      }
    } catch {
      onError("Connection error.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">Edit profile</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full bg-gray-50 border rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition ${errors.name ? "border-red-300 bg-red-50" : "border-gray-200"}`}
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full bg-gray-50 border rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition ${errors.email ? "border-red-300 bg-red-50" : "border-gray-200"}`}
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Phone</label>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(cleanPhone(e.target.value))}
              placeholder="+44 7700 900000"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── ChangePasswordModal ──────────────────────────────────────────────────────

function ChangePasswordModal({
  customer, onClose, onSaved, onError,
}: {
  customer: Customer;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (inFlight.current) return;
    setError("");
    if (value.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (value !== confirm) { setError("Passwords do not match."); return; }
    inFlight.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: value }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        const msg = json.error ?? "Failed to update password.";
        setError(msg);
        onError(msg);
      } else {
        onSaved();
      }
    } catch {
      setError("Connection error.");
      onError("Connection error.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">Change password</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">Set a new password for {customer.name}.</p>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">New password</label>
            <input
              type="password"
              autoFocus
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(""); }}
              placeholder="Min 6 characters"
              className={`w-full bg-gray-50 border rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition ${error ? "border-red-300 bg-red-50" : "border-gray-200"}`}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(""); }}
              placeholder="Repeat new password"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Update Password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
