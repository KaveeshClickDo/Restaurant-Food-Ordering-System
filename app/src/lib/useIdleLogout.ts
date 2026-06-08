"use client";

import { useEffect, useRef } from "react";

/**
 * Auto-logout after a period of user inactivity.
 *
 * Listens to `click`, `keydown`, and `touchstart` to detect activity. When the
 * delta since the last event exceeds `timeoutMs`, the supplied `onIdle`
 * callback fires. The check runs once a minute, so the actual time until
 * logout is `timeoutMs` ± 60 s — accurate enough for security purposes.
 *
 * Pass `enabled = false` to disable cleanly (e.g. when no user is signed in
 * yet so the listeners shouldn't be attached). Setting it back to `true`
 * starts a fresh idle window.
 *
 * Mirrors the inline implementation in POSContext.tsx — the hook exists so
 * other staff surfaces (waiter / admin / kitchen) can opt-in with identical
 * behaviour instead of duplicating the same useEffect blocks.
 *
 * Usage:
 * ```tsx
 * useIdleLogout({
 *   enabled:   Boolean(currentWaiter),
 *   timeoutMs: 15 * 60 * 1000,
 *   onIdle:    logout,
 * });
 * ```
 */
export function useIdleLogout(opts: {
  enabled: boolean;
  timeoutMs: number;
  onIdle: () => void;
}): void {
  const { enabled, timeoutMs, onIdle } = opts;
  const lastActivity = useRef(Date.now());

  // Keep the latest callback in a ref so the interval below doesn't need to
  // re-subscribe (and re-arm the timer) every render.
  const onIdleRef = useRef(onIdle);
  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;
    lastActivity.current = Date.now();
    const reset = () => { lastActivity.current = Date.now(); };
    window.addEventListener("click",      reset, { passive: true });
    window.addEventListener("keydown",    reset, { passive: true });
    window.addEventListener("touchstart", reset, { passive: true });
    return () => {
      window.removeEventListener("click",      reset);
      window.removeEventListener("keydown",    reset);
      window.removeEventListener("touchstart", reset);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current >= timeoutMs) onIdleRef.current();
    }, 60_000);
    return () => clearInterval(id);
  }, [enabled, timeoutMs]);
}
