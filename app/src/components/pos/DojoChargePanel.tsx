"use client";

/**
 * DojoChargePanel — the shared driven-terminal UI, reused by EVERY surface that
 * takes a card payment on a Dojo machine (POS sale, waiter settle, collection,
 * gift-card sale, reservation deposit). Mount it when the operator has chosen
 * "Card machine"; it auto-starts the terminal, runs the whole state machine
 * (present card → PIN → signature → settle) and calls back:
 *
 *   onApproved(result)    — captured/authorized; persist `result` on your record
 *   onManualFallback()    — (optional) operator records an Expired result manually
 *   onBack()              — operator went back to the tender choice
 *   onActiveChange(bool)  — (optional) true while a payment is live; hide or
 *                           disable your close/back controls meanwhile, because
 *                           closing the screen can't stop a card already in
 *
 * All Dojo logic lives in useDojoTerminal; this is purely presentation.
 *
 * Pass scope="waiter" when mounting inside the /waiter app so its calls stay on
 * /api/waiter/* (the surface boundary); the POS family uses the default "pos".
 */

import { useEffect, useRef } from "react";
import { CreditCard, Loader2, CheckCircle2, XCircle, RefreshCw, PenLine, AlertTriangle, Ban } from "lucide-react";
import { fmt } from "./_utils";
import { useDojoTerminal } from "./useDojoTerminal";
import type { DojoScope } from "@/lib/dojo/posApi";
import type { DojoSaleResult } from "@/lib/dojo/types";

/** Dojo's terminal prompts (TerminalSessionNotificationType), as staff should read them. */
const NOTIF_TEXT: Record<string, string> = {
  PresentCard: "Present card",
  PresentOnlyOneCard: "Present only one card",
  InsertCard: "Insert card",
  ReEnterCard: "Insert the card again",
  TapCard: "Tap card",
  EnterPin: "Enter PIN",
  PleaseWait: "Please wait…",
  RemoveCard: "Remove card",
  CardUnsupported: "Card not supported — ask for another card",
  CardError: "Card error — try the card again",
  Approved: "Approved",
  Declined: "Declined",
};

/** Error codes that mean Dojo (or our own switch) refused before any session
 *  began, so nothing can have been charged. Anything else, including a timeout
 *  or an unrecognised server error, may have reached the machine. "Busy" is
 *  left out too: what holds the machine may be an earlier try of this payment. */
const REFUSED_BEFORE_START = new Set(["auth", "terminal_unavailable", "rejected", "disabled"]);

export default function DojoChargePanel({
  amount,
  reference,
  description,
  currencySymbol,
  busy = false,
  scope = "pos",
  onApproved,
  onManualFallback,
  onBack,
  onActiveChange,
}: {
  amount: number;
  reference?: string;
  description?: string;
  currencySymbol: string;
  /** Disable + spin the "Record as paid" fallback while the parent settles. */
  busy?: boolean;
  /** Which surface's API routes to drive. "waiter" for the /waiter app. */
  scope?: DojoScope;
  onApproved: (result: DojoSaleResult) => void;
  onManualFallback?: () => void;
  onBack: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const dojo = useDojoTerminal(scope);
  const doneRef = useRef(false);
  const startedRef = useRef(false);

  const active = dojo.phase === "starting" || dojo.phase === "processing" || dojo.phase === "signature";

  /** Start, or retry: the hook reuses the payment intent of the earlier attempt. */
  function begin() {
    doneRef.current = false;
    void dojo.start({ amount, reference, description: description ?? (reference ? `Card sale ${reference}` : "Card sale") });
  }

  function back() {
    dojo.reset();
    onBack();
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

  // Tell the parent while a payment is live, and release it on unmount.
  useEffect(() => {
    onActiveChange?.(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onActiveChange?.(false), []);

  const tip = dojo.result?.tipAmount ?? 0;

  return (
    <div className="p-5">
      {dojo.test && (
        <p className="mb-3 mx-auto w-fit rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-300">
          Test mode — no real money moves
        </p>
      )}

      {(dojo.phase === "starting" || dojo.phase === "processing") && (
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CreditCard size={36} className="text-blue-400" />
          </div>
          <p className="text-white font-bold text-lg mb-1">
            {dojo.cancelState === "cancelling"
              ? "Cancelling…"
              : dojo.notification ? (NOTIF_TEXT[dojo.notification] ?? dojo.notification) : "Sending to card machine…"}
          </p>
          <p className="text-slate-400 text-sm">Follow the prompts on the terminal</p>
          <p className="text-lg sm:text-xl font-bold text-blue-400 mt-4 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> {fmt(amount, currencySymbol)}
          </p>
          {dojo.notice && <p className="text-amber-400 text-sm mt-4">{dojo.notice}</p>}
          {dojo.cancelState !== "too_late" && (
            <button
              onClick={() => void dojo.cancel()}
              disabled={dojo.cancelState === "cancelling"}
              className="mt-6 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {dojo.cancelState === "cancelling" ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </div>
      )}

      {dojo.phase === "signature" && (
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <PenLine size={36} className="text-amber-400" />
          </div>
          <p className="text-white font-bold text-lg mb-1">Signature verification</p>
          <p className="text-slate-400 text-sm mb-1">Check the signature matches the card, then accept or reject.</p>
          <p className="text-slate-500 text-xs mb-5">With no answer in 80 seconds, the card machine accepts it.</p>
          {dojo.notice && <p className="text-amber-400 text-sm mb-4">{dojo.notice}</p>}
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
          {tip > 0 && (
            <p className="text-green-300 text-sm mb-1">Includes a {fmt(tip, currencySymbol)} tip added on the card machine</p>
          )}
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
            <button onClick={back}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Back</button>
            <button onClick={begin}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        </div>
      )}

      {dojo.phase === "canceled" && (
        <div className="text-center py-6">
          <Ban size={44} className="text-slate-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Payment cancelled</p>
          <p className="text-slate-400 text-sm mb-5">Nothing was charged.</p>
          <div className="flex gap-3">
            <button onClick={back}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Back</button>
            <button onClick={begin}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        </div>
      )}

      {/* Could not start. No "Record as paid": money may not have been taken.
          "Nothing was charged" only when Dojo refused before anything began. */}
      {dojo.phase === "error" && (
        <div className="text-center py-6">
          <AlertTriangle size={44} className="text-amber-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Couldn&apos;t start the card payment</p>
          <p className="text-slate-400 text-sm mb-1">{dojo.error ?? "Something went wrong talking to the card machine."}</p>
          <p className="text-slate-500 text-xs mb-5">
            {dojo.errorCode && REFUSED_BEFORE_START.has(dojo.errorCode)
              ? "Nothing was charged."
              : "Check the card machine screen before trying again."}
          </p>
          <div className="flex gap-3">
            <button onClick={back}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Back</button>
            <button onClick={begin}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        </div>
      )}

      {dojo.phase === "expired" && (
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
              <button onClick={back}
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
