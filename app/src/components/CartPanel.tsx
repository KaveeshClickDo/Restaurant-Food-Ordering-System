"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import {
  ShoppingBag, Trash2, X, Minus, Plus, CalendarDays, ChevronRight,
} from "lucide-react";
import AuthModal from "@/components/AuthModal";
import CheckoutModal from "@/components/CheckoutModal";
import ScheduleOrderModal from "@/components/ScheduleOrderModal";
import { computeTax, taxSurcharge } from "@/lib/taxUtils";

interface CartPanelProps {
  onMobileClose?: () => void;
  onOrderPlaced?: () => void;
}

export default function CartPanel({ onMobileClose, onOrderPlaced }: CartPanelProps) {
  const { cart, updateQty, clearCart, cartTotal, settings, fulfillment, isOpen, scheduledTime, setScheduledTime, currentUser } = useApp();
  const [showCheckout, setShowCheckout] = useState(false);
  const [showAuth,     setShowAuth]     = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const { minOrder, deliveryFee, serviceFee } = settings.restaurant;
  const delivery   = fulfillment === "delivery" ? deliveryFee : 0;
  const service    = cartTotal * (serviceFee / 100);
  const tax        = computeTax(cartTotal, settings);
  const grandTotal = cartTotal + delivery + service + taxSurcharge(tax);
  const shortfall  = minOrder - cartTotal;
  const canCheckout = cartTotal >= minOrder && cart.length > 0 && (isOpen || !!scheduledTime);

  return (
    <>
      <div className="flex flex-col h-full bg-white w-full">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-[17px] h-[17px] text-zinc-700" strokeWidth={1.6} />
            <h2 className="font-semibold text-[14.5px] text-zinc-900 tracking-tight">Your order</h2>
            {cart.length > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {cart.length > 0 && (
              <button onClick={clearCart} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Clear cart">
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            )}
            {onMobileClose && (
              <button onClick={onMobileClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors lg:hidden">
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-14 px-5 text-center">
              <ShoppingBag className="w-10 h-10 text-zinc-200 mb-3" strokeWidth={1.2} />
              <p className="text-[13.5px] font-medium text-zinc-400">Your basket is empty</p>
              <p className="text-[12px] text-zinc-300 mt-1">Add items to get started</p>
              {!isOpen && !scheduledTime && (
                <button
                  onClick={() => setShowSchedule(true)}
                  className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100 text-orange-700 text-[12.5px] font-semibold transition-all"
                >
                  <CalendarDays className="w-3.5 h-3.5" strokeWidth={1.8} />
                  Order for later
                </button>
              )}
            </div>
          ) : (
            <ul>
              {cart.map((item) => (
                <li key={item.id} className="px-5 py-3.5 flex items-start gap-3 border-b border-zinc-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-zinc-900 leading-snug">{item.name}</p>
                    {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                      <p className="text-[11.5px] text-zinc-400 mt-0.5">+ {item.selectedAddOns.map((a) => a.name).join(", ")}</p>
                    )}
                    {item.specialInstructions && (
                      <p className="text-[11.5px] text-zinc-500 mt-0.5 italic">&ldquo;{item.specialInstructions}&rdquo;</p>
                    )}
                    <p className="text-[12px] text-zinc-400 mt-1">£{item.price.toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => updateQty(item.id, item.quantity - 1)}
                      className="w-7 h-7 rounded-full border border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 transition-colors">
                      <Minus className="w-3 h-3" strokeWidth={2} />
                    </button>
                    <span className="text-[13px] font-bold text-zinc-900 w-4 text-center tabular-nums">{item.quantity}</span>
                    <button onClick={() => updateQty(item.id, item.quantity + 1)}
                      className="w-7 h-7 rounded-full border border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-orange-500 hover:bg-orange-500 hover:text-white transition-colors">
                      <Plus className="w-3 h-3" strokeWidth={2} />
                    </button>
                  </div>
                  <span className="text-[13px] font-bold text-zinc-900 flex-shrink-0 w-12 text-right tabular-nums">
                    £{(item.price * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Totals + actions */}
        {cart.length > 0 && (
          <div className="flex-shrink-0 border-t border-zinc-100">
            <div className="px-5 py-4 space-y-2">
              <div className="flex justify-between text-[13px] text-zinc-500">
                <span>Subtotal</span><span className="tabular-nums">£{cartTotal.toFixed(2)}</span>
              </div>
              {fulfillment === "delivery" && delivery > 0 && (
                <div className="flex justify-between text-[13px] text-zinc-500">
                  <span>Delivery fee</span><span className="tabular-nums">£{delivery.toFixed(2)}</span>
                </div>
              )}
              {fulfillment === "collection" && (
                <div className="flex justify-between text-[13px] text-zinc-500">
                  <span>Collection</span><span className="text-emerald-600 font-medium">Free</span>
                </div>
              )}
              {serviceFee > 0 && (
                <div className="flex justify-between text-[13px] text-zinc-500">
                  <span>Service fee ({serviceFee}%)</span><span className="tabular-nums">£{service.toFixed(2)}</span>
                </div>
              )}
              {tax.enabled && tax.showBreakdown && tax.vatAmount > 0 && (
                <div className="flex justify-between text-[12px] font-semibold text-zinc-400">
                  <span>{tax.label}</span>
                  <span className="tabular-nums">{tax.inclusive ? "" : "+"} £{tax.vatAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-[14px] text-zinc-900 pt-2 border-t border-zinc-100">
                <span>Total</span><span className="tabular-nums">£{grandTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Min order warning */}
            {cartTotal < minOrder && (
              <div className="px-5 pb-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11.5px] text-amber-700 font-medium">
                  Add £{shortfall.toFixed(2)} more to reach the £{minOrder.toFixed(2)} minimum
                </div>
              </div>
            )}

            {/* Scheduled time strip */}
            {scheduledTime && (
              <div className="px-5 pb-3">
                <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                  <CalendarDays className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" strokeWidth={1.8} />
                  <p className="text-[11.5px] text-zinc-700 font-medium flex-1 min-w-0 truncate">{scheduledTime}</p>
                  <button onClick={() => setScheduledTime(null)} className="text-zinc-400 hover:text-zinc-700 transition-colors">
                    <X className="w-3 h-3" strokeWidth={2} />
                  </button>
                </div>
              </div>
            )}

            {/* Schedule for later when closed */}
            {!isOpen && !scheduledTime && (
              <div className="px-5 pb-3">
                <button onClick={() => setShowSchedule(true)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-zinc-300 hover:border-zinc-500 text-zinc-500 hover:text-zinc-800 rounded-xl py-2.5 text-[12px] font-semibold transition-all">
                  <CalendarDays className="w-3.5 h-3.5" strokeWidth={1.8} />
                  Schedule for later
                </button>
              </div>
            )}

            {/* Checkout button */}
            <div className="px-5 pb-5">
              <button
                disabled={!canCheckout}
                onClick={() => currentUser ? setShowCheckout(true) : setShowAuth(true)}
                className={`w-full py-3.5 rounded-xl font-semibold text-[14px] flex items-center justify-between px-5 transition-all ${
                  canCheckout
                    ? "bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white"
                    : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                }`}
              >
                <span>{scheduledTime ? "Schedule order" : "Go to checkout"}</span>
                {canCheckout && (
                  <span className="flex items-center gap-1 tabular-nums">
                    £{grandTotal.toFixed(2)} <ChevronRight className="w-4 h-4" strokeWidth={2} />
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => setShowCheckout(true)}
          subtitle="Sign in or create an account to place your order — your basket will be saved."
        />
      )}
      {showCheckout && (
        <CheckoutModal
          onClose={() => setShowCheckout(false)}
          onOrderPlaced={() => { onMobileClose?.(); onOrderPlaced?.(); }}
        />
      )}
      {showSchedule && <ScheduleOrderModal onClose={() => setShowSchedule(false)} />}
    </>
  );
}