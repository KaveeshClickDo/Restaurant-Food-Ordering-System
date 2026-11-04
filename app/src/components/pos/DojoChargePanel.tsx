"use client";

/**
 * DojoChargePanel — the shared driven-terminal UI, reused by EVERY surface that
 * takes a card payment on a Dojo machine (POS sale, waiter settle, collection,
 * gift-card sale, reservation deposit). Mount it when the operator has chosen
 * "Card machine"; it finds the machine, starts the payment, runs the whole
 * state machine (present card → PIN → signature → settle) and calls back:
 *
 *   onApproved(result)    — captured/authorized; persist `result` on your record.
 *                           Return false, or a message, when it couldn't be
 *                           saved: the panel keeps the approval and offers "Try
 *                           saving again", which calls onApproved again with the
 *                           same result. It never charges the card twice.
 *   onManualFallback()    — (optional) operator records an Expired result manually
 *   onBack()              — operator went back to the tender choice
 *   onActiveChange(bool)  — (optional) true while a payment is live or approved
 *                           but unsaved; hide or disable your close/back controls
 *                           meanwhile, because closing the screen can't stop a
 *                           card already in, or bring back an unsaved payment
 *
 * Which machine: each tablet remembers the one it uses, per surface. With one
 * machine online it's used straight away; with several and none remembered,
 * staff pick first. In test mode (simulator or sandbox key) the picker always
 * shows, because testers switch between the virtual terminals. Result screens
 * offer "Use another" when there's more than one.
 *
 * keyed: the guest isn't there (a phone booking), so staff type the card
 * details into the machine (MOTO). The machine skips "Present card"; only the
 * till's routes accept it.
 *
 * All Dojo logic lives in useDojoTerminal; this is presentation and the save.
 *
 * Pass scope="waiter" when mounting inside the /waiter app so its calls stay on
 * /api/waiter/* (the surface boundary); the POS family uses the default "pos".
 */

import { useEffect, useRef, useState } from "react";
import { CreditCard, Loader2, CheckCircle2, XCircle, RefreshCw, PenLine, AlertTriangle, Ban } from "lucide-react";
import { fmt } from "./_utils";
import { useDojoTerminal } from "./useDojoTerminal";
import { listDojoTerminals, type DojoMachine, type DojoScope } from "@/lib/dojo/posApi";
import type { DojoSaleResult } from "@/lib/dojo/types";

/** What onApproved returns: false, or a message saying why, when the sale
 *  wasn't saved. Anything else counts as saved. */
export type DojoSaveOutcome = void | boolean | string;

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

/** A machine's status as staff read it. */
const MACHINE_STATUS: Record<string, { text: string; className: string }> = {
  Available: { text: "Ready", className: "text-green-400" },
  InUse: { text: "Busy", className: "text-amber-400" },
  Offline: { text: "Offline", className: "text-slate-500" },
};

/** This tablet's card machine for a surface. Browser storage: a convenience
 *  only, so a tablet that forgets just asks again. */
const machineKey = (scope: DojoScope) => `directdine.dojoMachine.${scope}`;
function loadMachine(scope: DojoScope): string | null {
  try { return window.localStorage.getItem(machineKey(scope)); } catch { return null; }
}
function rememberMachine(scope: DojoScope, id: string): void {
  try { window.localStorage.setItem(machineKey(scope), id); } catch { /* not remembered */ }
}

type SaveState = "pending" | "saving" | "failed" | "saved";

export default function DojoChargePanel({
  amount,
  reference,
  description,
  currencySymbol,
  busy = false,
  scope = "pos",
  keyed = false,
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
  /** Card not present: staff key in the card details (MOTO). */
  keyed?: boolean;
  onApproved: (result: DojoSaleResult) => DojoSaveOutcome | Promise<DojoSaveOutcome>;
  onManualFallback?: () => void;
  onBack: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const dojo = useDojoTerminal(scope);
  const doneRef = useRef(false);
  const startedRef = useRef(false);
  const aliveRef = useRef(true);

  const [machines, setMachines] = useState<DojoMachine[] | null>(null);
  const [machineId, setMachineId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("pending");
  const [saveError, setSaveError] = useState<string | null>(null);

  const live = dojo.phase === "starting" || dojo.phase === "processing" || dojo.phase === "signature";
  // Approved but not saved yet: the screen must stay until it is (or staff leave).
  const holding = dojo.phase === "success" && saveState !== "saved";
  const active = live || holding;
  const machine = machines?.find((m) => m.id === machineId) ?? null;
  const severalMachines = (machines?.length ?? 0) > 1;

  /** Start, or retry: the hook reuses the payment intent of the earlier attempt,
   *  also on another machine. */
  function begin(terminalId: string | null = machineId) {
    doneRef.current = false;
    setSaveState("pending");
    setSaveError(null);
    setPicking(false);
    void dojo.start({
      amount,
      reference,
      description: description ?? (reference ? `Card sale ${reference}` : "Card sale"),
      ...(terminalId ? { terminalId } : {}),
      ...(keyed ? { cardHolderNotPresent: true } : {}),
    });
  }

  function back() {
    dojo.reset();
    onBack();
  }

  async function loadMachines(): Promise<{ list: DojoMachine[] | null; test: boolean }> {
    setLoadingMachines(true);
    try {
      const res = await listDojoTerminals(scope);
      if (aliveRef.current) {
        setMachines(res.terminals);
        setTestMode(res.test);
      }
      return { list: res.terminals, test: res.test };
    } catch {
      return { list: null, test: false };
    } finally {
      if (aliveRef.current) setLoadingMachines(false);
    }
  }

  function pickMachine(id: string) {
    rememberMachine(scope, id);
    setMachineId(id);
    begin(id);
  }

  /** From a result screen: choose another machine, with fresh statuses. */
  function changeMachine() {
    setPicking(true);
    void loadMachines();
  }

  /** On mount: find the machine, then start, or let staff pick. */
  async function init() {
    const saved = loadMachine(scope);
    const { list, test } = await loadMachines();
    if (!aliveRef.current) return;
    if (!list) { setMachineId(saved); begin(saved); return; } // can't list them: try as before
    const usable = list.filter((m) => m.status !== "Offline");
    const savedUsable = usable.find((m) => m.id === saved)?.id ?? null;
    if (test && list.length > 1) {
      setMachineId(savedUsable ?? usable[0]?.id ?? null);
      setPicking(true);
      return;
    }
    if (savedUsable) { setMachineId(savedUsable); begin(savedUsable); return; }
    if (usable.length === 1) { pickMachine(usable[0].id); return; }
    if (usable.length > 1) { setPicking(true); return; }
    begin(null); // none online: the server says so, in staff's words
  }

  useEffect(() => {
    aliveRef.current = true;
    if (!startedRef.current) { startedRef.current = true; void init(); }
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Hand the approved result to the surface to save; keep it if that fails. */
  async function save(result: DojoSaleResult) {
    setSaveState("saving");
    setSaveError(null);
    let outcome: DojoSaveOutcome;
    try {
      outcome = await onApproved(result);
    } catch (e) {
      outcome = e instanceof Error ? e.message : "Couldn't save the sale.";
    }
    if (!aliveRef.current) return;
    if (outcome === false || typeof outcome === "string") {
      setSaveState("failed");
      setSaveError(typeof outcome === "string" ? outcome : null);
    } else {
      setSaveState("saved");
    }
  }

  // Save exactly once per approval; retries go through the button.
  useEffect(() => {
    if (dojo.phase === "success" && dojo.result && !doneRef.current) {
      doneRef.current = true;
      void save(dojo.result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dojo.phase, dojo.result]);

  function leaveUnsaved() {
    const ref = reference ? ` (reference "${reference}")` : "";
    const ok = window.confirm(
      `The customer has paid ${fmt(amount, currencySymbol)} by card, but the sale isn't saved. `
      + `If you leave, the payment stays with Dojo${ref}: record the sale by hand or refund it in Dojo. Leave anyway?`,
    );
    if (!ok) return;
    setSaveState("saved"); // releases the parent's close controls
    back();
  }

  // Tell the parent while a payment is live or unsaved, and release it on unmount.
  useEffect(() => {
    onActiveChange?.(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onActiveChange?.(false), []);

  const tip = dojo.result?.tipAmount ?? 0;
  const machineName = machine?.tid ? `card machine ${machine.tid}` : "the terminal";
  // Keyed: a real machine goes straight to card number entry, which has no
  // prompt of its own, so the screen says it. (The sandbox's virtual machines
  // ignore the flag and still send "Present card".)
  const keyedPrompt = keyed && dojo.phase === "processing"
    && (!dojo.notification || dojo.notification === "PresentCard");

  /** "Use another machine" under a result screen. */
  const machineSwitch = severalMachines && (
    <button onClick={changeMachine}
      className="mt-4 text-slate-400 hover:text-white text-xs underline underline-offset-2">
      {machine?.tid ? `Card machine ${machine.tid} · Use another` : "Choose a card machine"}
    </button>
  );

  return (
    <div className="p-5">
      {(dojo.test || testMode) && (
        <p className="mb-3 mx-auto w-fit rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-300">
          Test mode — no real money moves
        </p>
      )}

      {picking && (
        <div className="py-2">
          <p className="text-white font-bold text-lg mb-1 text-center">Which card machine?</p>
          <p className="text-slate-400 text-sm mb-4 text-center">
            {fmt(amount, currencySymbol)} goes to the one you choose. This tablet remembers it.
          </p>
          {machines && machines.length > 0 ? (
            <div className="space-y-2 mb-5 max-h-64 overflow-y-auto">
              {machines.map((m) => {
                const status = MACHINE_STATUS[m.status] ?? { text: m.status, className: "text-slate-400" };
                const offline = m.status === "Offline";
                return (
                  <button key={m.id} disabled={offline} onClick={() => setMachineId(m.id)}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      machineId === m.id ? "border-blue-400 bg-blue-500/15" : "border-slate-600 bg-slate-900 hover:border-slate-400"}`}>
                    <span className="text-white font-semibold text-sm font-mono">{m.tid ?? m.id}</span>
                    <span className={`text-xs font-semibold ${status.className}`}>{status.text}</span>
                  </button>
                );
              })}
            </div>
          ) : loadingMachines ? (
            <p className="text-slate-400 text-sm mb-5 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Finding card machines…
            </p>
          ) : (
            <div className="text-center mb-5">
              <p className="text-amber-400 text-sm mb-2">Couldn&apos;t list the card machines. Check the connection.</p>
              <button onClick={() => void loadMachines()} className="text-slate-300 hover:text-white text-sm underline">Try again</button>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => (dojo.phase === "idle" ? back() : setPicking(false))}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Back</button>
            <button onClick={() => machineId && pickMachine(machineId)} disabled={!machineId || machine?.status === "Offline"}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/40 disabled:cursor-not-allowed text-white transition-colors">
              Send {fmt(amount, currencySymbol)}
            </button>
          </div>
        </div>
      )}

      {!picking && dojo.phase === "idle" && (
        <div className="text-center py-10">
          <p className="text-slate-400 text-sm flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Finding the card machine…
          </p>
        </div>
      )}

      {!picking && (dojo.phase === "starting" || dojo.phase === "processing") && (
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CreditCard size={36} className="text-blue-400" />
          </div>
          <p className="text-white font-bold text-lg mb-1">
            {dojo.cancelState === "cancelling"
              ? "Cancelling…"
              : keyedPrompt ? "Key in the card number"
              : dojo.notification ? (NOTIF_TEXT[dojo.notification] ?? dojo.notification) : "Sending to card machine…"}
          </p>
          <p className="text-slate-400 text-sm">
            {keyed
              ? `On ${machineName}, type in the card details the guest reads out`
              : `Follow the prompts on ${machineName}`}
          </p>
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

      {!picking && dojo.phase === "signature" && (
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

      {!picking && dojo.phase === "success" && (saveState === "failed" ? (
        <div className="text-center py-6">
          <AlertTriangle size={44} className="text-amber-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Paid, but not saved yet</p>
          <p className="text-slate-300 text-sm mb-2">
            The card payment of {fmt(amount, currencySymbol)} went through. Don&apos;t take it again.
          </p>
          {saveError && <p className="text-amber-400 text-sm mb-2">{saveError}</p>}
          <p className="text-slate-500 text-xs mb-5">Saving again won&apos;t charge the card a second time.</p>
          <button onClick={() => dojo.result && void save(dojo.result)}
            className="w-full py-3 rounded-xl font-bold text-sm bg-green-500 hover:bg-green-400 text-white transition-colors flex items-center justify-center gap-2">
            <RefreshCw size={14} /> Try saving again
          </button>
          <button onClick={leaveUnsaved} className="mt-4 text-slate-400 hover:text-white text-xs underline underline-offset-2">
            Leave without saving
          </button>
        </div>
      ) : (
        <div className="text-center py-8">
          <CheckCircle2 size={48} className="text-green-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Approved</p>
          {tip > 0 && (
            <p className="text-green-300 text-sm mb-1">Includes a {fmt(tip, currencySymbol)} tip added on the card machine</p>
          )}
          <p className="text-slate-400 text-sm flex items-center justify-center gap-2">
            {saveState === "saved" ? "Saved" : <><Loader2 size={14} className="animate-spin" /> Completing…</>}
          </p>
        </div>
      ))}

      {!picking && dojo.phase === "declined" && (
        <div className="text-center py-6">
          <XCircle size={44} className="text-red-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Card declined</p>
          <p className="text-slate-400 text-sm mb-5">{dojo.error ?? "The payment was not approved."}</p>
          <div className="flex gap-3">
            <button onClick={back}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Back</button>
            <button onClick={() => begin()}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
              <RefreshCw size={14} /> Try again
            </button>
          </div>
          {machineSwitch}
        </div>
      )}

      {!picking && dojo.phase === "canceled" && (
        <div className="text-center py-6">
          <Ban size={44} className="text-slate-400 mx-auto mb-3" />
          <p className="text-white font-bold text-lg mb-1">Payment cancelled</p>
          <p className="text-slate-400 text-sm mb-5">Nothing was charged.</p>
          <div className="flex gap-3">
            <button onClick={back}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">Back</button>
            <button onClick={() => begin()}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
              <RefreshCw size={14} /> Try again
            </button>
          </div>
          {machineSwitch}
        </div>
      )}

      {/* Could not start. No "Record as paid": money may not have been taken.
          "Nothing was charged" only when Dojo refused before anything began. */}
      {!picking && dojo.phase === "error" && (
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
            <button onClick={() => begin()}
              className="flex-1 py-3 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
              <RefreshCw size={14} /> Try again
            </button>
          </div>
          {machineSwitch}
        </div>
      )}

      {!picking && dojo.phase === "expired" && (
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
              <button onClick={() => begin()}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-colors flex items-center justify-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
          {machineSwitch}
        </div>
      )}
    </div>
  );
}
