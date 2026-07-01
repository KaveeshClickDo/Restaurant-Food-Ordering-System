"use client";

import { uuid } from "@/lib/uuid";
import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { Customer, DeliveryStatus, Order, OrderStatus, Refund } from "@/types";
import { fullOrderNumber } from "@/lib/orderNumber";
import {
  Truck, Package, ChefHat, CheckCircle2, Circle, Ban,
  Clock, MapPin, Phone, ShoppingBag, TrendingUp,
  ChevronRight, X, RefreshCw, Bike, Store,
  AlertCircle, Search, Filter, Navigation, RotateCcw,
} from "lucide-react";
import { PaymentStatusBadge } from "@/components/admin/PaymentStatusBadge";
import ConfirmDialog from "@/components/ConfirmDialog";
import { RefundModal } from "@/components/admin/RefundsPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RichOrder extends Order {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "confirmed", "preparing", "ready"];

// A FULLY-refunded order has left the live delivery workflow — the money is
// entirely back and (for an un-fulfilled order) the refund flow also cancels it.
// Used to gate the active kanban. A partial refund is deliberately excluded: an
// order that's still preparing with one item refunded (e.g. out of stock) is
// still being fulfilled and must stay on the board so the kitchen/driver finish
// the rest. Refund state lives in paymentStatus; status stays on fulfillment.
function isFullyRefunded(o: { paymentStatus?: string | null }): boolean {
  return o.paymentStatus === "refunded";
}

// Any refund (full or partial) clawed money back, so a *delivered* order with a
// refund is kept out of the "clean" today-revenue / completed stats. NOT used to
// gate the active kanban — see isFullyRefunded for why partial refunds stay live.
function isRefundedOrder(o: { paymentStatus?: string | null }): boolean {
  return o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded";
}

// When cancelling an active order, can the operator also issue a refund?
// Only if money was actually collected (card / online "paid", or a partial
// refund already happened) and something remains refundable. Unpaid
// cash-on-delivery orders have nothing to return.
function isCancelRefundEligible(o: Order): boolean {
  if (o.paymentStatus !== "paid" && o.paymentStatus !== "partially_refunded") return false;
  return (o.refundedAmount ?? 0) < o.total - 0.001;
}

// For delivery orders: admin can only advance up to "ready".
// The driver then drives the order through to "delivered" via delivery status.
// For collection orders: admin can advance all the way to "delivered".
const STATUS_NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "delivered", // only used for collection orders (guarded in advance())
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
};

// A refunded order must surface both states — a bare "Cancelled" or
// "Delivered" badge hides the fact that the customer's money already went
// back (QA #37). Refund state lives on paymentStatus, not status.
function orderStatusLabel(o: { status: OrderStatus; paymentStatus?: string | null }): string {
  const base = STATUS_CONFIG[o.status]?.label ?? String(o.status);
  if (o.paymentStatus === "refunded") return `${base} · Refunded`;
  if (o.paymentStatus === "partially_refunded") return `${base} · Partial refund`;
  return base;
}

// ─── Delivery leg config ──────────────────────────────────────────────────────

const DS_STEPS: DeliveryStatus[] = ["assigned", "picked_up", "on_the_way", "delivered"];

const DS_CONFIG: Record<DeliveryStatus, { label: string; badge: string; dot: string; pulse?: boolean }> = {
  assigned: { label: "Driver", badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  picked_up: { label: "Picked", badge: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  on_the_way: { label: "On the way", badge: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500", pulse: true },
  delivered: { label: "Delivered", badge: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
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

  const first = items.slice(0, 2).map((i) => {
    // 1. Extract and join variations and add-ons
    const v = i.selectedVariations?.map(v => v.label).join(", ");
    const a = i.selectedAddOns?.map(a => a.name).join(", ");

    // 2. Combine them only if they exist, separated by a slash
    const details = [v, a].filter(Boolean).join(" / ");

    // 3. Return the item string with details in parentheses if they exist
    return `${i.qty}× ${i.name}${details ? ` (${details})` : ""}`;
  }).join(", ");

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
    green: "bg-green-50 text-green-500",
    blue: "bg-blue-50 text-blue-500",
    purple: "bg-purple-50 text-purple-500",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[accent]}`}>{icon}</div>
      </div>
      <div className="text-lg sm:text-xl xl:text-2xl font-bold text-gray-900">{value}</div>
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
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
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
            <div className="flex items-center gap-1.5 flex-wrap">
              <span title={fullOrderNumber(order.id)} className="text-xs font-mono text-gray-400 truncate max-w-[140px]">{fullOrderNumber(order.id)}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border flex items-center gap-1 ${order.fulfillment === "delivery"
                ? "bg-blue-50 text-blue-600 border-blue-100"
                : "bg-teal-50 text-teal-600 border-teal-100"
                }`}>
                {order.fulfillment === "delivery" ? <Bike size={9} /> : <Store size={9} />}
                {order.fulfillment === "delivery" ? "Delivery" : "Collection"}
              </span>
              <PaymentStatusBadge status={order.paymentStatus} size="xs" />
            </div>
            <p className="font-semibold text-gray-900 text-sm mt-0.5">{order.customerName}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-bold text-gray-900 text-sm">{sym}{order.total.toFixed(2)}</div>
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

function OrderModal({ order, onClose, onStatusChange, onRequestCancel }: {
  order: RichOrder;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => void;
  onRequestCancel: () => void;
}) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const cfg = STATUS_CONFIG[order.status];
  const isActive = ACTIVE_STATUSES.includes(order.status);
  const adminCanAdvanceModal = canAdminAdvance(order);
  const next = adminCanAdvanceModal ? STATUS_NEXT[order.status] : undefined;

  // For delivery orders the final "delivered" step is driven by the driver.
  // For collection orders the admin marks it delivered.
  const FLOW: OrderStatus[] = order.fulfillment === "delivery"
    ? ["pending", "confirmed", "preparing", "ready"]
    : ["pending", "confirmed", "preparing", "ready", "delivered"];

  const subtotal = order.items.reduce((s, l) => s + l.price * l.qty, 0);
  const vatAmt = order.vatAmount ?? 0;

  // --- CALCULATE HISTORICAL VAT RATE ---
  let calculatedVatRate = 0;
  if (vatAmt > 0) {
    if (order.vatInclusive) {
      // Math: Rate = (VAT / (Gross - VAT)) * 100
      calculatedVatRate = Math.round((vatAmt / (subtotal - vatAmt)) * 100);
    }
  }
  const vatRate = calculatedVatRate;
  const tax = settings.taxSettings;
  const showVat = order.vatInclusive ? tax.showBreakdown : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-2 items-start">
            <div className="flex flex-col items-start gap-1">
              <span title={fullOrderNumber(order.id)} className="text-sm font-mono text-gray-400 break-all">{fullOrderNumber(order.id)}</span>
              <p className="text-xs text-gray-400">{fmtDate(order.date)} at {fmtTime(order.date)}</p>
            </div>
            <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
              {cfg.icon} {orderStatusLabel(order)}
            </span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Customer */}
          <div className="flex flex-wrap items-center gap-3 bg-gray-50 rounded-xl p-4 justify-between">
            <div className="flex gap-2 items-center">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {order.customerName.charAt(0)}
              </div>
              <div className="flex flex-col">
                <p className="font-semibold text-gray-900 text-sm">{order.customerName}</p>
                <div className="flex flex-wrap gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Phone size={10} /> {order.customerPhone || "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className={`text-[11px] px-2.5 py-1 rounded-full font-semibold border flex items-center gap-1 ${order.fulfillment === "delivery"
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
                      <Navigation size={10} className="animate-bounce" /> End route
                    </span>
                  )}
                </p>
              )}
              {/* Step progress */}
              <div className="pb-4">
                <div className="flex items-center gap-1">
                  {DS_STEPS.map((step, i) => {
                    const currentIdx = DS_STEPS.indexOf(order.deliveryStatus!);
                    const done = i <= currentIdx;
                    const active = step === order.deliveryStatus;
                    return (
                      <div key={step} className="flex items-center flex-1 last:flex-none">
                        <div className="relative flex justify-center">
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 transition-all ${active ? "ring-indigo-300 bg-indigo-500 scale-125" :
                            done ? "ring-indigo-100 bg-indigo-400" : "ring-gray-200 bg-gray-200"
                            }`} />
                          <span className={`absolute top-5 whitespace-nowrap text-[8px] sm:text-[9px] font-medium ${active ? "text-indigo-600" : "text-gray-300"} ${i === 0 ? "left-0" : i === DS_STEPS.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"
                            }`}>
                            {DS_CONFIG[step].label.split(" ").slice(0, 3).join(" ")}
                          </span>
                        </div>
                        {i < DS_STEPS.length - 1 && (
                          <div className={`h-0.5 flex-1 mx-0.5 ${i < currentIdx ? "bg-indigo-300" : "bg-gray-200"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Items */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Order items</p>
            <div className="space-y-2">
              {order.items.map((item, i) => {
                // Prefer the array form; fall back to the legacy singular variation.
                const variations = (item.selectedVariations?.length
                  ? item.selectedVariations
                  : item.selectedVariation ? [item.selectedVariation] : []
                ).map((v) => v.label).filter(Boolean);
                const addOns = (item.selectedAddOns ?? []).map((a) => a.name).filter(Boolean);
                const mods = [...variations, ...addOns];
                return (
                  <div key={i} className="flex justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className="text-gray-700">{item.qty}× {item.name}</span>
                      {mods.length > 0 && (
                        <p className="text-xs text-gray-500 mt-0.5">{mods.join(" · ")}</p>
                      )}
                      {item.specialInstructions && (
                        <p className="text-xs text-amber-600 mt-0.5 italic">📝 {item.specialInstructions}</p>
                      )}
                    </div>
                    <span className="font-medium text-gray-900 flex-shrink-0">{sym}{(item.price * item.qty).toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-gray-100 border-dashed mt-4 pt-3 space-y-1.5">
              {/* Subtotal */}
              <div className="flex justify-between text-xs text-gray-500">
                <span>Subtotal</span>
                <span className="tabular-nums">{sym}{subtotal.toFixed(2)}</span>
              </div>

              {/* Delivery Fee */}
              {order.fulfillment === "delivery" && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Delivery fee</span>
                  <span className="tabular-nums">{sym}{(order.deliveryFee ?? 0).toFixed(2)}</span>
                </div>
              )}

              {/* Service Fee */}
              {(order.serviceFee ?? 0) > 0 && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Service fee</span>
                  <span className="tabular-nums">{sym}{order.serviceFee!.toFixed(2)}</span>
                </div>
              )}

              {/* Coupon */}
              {(order.couponDiscount ?? 0) > 0 && (
                <div className="flex justify-between text-xs text-green-600 font-medium">
                  <span>Coupon {order.couponCode ? `(${order.couponCode})` : ""}</span>
                  <span className="tabular-nums">−{sym}{order.couponDiscount!.toFixed(2)}</span>
                </div>
              )}

              {/* VAT */}
              {(order.vatAmount ?? 0) > 0 && showVat && (
                <div className={`flex justify-between text-xs font-medium ${order.vatInclusive ? "text-zinc-400" : "text-orange-600"}`}>
                  <span>{order.vatInclusive ? `Incl. VAT` : `VAT`}</span>
                  <span className="tabular-nums">{order.vatInclusive ? "" : "+"}{sym}{order.vatAmount!.toFixed(2)}</span>
                </div>
              )}

              {/* Store Credit */}
              {(order.storeCreditUsed ?? 0) > 0 && (
                <div className="flex justify-between text-xs text-blue-600 font-medium">
                  <span>Store credit applied</span>
                  <span className="tabular-nums">−{sym}{order.storeCreditUsed!.toFixed(2)}</span>
                </div>
              )}

              {/* Gift Card */}
              {(order.giftCardUsed ?? 0) > 0 && (
                <div className="flex justify-between text-xs text-purple-600 font-medium">
                  <span>Gift card applied</span>
                  <span className="tabular-nums">−{sym}{order.giftCardUsed!.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Final Total */}
            <div className="border-t border-gray-200 mt-3 pt-3 flex justify-between font-bold text-gray-900">
              <span className="text-sm">Total</span>
              <span className="text-lg tabular-nums leading-none">{sym}{order.total.toFixed(2)}</span>
            </div>

            {/* VAT inclusive helper note */}
            {(order.vatAmount ?? 0) > 0 && order.vatInclusive && showVat && (
              <p className="text-[10px] text-gray-400 text-right mt-1">Prices include {vatRate}% VAT</p>
            )}
          </div>

          {/* Note */}
          {order.note && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              {order.note}
            </div>
          )}

          {/* Status progress */}
          <div className="pb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Progress</p>
            <div className="flex items-center gap-1">
              {FLOW.map((s, i) => {
                const done = FLOW.indexOf(order.status) >= i;
                const current = order.status === s;
                return (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div className="relative flex justify-center">
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ring-2 transition-all ${current ? "ring-orange-400 bg-orange-500 scale-125" :
                        done ? "ring-orange-200 bg-orange-400" : "ring-gray-200 bg-gray-200"
                        }`} />
                      <span className={`absolute top-6 whitespace-nowrap text-[8px] sm:text-[9px] font-medium ${order.status === s ? "text-orange-500" : "text-gray-300"} ${i === FLOW.length - 1 ? "-right-3" : "left-1/2 -translate-x-1/2"
                        }`}>
                        {STATUS_CONFIG[s].label}
                      </span>
                    </div>
                    {i < FLOW.length - 1 && (
                      <div className={`h-0.5 flex-1 mx-0.5 ${done && !current ? "bg-orange-300" : "bg-gray-200"}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          {isActive && (
            <div className="space-y-2 pt-1">
              {next && (
                <button
                  onClick={() => { onStatusChange(next); onClose(); }}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm sm:text-base font-bold py-3 rounded-xl transition flex items-center justify-center gap-2"
                >
                  <RefreshCw size={15} />
                  Mark as {STATUS_CONFIG[next].label}
                </button>
              )}
              {/* Delivery orders at "ready" are handed off to the driver — admin cannot mark delivered */}
              {!adminCanAdvanceModal && order.status === "ready" && (
                <div className="w-full flex items-center justify-center gap-2 bg-purple-50 border border-purple-200 text-purple-700 font-semibold px-2 py-3 rounded-xl text-xs sm:text-sm">
                  <Truck size={15} className="flex-shrink-0" />
                  Awaiting driver pickup — driver will mark as delivered
                </div>
              )}
              <button
                onClick={onRequestCancel}
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
  const { customers, updateOrderStatus, addRefund, settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";

  const [modalOrder, setModalOrder] = useState<RichOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<RichOrder | null>(null);
  const [refundCancelTarget, setRefundCancelTarget] = useState<RichOrder | null>(null);
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
  const todayOrders = allOrders.filter((o) => isToday(o.date));
  const activeOrders = allOrders.filter((o) => ACTIVE_STATUSES.includes(o.status) && !isFullyRefunded(o));
  const todayRevenue = todayOrders.filter((o) => o.status === "delivered" && !isRefundedOrder(o)).reduce((s, o) => s + o.total, 0);
  const deliveryCount = activeOrders.filter((o) => o.fulfillment === "delivery").length;
  const todayDelivered = todayOrders.filter((o) => o.status === "delivered" && !isRefundedOrder(o)).length;

  // Helpers to mutate — emails are sent server-side by /api/admin/orders/[id]/status
  function advance(order: RichOrder) {
    if (!canAdminAdvance(order)) return;
    const next = STATUS_NEXT[order.status];
    if (next) {
      const cust = customers.find((c: Customer) => c.id === order.customerId);
      if (cust) updateOrderStatus(cust.id, order.id, next);
    }
  }

  // Actually performs the cancellation. Only called after the operator confirms
  // in the dialog, which warns that a paid order is not auto-refunded.
  function confirmCancel(order: RichOrder) {
    const cust = customers.find((c: Customer) => c.id === order.customerId);
    if (cust) updateOrderStatus(cust.id, order.id, "cancelled");
    setCancelTarget(null);
  }

  // Refund + cancel: issue the refund (which sets status to "cancelled" in the
  // same atomic write, so it can't race the cancel) then run the normal cancel
  // so the customer still gets the cancellation email. Both write "cancelled",
  // so the second call is idempotent.
  function refundAndCancel(order: RichOrder, fields: Omit<Refund, "id" | "processedAt" | "processedBy">) {
    const cust = customers.find((c: Customer) => c.id === order.customerId);
    if (!cust) { setRefundCancelTarget(null); return; }
    const refund: Refund = {
      ...fields,
      id: uuid(),
      processedAt: new Date().toISOString(),
      processedBy: "Admin",
    };
    addRefund(cust.id, order.id, refund, "cancelled");
    updateOrderStatus(cust.id, order.id, "cancelled");
    setRefundCancelTarget(null);
  }

  function changeStatus(order: RichOrder, status: OrderStatus) {
    const cust = customers.find((c: Customer) => c.id === order.customerId);
    if (cust) updateOrderStatus(cust.id, order.id, status);
  }

  // Filtered active orders for kanban
  const filteredActive = useMemo(() => {
    const q = search.toLowerCase();
    return allOrders.filter((o) => {
      if (!ACTIVE_STATUSES.includes(o.status) || isFullyRefunded(o)) return false;
      if (fulfillmentFilter !== "all" && o.fulfillment !== fulfillmentFilter) return false;
      if (q && !o.customerName.toLowerCase().includes(q) && !o.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allOrders, fulfillmentFilter, search]);

  // Completed today (delivered + cancelled). Refunded orders are handled in the
  // Refunds panel and stay out of here, as they did before the refund flow
  // stopped overwriting status.
  const completedToday = useMemo(() =>
    allOrders
      .filter((o) => isToday(o.date) && !isRefundedOrder(o) && (o.status === "delivered" || o.status === "cancelled"))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [allOrders]
  );

  return (
    <div className="space-y-6">
      {/* Header — mirrors POS / Dine-in monitor panels. The "Today / Ongoing"
          qualifier matches what the panel actually shows: the kanban lists
          ongoing orders of any date, the "Completed today" table below is
          today-only. */}
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
          <Truck size={18} />
        </div>
        <div className="flex flex-col leading-snug">
          <h2 className="font-bold text-gray-900 text-lg leading-tight">Online Orders · Today / Ongoing</h2>
          <span className="text-[11px] font-semibold text-gray-400 mt-0.5">Live · ongoing orders &amp; today&apos;s completed</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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
          value={`${sym}${todayRevenue.toFixed(2)}`}
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
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition capitalize ${fulfillmentFilter === f
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
                        onCancel={() => setCancelTarget(order)}
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
                      <td title={fullOrderNumber(order.id)} className="px-4 py-3 text-xs font-mono text-gray-400 truncate max-w-[120px]">
                        {fullOrderNumber(order.id)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{order.customerName}</p>
                        <p className="text-[11px] text-gray-400">{order.customerPhone}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border flex items-center gap-1 w-fit ${order.fulfillment === "delivery"
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
                        {sym}{order.total.toFixed(2)}
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
          onRequestCancel={() => { setCancelTarget(modalOrder); setModalOrder(null); }}
        />
      )}

      {/* Cancel confirmation — when the order is paid it offers a one-step
          "refund + cancel"; otherwise a plain cancel. */}
      {(() => {
        const eligible = !!cancelTarget && isCancelRefundEligible(cancelTarget);
        return (
          <ConfirmDialog
            open={!!cancelTarget}
            title={`Cancel order ${cancelTarget ? fullOrderNumber(cancelTarget.id) : ""}?`}
            tone="danger"
            confirmLabel={eligible ? "Cancel without refund" : "Cancel order"}
            cancelLabel="Keep order"
            message={
              <div className="space-y-3">
                <p>This marks the order as cancelled and notifies the customer.</p>
                {eligible ? (
                  <>
                    <p className="text-red-300 font-medium">
                      This order is paid ({sym}{cancelTarget!.total.toFixed(2)}). Cancelling on
                      its own does <span className="font-bold">not</span> return the money.
                    </p>
                    <button
                      type="button"
                      onClick={() => { const t = cancelTarget; setCancelTarget(null); setRefundCancelTarget(t); }}
                      className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-400 text-white text-sm font-bold px-2 py-2.5 rounded-lg transition"
                    >
                      <RotateCcw size={14} className="flex-shrink-0" /> Refund + cancel order
                    </button>
                    <p className="text-xs text-gray-500">
                      Or use “Cancel without refund” below to cancel and handle the refund later
                      from the Refunds panel.
                    </p>
                  </>
                ) : (
                  <p>This action cannot be undone.</p>
                )}
              </div>
            }
            onConfirm={() => { if (cancelTarget) confirmCancel(cancelTarget); }}
            onCancel={() => setCancelTarget(null)}
          />
        );
      })()}

      {/* Refund + cancel: reuses the Refunds panel modal, then cancels on submit */}
      {refundCancelTarget && (
        <RefundModal
          order={refundCancelTarget}
          customerName={refundCancelTarget.customerName}
          cancelAfter
          onClose={() => setRefundCancelTarget(null)}
          onSubmit={(fields) => refundAndCancel(refundCancelTarget, fields)}
        />
      )}
    </div>
  );
}
