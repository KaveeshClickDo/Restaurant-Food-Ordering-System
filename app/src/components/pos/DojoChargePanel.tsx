"use client";

/**
 * DojoChargePanel — the shared driven-terminal UI, reused by EVERY surface that
 * takes a card payment on a Dojo machine (POS sale, waiter settle, collection,
 * gift-card sale, reservation deposit). Mount it when the operator has chosen
 * "Card machine"; it auto-starts the terminal, runs the whole state machine
 * (present card → PIN → signature → settle) and calls back:
 *
 *   onApproved(result)   — captured/authorized; persist `result` on your record
 *   onManualFallback()   — (optional) operator records an Expired result manually
 *   onBack()             — operator cancelled / went back to the tender choice
 *
 * All Dojo logic lives in useDojoTerminal; this is purely presentation.
 */

import { useEffect, useRef } from "react";
import { CreditCard, Loader2, CheckCircle2, XCircle, RefreshCw, PenLine, AlertTriangle } from "lucide-react";
import { fmt } from "./_utils";
import { useDojoTerminal } from "./useDojoTerminal";
import type { DojoSaleResult } from "@/lib/dojo/types";

const NOTIF_TEXT: Record<string, string> = {
  PresentCard: "Present card",
  InsertCard: "Insert card",
  TapCard: "Tap card",
  EnterPin: "Enter PIN",
  PleaseWait: "Please wait…",
  RemoveCard: "Remove card",
};

export default function DojoChargePanel({
  amount,
  reference,
  description,
  currencySymbol,
  busy = false,
  onApproved,
  onManualFallback,
  onBack,
}: {
  amount: number;
  reference?: string;
  description?: string;
  currencySymbol: string;
  /** Disable + spin the "Record as paid" fallback while the parent settles. */
  busy?: boolean;
  onApproved: (result: DojoSaleResult) => void;
  onManualFallback?: () => void;
  onBack: () => void;
}) {
  const dojo = useDojoTerminal();
  const doneRef = useRef(false);
  const startedRef = useRef(false);

  function begin() {
    doneRef.current = false;
    void dojo.start({ amount, reference, description: description ?? (reference ? `Card sale ${reference}` : "Card sale") });
  }

  // Auto-start on mount.
  useEffect(() => {
    if (!startedRef.current) { startedRef.current = true; begin(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire onApproved exactly once on success.
  useEffect(() => {
    if (dojo.phase === "success" && dojo.result && !doneRef.current) {
      doneRef.current = true;
      onApproved(dojo.result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dojo.phase, dojo.result]);

  return (
    <div className="p-5">
      {(dojo.phase === "starting" || dojo.phase === "processing") && (
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CreditCard size={36} className="text-blue-400" />
          </div>
          <p className="text-white font-bold text-lg mb-1">
            {dojo.notification ? (NOTIF_TEXT[dojo.notification] ?? dojo.notification) : "Sending to card machine…"}
          </p>
          <p className="text-slate-400 text-sm">Follow the prompts on the terminal</p>
          <p className="text-lg sm:text-xl font-bold text-blue-400 mt-4 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> {fmt(amount, currencySymbol)}
          </p>
          <button
            onClick={() => { void dojo.cancel(); dojo.reset(); onBack(); }}
            className="mt-6 text-slate-400 hover:text-white text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {dojo.phase === "signature" && (
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <PenLine size={36} className="text-amber-400" />
          </div>
          <p className="text-white font-bold text-lg mb-1">Signature verification</p>
          <p className="text-slate-400 text-sm mb-5">Check the signature matches the card, then accept or reject.</p>
          <div className="flex gap-3">
            <button onClick={() => void dojo.submitSignature(false)}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-red-500/90 hover:bg-red-500 text-white transition-colors">Reject</button>
            <button onClick={() => void dojo.submitSignature(true)}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-green-500 hover:bg-green-400 text-white transition-colors">Accept</button>
          </div>
        </div>
      )}

      {dojo.phase === "success" && (
        <div className="text-center py-8">
          <CheckCircle2 size={48} className="text-green-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Approved</p>
          <p className="text-slate-400 text-sm flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Completing…
          </p>
        </div>
      )}

      {dojo.phase === "declined" && (
        <div className="text-center py-6">
          <XCircle size={44} className="text-red-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Card declined</p>
          <p className="text-slate-400 text-sm mb-5">{dojo.error ?? "The payment was not approved."}</p>
          <div className="flex gap-3">
            <button onClick={() => { dojo.reset(); onBack(); }}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Back</button>
            <button onClick={begin}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        </div>
      )}

      {(dojo.phase === "expired" || dojo.phase === "error") && (
        <div className="text-center py-6">
          <AlertTriangle size={44} className="text-amber-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Result unconfirmed</p>
          <p className="text-slate-400 text-sm mb-5">{dojo.error ?? "Check the card machine screen for the result."}</p>
          <div className="space-y-2">
            {onManualFallback && (
              <button onClick={onManualFallback} disabled={busy}
                className="w-full py-3 rounded-xl font-bold text-sm bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Record as paid by card
              </button>
            )}
            <div className="flex gap-3">
              <button onClick={() => { dojo.reset(); onBack(); }}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Back</button>
              <button onClick={begin}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
