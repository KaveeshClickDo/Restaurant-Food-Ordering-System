"use client";

import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import {
    Receipt,
    PackageX,
    Navigation,
    RotateCcw,
    ChefHat,
    Bike,
    ShoppingBag,
    CheckCheck,
    X,
    Pin,
    Search,
    LayoutDashboard,
    LogOut,
    ShoppingCart,
    FileText,
    Printer,
    Circle,
    CheckCircle2,
    Package,
    Truck,
    Ban,
} from "lucide-react";
import AuthModal from "@/components/AuthModal";
import type { AddOn, CartItem, Customer, Order, OrderStatus } from "@/types";
import { fullOrderNumber } from "@/lib/orderNumber";
import Link from "next/link";
import Cart from "@/components/Cart";
import MobileBottomNav from "@/components/MobileBottomNav";
import { effectiveMenuPrice, getOfferUnitPrice, isOnChannel } from "@/lib/menuOfferUtils";
import { resolveStock } from "@/lib/stockUtils";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ── Track order modal ───────────────────────────────────────────────
function TrackOrderModal({ order, onClose }: { order: Order; onClose: () => void }) {
    const { settings } = useApp();
    const sym = settings.currency?.symbol ?? "£";
    const isDelivery = order.fulfillment === "delivery";
    const STEPS: { key: string; label: string; icon: React.ReactNode }[] = [
        { key: "pending", label: "Order received", icon: <Receipt className="w-4 h-4" strokeWidth={1.8} /> },
        { key: "preparing", label: "In the kitchen", icon: <ChefHat className="w-4 h-4" strokeWidth={1.8} /> },
        {
            key: "ready",
            label: isDelivery ? "On the way" : "Ready to collect",
            icon: isDelivery
                ? <Bike className="w-4 h-4" strokeWidth={1.8} />
                : <ShoppingBag className="w-4 h-4" strokeWidth={1.8} />,
        },
        { key: "delivered", label: isDelivery ? "Delivered" : "Collected", icon: <CheckCheck className="w-4 h-4" strokeWidth={2} /> },
    ];

    const statusIndex: Record<string, number> = {
        pending: 0, confirmed: 1, preparing: 1, ready: 2, delivered: 3,
    };
    const currentStep = statusIndex[order.status] ?? 0;

    const itemSummary = order.items.map((i) => `${i.qty}× ${i.name}`).join(", ");

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full sm:max-w-md bg-white sm:rounded-3xl rounded-t-3xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Tracking order</p>
                        <p title={fullOrderNumber(order.id)} className="text-[15px] font-bold text-zinc-900 mt-0.5 truncate">{fullOrderNumber(order.id)}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 transition-colors">
                        <X className="w-4 h-4" strokeWidth={2} />
                    </button>
                </div>

                {/* Route visualization */}
                <div className="px-3 sm:px-5 py-6 bg-stone-50">
                    <div className="relative flex items-center justify-between">
                        {/* Line */}
                        <div className="absolute left-6 right-6 top-5 h-0.5 bg-zinc-200 z-0" />
                        <div
                            className="absolute left-6 top-5 h-0.5 bg-orange-500 z-0 transition-all duration-700"
                            style={{ width: `${(currentStep / 3) * 100}%`, maxWidth: "calc(100% - 3rem)" }}
                        />
                        {/* Steps */}
                        {STEPS.map((step, i) => (
                            <div key={step.key} className="relative z-10 flex flex-col items-center gap-1.5" style={{ width: "25%" }}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${i <= currentStep
                                    ? "bg-orange-500 text-white shadow-lg shadow-orange-500/30"
                                    : "bg-white border-2 border-zinc-200 text-zinc-400"
                                    }`}>
                                    {step.icon}
                                </div>
                                <p className={`text-[10px] font-medium text-center leading-tight transition-colors ${i <= currentStep ? "text-orange-600" : "text-zinc-400"
                                    }`}>
                                    {step.label}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Driver info */}
                {order.driverName && (
                    <div className="mx-5 mt-4 flex items-center gap-3 bg-zinc-50 rounded-2xl p-3.5">
                        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-[16px] flex-shrink-0">
                            {order.driverName.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-zinc-400 leading-none mb-0.5">Your driver</p>
                            <p className="text-[14px] font-semibold text-zinc-800">{order.driverName}</p>
                        </div>
                        <Navigation className="w-5 h-5 text-orange-500" strokeWidth={1.8} />
                    </div>
                )}

                {/* Delivery confirmation code. Only shown for delivery orders that
                 *  haven't been delivered yet — once delivered the code has been
                 *  used. Same value the customer received by email, mirrored here
                 *  in case the email was missed or deleted. */}
                {order.fulfillment === "delivery"
                    && order.deliveryCode
                    && order.status !== "delivered"
                    && order.status !== "cancelled"
                    && order.paymentStatus !== "refunded" && (
                        <div className="mx-5 mt-3 rounded-2xl p-4 text-center border-2 border-dashed border-orange-300 bg-orange-50">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-700 mb-1">
                                Delivery confirmation code
                            </p>
                            <p className="font-mono font-extrabold text-[28px] tracking-[0.4em] text-zinc-900 leading-none my-2">
                                {order.deliveryCode}
                            </p>
                            <p className="text-[11.5px] text-zinc-600 leading-snug">
                                Show or read this to your driver to confirm delivery.
                            </p>
                        </div>
                    )}

                {/* Order details */}
                <div className="px-5 py-4 space-y-3">
                    <div className="bg-zinc-50 rounded-2xl p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">Order summary</p>
                        <p className="text-[13px] text-zinc-700 leading-relaxed">{itemSummary}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-zinc-50 rounded-2xl p-3.5">
                            <p className="text-[10px] text-zinc-400 mb-1">Total</p>
                            <p className="text-[15px] font-bold text-zinc-900 tabular-nums">{sym}{order.total.toFixed(2)}</p>
                        </div>
                        <div className="bg-zinc-50 rounded-2xl p-3.5">
                            <p className="text-[10px] text-zinc-400 mb-1">Type</p>
                            <p className="text-[14px] font-semibold text-zinc-800 capitalize">{order.fulfillment}</p>
                        </div>
                    </div>

                    {order.address && (
                        <div className="flex items-start gap-2.5 bg-zinc-50 rounded-2xl p-3.5">
                            <Pin className="w-4 h-4 text-zinc-400 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                            <p className="text-[13px] text-zinc-700 leading-snug">{order.address}</p>
                        </div>
                    )}
                </div>

                <div className="pb-6" />
            </div>
        </div>
    );
}


interface ReorderResult { added: number; skipped: string[]; priceChanged: string[] }

function ReorderToast({ result, onClose }: { result: ReorderResult; onClose: () => void }) {
    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
            <div className="bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-start gap-3">
                <ShoppingCart size={18} className="text-zinc-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">
                        {result.added > 0
                            ? `${result.added} item${result.added !== 1 ? "s" : ""} added to cart`
                            : "No items could be added"}
                    </p>
                    {result.priceChanged.length > 0 && (
                        <p className="text-xs text-amber-400 mt-0.5 truncate">
                            Price updated: {result.priceChanged.join(", ")}
                        </p>
                    )}
                    {result.skipped.length > 0 && (
                        <p className="text-xs text-zinc-400 mt-0.5 truncate">
                            Unavailable: {result.skipped.join(", ")}
                        </p>
                    )}
                    {result.added > 0 && (
                        <Link
                            href="/"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-400 hover:text-orange-300 transition"
                        >
                            <ShoppingCart size={11} /> Go to cart
                        </Link>
                    )}
                </div>
                <button onClick={onClose} className="text-zinc-500 hover:text-white transition flex-shrink-0">
                    <X size={15} />
                </button>
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
          <div className="flex items-center gap-2 max-w-[60%]">
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

// ── Main Page ───────────────────────────────────────────────────────────────
export default function MyOrdersPage() {
    const { currentUser, addToCart, settings, menuItems, refreshCurrentUser, logout } = useApp();
    const sym = settings.currency?.symbol ?? "£";
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [trackingOrder, setTrackingOrder] = useState<Order | null>(null);
    const [authModal, setAuthModal] = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [showMobileCart, setShowMobileCart] = useState(false);
    const [reorderToast, setReorderToast] = useState<ReorderResult | null>(null);
    const [viewingReceipt, setViewingReceipt] = useState<Order | null>(null);

    const ACTIVE_STATUSES = new Set(["pending", "confirmed", "preparing", "ready"]);
    // Only a FULL refund removes an order from "active". A partially refunded
    // order that's still mid-pipeline is still being prepared and delivered, so
    // it must stay in progress — the customer still needs the driver code.
    const isFullyRefunded = (o: Order) => o.paymentStatus === "refunded";
    const displayOrders = currentUser?.orders ?? [];
    const hasActiveOrders = displayOrders.some((o) => ACTIVE_STATUSES.has(o.status) && !isFullyRefunded(o));

    // Refresh immediately on mount so switching to this screen always shows fresh data.
    useEffect(() => {
        if (currentUser) refreshCurrentUser().catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id]);

    // Poll every 15 s while active orders exist — graceful fallback if Realtime is unreliable.
    useEffect(() => {
        if (!currentUser?.id || !hasActiveOrders) return;
        const id = setInterval(() => refreshCurrentUser().catch(() => { }), 15_000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id, hasActiveOrders]);

    // Re-fetch when the browser tab becomes visible again.
    useEffect(() => {
        function onVisible() {
            if (document.visibilityState === "visible" && currentUser) {
                refreshCurrentUser().catch(() => { });
            }
        }
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id]);

    const allOrders = [...displayOrders].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const activeOrders = allOrders.filter((o) => ACTIVE_STATUSES.has(o.status) && !isFullyRefunded(o));
    const pastOrders = allOrders.filter((o) => !ACTIVE_STATUSES.has(o.status) || isFullyRefunded(o));

    const activeLabel = (order: Order): string => {
        switch (order.status) {
            case "pending": return "Order received";
            case "confirmed": return "Confirmed";
            case "preparing": return "In the kitchen";
            case "ready": return order.fulfillment === "delivery" ? "Out for delivery" : "Ready to collect / pick up";
            default: return order.status;
        }
    };

    // ── Re-order handler ───────────────────────────────────────────────────────
    function handleReorder(order: Order) {
        const added: string[] = [];
        const skipped: string[] = [];
        const priceChanged: string[] = [];

        order.items.forEach((line) => {
            // Match by menuItemId first (preferred), fall back to name
            const menuItem = line.menuItemId
                ? menuItems.find((m) => m.id === line.menuItemId)
                : menuItems.find((m) => m.name.toLowerCase() === line.name.toLowerCase());

            if (!menuItem || !isOnChannel(menuItem, "online") || resolveStock(menuItem) === "out_of_stock") {
                skipped.push(line.name);
                return;
            }

            // Resolve Variations (Support multiple variations + Name fallback)
            // Check for both plural and singular keys to be safe
            const originalVars = line.selectedVariations || (line.selectedVariation ? [line.selectedVariation] : []);
            const resolvedVariations: CartItem["selectedVariations"] = [];
            let variationPriceTotal = 0;

            if (originalVars.length > 0) {
                originalVars.forEach((saved) => {
                    // Find the variation group (e.g., "Size")
                    const variationGroup = menuItem.variations?.find(v => v.id === saved.variationId);

                    // Find the specific option (e.g., "Large")
                    // Try ID first, fallback to Label matching
                    let option = variationGroup?.options.find(o => o.id === saved.optionId);
                    if (!option && saved.label) {
                        option = variationGroup?.options.find(o => o.label.toLowerCase() === saved.label.toLowerCase());
                    }

                    if (option && variationGroup) {
                        resolvedVariations.push({
                            variationId: variationGroup.id,
                            optionId: option.id,
                            label: option.label
                        });
                        variationPriceTotal += option.price;
                    }
                });
            }

            // Resolve Add-ons (ID matching + Name fallback)
            let resolvedAddOns: CartItem["selectedAddOns"] = [];
            let addOnsPriceTotal = 0;

            if (line.selectedAddOns?.length) {
                const currentMenuAddOns = menuItem.addOns ?? [];
                resolvedAddOns = line.selectedAddOns.map((saved) => {
                    // Try ID match first
                    let found = currentMenuAddOns.find((a) => String(a.id) === String(saved.id));
                    // Fallback to Name match if ID changed
                    if (!found) {
                        found = currentMenuAddOns.find((a) => a.name.toLowerCase() === saved.name.toLowerCase());
                    }
                    return found;
                }).filter((a): a is AddOn => a != null);

                addOnsPriceTotal = resolvedAddOns.reduce((s, a) => s + a.price, 0);
            }

            // Price Validation
            const offerBase = getOfferUnitPrice(menuItem) ?? effectiveMenuPrice(menuItem);
            const currentPrice = offerBase + variationPriceTotal + addOnsPriceTotal;

            if (Math.abs(currentPrice - line.price) > 0.005) {
                priceChanged.push(line.name);
            }

            // Add to Cart with ALL data
            addToCart({
                id: crypto.randomUUID(),
                menuItemId: menuItem.id,
                name: menuItem.name,
                price: currentPrice,
                quantity: line.qty,
                // Pass the resolved arrays to the cart
                selectedVariations: resolvedVariations,
                selectedAddOns: resolvedAddOns,
                specialInstructions: line.specialInstructions,
                ...(menuItem.offer?.active ? { offer: menuItem.offer } : {}),
            });

            added.push(line.name);
        });

        setReorderToast({ added: added.length, skipped, priceChanged });
        setTimeout(() => setReorderToast(null), 6000);

        if (added.length > 0) {
            router.push("/");
        }
    }

    return (
        <div className="h-full flex overflow-hidden" style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif', backgroundColor: '#f5f5f3' }}>

            {/* ── Main content area ─────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 h-full">

                {/* Top search header */}
                <header className="hidden lg:flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-b border-zinc-200/70 bg-white flex-shrink-0">
                    {/* Mobile: logo */}
                    <div className="lg:hidden flex items-center gap-2 flex-shrink-0">
                        {settings.restaurant.logoImage ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={settings.restaurant.logoImage} alt={settings.restaurant.name}
                                className="w-8 h-8 rounded-xl object-cover" />
                        ) : (
                            <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[14px] font-bold">
                                {settings.restaurant.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                    </div>

                    {/* Search */}
                    <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-100 max-w-xl">
                        <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search dishes…"
                            className="flex-1 bg-transparent outline-none text-[13.5px] text-zinc-900 placeholder:text-zinc-400"
                        />
                        {search && (
                            <button onClick={() => setSearch("")} className="text-[11px] font-medium text-zinc-400 hover:text-zinc-700 transition-colors">
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Auth / user (desktop) */}
                    <div className="hidden lg:flex items-center gap-2">
                        {currentUser ? (
                            <div className="relative">
                                <button
                                    onClick={() => setUserMenuOpen((o) => !o)}
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 transition-colors"
                                >
                                    <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-[11px] font-bold">
                                        {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
                                    </div>
                                    <span className="text-[13px] font-medium text-zinc-700">{currentUser.name?.split(" ")[0]}</span>
                                </button>
                                {userMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                                        <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl border border-zinc-200/70 shadow-lg z-20 overflow-hidden py-1">
                                            <Link href="/account" onClick={() => setUserMenuOpen(false)}
                                                className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50 transition-colors">
                                                <LayoutDashboard className="w-4 h-4" strokeWidth={1.6} />Account
                                            </Link>
                                            <button onClick={() => { logout(); setUserMenuOpen(false); }}
                                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors">
                                                <LogOut className="w-4 h-4" strokeWidth={1.6} />Sign out
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <button onClick={() => setAuthModal({ open: true, tab: "login" })}
                                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-[13px] font-medium hover:bg-orange-600 transition-colors">
                                Sign in
                            </button>
                        )}
                    </div>

                </header>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto pb-15">

                    <div className="min-h-full pb-10" style={{ backgroundColor: "#f5f5f3" }}>
                        <div className="px-5 pt-7 pb-2">
                            <h1 className="text-[28px] font-extrabold text-zinc-900 tracking-tight leading-tight">My Orders</h1>
                            <p className="text-[13.5px] text-zinc-500 mt-1">Recent activity from your kitchen.</p>
                        </div>

                        {!currentUser ? (
                            <div className="mx-5 mt-6 bg-white rounded-3xl p-8 flex flex-col items-center gap-4 text-center shadow-sm">
                                <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
                                    <Receipt className="w-7 h-7 text-zinc-400" strokeWidth={1.4} />
                                </div>
                                <p className="text-[13.5px] text-zinc-500">Sign in to see your order history</p>
                                <button onClick={() => setAuthModal({ open: true, tab: "login" })}
                                    className="px-6 py-2.5 rounded-full bg-zinc-900 hover:bg-zinc-700 text-white text-[13.5px] font-semibold transition-colors">
                                    Sign in
                                </button>
                            </div>

                        ) : displayOrders.length === 0 ? (
                            <div className="mx-5 mt-6 bg-white rounded-3xl p-8 flex flex-col items-center gap-3 text-center shadow-sm">
                                <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
                                    <PackageX className="w-7 h-7 text-zinc-400" strokeWidth={1.4} />
                                </div>
                                <p className="text-[13.5px] text-zinc-500">No orders yet — your order history will appear here.</p>
                            </div>

                        ) : (
                            <>
                                {activeOrders.length > 0 && (
                                    <div className="mx-5 mt-4 space-y-3">
                                        {activeOrders.map((activeOrder) => (
                                            <div key={activeOrder.id} className="bg-zinc-900 rounded-3xl p-5 shadow-lg">
                                                <div className="flex items-center gap-1.5 mb-4">
                                                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                                    <span className="text-[11px] font-bold uppercase tracking-widest text-green-400">In Progress</span>
                                                </div>
                                                <p title={fullOrderNumber(activeOrder.id)} className="text-[13px] text-zinc-400 mb-0.5 truncate">Order {fullOrderNumber(activeOrder.id)}</p>
                                                <p className="text-[18px] font-bold text-white leading-snug mb-3">
                                                    {activeLabel(activeOrder)}
                                                </p>
                                                <p className="text-[12.5px] text-zinc-400 leading-relaxed mb-5 line-clamp-2">
                                                    {activeOrder.items.map((i) => {
                                                        // 1. Get variations and add-ons
                                                        const v = i.selectedVariations?.map(v => v.label).join(", ");
                                                        const a = i.selectedAddOns?.map(a => a.name).join(", ");

                                                        // 2. Combine them only if they exist
                                                        const details = [v, a].filter(Boolean).join(" / ");

                                                        // 3. Return the string with details in brackets if present
                                                        return `${i.qty}× ${i.name}${details ? ` (${details})` : ""}`;
                                                    }).join(", ")}
                                                </p>

                                                {/* Compact delivery code pill — same value the customer got by
                                                 *  email. Surfaced here so they don't need to dig for it when the
                                                 *  driver arrives. Only for delivery orders that aren't completed. */}
                                                {activeOrder.fulfillment === "delivery" && activeOrder.deliveryCode && (
                                                    <div className="mb-4 rounded-2xl border border-orange-400/40 bg-orange-500/10 px-3.5 py-2.5 flex items-center gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-orange-300 leading-none mb-1">
                                                                Driver code
                                                            </p>
                                                            <p className="text-[11px] text-zinc-300 leading-snug">
                                                                Tell this to your driver
                                                            </p>
                                                        </div>
                                                        <p className="font-mono font-extrabold text-[20px] tracking-[0.3em] text-white leading-none">
                                                            {activeOrder.deliveryCode}
                                                        </p>
                                                    </div>
                                                )}

                                                <div className="flex flex-wrap gap-2 items-center justify-between">
                                                    <span className="text-[16px] font-bold text-white tabular-nums">{sym}{activeOrder.total.toFixed(2)}</span>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => setViewingReceipt(activeOrder)}
                                                            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-zinc-700 text-zinc-300 text-[12px] font-medium hover:bg-zinc-800 transition-colors"
                                                        >
                                                            <Receipt className="w-3.5 h-3.5" />
                                                            Receipt
                                                        </button>
                                                        <button
                                                            onClick={() => setTrackingOrder(activeOrder)}
                                                            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-zinc-900 text-[13px] font-bold hover:bg-zinc-100 transition-colors active:scale-[0.98]"
                                                        >
                                                            <Navigation className="w-3.5 h-3.5" strokeWidth={2} />
                                                            Track order
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {pastOrders.length > 0 && (
                                    <div className="px-5 mt-6">
                                        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-3">Past orders</p>
                                        <div className="space-y-3 max-w-lg">
                                            {pastOrders.map((order) => {
                                                const dateStr = new Date(order.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                                                const itemSummary = order.items.slice(0, 2).map((i) => {
                                                    const v = i.selectedVariations?.map(v => v.label).join(", ");
                                                    const a = i.selectedAddOns?.map(a => a.name).join(", ");
                                                    const details = [v, a].filter(Boolean).join(" / ");
                                                    return `${i.qty}× ${i.name}${details ? ` (${details})` : ""}`;
                                                }).join(", ") + (order.items.length > 2 ? ` +${order.items.length - 2} more` : "");
                                                // Refund state lives in paymentStatus; status stays on fulfillment.
                                                const refundLabel =
                                                    order.paymentStatus === "refunded"
                                                        ? "refunded"
                                                        : order.paymentStatus === "partially_refunded"
                                                            ? "partially refunded"
                                                            : null;
                                                // Red is reserved for cancelled orders — a delivered order with a
                                                // refund completed normally, so it keeps the neutral grey.
                                                const isCancelled = order.status === "cancelled";
                                                // A refunded order must surface both facts — showing only
                                                // "cancelled"/"Delivered" hides from the customer that their
                                                // money came back, and a bare "refunded" hides whether the
                                                // food ever arrived.
                                                const pastLabel =
                                                    order.status === "cancelled"
                                                        ? (refundLabel ? `cancelled · ${refundLabel}` : "cancelled")
                                                        : refundLabel
                                                            ? `Delivered · ${refundLabel}`
                                                            : "Delivered";
                                                return (
                                                    <div key={order.id} className="bg-white rounded-3xl p-5 shadow-sm">
                                                        <div className="flex items-start justify-between gap-2 mb-2">
                                                            <p className="text-[12px] text-zinc-400">{dateStr}</p>
                                                            <span className={`text-[10.5px] font-bold uppercase tracking-wider ${isCancelled ? "text-red-400" : "text-zinc-400"}`}>
                                                                {pastLabel}
                                                            </span>
                                                        </div>
                                                        <p className="text-[14px] font-semibold text-zinc-900 leading-snug mb-3 line-clamp-2">{itemSummary}</p>
                                                        <div className="flex flex-wrap gap-2 items-center justify-between">
                                                            <span className="text-[15px] font-bold text-zinc-900 tabular-nums">{sym}{order.total.toFixed(2)}</span>
                                                            <div className="flex items-center gap-4">
                                                                <button
                                                                    onClick={() => setViewingReceipt(order)}
                                                                    className="flex items-center gap-1 text-[13px] font-semibold text-zinc-500 hover:text-zinc-800 transition-colors"
                                                                >
                                                                    <FileText className="w-3.5 h-3.5" strokeWidth={2} />
                                                                    Receipt
                                                                </button>
                                                                <button
                                                                    onClick={() => handleReorder(order)}
                                                                    className="flex items-center gap-1 text-[13px] font-semibold text-orange-500 hover:text-orange-600 transition-colors"
                                                                >
                                                                    <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                                                                    Reorder
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {viewingReceipt && currentUser && (
                <ReceiptModal
                    order={viewingReceipt}
                    customer={currentUser}
                    onClose={() => setViewingReceipt(null)}
                />
            )}

            {/* Re-order toast */}
            {reorderToast && (
                <ReorderToast result={reorderToast} onClose={() => setReorderToast(null)} />
            )}

            {/* ── Mobile Bottom Nav ── */}
            <MobileBottomNav
                onCartOpen={() => setShowMobileCart(true)}
                onAuth={() => setAuthModal({ open: true, tab: "login" })}
            />

            {/* ── Mobile Cart Drawer ── */}
            {showMobileCart && (
                <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileCart(false)} />
                    <div className="relative bg-white rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
                        <Cart
                            onMobileClose={() => setShowMobileCart(false)}
                            onOrderPlaced={() => { setShowMobileCart(false); router.push('/my-orders'); }}
                        />
                    </div>
                </div>
            )}


            {trackingOrder && (
                <TrackOrderModal order={trackingOrder} onClose={() => setTrackingOrder(null)} />
            )}

            {authModal.open && (
                <AuthModal
                    initialTab={authModal.tab}
                    onClose={() => setAuthModal({ open: false, tab: "login" })}
                />
            )}

        </div>
    );
}