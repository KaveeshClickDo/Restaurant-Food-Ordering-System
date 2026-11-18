"use client";

/**
 * useDojoTerminal — client hook that runs the Dojo card-terminal state machine
 * for one payment: create session → poll ~1s → (signature) → settle.
 *
 * It exposes a small phase + status surface the payment screens render, and a
 * `result` the caller persists on the sale. All network calls go through
 * lib/dojo/posApi (which uses apiBase(), so it works in the Capacitor APK).
 *
 * `scope` selects which surface's routes to call — "waiter" keeps the /waiter
 * app inside /api/waiter/*, "pos" (default) serves the POS family.
 *
 * The machine can take money while nobody is looking, so the hook never stops
 * watching a live session on its own account:
 * - Cancel asks Dojo and keeps polling. Dojo refuses once the card is in
 *   (cancelState "too_late"), and the payment's real outcome still arrives.
 * - A retry reuses the attempt's payment intent (Dojo's rule). The server then
 *   also spots an earlier attempt that did take the money. `onIntent` hands
 *   each intent to the paying screen, which keeps it across Back (that unmounts
 *   this hook), so going back and choosing the card machine again reuses it too.
 * - If the screen closes mid-payment, the hook asks Dojo to cancel the session.
 *   A StrictMode dev remount is told apart from a real unmount by re-checking
 *   on the next tick.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDojoSession, getDojoSession, signDojoSession, cancelDojoSession,
  DojoRequestError, type CreateDojoSessionBody, type DojoScope,
} from "@/lib/dojo/posApi";
import type { DojoSessionSnapshot, DojoSaleResult } from "@/lib/dojo/types";

export type DojoPhase =
  | "idle"        // nothing started
  | "starting"    // creating the session
  | "processing"  // waiting for the card / issuer
  | "signature"   // operator must accept/reject a signature
  | "success"     // captured/authorized — result is set
  | "declined"    // card declined or signature rejected
  | "expired"     // result unconfirmed — staff must check the machine
  | "canceled"    // session cancelled before payment
  | "error";      // the payment could not be started

export type DojoCancelState = "idle" | "cancelling" | "too_late";

/** Dojo's checklist: poll the terminal session about once a second. The next
 *  check is timed from each answer, so a slow answer never stacks requests. */
const POLL_MS = 1000;
const MAX_CONSECUTIVE_ERRORS = 8;
/** Give up waiting (and treat it as unconfirmed) after this long without a result. */
const MAX_FLOW_MS = 5 * 60_000;

export interface UseDojoTerminal {
  phase: DojoPhase;
  status: string | null;
  notification: string | null;
  result: DojoSaleResult | null;
  /** Why the flow stopped (declined/expired/canceled/error), in words staff can act on. */
  error: string | null;
  /** For phase "error": the server's classification, e.g. "terminal_busy" or "network". */
  errorCode: string | null;
  cancelState: DojoCancelState;
  /** A message to show beside a live payment, e.g. why a cancel or signature call failed. */
  notice: string | null;
  /** The server is on the simulator or a sandbox key: no real money moves. */
  test: boolean;
  start: (body: CreateDojoSessionBody) => Promise<void>;
  submitSignature: (accepted: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export interface UseDojoTerminalOptions {
  /** Called with each payment intent the flow learns, so the screen that owns
   *  the payment can keep it after this hook is gone (Back unmounts it) and
   *  retry the same intent later. */
  onIntent?: (paymentIntentId: string) => void;
}

export function useDojoTerminal(scope: DojoScope = "pos", options: UseDojoTerminalOptions = {}): UseDojoTerminal {
  const onIntentRef = useRef(options.onIntent);
  onIntentRef.current = options.onIntent;
  const [phase, setPhase] = useState<DojoPhase>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [result, setResult] = useState<DojoSaleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [cancelState, setCancelState] = useState<DojoCancelState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState(false);

  const mountedRef = useRef(false);
  const activeRef = useRef(false);          // a session is being started or watched
  const sessionIdRef = useRef<string | null>(null);
  const intentIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false); // Cancel pressed before the session existed
  const signingRef = useRef(false);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorsRef = useRef(0);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const rememberIntent = useCallback((id: string | null | undefined) => {
    if (!id) return;
    intentIdRef.current = id;
    onIntentRef.current?.(id);
  }, []);

  const applySnapshot = useCallback((snap: DojoSessionSnapshot) => {
    errorsRef.current = 0;
    rememberIntent(snap.paymentIntentId);
    setStatus(snap.status);
    setNotification(snap.latestNotification);
    if (snap.done) {
      activeRef.current = false;
      clearTimer();
      setCancelState("idle");
      setNotice(null);
      if (snap.result) { setResult(snap.result); setPhase("success"); }
      else if (snap.status === "Expired") { setError(snap.message); setPhase("expired"); }
      else if (snap.status === "Canceled") { setError(snap.message); setPhase("canceled"); }
      else { setError(snap.message); setPhase("declined"); }
    } else if (snap.status === "SignatureVerificationRequired") {
      setPhase("signature");
    } else {
      setPhase("processing");
    }
  }, [rememberIntent]);

  const giveUpUnconfirmed = useCallback((message: string) => {
    activeRef.current = false;
    clearTimer();
    setCancelState("idle");
    setError(message);
    setPhase("expired"); // unknown result — like Expired, staff check the machine
  }, []);

  const poll = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id || !activeRef.current || !mountedRef.current) return;
    if (Date.now() - startedAtRef.current > MAX_FLOW_MS) {
      giveUpUnconfirmed("No final result from the card machine. Check its screen for the result.");
      return;
    }
    try {
      const { snapshot } = await getDojoSession(id, scope);
      if (!activeRef.current || !mountedRef.current) return;
      applySnapshot(snapshot);
      if (activeRef.current && !snapshot.done) timerRef.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      if (!activeRef.current || !mountedRef.current) return;
      errorsRef.current += 1;
      if (errorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
        giveUpUnconfirmed(e instanceof Error ? e.message : "Lost contact with the card machine.");
        return;
      }
      timerRef.current = setTimeout(poll, POLL_MS);
    }
  }, [applySnapshot, giveUpUnconfirmed, scope]);

  const cancel = useCallback(async () => {
    if (!activeRef.current) return;
    setNotice(null);
    setCancelState("cancelling");
    const id = sessionIdRef.current;
    if (!id) { cancelRequestedRef.current = true; return; } // sent as soon as the session exists
    try {
      // CancelRequested keeps the poll loop going until Dojo reports Canceled.
      const { snapshot } = await cancelDojoSession(id, scope);
      if (activeRef.current && mountedRef.current) {
        applySnapshot(snapshot);
        // Dojo can accept a cancel and still take the payment when the card
        // is already in (the sandbox did, 2026-10-22): staff wait for the result.
        if (!snapshot.done) {
          setNotice("Cancel sent. If the customer's card is already in, the payment can still go through: wait for the result.");
        }
      }
    } catch (e) {
      // Refused once the card is in: the payment carries on and polling shows its outcome.
      const tooLate = e instanceof DojoRequestError && e.code === "cancel_too_late";
      setCancelState(tooLate ? "too_late" : "idle");
      setNotice(e instanceof Error ? e.message : "Couldn't cancel. Check the card machine.");
    }
  }, [applySnapshot, scope]);

  const start = useCallback(async (body: CreateDojoSessionBody) => {
    clearTimer();
    errorsRef.current = 0;
    sessionIdRef.current = null;
    cancelRequestedRef.current = false;
    setError(null); setErrorCode(null); setResult(null); setNotification(null); setStatus(null);
    setNotice(null); setCancelState("idle");
    setPhase("starting");
    activeRef.current = true;
    startedAtRef.current = Date.now();
    try {
      const res = await createDojoSession(
        { ...body, paymentIntentId: body.paymentIntentId ?? intentIdRef.current ?? undefined },
        scope,
      );
      rememberIntent(res.paymentIntentId);
      sessionIdRef.current = res.terminalSessionId;
      setTest(Boolean(res.test));
      if (!activeRef.current) return; // reset() while starting
      if (!mountedRef.current) {
        // The screen closed while the session was being created.
        activeRef.current = false;
        if (res.terminalSessionId) void cancelDojoSession(res.terminalSessionId, scope).catch(() => {});
        return;
      }
      applySnapshot(res.snapshot);
      if (activeRef.current && !res.snapshot.done) {
        if (cancelRequestedRef.current) void cancel();
        timerRef.current = setTimeout(poll, POLL_MS);
      }
    } catch (e) {
      activeRef.current = false;
      if (e instanceof DojoRequestError) rememberIntent(e.paymentIntentId);
      setCancelState("idle");
      setError(e instanceof Error ? e.message : "Could not start the card payment.");
      setErrorCode(e instanceof DojoRequestError ? e.code : null);
      setPhase("error");
    }
  }, [applySnapshot, cancel, poll, rememberIntent, scope]);

  const submitSignature = useCallback(async (accepted: boolean) => {
    const id = sessionIdRef.current;
    if (!id || !activeRef.current || signingRef.current) return;
    signingRef.current = true;
    setNotice(null);
    try {
      const { snapshot } = await signDojoSession(id, accepted, scope);
      if (activeRef.current && mountedRef.current) applySnapshot(snapshot); // the poll loop carries on if not done
    } catch (e) {
      // e.g. Dojo already accepted it after 80 seconds — polling shows the real result.
      setNotice(e instanceof Error ? e.message : "Couldn't send the signature decision.");
    } finally {
      signingRef.current = false;
    }
  }, [applySnapshot, scope]);

  const reset = useCallback(() => {
    activeRef.current = false;
    clearTimer();
    sessionIdRef.current = null;
    intentIdRef.current = null;
    cancelRequestedRef.current = false;
    errorsRef.current = 0;
    setPhase("idle"); setError(null); setErrorCode(null); setResult(null); setNotification(null); setStatus(null);
    setNotice(null); setCancelState("idle");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // StrictMode's dev-only remount sets mountedRef again before this runs.
      setTimeout(() => {
        if (mountedRef.current) return;
        clearTimer();
        const id = sessionIdRef.current;
        if (activeRef.current && id) {
          activeRef.current = false;
          void cancelDojoSession(id, scope).catch(() => {});
        }
      }, 0);
    };
  }, [scope]);

  return {
    phase, status, notification, result, error, errorCode, cancelState, notice, test,
    start, submitSignature, cancel, reset,
  };
}
