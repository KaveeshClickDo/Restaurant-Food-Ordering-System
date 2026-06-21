"use client";

import { useRef, useState } from "react";
import { apiBase } from "@/lib/apiBase";
import { usePOS } from "@/context/POSContext";
import { X, AlertTriangle, RotateCcw, Banknote, CreditCard, Loader2 } from "lucide-react";
import { fmt } from "../_utils";
import type { DineInOrder } from "../_receipts";

export type DineInAction = { mode: "void" | "refund"; order: DineInOrder };

export default function DineInActionModal({
  action,
  onClose,
  onComplete,
}: {
  action: DineInAction;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { settings } = usePOS();
  const sym = settings.currencySymbol;
  // A gift card is prepaid money, so only the cash/card portion is refundable —
  // and `total` is stored net of the gift card. Cap "full" and the partial input
  // at money collected, net of anything already refunded (server enforces it too).
  const refundable = Math.max(
    0,
    action.order.total - (action.order.refundedAmount ?? 0),
  );

  const [reason,       setReason]       = useState("");
  const [refundType,   setRefundType]   = useState<"full" | "partial">("full");
  const [refundAmtStr, setRefundAmtStr] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card">("cash");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submitVoid() {
    if (inFlight.current) return;
    if (!reason.trim()) { setError("Please enter a reason."); return; }
    inFlight.current = true;
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiBase() + "/api/pos/orders/dine-in/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [action.order.id], reason: reason.trim() }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (d.ok) { onComplete(); onClose(); }
      else setError(d.error ?? "Failed to void order.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function submitRefund() {
    if (inFlight.current) return;
    if (!reason.trim()) { setError("Please enter a reason."); return; }
    const amt = refundType === "full" ? refundable : parseFloat(refundAmtStr);
    if (isNaN(amt) || amt <= 0) { setError("Enter a valid refund amount."); return; }
    if (amt > refundable + 0.001) { setError(`Cannot exceed ${fmt(refundable, sym)}.`); return; }
    inFlight.current = true;
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiBase() + "/api/pos/orders/dine-in/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [action.order.id], refundAmount: amt, refundMethod, reason: reason.trim() }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (d.ok) { onComplete(); onClose(); }
      else setError(d.error ?? "Failed to process refund.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${action.mode === "void" ? "bg-red-500/20" : "bg-amber-500/20"}`}>
              {action.mode === "void"
                ? <AlertTriangle size={17} className="text-red-400" />
                : <RotateCcw size={17} className="text-amber-400" />}
            </div>
            <div>
              <h3 className="text-white font-bold">{action.mode === "void" ? "Void Order" : "Refund Order"}</h3>
              <p className="text-slate-400 text-xs">Table {action.order.tableLabel} · {sym}{action.order.total.toFixed(2)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Refund options */}
          {action.mode === "refund" && (
            <>
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Refund Amount</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {(["full", "partial"] as const).map(t => (
                    <button key={t} onClick={() => setRefundType(t)}
                      className={`px-2 py-2 rounded-xl text-sm font-semibold border transition ${refundType === t ? "bg-amber-500/20 border-amber-500 text-amber-300" : "bg-slate-700 border-slate-600 text-slate-300"}`}>
                      {t === "full" ? `Full ${sym}${refundable.toFixed(2)}` : "Partial"}
                    </button>
                  ))}
                </div>
                {refundType === "partial" && (
                  <input type="number" min="0.01" max={refundable} step="0.01"
                    value={refundAmtStr} onChange={e => setRefundAmtStr(e.target.value)}
                    placeholder={`Max ${sym}${refundable.toFixed(2)}`}
                    className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500" />
                )}
                {/* {(action.order.giftCardUsed ?? 0) > 0 && (
                  <p className="text-[11px] text-slate-400 mt-2">
                    {sym}{(action.order.giftCardUsed ?? 0).toFixed(2)} of this bill was paid by gift card and is non-refundable.
                  </p>
                )} */}
              </div>
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Return Method</p>
                <div className="grid grid-cols-2 gap-2">
                  {([{ v: "cash", label: "Cash", Ico: Banknote }, { v: "card", label: "Card", Ico: CreditCard }] as const).map(({ v, label, Ico }) => (
                    <button key={v} onClick={() => setRefundMethod(v)}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition ${refundMethod === v ? "bg-amber-500/20 border-amber-500 text-amber-300" : "bg-slate-700 border-slate-600 text-slate-300"}`}>
                      <Ico size={14} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Reason */}
          <div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">
              {action.mode === "void" ? "Void Reason" : "Refund Reason"}
            </p>
            <textarea rows={2} value={reason}
              onChange={e => { setReason(e.target.value); setError(null); }}
              placeholder={action.mode === "void" ? "e.g. Customer cancelled, duplicate order…" : "e.g. Incorrect item, quality issue…"}
              className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500 resize-none" />
          </div>

          {/* Void warning */}
          {action.mode === "void" && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs">This will cancel the order for Table {action.order.tableLabel}. This cannot be undone.</p>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-semibold text-sm transition">
            Cancel
          </button>
          <button
            onClick={action.mode === "void" ? submitVoid : submitRefund}
            disabled={loading || !reason.trim()}
            className={`flex-1 px-2 py-3 disabled:opacity-50 text-white rounded-xl flex-shrink-0 font-bold text-sm transition flex items-center justify-center gap-2 ${action.mode === "void" ? "bg-red-600 hover:bg-red-500" : "bg-amber-600 hover:bg-amber-500"}`}>
            {loading
              ? <><Loader2 size={15} className="animate-spin flex-shrink-0" /> Processing…</>
              : action.mode === "void"
                ? <><AlertTriangle size={15} /> Void Order</>
                : <><RotateCcw size={15} /> Confirm Refund</>}
          </button>
        </div>
      </div>
    </div>
  );
}
