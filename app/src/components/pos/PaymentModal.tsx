"use client";

import { useState } from "react";
import { X, Banknote, CreditCard, Shuffle, ChevronRight, AlertTriangle } from "lucide-react";
import { fmt } from "./_utils";

export default function PaymentModal({
  total,
  onClose,
  onComplete,
  currencySymbol,
  isOffline = false,
}: {
  total: number;
  onClose: () => void;
  onComplete: (method: "cash" | "card" | "split", payments: {method:"cash"|"card";amount:number}[], cashTendered?: number) => void;
  currencySymbol: string;
  isOffline?: boolean;
}) {
  type Step = "method" | "cash" | "card" | "split" | "done";
  const [step, setStep] = useState<Step>("method");
  const [cashInput, setCashInput] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState(total.toFixed(2));

  const QUICK_CASH = [Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20].filter((v, i, a) => a.indexOf(v) === i);

  const cashTendered = parseFloat(cashInput) || 0;
  const change = Math.max(0, cashTendered - total);

  function completeCash() {
    onComplete("cash", [{ method: "cash", amount: total }], cashTendered);
  }

  function completeCard() {
    onComplete("card", [{ method: "card", amount: total }]);
  }

  function completeSplit() {
    const cash = parseFloat(splitCash) || 0;
    const card = parseFloat(splitCard) || 0;
    onComplete("split", [{ method: "cash", amount: cash }, { method: "card", amount: card }], cash);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-xs">Amount due</p>
            <p className="text-white font-bold text-2xl">{fmt(total, currencySymbol)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition-colors">
            <X size={20} />
          </button>
        </div>

        {step === "method" && (
          <div className="p-5 space-y-3">
            <p className="text-slate-400 text-sm mb-4">Choose payment method</p>
            {isOffline && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 mb-1">
                <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                <p className="text-amber-300 text-xs">Offline — card payments unavailable</p>
              </div>
            )}
            <button
              onClick={() => setStep("cash")}
              className="w-full flex items-center gap-4 p-4 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-green-500/50 rounded-xl transition-all group"
            >
              <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center group-hover:bg-green-500/30 transition-colors">
                <Banknote size={20} className="text-green-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Cash</p>
                <p className="text-slate-400 text-xs">Calculate change</p>
              </div>
              <ChevronRight size={16} className="text-slate-500 ml-auto" />
            </button>
            <button
              disabled={isOffline}
              onClick={() => !isOffline && setStep("card")}
              className={`w-full flex items-center gap-4 p-4 border rounded-xl transition-all group ${
                isOffline
                  ? "bg-slate-800/40 border-slate-700 opacity-50 cursor-not-allowed"
                  : "bg-slate-700/60 hover:bg-slate-700 border-slate-600 hover:border-blue-500/50"
              }`}
            >
              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                <CreditCard size={20} className="text-blue-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Card</p>
                <p className="text-slate-400 text-xs">{isOffline ? "Requires internet" : "Tap, chip or swipe"}</p>
              </div>
              <ChevronRight size={16} className="text-slate-500 ml-auto" />
            </button>
            <button
              disabled={isOffline}
              onClick={() => !isOffline && setStep("split")}
              className={`w-full flex items-center gap-4 p-4 border rounded-xl transition-all group ${
                isOffline
                  ? "bg-slate-800/40 border-slate-700 opacity-50 cursor-not-allowed"
                  : "bg-slate-700/60 hover:bg-slate-700 border-slate-600 hover:border-purple-500/50"
              }`}
            >
              <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                <Shuffle size={20} className="text-purple-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Split</p>
                <p className="text-slate-400 text-xs">{isOffline ? "Requires internet" : "Cash + card"}</p>
              </div>
              <ChevronRight size={16} className="text-slate-500 ml-auto" />
            </button>
          </div>
        )}

        {step === "cash" && (
          <div className="p-5">
            <button onClick={() => setStep("method")} className="text-slate-400 hover:text-white text-sm mb-5 flex items-center gap-1">← Back</button>
            <p className="text-slate-400 text-xs mb-2">Cash tendered</p>
            <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 mb-4 flex items-center gap-2">
              <span className="text-slate-500 text-xl font-bold">{currencySymbol}</span>
              <input
                type="number"
                step="0.01"
                min={total}
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder={total.toFixed(2)}
                autoFocus
                className="flex-1 bg-transparent text-white text-2xl font-bold outline-none placeholder-slate-600"
              />
            </div>
            <div className="flex gap-2 mb-5">
              {QUICK_CASH.map((v) => (
                <button key={v} onClick={() => setCashInput(v.toFixed(2))}
                  className="flex-1 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors">
                  {fmt(v, currencySymbol)}
                </button>
              ))}
              <button onClick={() => setCashInput(total.toFixed(2))}
                className="flex-1 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors">
                Exact
              </button>
            </div>
            {cashTendered >= total && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
                <span className="text-green-400 font-semibold text-sm">Change</span>
                <span className="text-green-400 font-bold text-xl">{fmt(change, currencySymbol)}</span>
              </div>
            )}
            <button
              disabled={cashTendered < total}
              onClick={completeCash}
              className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${cashTendered >= total ? "bg-green-500 hover:bg-green-400 text-white active:scale-[0.98]" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}
            >
              {cashTendered >= total ? `Confirm Cash · Change ${fmt(change, currencySymbol)}` : "Enter amount"}
            </button>
          </div>
        )}

        {step === "card" && (
          <div className="p-5">
            <button onClick={() => setStep("method")} className="text-slate-400 hover:text-white text-sm mb-5 flex items-center gap-1">← Back</button>
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CreditCard size={36} className="text-blue-400" />
              </div>
              <p className="text-white font-bold text-lg mb-1">Present card to terminal</p>
              <p className="text-slate-400 text-sm">Tap, insert or swipe to collect</p>
              <p className="text-2xl font-bold text-blue-400 mt-4">{fmt(total, currencySymbol)}</p>
            </div>
            <button
              onClick={completeCard}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-all active:scale-[0.98]"
            >
              Payment Received · {fmt(total, currencySymbol)}
            </button>
          </div>
        )}

        {step === "split" && (
          <div className="p-5">
            <button onClick={() => setStep("method")} className="text-slate-400 hover:text-white text-sm mb-5 flex items-center gap-1">← Back</button>
            <p className="text-slate-400 text-sm mb-4">Split {fmt(total, currencySymbol)} between cash and card</p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Cash amount</label>
                <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 flex items-center gap-2">
                  <Banknote size={16} className="text-green-400" />
                  <input type="number" step="0.01" min={0} max={total}
                    value={splitCash} onChange={(e) => { setSplitCash(e.target.value); setSplitCard((total - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                    placeholder="0.00" className="flex-1 bg-transparent text-white font-bold text-lg outline-none placeholder-slate-600" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Card amount</label>
                <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 flex items-center gap-2">
                  <CreditCard size={16} className="text-blue-400" />
                  <input type="number" step="0.01" min={0} max={total}
                    value={splitCard} onChange={(e) => { setSplitCard(e.target.value); setSplitCash((total - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                    placeholder="0.00" className="flex-1 bg-transparent text-white font-bold text-lg outline-none placeholder-slate-600" />
                </div>
              </div>
            </div>
            {Math.abs((parseFloat(splitCash) || 0) + (parseFloat(splitCard) || 0) - total) < 0.01 && (
              <button onClick={completeSplit} className="w-full py-3.5 rounded-xl font-bold text-sm bg-purple-500 hover:bg-purple-400 text-white transition-all active:scale-[0.98]">
                Confirm Split Payment
              </button>
            )}
            {Math.abs((parseFloat(splitCash) || 0) + (parseFloat(splitCard) || 0) - total) >= 0.01 && (
              <p className="text-center text-amber-400 text-xs">
                Total must equal {fmt(total, currencySymbol)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
