"use client";

import { useRef, useState, useCallback } from "react";

/**
 * Double-submit guard for async button/form handlers.
 *
 * The canonical pattern is two-pronged:
 *   - A useRef flag (`inFlight`) that flips synchronously inside the handler,
 *     so a rapid second click that fires before React re-renders is rejected.
 *   - A useState flag (`busy`) that gates the button's `disabled` prop and
 *     drives the "Saving…" label.
 *
 * The hook bundles both and exposes a `run` helper that wraps the async work
 * in the proper try/finally. Use it whenever a click triggers a mutating
 * fetch — even when the network is fast, a double-click can still produce
 * duplicate records.
 *
 * ```tsx
 * const { busy, run } = useInflight();
 *
 * async function onSave() {
 *   await run(async () => {
 *     await fetch("/api/admin/foo", { method: "POST", body: JSON.stringify(data) });
 *     // close dialog, refresh list, etc.
 *   });
 * }
 *
 * <button disabled={busy} onClick={onSave}>
 *   {busy ? "Saving…" : "Save"}
 * </button>
 * ```
 *
 * Returns `undefined` from `run` when the call is suppressed because another
 * in-flight call is already executing. Otherwise returns whatever the wrapped
 * function returned.
 */
export function useInflight(): {
  busy: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
} {
  const [busy, setBusy] = useState(false);
  const ref = useRef(false);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (ref.current) return undefined;
    ref.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      ref.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
