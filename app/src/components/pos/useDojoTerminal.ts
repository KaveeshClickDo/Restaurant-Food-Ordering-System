"use client";

/**
 * useDojoTerminal — client hook that runs the Dojo card-terminal state machine
 * for one payment: create session → poll ~1s → (signature) → settle.
 *
 * It exposes a small phase + status surface the PaymentModal renders, and a
 * `result` the caller persists on the sale. All network calls go through
 * lib/dojo/posApi (which uses apiBase(), so it works in the Capacitor APK).
 *
 * `scope` selects which surface's routes to call — "waiter" keeps the /waiter
 * app inside /api/waiter/*, "pos" (default) serves the POS family.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDojoSession, getDojoSession, signDojoSession, cancelDojoSession,
  type CreateDojoSessionBody, type DojoScope,
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
  | "error";      // could not talk to Dojo/our API

const POLL_MS = 1200;
const MAX_CONSECUTIVE_ERRORS = 8;

export interface UseDojoTerminal {
  phase: DojoPhase;
  status: string | null;
  notification: string | null;
  result: DojoSaleResult | null;
  error: string | null;
  start: (body: CreateDojoSessionBody) => Promise<void>;
  submitSignature: (accepted: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export function useDojoTerminal(scope: DojoScope = "pos"): UseDojoTerminal {
  const [phase, setPhase] = useState<DojoPhase>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [result, setResult] = useState<DojoSaleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  const errorsRef = useRef(0);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  const applySnapshot = useCallback((snap: DojoSessionSnapshot) => {
    errorsRef.current = 0;
    setStatus(snap.status);
    setNotification(snap.latestNotification);
    if (snap.done) {
      activeRef.current = false;
      clearTimer();
      if (snap.result) { setResult(snap.result); setPhase("success"); }
      else if (snap.status === "Expired") { setError(snap.message); setPhase("expired"); }
      else if (snap.status === "Canceled") { setError(snap.message); setPhase("canceled"); }
      else { setError(snap.message); setPhase("declined"); }
    } else if (snap.status === "SignatureVerificationRequired") {
      setPhase("signature");
    } else {
      setPhase("processing");
    }
  }, []);

  const poll = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id || !activeRef.current) return;
    try {
      const { snapshot } = await getDojoSession(id, scope);
      if (!activeRef.current) return;
      applySnapshot(snapshot);
      if (activeRef.current && !snapshot.done) timerRef.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      if (!activeRef.current) return;
      errorsRef.current += 1;
      if (errorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
        activeRef.current = false;
        clearTimer();
        setError(e instanceof Error ? e.message : "Lost contact with the card machine.");
        setPhase("expired"); // unknown result — treat like Expired: staff verifies on the device
        return;
      }
      timerRef.current = setTimeout(poll, POLL_MS);
    }
  }, [applySnapshot, scope]);

  const start = useCallback(async (body: CreateDojoSessionBody) => {
    clearTimer();
    errorsRef.current = 0;
    setError(null); setResult(null); setNotification(null); setStatus(null);
    setPhase("starting");
    activeRef.current = true;
    try {
      const res = await createDojoSession(body, scope);
      sessionIdRef.current = res.terminalSessionId;
      if (!activeRef.current) return;
      applySnapshot(res.snapshot);
      if (activeRef.current && !res.snapshot.done) timerRef.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      activeRef.current = false;
      setError(e instanceof Error ? e.message : "Could not start the card payment.");
      setPhase("error");
    }
  }, [applySnapshot, poll, scope]);

  const submitSignature = useCallback(async (accepted: boolean) => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      const { snapshot } = await signDojoSession(id, accepted, scope);
      applySnapshot(snapshot); // the ongoing poll loop (still active) carries on if not yet done
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signature submission failed.");
    }
  }, [applySnapshot, scope]);

  const cancel = useCallback(async () => {
    const id = sessionIdRef.current;
    activeRef.current = false;
    clearTimer();
    if (!id) { setPhase("idle"); return; }
    try {
      const { snapshot } = await cancelDojoSession(id, scope);
      applySnapshot(snapshot);
    } catch {
      // A 422 (card already presented) means cancel is no longer possible; the
      // payment continues — leave the last known state on screen.
    }
  }, [applySnapshot, scope]);

  const reset = useCallback(() => {
    activeRef.current = false;
    clearTimer();
    sessionIdRef.current = null;
    errorsRef.current = 0;
    setPhase("idle"); setError(null); setResult(null); setNotification(null); setStatus(null);
  }, []);

  // Stop polling if the component unmounts mid-payment.
  useEffect(() => () => { activeRef.current = false; clearTimer(); }, []);

  return { phase, status, notification, result, error, start, submitSignature, cancel, reset };
}
