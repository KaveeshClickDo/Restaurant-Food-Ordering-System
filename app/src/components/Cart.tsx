"use client";

import { useApp } from "@/context/AppContext";
import { Trash2, Plus, Minus, ShoppingCart, ChevronRight, CalendarDays, X } from "lucide-react";
import { computeTax, taxSurcharge } from "@/lib/taxUtils";
import { useState } from "react";
import CheckoutModal from "./CheckoutModal";
import ScheduleOrderModal from "./ScheduleOrderModal";

export default function Cart() {
  const { cart, updateQty, clearCart, cartTotal, settings, fulfillment, isOpen, scheduledTime, setScheduledTime } = useApp();
  const [showCheckout, setShowCheckout] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const { minOrder, deliveryFee, serviceFee } = settings.restaurant;
  const delivery   = fulfillment === "delivery" ? deliveryFee : 0;
  const service    = cartTotal * (serviceFee / 100);
  const tax        = computeTax(cartTotal, settings);
  const grandTotal = cartTotal + delivery + service + taxSurcharge(tax);
  const shortfall = minOrder - cartTotal;
  // Allow checkout when: min order met AND (store is open OR a future slot is scheduled)
  const canCheckout = cartTotal >= minOrder && cart.length > 0 && (isOpen || !!scheduledTime);

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-orange-500" />
            <h2 className="font-bold text-gray-900">Your order</h2>
          </div>
          {cart.length > 0 && (
            <button
              onClick={clearCart}
              className="text-xs text-gray-400 hover:text-red-500 transition flex items-center gap-1"
            >
              <Trash2 size={12} />
              Clear
            </button>
          )}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="text-center py-10 px-4">
              <ShoppingCart size={36} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-400">Your basket is empty</p>
              <p className="text-xs text-gray-300 mt-1">Add some delicious items!</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {cart.map((item) => (
                <li key={item.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 leading-snug">{item.name}</p>
                    {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        + {item.selectedAddOns.map((a) => a.name).join(", ")}
                      </p>
                    )}
                    {item.specialInstructions && (
                      <p className="text-xs text-orange-500 mt-0.5 italic">
                        &ldquo;{item.specialInstructions}&rdquo;
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">£{item.price.toFixed(2)} each</p>
                  </div>

                  {/* Qty controls */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => updateQty(item.id, item.quantity - 1)}
                      className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:border-red-300 hover:text-red-500 active:bg-red-50 transition"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="text-sm font-bold text-gray-900 w-4 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQty(item.id, item.quantity + 1)}
                      className="w-8 h-8 rounded-full border border-orange-300 text-orange-500 flex items-center justify-center hover:bg-orange-500 hover:text-white active:bg-orange-600 active:text-white transition"
                    >
                      <Plus size={13} />
                    </button>
                  </div>

                  <span className="text-sm font-bold text-gray-900 flex-shrink-0 w-14 text-right">
                    £{(item.price * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Totals */}
        {cart.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-100 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>£{cartTotal.toFixed(2)}</span>
            </div>
            {fulfillment === "delivery" && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Delivery fee</span>
                <span>£{delivery.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-gray-600">
              <span>Service fee ({serviceFee}%)</span>
              <span>£{service.toFixed(2)}</span>
            </div>
            {tax.enabled && tax.showBreakdown && tax.vatAmount > 0 && (
              <div className={`flex justify-between text-xs font-semibold ${
                tax.inclusive ? "text-gray-400" : "text-orange-600"
              }`}>
                <span>{tax.label}</span>
                <span>{tax.inclusive ? `£${tax.vatAmount.toFixed(2)}` : `+£${tax.vatAmount.toFixed(2)}`}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Total</span>
              <span>£{grandTotal.toFixed(2)}</span>
            </div>
            {tax.enabled && tax.inclusive && tax.showBreakdown && (
              <p className="text-[10px] text-gray-400 text-right">Prices include {tax.rate}% VAT</p>
            )}
          </div>
        )}

        {/* Shortfall warning */}
        {cart.length > 0 && cartTotal < minOrder && (
          <div className="px-5 pb-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 font-medium">
              Add £{shortfall.toFixed(2)} more to reach the minimum order of £{minOrder.toFixed(2)}
            </div>
          </div>
        )}

        {/* Scheduled time strip */}
        {scheduledTime && (
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CalendarDays size={13} className="text-green-600 flex-shrink-0" />
              <p className="text-xs text-green-700 font-semibold flex-1 min-w-0 truncate">
                {scheduledTime}
              </p>
              <button
                onClick={() => setShowSchedule(true)}
                className="text-[10px] text-green-600 hover:text-green-800 font-semibold underline flex-shrink-0"
              >
                Change
              </button>
              <button
                onClick={() => setScheduledTime(null)}
                className="text-green-400 hover:text-green-700 flex-shrink-0 transition"
                title="Cancel scheduled order"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* "Order for later" prompt when store is closed and no time is set */}
        {!isOpen && !scheduledTime && cart.length > 0 && (
          <div className="px-5 pb-3">
            <button
              onClick={() => setShowSchedule(true)}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-orange-300 hover:border-orange-500 text-orange-600 hover:text-orange-700 rounded-xl py-2.5 text-xs font-semibold transition-all"
            >
              <CalendarDays size={13} />
              Schedule this order for later
            </button>
          </div>
        )}

        {/* Checkout button */}
        <div className="px-5 pb-5">
          <button
            disabled={!canCheckout}
            onClick={() => setShowCheckout(true)}
            className={`w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-between px-5 transition-all ${
              canCheckout
                ? "bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            <span>{scheduledTime ? "Schedule order" : "Go to checkout"}</span>
            {canCheckout && (
              <span className="flex items-center gap-1">
                £{grandTotal.toFixed(2)}
                <ChevronRight size={16} />
              </span>
            )}
          </button>
        </div>
      </div>

      {showCheckout && (
        <CheckoutModal onClose={() => setShowCheckout(false)} />
      )}
      {showSchedule && (
        <ScheduleOrderModal onClose={() => setShowSchedule(false)} />
      )}
    </>
  );
}
