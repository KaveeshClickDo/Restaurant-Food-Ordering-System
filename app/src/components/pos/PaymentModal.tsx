"use client";

import { useRef, useState } from "react";
import { X, Banknote, CreditCard, Shuffle, ChevronRight, AlertTriangle, Gift, Loader2 } from "lucide-react";
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
  onComplete: (
    method: "cash" | "card" | "split" | "gift_card",
    payments: { method: "cash" | "card"; amount: number }[],
    cashTendered?: number,
    giftCard?: { code: string; amount: number },
  ) => void;
  currencySymbol: string;
  isOffline?: boolean;
}) {
  type Step = "method" | "cash" | "card" | "split" | "done";
  const [step, setStep] = useState<Step>("method");

  // ── Gift card tender ────────────────────────────────────────────────────────
  // A gift card is applied first (it's a payment instrument, not a discount),
  // reducing the amount due. The cash/card/split steps then settle the
  // remainder. If the card covers everything, a "Complete" button finishes the
  // sale with method "gift_card" and no cash/card payment.
  const [gcInput, setGcInput] = useState("");
  const [gcError, setGcError] = useState("");
  const [gcLookingUp, setGcLookingUp] = useState(false);
  const [appliedGc, setAppliedGc] = useState<{ code: string; balance: number } | null>(null);

  const giftCardApplied = appliedGc ? Math.round(Math.min(appliedGc.balance, total) * 100) / 100 : 0;
  const due = Math.max(0, Math.round((total - giftCardApplied) * 100) / 100);
  const giftCardArg = appliedGc && giftCardApplied > 0 ? { code: appliedGc.code, amount: giftCardApplied } : undefined;

  const [cashInput, setCashInput] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState(due.toFixed(2));

  const QUICK_CASH = [Math.ceil(due / 5) * 5, Math.ceil(due / 10) * 10, Math.ceil(due / 20) * 20].filter((v, i, a) => a.indexOf(v) === i && v > 0);

  const cashTendered = parseFloat(cashInput) || 0;
  const change = Math.max(0, cashTendered - due);

  async function applyGiftCard() {
    const code = gcInput.trim();
    if (!code) return;
    setGcError("");
    setGcLookingUp(true);
    try {
      const res = await fetch("/api/gift-cards/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; card?: { code: string; balance: number } };
      if (!res.ok || !json.ok || !json.card) { setGcError(json.error ?? "Could not apply that gift card."); return; }
      setAppliedGc({ code: json.card.code, balance: json.card.balance });
      setGcInput("");
    } catch {
      setGcError("Connection error.");
    } finally {
      setGcLookingUp(false);
    }
  }

  // Once any complete button is clicked, lock all of them until the modal
  // unmounts. The parent handles the actual sale POST asynchronously; without
  // this guard a quick double-tap on the same button (or a different tender
  // method) would dispatch two sales (Bug #24). Use a ref alongside the state
  // so the guard reads synchronously — between two rapid click events React
  // is not guaranteed to have flushed the state update yet.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  function lock(): boolean {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setSubmitting(true);
    return true;
  }
  function completeCash() {
    if (!lock()) return;
    onComplete("cash", [{ method: "cash", amount: due }], cashTendered, giftCardArg);
  }
  function completeCard() {
    if (!lock()) return;
    onComplete("card", [{ method: "card", amount: due }], undefined, giftCardArg);
  }
  function completeSplit() {
    if (!lock()) return;
    const cash = parseFloat(splitCash) || 0;
    const card = parseFloat(splitCard) || 0;
    onComplete("split", [{ method: "cash", amount: cash }, { method: "card", amount: card }], cash, giftCardArg);
  }
  function completeGiftCardOnly() {
    if (!lock()) return;
    onComplete("gift_card", [], undefined, giftCardArg);
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-xs">{giftCardApplied > 0 ? "Amount due after gift card" : "Amount due"}</p>
            <p className="text-white font-bold text-2xl">{fmt(due, currencySymbol)}</p>
            {giftCardApplied > 0 && (
              <p className="text-purple-300 text-xs mt-0.5">Gift card −{fmt(giftCardApplied, currencySymbol)} of {fmt(total, currencySymbol)}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition-colors">
            <X size={20} />
          </button>
        </div>

        {step === "method" && (
          <div className="p-5 space-y-3">
            {isOffline && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 mb-1">
                <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                <p className="text-amber-300 text-xs">Offline — confirm card on terminal before tapping Payment Received. Gift cards unavailable.</p>
              </div>
            )}

            {/* Gift card tender */}
            {appliedGc ? (
              <div className="flex items-center justify-between gap-2 bg-purple-500/10 border border-purple-500/40 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Gift size={15} className="text-purple-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-purple-200 text-xs font-bold font-mono tracking-wider truncate">{appliedGc.code}</p>
                    <p className="text-purple-400 text-[11px]">−{fmt(giftCardApplied, currencySymbol)} applied</p>
                  </div>
                </div>
                <button onClick={() => setAppliedGc(null)} className="text-slate-400 hover:text-white text-xs flex-shrink-0">Remove</button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <input
                    value={gcInput}
                    onChange={(e) => { setGcInput(e.target.value.toUpperCase()); setGcError(""); }}
                    onKeyDown={(e) => !isOffline && e.key === "Enter" && applyGiftCard()}
                    disabled={isOffline}
                    placeholder={isOffline ? "Gift cards unavailable offline" : "Gift card code"}
                    className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-sm font-mono tracking-wider outline-none focus:border-purple-500 placeholder-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={applyGiftCard}
                    disabled={isOffline || !gcInput.trim() || gcLookingUp}
                    className="flex items-center gap-1.5 bg-purple-500/80 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold px-3 rounded-xl transition-colors"
                  >
                    {gcLookingUp ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
                  </button>
                </div>
                {gcError && <p className="text-red-400 text-xs px-1">{gcError}</p>}
              </div>
            )}

            {/* When the gift card covers everything, offer direct completion. */}
            {due <= 0 && appliedGc ? (
              <button
                onClick={completeGiftCardOnly}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 p-4 bg-purple-500 hover:bg-purple-400 disabled:bg-purple-500/50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all active:scale-[0.98]"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <Gift size={18} />}
                {submitting ? "Processing…" : "Complete · paid by gift card"}
              </button>
            ) : (
              <>
                <p className="text-slate-400 text-sm pt-1">Pay {fmt(due, currencySymbol)} by</p>
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
                {/* Card payment is recorded only — your standalone card terminal
                    handles authorisation independently, so this works offline
                    too. The cashier MUST confirm the terminal beeped approved
                    before tapping "Payment Received" on the next screen. */}
                <button
                  onClick={() => setStep("card")}
                  className="w-full flex items-center gap-4 p-4 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-blue-500/50 rounded-xl transition-all group"
                >
                  <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                    <CreditCard size={20} className="text-blue-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-semibold text-sm">Card</p>
                    <p className="text-slate-400 text-xs">Tap, chip or swipe</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-500 ml-auto" />
                </button>
                <button
                  onClick={() => setStep("split")}
                  className="w-full flex items-center gap-4 p-4 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-purple-500/50 rounded-xl transition-all group"
                >
                  <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                    <Shuffle size={20} className="text-purple-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-semibold text-sm">Split</p>
                    <p className="text-slate-400 text-xs">Cash + card</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-500 ml-auto" />
                </button>
              </>
            )}
          </div>
        )}

        {step === "cash" && (
          <div className="p-5">
            <button onClick={() => setStep("method")} className="text-slate-400 hover:text-white text-sm mb-5 flex items-center gap-1">← Back</button>
            <p className="text-slate-400 text-xs mb-2">Cash tendered</p>
            <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 mb-4 flex items-center gap-2">
              <span className="text-slate-500 text-xl font-bold">{currencySymbol}</span>
              <input
                type="number" step="0.01" min={due}
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder={due.toFixed(2)}
                autoFocus
                className="flex-1 min-w-0 bg-transparent text-white text-lg sm:text-xl font-bold outline-none placeholder-slate-600"
              />
            </div>
            <div className="flex flex-wrap gap-2 mb-5">
              {QUICK_CASH.map((v) => (
                <button key={v} onClick={() => setCashInput(v.toFixed(2))}
                  className="flex-1 min-w-[110px] max-w-full px-2 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors">
                  {fmt(v, currencySymbol)}
                </button>
              ))}
              <button onClick={() => setCashInput(due.toFixed(2))}
                className="flex-1 min-w-[80px] max-w-full px-2 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors">
                Exact
              </button>
            </div>
            {cashTendered >= due && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
                <span className="text-green-400 font-semibold text-sm">Change</span>
                <span className="text-green-400 font-bold text-xl">{fmt(change, currencySymbol)}</span>
              </div>
            )}
            <button
              disabled={cashTendered < due || submitting}
              onClick={completeCash}
              className={`w-full py-3.5 px-2 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${cashTendered >= due && !submitting ? "bg-green-500 hover:bg-green-400 text-white active:scale-[0.98]" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? "Processing…" : cashTendered >= due ? `Confirm Cash · Change ${fmt(change, currencySymbol)}` : "Enter amount"}
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
              <p className="text-lg sm:text-xl font-bold text-blue-400 mt-4">{fmt(due, currencySymbol)}</p>
            </div>
            <button
              onClick={completeCard}
              disabled={submitting}
              className="w-full px-2 py-3.5 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 disabled:cursor-not-allowed text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? "Processing…" : `Payment Received · ${fmt(due, currencySymbol)}`}
            </button>
          </div>
        )}

        {step === "split" && (
          <div className="p-5">
            <button onClick={() => setStep("method")} className="text-slate-400 hover:text-white text-sm mb-5 flex items-center gap-1">← Back</button>
            <p className="text-slate-400 text-sm mb-4">Split {fmt(due, currencySymbol)} between cash and card</p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Cash amount</label>
                <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 flex items-center gap-2">
                  <Banknote size={16} className="text-green-400" />
                  <input type="number" step="0.01" min={0} max={due}
                    value={splitCash} onChange={(e) => { setSplitCash(e.target.value); setSplitCard((due - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                    placeholder="0.00" className="flex-1 min-w-0 bg-transparent text-white font-bold text-lg outline-none placeholder-slate-600" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Card amount</label>
                <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 flex items-center gap-2">
                  <CreditCard size={16} className="text-blue-400" />
                  <input type="number" step="0.01" min={0} max={due}
                    value={splitCard} onChange={(e) => { setSplitCard(e.target.value); setSplitCash((due - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                    placeholder="0.00" className="flex-1 min-w-0 bg-transparent text-white font-bold text-lg outline-none placeholder-slate-600" />
                </div>
              </div>
            </div>
            {Math.abs((parseFloat(splitCash) || 0) + (parseFloat(splitCard) || 0) - due) < 0.01 ? (
              <button
                onClick={completeSplit}
                disabled={submitting}
                className="w-full px-2 py-3.5 rounded-xl font-bold text-sm bg-purple-500 hover:bg-purple-400 disabled:bg-purple-500/50 disabled:cursor-not-allowed text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? "Processing…" : "Confirm Split Payment"}
              </button>
            ) : (
              <p className="text-center text-amber-400 text-xs">
                Total must equal {fmt(due, currencySymbol)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
