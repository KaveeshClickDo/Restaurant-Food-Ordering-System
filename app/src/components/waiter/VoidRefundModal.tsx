"use client";

/**
 * Void (cancel all orders) / Refund flow for a settled or active table.
 * Senior-staff only — the server enforces the role gate too; the non-senior
 * branch here is just the friendly door.
 */

import { useState, useRef } from "react";
import { useApp } from "@/context/AppContext";
import {
  ShieldAlert, AlertTriangle, RotateCcw, X, Banknote, CreditCard, Loader2,
} from "lucide-react";
import { fmtCur } from "./_utils";

export default function VoidRefundModal({
  mode, orderIds, total, tableLabel, waiterName, isSenior, onSuccess, onClose,
}: {
  mode: "void" | "refund";
  orderIds: string[];
  total: number;
  tableLabel: string;
  waiterName: string;
  isSenior: boolean;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const [reason, setReason] = useState("");
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [refundAmountStr, setRefundAmountStr] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card">("cash");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  if (!isSenior) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center space-y-4">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert size={28} className="text-red-400" />
          </div>
          <h3 className="text-white font-bold text-lg">Access Denied</h3>
          <p className="text-slate-400 text-sm">Only senior staff can process voids and refunds.</p>
          <button onClick={onClose} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-semibold transition">
            Close
          </button>
        </div>
      </div>
    );
  }

  async function handleVoid() {
    if (inFlight.current) return;
    if (!reason.trim()) { setError("Please enter a reason."); return; }
    inFlight.current = true;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/waiter/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, reason: reason.trim(), voidedBy: waiterName }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (d.ok) onSuccess();
      else setError(d.error ?? "Failed to void orders.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function handleRefund() {
    if (inFlight.current) return;
    if (!reason.trim()) { setError("Please enter a reason."); return; }
    const amount = refundType === "full" ? total : parseFloat(refundAmountStr);
    if (isNaN(amount) || amount <= 0) { setError("Enter a valid refund amount."); return; }
    if (amount > total + 0.001) { setError(`Refund cannot exceed ${fmtCur(total, sym)}.`); return; }
    inFlight.current = true;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/waiter/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, refundAmount: amount, refundMethod, reason: reason.trim(), refundedBy: waiterName }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (d.ok) onSuccess();
      else setError(d.error ?? "Failed to process refund.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  const isVoid = mode === "void";
  const Icon = isVoid ? AlertTriangle : RotateCcw;
  const actionCls = isVoid
    ? "bg-red-600 hover:bg-red-500"
    : "bg-amber-600 hover:bg-amber-500";

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isVoid ? "bg-red-500/20" : "bg-amber-500/20"}`}>
              <Icon size={18} className={isVoid ? "text-red-400" : "text-amber-400"} />
            </div>
            <div>
              <h3 className="text-white font-bold">{isVoid ? "Void Table" : "Process Refund"}</h3>
              <p className="text-slate-400 text-xs">Table {tableLabel} · {fmtCur(total, sym)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Refund-specific options */}
          {!isVoid && (
            <>
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Refund Amount</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {(["full", "partial"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setRefundType(t)}
                      className={`py-2.5 rounded-xl text-sm font-semibold transition border ${refundType === t
                        ? "bg-amber-500/20 border-amber-500 text-amber-300"
                        : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500"
                        }`}
                    >
                      {t === "full" ? `Full ${fmtCur(total, sym)}` : "Partial"}
                    </button>
                  ))}
                </div>
                {refundType === "partial" && (
                  <input
                    type="number"
                    min="0.01"
                    max={total}
                    step="0.01"
                    value={refundAmountStr}
                    onChange={(e) => setRefundAmountStr(e.target.value)}
                    placeholder={`Max ${fmtCur(total, sym)}`}
                    className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                )}
              </div>

              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Return Method</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: "cash", label: "Cash", Ico: Banknote },
                    { v: "card", label: "Card", Ico: CreditCard },
                  ] as const).map(({ v, label, Ico }) => (
                    <button
                      key={v}
                      onClick={() => setRefundMethod(v)}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition border ${refundMethod === v
                        ? "bg-amber-500/20 border-amber-500 text-amber-300"
                        : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500"
                        }`}
                    >
                      <Ico size={15} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Reason */}
          <div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">
              {isVoid ? "Void Reason" : "Refund Reason"}
            </p>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(null); }}
              placeholder={isVoid ? "e.g. Customer changed mind, duplicate order…" : "e.g. Incorrect item, quality issue…"}
              className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

          {/* Void warning */}
          {isVoid && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs">
                This will cancel all {orderIds.length} order{orderIds.length !== 1 ? "s" : ""} for Table {tableLabel}. This action cannot be undone.
              </p>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-semibold text-sm transition"
          >
            Cancel
          </button>
          <button
            onClick={isVoid ? handleVoid : handleRefund}
            disabled={loading || !reason.trim()}
            className={`flex-1 py-3 ${actionCls} disabled:opacity-50 text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2`}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
            {loading ? "Processing…" : isVoid ? "Void Table" : "Confirm Refund"}
          </button>
        </div>
      </div>
    </div>
  );
}
