"use client";

import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { Customer, DeliveryStatus, Order, OrderStatus } from "@/types";
import {
  Truck, Package, ChefHat, CheckCircle2, Circle, Ban,
  Clock, MapPin, Phone, ShoppingBag, TrendingUp,
  ChevronRight, X, RefreshCw, Bike, Store,
  AlertCircle, Search, Filter, Navigation, RotateCcw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RichOrder extends Order {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "confirmed", "preparing", "ready"];

// For delivery orders: admin can only advance up to "ready".
// The driver then drives the order through to "delivered" via delivery status.
// For collection orders: admin can advance all the way to "delivered".
const STATUS_NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  pending:   "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready:     "delivered", // only used for collection orders (guarded in advance())
};

/** Whether the admin can advance this order to the next status */
function canAdminAdvance(order: { status: OrderStatus; fulfillment: string }): boolean {
  if (order.status === "ready" && order.fulfillment === "delivery") return false;
  return !!STATUS_NEXT[order.status];
}

const STATUS_CONFIG: Record<OrderStatus, {
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  headerBg: string;
  dotBg: string;
  badge: string;
  cardBorder: string;
}> = {
  pending: {
    label: "Pending",
    shortLabel: "Confirm",
    icon: <Circle size={14} className="fill-yellow-400 text-yellow-400" />,
    headerBg: "bg-yellow-50 border-yellow-200",
    dotBg: "bg-yellow-400",
    badge: "bg-yellow-50 text-yellow-700 border-yellow-200",
    cardBorder: "border-yellow-200",
  },
  confirmed: {
    label: "Confirmed",
    shortLabel: "Start preparing",
    icon: <CheckCircle2 size={14} className="text-blue-500" />,
    headerBg: "bg-blue-50 border-blue-200",
    dotBg: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    cardBorder: "border-blue-200",
  },
  preparing: {
    label: "Preparing",
    shortLabel: "Mark ready",
    icon: <ChefHat size={14} className="text-orange-500" />,
    headerBg: "bg-orange-50 border-orange-200",
    dotBg: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700 border-orange-200",
    cardBorder: "border-orange-300",
  },
  ready: {
    label: "Ready for Pickup",
    shortLabel: "Mark collected", // only shown for collection orders
    icon: <Package size={14} className="text-purple-500" />,
    headerBg: "bg-purple-50 border-purple-200",
    dotBg: "bg-purple-500",
    badge: "bg-purple-50 text-purple-700 border-purple-200",
    cardBorder: "border-purple-300",
  },
  delivered: {
    label: "Delivered",
    shortLabel: "",
    icon: <Truck size={14} className="text-green-600" />,
    headerBg: "bg-green-50 border-green-200",
    dotBg: "bg-green-500",
    badge: "bg-green-50 text-green-700 border-green-200",
    cardBorder: "border-green-200",
  },
  cancelled: {
    label: "Cancelled", shortLabel: "",
    icon: <Ban size={14} className="text-red-500" />,
    headerBg: "bg-red-50 border-red-200", dotBg: "bg-red-400",
    badge: "bg-red-50 text-red-700 border-red-200", cardBorder: "border-red-200",
  },
  refunded: {
    label: "Refunded", shortLabel: "",
    icon: <RotateCcw size={14} className="text-teal-600" />,
    headerBg: "bg-teal-50 border-teal-200", dotBg: "bg-teal-500",
    badge: "bg-teal-50 text-teal-700 border-teal-200", cardBorder: "border-teal-200",
  },
  partially_refunded: {
    label: "Partially Refunded", shortLabel: "",
    icon: <RotateCcw size={14} className="text-cyan-600" />,
    headerBg: "bg-cyan-50 border-cyan-200", dotBg: "bg-cyan-500",
    badge: "bg-cyan-50 text-cyan-700 border-cyan-200", cardBorder: "border-cyan-200",
  },
};

// ─── Delivery leg config ──────────────────────────────────────────────────────

const DS_STEPS: DeliveryStatus[] = ["assigned", "picked_up", "on_the_way", "delivered"];

const DS_CONFIG: Record<DeliveryStatus, { label: string; badge: string; dot: string; pulse?: boolean }> = {
  assigned:   { label: "Driver assigned",   badge: "bg-amber-50 text-amber-700 border-amber-200",   dot: "bg-amber-500"  },
  picked_up:  { label: "Picked up",         badge: "bg-blue-50 text-blue-700 border-blue-200",     dot: "bg-blue-500"   },
  on_the_way: { label: "On the way",        badge: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500", pulse: true },
  delivered:  { label: "Delivered",         badge: "bg-green-50 text-green-700 border-green-200",  dot: "bg-green-500"  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeSince(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isToday(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function itemsSummary(items: Order["items"]) {
  if (items.length === 0) return "No items";
  const first = items.slice(0, 2).map((i) => `${i.qty}× ${i.name}`).join(", ");
  const extra = items.length > 2 ? ` +${items.length - 2} more` : "";
  return first + extra;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, accent = "orange" }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; accent?: "orange" | "green" | "blue" | "purple";
}) {
  const colors = {
    orange: "bg-orange-50 text-orange-500",
    green:  "bg-green-50 text-green-500",
    blue:   "bg-blue-50 text-blue-500",
    purple: "bg-purple-50 text-purple-500",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[accent]}`}>{icon}</div>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Order card (kanban) ──────────────────────────────────────────────────────

function KanbanCard({
  order, onAdvance, onCancel, onClick,
}: {
  order: RichOrder;
  onAdvance: () => void;
  onCancel: () => void;
  onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[order.status];
  const adminCanAdvance = canAdminAdvance(order);

  return (
    <div
      className={`bg-white rounded-xl border-2 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${cfg.cardBorder}`}
      onClick={onClick}
    >
      {/* Card top */}
      <div className="px-4 pt-3.5 pb-2.5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-gray-400">#{order.id.slice(-6).toUpperCase()}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border flex items-center gap-1 ${
                order.fulfillment === "delivery"
                  ? "bg-blue-50 text-blue-600 border-blue-100"
                  : "bg-teal-50 text-teal-600 border-teal-100"
              }`}>
                {order.fulfillment === "delivery" ? <Bike size={9} /> : <Store size={9} />}
                {order.fulfillment === "delivery" ? "Delivery" : "Collection"}
              </span>
            </div>
            <p className="font-semibold text-gray-900 text-sm mt-0.5">{order.customerName}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-bold text-gray-900 text-sm">£{order.total.toFixed(2)}</div>
            <div className="text-[10px] text-gray-400 flex items-center gap-0.5 justify-end mt-0.5">
              <Clock size={9} /> {timeSince(order.date)}
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{itemsSummary(order.items)}</p>

        {order.address && (
          <div className="flex items-start gap-1 mt-1.5 text-[11px] text-gray-400">
            <MapPin size={10} className="mt-0.5 flex-shrink-0" />
            <span className="line-clamp-1">{order.address}</span>
          </div>
        )}

        {/* Driver / delivery leg badge */}
        {order.deliveryStatus && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${DS_CONFIG[order.deliveryStatus].badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${DS_CONFIG[order.deliveryStatus].dot} ${DS_CONFIG[order.deliveryStatus].pulse ? "animate-pulse" : ""}`} />
              {DS_CONFIG[order.deliveryStatus].label}
            </span>
            {order.driverName && (
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <Truck size={9} /> {order.driverName}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Card actions */}
      <div className="border-t border-gray-100 px-3 py-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
        {adminCanAdvance && (
          <button
            onClick={onAdvance}
            className="flex-1 flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold py-1.5 rounded-lg transition"
          >
            <ChevronRight size={12} /> {cfg.shortLabel}
          </button>
        )}
        {/* Delivery orders waiting for a driver cannot be advanced by admin */}
        {!adminCanAdvance && order.status === "ready" && (
          <div className="flex-1 flex items-center justify-center gap-1.5 bg-purple-50 border border-purple-200 text-purple-600 text-[11px] font-semibold py-1.5 rounded-lg">
            <Truck size={10} /> Awaiting driver
          </div>
        )}
        <button
          onClick={onCancel}
          className="flex items-center justify-center gap-1 border border-red-200 text-red-500 hover:bg-red-50 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition"
        >
          <Ban size={10} /> Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Order detail modal ───────────────────────────────────────────────────────

function OrderModal({ order, onClose, onStatusChange }: {
  order: RichOrder;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => void;
}) {
  const cfg = STATUS_CONFIG[order.status];
  const isActive = ACTIVE_STATUSES.includes(order.status);
  const adminCanAdvanceModal = canAdminAdvance(order);
  const next = adminCanAdvanceModal ? STATUS_NEXT[order.status] : undefined;

  // For delivery orders the final "delivered" step is driven by the driver.
  // For collection orders the admin marks it delivered.
  const FLOW: OrderStatus[] = order.fulfillment === "delivery"
    ? ["pending", "confirmed", "preparing", "ready"]
    : ["pending", "confirmed", "preparing", "ready", "delivered"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-gray-400">#{order.id.toUpperCase()}</span>
              <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                {cfg.icon} {cfg.label}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{fmtDate(order.date)} at {fmtTime(order.date)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition">
            <X size={15} />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Customer */}
          <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-4">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-red-400 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {order.customerName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm">{order.customerName}</p>
              <div className="flex flex-wrap gap-3 mt-0.5">
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <Phone size={10} /> {order.customerPhone || "—"}
                </span>
              </div>
            </div>
            <div className={`text-[11px] px-2.5 py-1 rounded-full font-semibold border flex items-center gap-1 ${
              order.fulfillment === "delivery"
                ? "bg-blue-50 text-blue-600 border-blue-100"
                : "bg-teal-50 text-teal-600 border-teal-100"
            }`}>
              {order.fulfillment === "delivery" ? <Bike size={11} /> : <Store size={11} />}
              {order.fulfillment === "delivery" ? "Delivery" : "Collection"}
            </div>
          </div>

          {/* Address */}
          {order.address && (
            <div className="flex items-start gap-2 text-sm text-gray-600 bg-blue-50 rounded-xl px-4 py-3">
              <MapPin size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <span>{order.address}</span>
            </div>
          )}

          {/* Delivery leg tracker */}
          {order.deliveryStatus && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Driver delivery</p>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border ${DS_CONFIG[order.deliveryStatus].badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${DS_CONFIG[order.deliveryStatus].dot} ${DS_CONFIG[order.deliveryStatus].pulse ? "animate-pulse" : ""}`} />
                  {DS_CONFIG[order.deliveryStatus].label}
                </span>
              </div>
              {order.driverName && (
                <p className="text-xs text-gray-600 flex items-center gap-1.5">
                  <Truck size={11} className="text-gray-400" />
                  Driver: <span className="font-semibold text-gray-800">{order.driverName}</span>
                  {order.deliveryStatus === "on_the_way" && (
                    <span className="ml-1 flex items-center gap-1 text-indigo-600 font-bold">
                      <Navigation size={10} className="animate-bounce" /> En route
                    </span>
                  )}
                </p>
              )}
              {/* Step progress */}
              <div className="flex items-center gap-1">
                {DS_STEPS.map((step, i) => {
                  const currentIdx = DS_STEPS.indexOf(order.deliveryStatus!);
                  const done = i <= currentIdx;
                  const active = step === order.deliveryStatus;
                  return (
                    <div key={step} className="flex items-center flex-1 last:flex-none">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 transition-all ${
                        active ? "ring-indigo-300 bg-indigo-500 scale-125" :
                        done   ? "ring-indigo-100 bg-indigo-400"           : "ring-gray-200 bg-gray-200"
                      }`} />
                      {i < DS_STEPS.length - 1 && (
                        <div className={`h-0.5 flex-1 mx-0.5 ${i < currentIdx ? "bg-indigo-300" : "bg-gray-200"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between">
                {DS_STEPS.map((step, i) => {
                  const currentIdx = DS_STEPS.indexOf(order.deliveryStatus!);
                  return (
                    <span key={step} className={`text-[9px] font-medium ${i === currentIdx ? "text-indigo-600" : "text-gray-300"}`}>
                      {DS_CONFIG[step].label.split(" ")[0]}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Items */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Order items</p>
            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">{item.qty}× {item.name}</span>
                  <span className="font-medium text-gray-900">£{(item.price * item.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-3 pt-3 flex justify-between font-bold text-gray-900 text-sm">
              <span>Total</span>
              <span>£{order.total.toFixed(2)}</span>
            </div>
          </div>

          {/* Note */}
          {order.note && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              {order.note}
            </div>
          )}

          {/* Status progress */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Progress</p>
            <div className="flex items-center gap-1">
              {FLOW.map((s, i) => {
                const done = FLOW.indexOf(order.status) >= i;
                const current = order.status === s;
                return (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ring-2 transition-all ${
                      current ? "ring-orange-400 bg-orange-500 scale-125" :
                      done ? "ring-orange-200 bg-orange-400" : "ring-gray-200 bg-gray-200"
                    }`} />
                    {i < FLOW.length - 1 && (
                      <div className={`h-0.5 flex-1 mx-0.5 ${done && !current ? "bg-orange-300" : "bg-gray-200"}`} />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1">
              {FLOW.map((s) => (
                <span key={s} className={`text-[9px] font-medium ${order.status === s ? "text-orange-500" : "text-gray-300"}`}>
                  {STATUS_CONFIG[s].label}
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          {isActive && (
            <div className="space-y-2 pt-1">
              {next && (
                <button
                  onClick={() => { onStatusChange(next); onClose(); }}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2"
                >
                  <RefreshCw size={15} />
                  Mark as {STATUS_CONFIG[next].label}
                </button>
              )}
              {/* Delivery orders at "ready" are handed off to the driver — admin cannot mark delivered */}
              {!adminCanAdvanceModal && order.status === "ready" && (
                <div className="w-full flex items-center justify-center gap-2 bg-purple-50 border border-purple-200 text-purple-700 font-semibold py-3 rounded-xl text-sm">
                  <Truck size={15} />
                  Awaiting driver pickup — driver will mark as delivered
                </div>
              )}
              <button
                onClick={() => { onStatusChange("cancelled"); onClose(); }}
                className="w-full border-2 border-red-200 text-red-500 hover:bg-red-50 font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2 text-sm"
              >
                <Ban size={14} /> Cancel order
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function DeliveryPanel() {
  const { customers, updateOrderStatus } = useApp();

  const [modalOrder, setModalOrder] = useState<RichOrder | null>(null);
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "delivery" | "collection">("all");
  const [search, setSearch] = useState("");

  // Flatten all orders with customer info
  const allOrders: RichOrder[] = useMemo(() =>
    customers.flatMap((c: Customer) =>
      c.orders.map((o) => ({
        ...o,
        customerName: c.name,
        customerPhone: c.phone,
        customerEmail: c.email,
      }))
    ),
    [customers]
  );

  // Today's stats
  const todayOrders   = allOrders.filter((o) => isToday(o.date));
  const activeOrders  = allOrders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const todayRevenue  = todayOrders.filter((o) => o.status === "delivered").reduce((s, o) => s + o.total, 0);
  const deliveryCount = activeOrders.filter((o) => o.fulfillment === "delivery").length;
  const todayDelivered = todayOrders.filter((o) => o.status === "delivered").length;

  // Helpers to mutate — emails are sent server-side by /api/admin/orders/[id]/status
  function advance(order: RichOrder) {
    if (!canAdminAdvance(order)) return;
    const next = STATUS_NEXT[order.status];
    if (next) {
      const cust = customers.find((c: Customer) => c.id === order.customerId);
      if (cust) updateOrderStatus(cust.id, order.id, next);
    }
  }

  function cancel(order: RichOrder) {
    const cust = customers.find((c: Customer) => c.id === order.customerId);
    if (cust) updateOrderStatus(cust.id, order.id, "cancelled");
  }

  function changeStatus(order: RichOrder, status: OrderStatus) {
    const cust = customers.find((c: Customer) => c.id === order.customerId);
    if (cust) updateOrderStatus(cust.id, order.id, status);
  }

  // Filtered active orders for kanban
  const filteredActive = useMemo(() => {
    const q = search.toLowerCase();
    return allOrders.filter((o) => {
      if (!ACTIVE_STATUSES.includes(o.status)) return false;
      if (fulfillmentFilter !== "all" && o.fulfillment !== fulfillmentFilter) return false;
      if (q && !o.customerName.toLowerCase().includes(q) && !o.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allOrders, fulfillmentFilter, search]);

  // Completed today (delivered + cancelled)
  const completedToday = useMemo(() =>
    allOrders
      .filter((o) => isToday(o.date) && (o.status === "delivered" || o.status === "cancelled"))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [allOrders]
  );

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active orders"
          value={activeOrders.length}
          sub={activeOrders.length === 0 ? "All clear!" : "need attention"}
          icon={<ShoppingBag size={16} />}
          accent="orange"
        />
        <StatCard
          label="Live deliveries"
          value={deliveryCount}
          sub={`${activeOrders.length - deliveryCount} collections`}
          icon={<Bike size={16} />}
          accent="blue"
        />
        <StatCard
          label="Delivered today"
          value={todayDelivered}
          sub={`of ${todayOrders.length} orders placed`}
          icon={<Truck size={16} />}
          accent="green"
        />
        <StatCard
          label="Revenue today"
          value={`£${todayRevenue.toFixed(2)}`}
          sub="delivered orders only"
          icon={<TrendingUp size={16} />}
          accent="purple"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Fulfillment filter */}
        <div className="flex bg-white border border-gray-200 rounded-xl p-1 gap-1">
          {(["all", "delivery", "collection"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFulfillmentFilter(f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition capitalize ${
                fulfillmentFilter === f
                  ? "bg-orange-500 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f === "delivery" && <Bike size={11} />}
              {f === "collection" && <Store size={11} />}
              {f === "all" && <Filter size={11} />}
              {f === "all" ? "All types" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or order ID…"
            className="w-full pl-8 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
          />
        </div>

        <span className="text-xs text-gray-400 ml-auto">
          {filteredActive.length} active order{filteredActive.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Kanban board */}
      {filteredActive.length === 0 && activeOrders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-20 text-center">
          <Truck size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="font-semibold text-gray-400">No active orders right now</p>
          <p className="text-sm text-gray-300 mt-1">New orders will appear here automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {ACTIVE_STATUSES.map((status) => {
            const cards = filteredActive
              .filter((o) => o.status === status)
              .sort((a, b) => a.date.localeCompare(b.date)); // oldest first

            const cfg = STATUS_CONFIG[status];

            return (
              <div key={status} className="flex flex-col gap-3">
                {/* Column header */}
                <div className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border ${cfg.headerBg}`}>
                  <div className="flex items-center gap-2">
                    {cfg.icon}
                    <span className="font-semibold text-sm text-gray-800">{cfg.label}</span>
                  </div>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white ${cfg.dotBg}`}>
                    {cards.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="space-y-3 min-h-[80px]">
                  {cards.length === 0 ? (
                    <div className="border-2 border-dashed border-gray-100 rounded-xl py-8 flex items-center justify-center">
                      <p className="text-xs text-gray-300 font-medium">Empty</p>
                    </div>
                  ) : (
                    cards.map((order) => (
                      <KanbanCard
                        key={order.id}
                        order={order}
                        onAdvance={() => advance(order)}
                        onCancel={() => cancel(order)}
                        onClick={() => setModalOrder(order)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Completed today */}
      {completedToday.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Completed today</h3>
            <span className="ml-auto text-xs text-gray-400">{completedToday.length} order{completedToday.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-50 bg-gray-50/50">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Order</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Customer</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Type</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Items</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Total</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Time</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {completedToday.map((order) => {
                  const cfg = STATUS_CONFIG[order.status];
                  return (
                    <tr
                      key={order.id}
                      className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                      onClick={() => setModalOrder(order)}
                    >
                      <td className="px-4 py-3 text-xs font-mono text-gray-400">
                        #{order.id.slice(-6).toUpperCase()}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{order.customerName}</p>
                        <p className="text-[11px] text-gray-400">{order.customerPhone}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border flex items-center gap-1 w-fit ${
                          order.fulfillment === "delivery"
                            ? "bg-blue-50 text-blue-600 border-blue-100"
                            : "bg-teal-50 text-teal-600 border-teal-100"
                        }`}>
                          {order.fulfillment === "delivery" ? <Bike size={9} /> : <Store size={9} />}
                          {order.fulfillment === "delivery" ? "Delivery" : "Collection"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate hidden sm:table-cell">
                        {itemsSummary(order.items)}
                      </td>
                      <td className="px-4 py-3 font-bold text-gray-900 text-sm">
                        £{order.total.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap hidden sm:table-cell">
                        {fmtTime(order.date)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border w-fit ${cfg.badge}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Order detail modal */}
      {modalOrder && (
        <OrderModal
          order={modalOrder}
          onClose={() => setModalOrder(null)}
          onStatusChange={(status) => changeStatus(modalOrder, status)}
        />
      )}
    </div>
  );
}
