"use client";

/**
 * Plug-in barcode scanners (USB or Bluetooth) work as keyboards: they "type"
 * the code in a fast burst and press Enter. This hook catches that burst
 * anywhere on the page, so staff can scan without clicking into the box first.
 *
 * - Keys typed into a text box are left alone: the box handles its own Enter.
 * - A pause between keys starts over, so normal typing by hand isn't mistaken
 *   for a scan.
 * - The Enter that ends a scan is swallowed, so it can't also "press" whatever
 *   button happens to have focus (e.g. Check in for the previous guest).
 */

import { useEffect, useRef } from "react";

/** Scanners send each key a few milliseconds apart; people are much slower. */
const MAX_GAP_MS = 80;
/** Shorter than a booking reference (8 characters): not a scan. */
const MIN_LENGTH = 8;

export function useScannerWedge(onScan: (text: string) => void, enabled = true): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;

    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = performance.now();
      if (now - last > MAX_GAP_MS) buffer = "";
      last = now;

      if (e.key === "Enter") {
        if (buffer.length >= MIN_LENGTH) {
          e.preventDefault();
          e.stopPropagation();
          onScanRef.current(buffer);
        }
        buffer = "";
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled]);
}
