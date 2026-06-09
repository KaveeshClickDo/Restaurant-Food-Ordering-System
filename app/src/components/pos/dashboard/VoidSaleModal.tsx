"use client";

import { useState } from "react";
import { usePOS } from "@/context/POSContext";
import { POSSale } from "@/types/pos";
import { X, Banknote, CreditCard } from "lucide-react";
import { fmt } from "../_utils";

export default function VoidSaleModal({ sale, onClose }: { sale: POSSale; onClose: () => void }) {
  const { settings, voidSale } = usePOS();
  // A gift card is prepaid money, so its portion is non-refundable. A refund can
  // only return what was actually paid by cash/card: moneyPaid = total − gift
  // card used. Default + cap the refund to that.
  const giftUsed  = sale.giftCardUsed ?? 0;
  const moneyPaid = Math.max(0, sale.total - giftUsed);
  const [voidReason, setVoidReason]   = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card" | "none">(sale.paymentMethod === "card" ? "card" : "cash");
  const [refundAmount, setRefundAmount] = useState(moneyPaid.toFixed(2));

  const [submitting, setSubmitting] = useState(false);

  async function confirmVoid() {
    if (!voidReason.trim() || submitting) return;
    // If there is no refund, force the amount to 0. 
    // Otherwise, parse the refund input state.
    const amt = refundMethod === "none" ? 0 : parseFloat(refundAmount);

    setSubmitting(true);
    const { ok, error } = await voidSale(sale.id, voidReason.trim(), refundMethod, isNaN(amt) ? 0 : amt);
    setSubmitting(false);
    if (!ok) {
      // Surface the server's actual reason (no permission, already voided,
      // refund > total, etc.) instead of a generic network message. Falls
      // back to the network copy when the request never reached the server.
      alert(error ?? "Couldn't void the sale on the server. Check your network and try again.");
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h3 className="text-white font-bold">Void &amp; Refund</h3>
            <p className="text-slate-400 text-xs mt-0.5">
              #{sale.receiptNo} · {fmt(sale.total, settings.currencySymbol)} · {sale.staffName}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Void reason */}
          <div>
            <label className="text-xs text-slate-400 font-medium mb-1.5 block">Void reason <span className="text-red-400">*</span></label>
            <input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Customer changed mind, wrong order…"
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-red-500 placeholder-slate-500"
            />
          </div>

          {/* Refund method */}
          <div>
            <label className="text-xs text-slate-400 font-medium mb-1.5 block">Refund method</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "cash",  label: "Cash",       icon: Banknote,   color: "border-green-500 bg-green-500/10 text-green-400" },
                { id: "card",  label: "Card",        icon: CreditCard, color: "border-blue-500  bg-blue-500/10  text-blue-400"  },
                { id: "none",  label: "No Refund",   icon: X,          color: "border-slate-500 bg-slate-700    text-slate-300" },
              ] as const).map(({ id, label, icon: Icon, color }) => (
                <button
                  key={id}
                  onClick={() => setRefundMethod(id)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all text-xs font-semibold ${
                    refundMethod === id ? color : "border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Refund amount */}
          {refundMethod !== "none" && (
            <div>
              <label className="text-xs text-slate-400 font-medium mb-1.5 block">Refund amount</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">
                  {settings.currencySymbol}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-8 pr-4 py-2.5 text-white text-sm outline-none focus:border-orange-500"
                />
              </div>
              {parseFloat(refundAmount) < moneyPaid && parseFloat(refundAmount) > 0 && (
                <p className="text-amber-400 text-xs mt-1">
                  Partial refund — {fmt(moneyPaid - parseFloat(refundAmount), settings.currencySymbol)} retained
                </p>
              )}
              {giftUsed > 0 && (
                <p className="text-purple-300 text-xs mt-1">
                  {fmt(giftUsed, settings.currencySymbol)} paid by gift card is non-refundable · max refund {fmt(moneyPaid, settings.currencySymbol)}
                </p>
              )}
            </div>
          )}

          {/* Refund summary banner */}
          {refundMethod !== "none" && parseFloat(refundAmount) > 0 && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
              refundMethod === "cash"
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : "bg-blue-500/10 border-blue-500/30 text-blue-400"
            }`}>
              {refundMethod === "cash" ? <Banknote size={16} /> : <CreditCard size={16} />}
              <span className="text-sm font-semibold">
                Return {fmt(parseFloat(refundAmount) || 0, settings.currencySymbol)} in {refundMethod === "cash" ? "cash to customer" : "card refund"}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          <button
            onClick={onClose}
            className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmVoid}
            disabled={!voidReason.trim() || submitting}
            className="py-3 rounded-xl bg-red-500 hover:bg-red-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? "Voiding…"
              : <>Void &amp; {refundMethod === "none" ? "No Refund" : `Refund ${fmt(parseFloat(refundAmount) || 0, settings.currencySymbol)}`}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
