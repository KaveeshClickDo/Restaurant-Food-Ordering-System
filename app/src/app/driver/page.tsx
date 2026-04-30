"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import type { DeliveryStatus, Order } from "@/types";
import {
  Truck, LogOut, MapPin, Phone, Package,
  CheckCircle2, Navigation, ChefHat,
  AlertTriangle, ChevronDown, ChevronUp,
  Inbox, Zap, Star,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DriverOrder {
  order: Order;
  customerId: string;
  customerName: string;
  customerPhone: string;
}

interface AvailableOrder {
  order: Order;
  customerId: string;
  customerName: string;
  customerPhone: string;
}

// ─── Active order status config ───────────────────────────────────────────────

type DSKey = DeliveryStatus;

const DS_CONFIG: Record<DSKey, {
  label: string;
  color: string;
  dot: string;
  next: DSKey | null;
  nextLabel: string | null;
  nextClass: string;
}> = {
  assigned: {
    label:     "Assigned",
    color:     "bg-amber-100 text-amber-800 border-amber-200",
    dot:       "bg-amber-500",
    next:      "picked_up",
    nextLabel: "Confirm Pick-Up",
    nextClass: "bg-amber-500 hover:bg-amber-400",
  },
  picked_up: {
    label:     "Picked Up",
    color:     "bg-blue-100 text-blue-800 border-blue-200",
    dot:       "bg-blue-500",
    next:      "on_the_way",
    nextLabel: "Start Delivery",
    nextClass: "bg-blue-500 hover:bg-blue-400",
  },
  on_the_way: {
    label:     "On the Way",
    color:     "bg-indigo-100 text-indigo-800 border-indigo-200",
    dot:       "bg-indigo-500",
    next:      "delivered",
    nextLabel: "Mark Delivered",
    nextClass: "bg-green-500 hover:bg-green-400",
  },
  delivered: {
    label:     "Delivered",
    color:     "bg-green-100 text-green-800 border-green-200",
    dot:       "bg-green-500",
    next:      null,
    nextLabel: null,
    nextClass: "",
  },
};

// ─── Elapsed time (client-only to avoid hydration mismatch) ──────────────────

function ElapsedLabel({ date }: { date: string }) {
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    const calc = () => Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
    setMins(calc());
    const id = setInterval(() => setMins(calc()), 60_000);
    return () => clearInterval(id);
  }, [date]);
  if (mins === null) return null;
  const label = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  return (
    <span className={`text-xs font-semibold ${mins >= 30 ? "text-red-500" : "text-gray-400"}`}>
      {label}
    </span>
  );
}

// ─── Available order card ─────────────────────────────────────────────────────

function AvailableOrderCard({
  availableOrder,
  onAccept,
}: {
  availableOrder: AvailableOrder;
  onAccept: () => void;
}) {
  const { order, customerName, customerPhone } = availableOrder;
  const [confirming, setConfirming] = useState(false);
  const isReady = order.status === "ready";

  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden border-l-4 ${
      isReady ? "border-green-400" : "border-orange-400"
    }`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
            #{order.id.slice(-8).toUpperCase()}
          </p>
          <p className="text-gray-900 font-extrabold text-lg leading-tight">{customerName}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
            isReady
              ? "bg-green-100 text-green-800 border-green-200"
              : "bg-orange-100 text-orange-800 border-orange-200"
          }`}>
            {isReady ? "Ready for pickup" : "Preparing"}
          </span>
          <ElapsedLabel date={order.date} />
        </div>
      </div>

      <div className="mx-4 border-t border-gray-100" />

      {/* Contact + navigate */}
      <div className="px-4 py-3 space-y-2">
        {customerPhone && (
          <a
            href={`tel:${customerPhone}`}
            className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2 hover:bg-green-100 transition"
          >
            <div className="w-7 h-7 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Phone size={13} className="text-white" />
            </div>
            <div>
              <p className="text-[10px] text-green-600 font-semibold uppercase tracking-wide">Call customer</p>
              <p className="text-sm font-bold text-green-800">{customerPhone}</p>
            </div>
          </a>
        )}
        {order.address && (
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(order.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 hover:bg-blue-100 transition"
          >
            <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Navigation size={13} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">Delivery address</p>
              <p className="text-sm font-bold text-blue-800 leading-snug truncate">{order.address}</p>
            </div>
          </a>
        )}
      </div>

      <div className="mx-4 border-t border-gray-100" />

      {/* Items */}
      <div className="px-4 py-3 space-y-1.5">
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide flex items-center gap-1">
          <Package size={10} /> Order items
        </p>
        {order.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-orange-500 font-extrabold text-base w-6 text-center flex-shrink-0">{item.qty}×</span>
            <span className="text-gray-800 font-semibold text-sm">{item.name}</span>
          </div>
        ))}
      </div>

      {/* Delivery note */}
      {order.note && (
        <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <p className="text-amber-600 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 mb-1">
            <AlertTriangle size={10} /> Delivery note
          </p>
          <p className="text-amber-800 text-sm">{order.note}</p>
        </div>
      )}

      {/* Payment */}
      {order.paymentMethod && (
        <div className="px-4 pb-3">
          <p className="text-xs text-gray-500">
            Payment: <span className="font-semibold text-gray-700">{order.paymentMethod}</span>
            {order.paymentMethod.toLowerCase().includes("cash") && (
              <span className="ml-2 text-orange-600 font-bold">· Collect £{order.total.toFixed(2)}</span>
            )}
          </p>
        </div>
      )}

      {/* Accept / Confirm */}
      <div className="px-4 pb-4">
        {confirming ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-700 font-semibold text-center">
              Accept this delivery?
            </p>
            <p className="text-xs text-gray-500 text-center">
              It will be assigned to you and removed from the available list.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { onAccept(); setConfirming(false); }}
                className="flex-1 bg-green-500 hover:bg-green-400 text-white font-bold py-3 rounded-xl transition"
              >
                Yes, Accept
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl transition"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className={`w-full font-bold py-3.5 rounded-xl transition-all active:scale-[0.97] shadow-sm text-white ${
              isReady
                ? "bg-green-500 hover:bg-green-400"
                : "bg-orange-500 hover:bg-orange-400"
            }`}
          >
            {isReady ? "Accept & Pick Up →" : "Accept Order →"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Active order card ────────────────────────────────────────────────────────

function OrderCard({
  driverOrder,
  onAdvance,
}: {
  driverOrder: DriverOrder;
  onAdvance: (status: DSKey) => void;
}) {
  const { order, customerName, customerPhone } = driverOrder;
  const ds  = (order.deliveryStatus ?? "assigned") as DSKey;
  const cfg = DS_CONFIG[ds];
  const [confirmDeliver, setConfirmDeliver] = useState(false);

  function handleNext() {
    if (!cfg.next) return;
    if (cfg.next === "delivered") {
      setConfirmDeliver(true);
    } else {
      onAdvance(cfg.next);
    }
  }

  return (
    <div className={`bg-white rounded-2xl border-l-4 shadow-sm overflow-hidden ${
      ds === "assigned"   ? "border-amber-400"  :
      ds === "picked_up"  ? "border-blue-400"   :
      ds === "on_the_way" ? "border-indigo-500" :
                            "border-green-400"
    }`}>
      {/* Card header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
            #{order.id.slice(-8).toUpperCase()}
          </p>
          <p className="text-gray-900 font-extrabold text-lg leading-tight">{customerName}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${cfg.color}`}>
            {cfg.label}
          </span>
          <ElapsedLabel date={order.date} />
        </div>
      </div>

      <div className="mx-4 border-t border-gray-100" />

      {/* Contact + address */}
      <div className="px-4 py-3 space-y-2">
        {customerPhone && (
          <a
            href={`tel:${customerPhone}`}
            className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 hover:bg-green-100 transition group"
          >
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Phone size={14} className="text-white" />
            </div>
            <div>
              <p className="text-[10px] text-green-600 font-semibold uppercase tracking-wide">Call customer</p>
              <p className="text-sm font-bold text-green-800">{customerPhone}</p>
            </div>
          </a>
        )}
        {order.address && (
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(order.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 hover:bg-blue-100 transition"
          >
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Navigation size={14} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">Navigate</p>
              <p className="text-sm font-bold text-blue-800 leading-snug truncate">{order.address}</p>
            </div>
          </a>
        )}
      </div>

      <div className="mx-4 border-t border-gray-100" />

      {/* Items */}
      <div className="px-4 py-3 space-y-1.5">
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide flex items-center gap-1">
          <Package size={10} /> Order items
        </p>
        {order.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="text-orange-500 font-extrabold text-base w-6 text-center flex-shrink-0">{item.qty}×</span>
            <span className="text-gray-800 font-semibold text-sm">{item.name}</span>
          </div>
        ))}
      </div>

      {/* Note */}
      {order.note && (
        <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <p className="text-amber-600 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 mb-1">
            <AlertTriangle size={10} /> Delivery note
          </p>
          <p className="text-amber-800 text-sm">{order.note}</p>
        </div>
      )}

      {/* Payment */}
      {order.paymentMethod && (
        <div className="px-4 pb-3">
          <p className="text-xs text-gray-500">
            Payment: <span className="font-semibold text-gray-700">{order.paymentMethod}</span>
            {order.paymentMethod.toLowerCase().includes("cash") && (
              <span className="ml-2 text-orange-600 font-bold">· Collect £{order.total.toFixed(2)}</span>
            )}
          </p>
        </div>
      )}

      {/* Action button */}
      {ds !== "delivered" && (
        <div className="px-4 pb-4">
          {confirmDeliver ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600 font-semibold text-center">Confirm order delivered?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { onAdvance("delivered"); setConfirmDeliver(false); }}
                  className="flex-1 bg-green-500 hover:bg-green-400 text-white font-bold py-3 rounded-xl transition"
                >
                  Yes, Delivered
                </button>
                <button
                  onClick={() => setConfirmDeliver(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleNext}
              className={`w-full ${cfg.nextClass} text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.97] shadow-sm`}
            >
              {cfg.nextLabel} →
            </button>
          )}
        </div>
      )}

      {ds === "delivered" && (
        <div className="px-4 pb-4 flex items-center justify-center gap-2 text-green-600 font-bold text-sm">
          <CheckCircle2 size={18} />
          Order delivered
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function DriverDashboardPage() {
  const {
    currentDriver, driverLogout, customers,
    updateDeliveryStatus, assignDriverToOrder, settings,
  } = useApp();
  const router = useRouter();
  const [showDelivered, setShowDelivered] = useState(false);
  const [acceptedId,    setAcceptedId]    = useState<string | null>(null);
  // How long (ms) to wait for AppContext to populate currentDriver before
  // concluding the session is gone and redirecting to login.
  // AppContext fetches from /api/auth/driver/me when localStorage is empty,
  // so we give it enough time to resolve even on a slow connection.
  const [authTimedOut, setAuthTimedOut] = useState(false);

  useEffect(() => {
    if (currentDriver) return; // already loaded — no timeout needed
    const t = setTimeout(() => setAuthTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [currentDriver]);

  useEffect(() => {
    if (authTimedOut && !currentDriver) router.replace("/driver/login");
  }, [authTimedOut, currentDriver, router]);

  if (!currentDriver) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  const driver = currentDriver; // narrowed — safe inside closures below

  // ── Orders assigned to this driver ─────────────────────────────────────────
  const myOrders: DriverOrder[] = customers.flatMap((c) =>
    c.orders
      .filter((o) => o.driverId === driver.id)
      .map((o) => ({
        order:         o,
        customerId:    c.id,
        customerName:  c.name,
        customerPhone: c.phone,
      }))
  ).sort((a, b) => new Date(a.order.date).getTime() - new Date(b.order.date).getTime());

  const active    = myOrders.filter((d) => d.order.deliveryStatus !== "delivered");
  const delivered = myOrders.filter((d) => d.order.deliveryStatus === "delivered");

  // ── Unassigned delivery orders available for self-assignment ───────────────
  // Delivery orders that are "ready" (kitchen done) or "preparing" (coming soon)
  // with no driver yet. Sorted oldest-first so most urgent shows at the top.
  const availableOrders: AvailableOrder[] = customers.flatMap((c) =>
    c.orders
      .filter(
        (o) =>
          o.fulfillment === "delivery" &&
          (o.status === "ready" || o.status === "preparing") &&
          !o.driverId,
      )
      .map((o) => ({
        order:         o,
        customerId:    c.id,
        customerName:  c.name,
        customerPhone: c.phone,
      }))
  ).sort((a, b) => {
    // "ready" before "preparing", then oldest first within each group
    if (a.order.status !== b.order.status) {
      return a.order.status === "ready" ? -1 : 1;
    }
    return new Date(a.order.date).getTime() - new Date(b.order.date).getTime();
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleAdvance(driverOrder: DriverOrder, status: DeliveryStatus) {
    updateDeliveryStatus(driverOrder.customerId, driverOrder.order.id, status);
  }

  function handleAccept(av: AvailableOrder) {
    // Guard: verify the order hasn't been taken since last render
    const live = customers
      .find((c) => c.id === av.customerId)
      ?.orders.find((o) => o.id === av.order.id);
    if (!live || live.driverId) return; // already claimed

    assignDriverToOrder(av.customerId, av.order.id, driver.id);
    setAcceptedId(av.order.id);
    setTimeout(() => setAcceptedId(null), 3000);
  }

  function handleLogout() {
    driverLogout();
    router.replace("/driver/login");
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <Truck size={18} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm leading-tight">{currentDriver.name}</p>
              <p className="text-gray-400 text-[11px] leading-tight">{settings.restaurant.name} · Driver</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {active.length > 0 && (
              <span className="bg-orange-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {active.length} active
              </span>
            )}
            {availableOrders.length > 0 && (
              <span className="bg-green-500 text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <Inbox size={11} /> {availableOrders.length}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-500 bg-gray-100 hover:bg-red-50 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg font-semibold transition"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Accepted flash banner */}
      {acceptedId && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <div className="bg-green-500 text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg">
            <CheckCircle2 size={18} className="flex-shrink-0" />
            <div>
              <p className="font-bold text-sm">Order accepted!</p>
              <p className="text-green-100 text-xs">It&apos;s now in your active deliveries below.</p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-5 space-y-6">
        {/* Vehicle info */}
        {currentDriver.vehicleInfo && (
          <div className="flex items-center gap-2 text-sm text-gray-500 bg-white border border-gray-100 rounded-xl px-4 py-2.5">
            <ChefHat size={14} className="text-orange-400" />
            <span>{currentDriver.vehicleInfo}</span>
          </div>
        )}

        {/* ── Available orders ──────────────────────────────────────────────── */}
        {availableOrders.length > 0 && (
          <section className="space-y-3">
            {/* Section header */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-500 rounded-lg flex items-center justify-center">
                  <Inbox size={13} className="text-white" />
                </div>
                <h2 className="text-sm font-bold text-gray-800">Available orders</h2>
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {availableOrders.length}
                </span>
              </div>
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                <Zap size={9} /> Real-time
              </span>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 px-1">
              <span className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className="w-2 h-2 rounded-full bg-green-400" /> Ready for pickup
              </span>
              <span className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className="w-2 h-2 rounded-full bg-orange-400" /> Still preparing
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-4">
              {availableOrders.map((av) => (
                <AvailableOrderCard
                  key={av.order.id}
                  availableOrder={av}
                  onAccept={() => handleAccept(av)}
                />
              ))}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Your deliveries</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
          </section>
        )}

        {/* ── Active orders ─────────────────────────────────────────────────── */}
        {active.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Truck size={48} className="mx-auto mb-4 opacity-20" />
            <p className="font-bold text-gray-500 text-lg">No active deliveries</p>
            <p className="text-sm mt-1">
              {availableOrders.length > 0
                ? "Accept an available order above to get started."
                : "You'll see new orders here once they're assigned to you."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">
              Active deliveries
            </p>
            {active.map((d) => (
              <OrderCard
                key={d.order.id}
                driverOrder={d}
                onAdvance={(status) => handleAdvance(d, status)}
              />
            ))}
          </div>
        )}

        {/* ── Stats bar ─────────────────────────────────────────────────────── */}
        {(delivered.length > 0 || active.length > 0) && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 px-3 py-3 text-center">
              <p className="text-lg font-extrabold text-gray-900">{active.length}</p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">Active</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 px-3 py-3 text-center">
              <p className="text-lg font-extrabold text-green-600">{delivered.length}</p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">Delivered</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 px-3 py-3 text-center">
              <p className="text-lg font-extrabold text-orange-500">
                £{delivered.reduce((s, d) => s + d.order.total, 0).toFixed(0)}
              </p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">Value</p>
            </div>
          </div>
        )}

        {/* ── Delivered today ───────────────────────────────────────────────── */}
        {delivered.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <button
              onClick={() => setShowDelivered((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-green-500" />
                <span className="font-bold text-gray-700 text-sm">Completed</span>
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {delivered.length}
                </span>
              </div>
              {showDelivered ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </button>
            {showDelivered && (
              <div className="divide-y divide-gray-50">
                {delivered.map((d) => (
                  <div key={d.order.id} className="px-4 py-3 flex items-center gap-3">
                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-700">
                        #{d.order.id.slice(-8).toUpperCase()} — {d.customerName}
                      </p>
                      {d.order.address && (
                        <p className="text-xs text-gray-400 truncate flex items-center gap-1">
                          <MapPin size={10} /> {d.order.address}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-bold text-gray-900">£{d.order.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Empty state (no orders anywhere) ─────────────────────────────── */}
        {availableOrders.length === 0 && active.length === 0 && delivered.length === 0 && (
          <div className="text-center py-16 text-gray-400 space-y-3">
            <div className="relative inline-block">
              <Truck size={52} className="opacity-20" />
              <Star size={16} className="text-orange-400 absolute -top-1 -right-1" />
            </div>
            <div>
              <p className="font-bold text-gray-500 text-lg">All clear!</p>
              <p className="text-sm mt-1">No orders available right now. Check back soon.</p>
            </div>
          </div>
        )}

        {/* Real-time note */}
        <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Updates sync automatically across devices
        </p>
      </div>
    </div>
  );
}
