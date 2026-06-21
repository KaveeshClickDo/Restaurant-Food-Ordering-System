"use client";

/**
 * posOutbox.ts — offline-sale queue + drain logic, sitting on top of
 * posLocalDb.ts (Capacitor SQLite).
 *
 * Lifecycle:
 *   1. POSContext.completeSale calls enqueueSale(payload) when the network
 *      POST to /api/pos/sales fails AND the device is running inside the
 *      Capacitor Android shell.
 *   2. The cashier sees an optimistic receipt and keeps working.
 *   3. Whenever connectivity flips back on (pos/page.tsx subscribes to
 *      useConnectivity), drainOutbox() is invoked. It walks every pending
 *      entry, POSTs it to /api/pos/sales, and dequeues on 2xx/409 (server
 *      idempotent on row id).
 *   4. The Android-side OutboxSyncWorker (Phase 1 step 8) also drains the
 *      same SQLite table on a periodic schedule, so sales sync even when the
 *      WebView is closed.
 *
 * Why this lives in a separate module from posLocalDb.ts: the wrapper is
 * pure storage with no domain knowledge; this module is the policy
 * (HTTP shape, retry rules, listener fan-out) that other parts of the POS
 * subscribe to.
 *
 * On web (`!isCapacitorAndroid()`) every function is a graceful no-op —
 * the queue can't exist without SQLite, and web POS hard-fails offline by
 * design.
 */

import { isCapacitorAndroid } from "./capacitorBridge";
import {
  outboxAdd,
  outboxList,
  outboxUpdate,
  outboxDelete,
  outboxCount,
  type OutboxEntry,
} from "./posLocalDb";

const MAX_ATTEMPTS  = 5;
const BASE_DELAY_MS = 2_000;          // 2s, 4s, 8s, 16s, 32s

// ─── Public types ─────────────────────────────────────────────────────────────

export type { OutboxEntry } from "./posLocalDb";

// ─── Listener fan-out (used by the pending-sync banner) ──────────────────────

const listeners = new Set<(count: number) => void>();

async function notifyPendingChange(): Promise<void> {
  if (listeners.size === 0) return;
  const n = await pendingCount();
  for (const fn of listeners) {
    try { fn(n); } catch { /* listener errors must not stop the loop */ }
  }
}

/**
 * Subscribe to pending-count changes. Returns an unsubscribe function — usable
 * directly as a useEffect cleanup.
 *
 *   useEffect(() => onPendingChange(setN), []);
 */
export function onPendingChange(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Persist a sale payload to the outbox. Idempotent on `payload.id` — the
 * underlying SQLite INSERT uses OR IGNORE, so re-enqueueing the same sale
 * never duplicates or resets retry counters.
 *
 * Returns true if the entry is persisted (now or already was). False means
 * the underlying DB is unavailable — caller's choice whether to surface that
 * as a hard error to the cashier.
 */
export async function enqueueSale(payload: { id: string } & Record<string, unknown>): Promise<boolean> {
  if (!isCapacitorAndroid()) return false;
  const ok = await outboxAdd({ id: payload.id, payload });
  if (ok) notifyPendingChange();
  return ok;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export async function pendingCount(): Promise<number> {
  if (!isCapacitorAndroid()) return 0;
  return outboxCount("pending");
}

export async function failedCount(): Promise<number> {
  if (!isCapacitorAndroid()) return 0;
  return outboxCount("failed");
}

export async function listEntries(): Promise<OutboxEntry[]> {
  if (!isCapacitorAndroid()) return [];
  return outboxList();
}

/**
 * Reset every failed entry to pending so the next drain retries it. Used by
 * the manual "Sync now" button in POS Settings (Phase 5).
 */
export async function retryFailed(): Promise<number> {
  if (!isCapacitorAndroid()) return 0;
  const failed = await outboxList("failed");
  for (const e of failed) {
    await outboxUpdate(e.id, { status: "pending", attempts: 0, lastError: undefined });
  }
  if (failed.length > 0) notifyPendingChange();
  return failed.length;
}

// ─── Drain ────────────────────────────────────────────────────────────────────

// Module-level latch: concurrent drain calls collapse into a single in-flight
// pass. Without this, two reconnect events fired in quick succession would
// each start their own drain and race on the same outbox rows.
let draining = false;

interface DrainResult {
  attempted: number;
  synced:    number;
  failed:    number;
  retrying:  number;
}

/**
 * Walk every pending outbox entry and try to POST it to /api/pos/sales.
 *
 * Per-entry outcomes:
 *   • 200, 201, 409 with body.sale → dequeue. The server already has it.
 *   • 4xx (400/401/403)            → mark `failed`. Won't succeed on retry.
 *   • 5xx or network error          → increment attempts; if >= MAX_ATTEMPTS,
 *                                     mark `failed`; otherwise leave pending
 *                                     and skip future drains until the
 *                                     back-off window elapses.
 *
 * Back-off: per-entry, exponential. `delay(n) = BASE * 2^(n-1)`. Drain skips
 * an entry whose elapsed-since-last-attempt is below its current delay —
 * cheaper than scheduling individual timers, and naturally batches retries
 * with the next drain trigger.
 */
export async function drainOutbox(): Promise<DrainResult> {
  const summary: DrainResult = { attempted: 0, synced: 0, failed: 0, retrying: 0 };
  if (!isCapacitorAndroid()) return summary;
  if (draining) return summary;
  draining = true;

  try {
    const pending = await outboxList("pending");
    if (pending.length === 0) return summary;

    for (const entry of pending) {
      // Honour the per-entry back-off window — we drain on every reconnect,
      // and without this an entry that just failed a moment ago would be
      // pounded on every wake.
      if (entry.attempts > 0 && entry.lastAttemptAt) {
        const delay = BASE_DELAY_MS * Math.pow(2, entry.attempts - 1);
        const elapsed = Date.now() - new Date(entry.lastAttemptAt).getTime();
        if (elapsed < delay) {
          summary.retrying++;
          continue;
        }
      }

      summary.attempted++;
      const nowIso = new Date().toISOString();
      // Stamp `syncing` so a concurrent JS-side drain (e.g. user pressing
      // "Sync now" while a reconnect drain is in flight) can detect and
      // skip in-flight rows. The Android-side worker checks for this too.
      await outboxUpdate(entry.id, { status: "syncing", lastAttemptAt: nowIso });

      try {
        const res = await fetch("/api/pos/sales", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(entry.payload),
        });

        const code = res.status;
        // 200/201 = inserted; 409 with body.sale = idempotent duplicate (the
        // server's pre-check fired). Both mean the row is durably persisted.
        if (code === 200 || code === 201 || code === 409) {
          await outboxDelete(entry.id);
          summary.synced++;
          continue;
        }

        if (code >= 400 && code < 500) {
          // Client error — replaying will hit the same validation/permission
          // gate. Mark failed and surface to the operator.
          const j = await res.json().catch(() => ({})) as { error?: string };
          await outboxUpdate(entry.id, {
            status:    "failed",
            attempts:  entry.attempts + 1,
            lastError: j.error ?? `HTTP ${code}`,
          });
          summary.failed++;
          continue;
        }

        // 5xx — transient server problem. Back off and retry on the next drain.
        const next = entry.attempts + 1;
        const j2 = await res.json().catch(() => ({})) as { error?: string };
        await outboxUpdate(entry.id, {
          status:    next >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts:  next,
          lastError: j2.error ?? `HTTP ${code}`,
        });
        if (next >= MAX_ATTEMPTS) summary.failed++; else summary.retrying++;
      } catch (err) {
        // Network error — back off and retry. Same shape as 5xx.
        const next = entry.attempts + 1;
        await outboxUpdate(entry.id, {
          status:    next >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts:  next,
          lastError: err instanceof Error ? err.message : "network error",
        });
        if (next >= MAX_ATTEMPTS) summary.failed++; else summary.retrying++;
      }
    }
  } finally {
    draining = false;
    notifyPendingChange();
  }

  return summary;
}
