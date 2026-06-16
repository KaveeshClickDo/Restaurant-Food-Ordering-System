"use client";

import { usePOS } from "@/context/POSContext";
import { cartLineTotal, cartLineSaving } from "@/types/pos";
import {
  ShoppingCart, Trash2, Users, Star, ChevronRight,
  Minus, Plus, Percent, BadgeDollarSign, CreditCard,
  DollarSign,
} from "lucide-react";
import { fmt } from "./_utils";

export default function OrderPanel({
  onCharge,
  onSelectCustomer,
  onOpenDiscount,
  onOpenTip,
  onOpenServiceFee,
}: {
  onCharge: () => void;
  onSelectCustomer: () => void;
  onOpenDiscount: () => void;
  onOpenTip: () => void;
  onOpenServiceFee: () => void;
}) {
  const {
    cart, updateCartQty, clearCart,
    subtotal, discountAmount, taxAmount, grandTotal, tipAmount, serviceFeeAmount,
    discount, settings, assignedCustomer, currentStaff,
    kitchenNote, setKitchenNote,
  } = usePOS();

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700/50">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart size={16} className="text-orange-400" />
          <span className="text-white font-bold text-sm">Current Order</span>
          {cart.length > 0 && (
            <span className="bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full text-center">
              {cart.reduce((s, l) => s + l.quantity, 0)}
            </span>
          )}
        </div>
        {cart.length > 0 && (
          <button onClick={clearCart} className="text-slate-500 hover:text-red-400 transition-colors p-1">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Customer */}
      <button
        onClick={onSelectCustomer}
        className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
      >
        <Users size={14} className="text-slate-400" />
        <span className={`text-sm flex-1 text-left truncate ${assignedCustomer ? "text-white font-medium" : "text-slate-400"}`}>
          {assignedCustomer ? assignedCustomer.name : "Assign customer"}
        </span>
        {assignedCustomer ? (
          <span className="text-xs text-amber-400 font-semibold flex items-center gap-1">
            {assignedCustomer.tags.includes("VIP") && <Star size={10} />} {assignedCustomer.loyaltyPoints ?? 0}pts
          </span>
        ) : (
          <ChevronRight size={14} className="text-slate-500" />
        )}
      </button>

      {/* Items */}
      <div className="flex-1 overflow-y-auto mt-3">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <ShoppingCart size={40} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm font-medium">No items added</p>
            <p className="text-slate-600 text-xs mt-1">Tap items to add to order</p>
          </div>
        ) : (
          <ul className="space-y-1 px-3">
            {cart.map((item) => (
              <li key={item.lineId} className={`rounded-xl p-3 border ${item.offer?.active ? "bg-amber-500/5 border-amber-500/30" : "bg-slate-800/60 border-slate-700/50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold leading-snug truncate">{item.name}</p>
                    {item.modifiers.map((m) => (
                      <p key={m.optionId} className="text-slate-400 text-xs mt-0.5">+ {m.optionLabel}</p>
                    ))}
                    {item.note && <p className="text-orange-400 text-xs italic mt-0.5">&ldquo;{item.note}&rdquo;</p>}
                    {/* Offer savings badge */}
                    {(() => {
                      const saving = cartLineSaving(item); return saving > 0 ? (
                        <p className="text-amber-400 text-[10px] font-semibold mt-0.5">
                          Save {fmt(saving, settings.currencySymbol)} offer applied
                        </p>
                      ) : null;
                    })()}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {(() => {
                      const total = cartLineTotal(item);
                      const full = item.price * item.quantity;
                      return total < full ? (
                        <>
                          <p className="text-amber-400 font-bold text-sm">{fmt(total, settings.currencySymbol)}</p>
                          <p className="text-slate-500 text-xs line-through">{fmt(full, settings.currencySymbol)}</p>
                        </>
                      ) : (
                        <p className="text-white font-bold text-sm">{fmt(full, settings.currencySymbol)}</p>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-slate-500 text-xs">{fmt(item.price, settings.currencySymbol)} each</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateCartQty(item.lineId, item.quantity - 1)}
                      className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-red-500/30 text-slate-300 hover:text-red-400 flex items-center justify-center transition-all active:scale-95"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="text-white text-sm font-bold w-7 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateCartQty(item.lineId, item.quantity + 1)}
                      className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-orange-500/30 text-slate-300 hover:text-orange-400 flex items-center justify-center transition-all active:scale-95"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Totals + Actions */}
      {cart.length > 0 && (
        <div className="border-t border-slate-700/50 p-4 space-y-3">
          {/* Action row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 gap-2">
            <button
              onClick={onOpenDiscount}
              disabled={!currentStaff?.permissions.canApplyDiscount}
              title={!currentStaff?.permissions.canApplyDiscount ? "Manager or Admin required" : undefined}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${!currentStaff?.permissions.canApplyDiscount
                  ? "bg-slate-800/40 text-slate-600 border border-slate-700/40 cursor-not-allowed"
                  : discount.pct > 0
                    ? "bg-green-500/20 text-green-400 border border-green-500/40"
                    : "bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600"
                }`}
            >
              <Percent size={12} className="flex-shrink-0" />
              {discount.pct > 0 ? `Discount ${discount.pct}% ` : "Discount"}
            </button>
            <button
              onClick={onOpenTip}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${tipAmount > 0
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                  : "bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600"
                }`}
            >
              <BadgeDollarSign size={12} className="flex-shrink-0" />
              {tipAmount > 0 ? `Tip ${fmt(tipAmount, settings.currencySymbol)}` : "Tip"}
            </button>
            <div className="grid col-span-2 sm:col-span-1 md:col-span-2 ">
              <button
                onClick={onOpenServiceFee}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${serviceFeeAmount > 0
                    ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                    : "bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600"
                  }`}
              >
                <DollarSign size={12} className="flex-shrink-0" />
                {serviceFeeAmount > 0 ? `Service Fee ${fmt(serviceFeeAmount, settings.currencySymbol)}` : "Service Fee"}
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm text-slate-400">
              <span>Subtotal</span><span>{fmt(subtotal, settings.currencySymbol)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-green-400">
                <span>Discount ({discount.pct}%)</span><span>-{fmt(discountAmount, settings.currencySymbol)}</span>
              </div>
            )}
            {settings.taxInclusive && taxAmount > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>VAT ({settings.taxRate}% incl.)</span><span>{fmt(taxAmount, settings.currencySymbol)}</span>
              </div>
            )}
            {!settings.taxInclusive && taxAmount > 0 && (
              <div className="flex justify-between text-sm text-slate-400">
                <span>VAT ({settings.taxRate}%)</span><span>+{fmt(taxAmount, settings.currencySymbol)}</span>
              </div>
            )}
            {tipAmount > 0 && (
              <div className="flex justify-between text-sm text-amber-400">
                <span>Tip</span><span>{fmt(tipAmount, settings.currencySymbol)}</span>
              </div>
            )}
            {serviceFeeAmount > 0 && (
              <div className="flex justify-between text-sm text-blue-400">
                <span>Service Fee</span><span>{fmt(serviceFeeAmount, settings.currencySymbol)}</span>
              </div>
            )}
            <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-slate-700">
              <span>Total</span><span>{fmt(grandTotal, settings.currencySymbol)}</span>
            </div>
          </div>

          {/* Kitchen note — one note for the whole order; lands in the KDS
              ticket header alongside [POS] / Customer / Staff / Receipt. */}
          <input
            type="text"
            value={kitchenNote}
            onChange={(e) => setKitchenNote(e.target.value)}
            placeholder="Note to kitchen (optional)…"
            maxLength={300}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-orange-500"
          />

          {/* Charge button */}
          <button
            onClick={onCharge}
            className="w-full py-4 rounded-xl bg-orange-500 hover:bg-orange-400 active:scale-[0.98] text-white font-bold text-base transition-all flex items-center justify-between px-4 shadow-lg shadow-orange-500/30"
          >
            <span className="flex items-center gap-2"><CreditCard size={18} /> Charge</span>
            <span>{fmt(grandTotal, settings.currencySymbol)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
