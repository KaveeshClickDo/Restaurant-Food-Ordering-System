"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import {
  ShoppingBag, Trash2, X, Minus, Plus, CalendarDays, ChevronRight, AlertTriangle,
} from "lucide-react";
import AuthModal from "@/components/AuthModal";
import CheckoutModal from "@/components/CheckoutModal";
import ScheduleOrderModal from "@/components/ScheduleOrderModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { computeTax, taxSurcharge } from "@/lib/taxUtils";
import { cartLineTotal } from "@/lib/menuOfferUtils";
import { isMealPeriodActive } from "@/lib/scheduleUtils";

interface CartProps {
  onMobileClose?: () => void;
  onOrderPlaced?: () => void;
}

export default function Cart({ onMobileClose, onOrderPlaced }: CartProps) {
  const { cart, updateQty, clearCart, cartTotal, menuItems, mealPeriods, settings, fulfillment, isOpen, scheduledTime, setScheduledTime, currentUser } = useApp();
  const [showCheckout, setShowCheckout] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Tick every 30s so meal-period orderability re-evaluates as windows roll over.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Lines whose item is currently outside its meal-period window.
  // Anytime items (no tags) and items missing from the catalogue are skipped.
  const activeMealPeriodIds = new Set(
    mealPeriods.filter((p) => isMealPeriodActive(p)).map((p) => p.id),
  );
  const blockedLines = cart.filter((line) => {
    const item = menuItems.find((m) => m.id === line.menuItemId);
    if (!item) return false;
    const tags = item.mealPeriodIds ?? [];
    if (tags.length === 0) return false;
    return !tags.some((id) => activeMealPeriodIds.has(id));
  });
  const hasBlockedLines = blockedLines.length > 0;

  const { minOrder, deliveryFee, serviceFee } = settings.restaurant;
  const sym = settings.currency?.symbol ?? "£";
  const delivery = fulfillment === "delivery" ? deliveryFee : 0;
  const service = cartTotal * (serviceFee / 100);
  const tax = computeTax(cartTotal, settings);
  const grandTotal = cartTotal + delivery + service + taxSurcharge(tax);
  const shortfall = minOrder - cartTotal;
  const canCheckout = cartTotal >= minOrder && cart.length > 0 && (isOpen || !!scheduledTime) && !hasBlockedLines;

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
              <button onClick={() => setShowClearConfirm(true)} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Clear cart">
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
                    <p className="text-[13.5px] font-semibold text-zinc-900 leading-snug">
                      {item.name}
                      {item.loyaltyRewardId && (
                        <span className="ml-2 inline-flex items-center gap-1 align-middle bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5">
                          Reward
                        </span>
                      )}
                    </p>
                    {item.selectedVariations && item.selectedVariations.length > 0 && (
                      <p className="text-[11.5px] text-zinc-400 mt-0.5">{item.selectedVariations.map((v) => v.label).join(", ")}</p>
                    )}
                    {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                      <p className="text-[11.5px] text-zinc-400 mt-0.5">+ {item.selectedAddOns.map((a) => a.name).join(", ")}</p>
                    )}
                    {item.specialInstructions && (
                      <p className="text-[11.5px] text-zinc-500 mt-0.5 italic">&ldquo;{item.specialInstructions}&rdquo;</p>
                    )}
                    {item.loyaltyRewardId ? (
                      <p className="text-[12px] text-amber-600 font-semibold mt-1">
                        {item.loyaltyPointsCost ? `${item.loyaltyPointsCost.toLocaleString()} points` : "Loyalty reward"}
                      </p>
                    ) : (
                      <p className="text-[12px] text-zinc-400 mt-1">{sym}{item.price.toFixed(2)} each</p>
                    )}
                  </div>
                  {item.loyaltyRewardId ? (
                    <button
                      onClick={() => updateQty(item.id, 0)}
                      className="flex-shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Remove reward"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => updateQty(item.id, item.quantity - 1)}
                        className="w-7 h-7 rounded-full border border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 transition-colors">
                        <Minus className="w-3 h-3" strokeWidth={2} />
                      </button>
                      <span className="text-[11px] font-bold text-zinc-900 w-6 text-center tabular-nums">{item.quantity}</span>
                      <button onClick={() => updateQty(item.id, item.quantity + 1)}
                        className="w-7 h-7 rounded-full border border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-orange-500 hover:bg-orange-500 hover:text-white transition-colors">
                        <Plus className="w-3 h-3" strokeWidth={2} />
                      </button>
                    </div>
                  )}
                  <span className="text-[13px] font-bold flex-shrink-0 whitespace-nowrap text-right tabular-nums">
                    {item.loyaltyRewardId
                      ? <span className="text-emerald-600">Free</span>
                      : <span className="text-zinc-900">{sym}{cartLineTotal(item).toFixed(2)}</span>}
                  </span>
                </li>
              )
              )}
            </ul>
          )}
        </div>

        {/* Totals + actions */}
        {cart.length > 0 && (
          <div className="flex-shrink-0 border-t border-zinc-100">
            <div className="px-5 py-4 space-y-2">
              <div className="flex justify-between text-[13px] text-zinc-500">
                <span>Subtotal</span><span className="tabular-nums">{sym}{cartTotal.toFixed(2)}</span>
              </div>
              {fulfillment === "delivery" && delivery > 0 && (
                <div className="flex justify-between text-[13px] text-zinc-500">
                  <span>Delivery fee</span><span className="tabular-nums">{sym}{delivery.toFixed(2)}</span>
                </div>
              )}
              {fulfillment === "collection" && (
                <div className="flex justify-between text-[13px] text-zinc-500">
                  <span>Collection</span><span className="text-emerald-600 font-medium">Free</span>
                </div>
              )}
              {serviceFee > 0 && (
                <div className="flex justify-between text-[13px] text-zinc-500">
                  <span>Service fee ({serviceFee}%)</span><span className="tabular-nums">{sym}{service.toFixed(2)}</span>
                </div>
              )}
              {tax.enabled && tax.showBreakdown && tax.vatAmount > 0 && (
                <div className="flex justify-between text-[12px] font-semibold text-zinc-400">
                  <span>{tax.label}</span>
                  <span className="tabular-nums">{tax.inclusive ? "" : "+"} {sym}{tax.vatAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-[14px] text-zinc-900 pt-2 border-t border-zinc-100">
                <span>Total</span><span className="tabular-nums">{sym}{grandTotal.toFixed(2)}</span>
              </div>
              {tax.enabled && tax.inclusive && tax.showBreakdown && (
                <p className="text-[10px] text-zinc-400 text-right">Prices include {tax.rate}% VAT</p>
              )}
            </div>

            {/* Min order warning */}
            {cartTotal < minOrder && (
              <div className="px-5 pb-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11.5px] text-amber-700 font-medium">
                  Add {sym}{shortfall.toFixed(2)} more to reach the {sym}{minOrder.toFixed(2)} minimum
                </div>
              </div>
            )}

            {/* Scheduled time strip */}
            {scheduledTime && (
              <div className="px-5 pb-3">
                <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                  <CalendarDays className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" strokeWidth={1.8} />
                  <p className="text-[11.5px] text-zinc-700 font-medium flex-1 min-w-0 truncate">{scheduledTime}</p>
                  <button
                    onClick={() => setShowSchedule(true)}
                    className="text-[10px] text-zinc-500 hover:text-zinc-800 font-semibold underline flex-shrink-0 transition-colors"
                  >
                    Change
                  </button>
                  <button onClick={() => setScheduledTime(null)} className="text-zinc-400 hover:text-zinc-700 transition-colors" title="Cancel scheduled order">
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

            {/* Meal-period blocker — surfaces lines that can't be ordered right now. */}
            {hasBlockedLines && (
              <div className="px-5 pb-3">
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold mb-1">
                      {blockedLines.length === 1
                        ? "1 item isn't available right now."
                        : `${blockedLines.length} items aren't available right now.`}
                    </p>
                    <p className="text-amber-700 mb-2">Remove them to continue, or come back during their serving hours.</p>
                    <ul className="space-y-1">
                      {blockedLines.map((line) => (
                        <li key={line.id} className="flex items-center justify-between gap-2 bg-white/60 rounded-lg px-2 py-1">
                          <span className="truncate">{line.name}</span>
                          <button
                            onClick={() => updateQty(line.id, 0)}
                            className="text-amber-700 hover:text-amber-900 font-semibold text-[11px] flex-shrink-0"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Checkout button */}
            <div className="px-5 pb-5">
              <button
                disabled={!canCheckout}
                onClick={() => currentUser ? setShowCheckout(true) : setShowAuth(true)}
                className={`w-full py-3.5 rounded-xl font-semibold text-[14px] flex items-center justify-between px-5 transition-all ${canCheckout
                  ? "bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white"
                  : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                  }`}
              >
                <span>{scheduledTime ? "Schedule order" : "Go to checkout"}</span>
                {canCheckout && (
                  <span className="flex items-center gap-1 tabular-nums">
                    {sym}{grandTotal.toFixed(2)} <ChevronRight className="w-4 h-4" strokeWidth={2} />
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

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear your basket?"
        message="All items will be removed. This cannot be undone."
        confirmLabel="Clear basket"
        tone="danger"
        onConfirm={() => { clearCart(); setShowClearConfirm(false); }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </>
  );
}