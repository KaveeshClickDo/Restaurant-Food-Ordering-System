"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const PROBE_URL        = "/api/ping";
const PROBE_TIMEOUT_MS = 4000;
const POLL_ONLINE_MS   = 30_000; // check every 30 s when apparently online
const POLL_OFFLINE_MS  = 5_000;  // retry every 5 s when offline

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(PROBE_URL, { method: "HEAD", signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

export interface ConnectivityState {
  isOnline: boolean;
  /** true while the very first probe hasn't resolved yet */
  checking: boolean;
  /** call to force an immediate re-probe */
  recheck: () => void;
}

export function useConnectivity(): ConnectivityState {
  const [isOnline, setIsOnline] = useState(true);
  const [checking, setChecking] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const schedule = useCallback((online: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(doProbe, online ? POLL_ONLINE_MS : POLL_OFFLINE_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doProbe = useCallback(async () => {
    const result = await probe();
    if (!mountedRef.current) return;
    setIsOnline(result);
    setChecking(false);
    schedule(result);
  }, [schedule]);

  const recheck = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    doProbe();
  }, [doProbe]);

  useEffect(() => {
    mountedRef.current = true;
    doProbe();

    // Also react immediately to browser events (not reliable alone, but good for fast recovery)
    const onOnline  = () => doProbe();
    const onOffline = () => { setIsOnline(false); schedule(false); };
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isOnline, checking, recheck };
}
