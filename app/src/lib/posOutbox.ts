"use client";

/**
 * Lightweight outbox queue for POS → server sync.
 *
 * When the POS is offline the sale is already safe in localStorage (POSContext).
 * This module queues the KDS push (POST /api/pos/orders) and retries it
 * automatically whenever connectivity is restored, with exponential back-off.
 *
 * Storage: localStorage key "pos_outbox" — a JSON array of OutboxEntry objects.
 * Each entry is attempted up to MAX_ATTEMPTS times before being marked failed.
 */

export type OutboxStatus = "pending" | "failed";

export interface OutboxEntry {
  id: string;              // matches POSSale.id
  payload: unknown;        // the full POSSale JSON
  addedAt: string;         // ISO — when it was enqueued
  attempts: number;        // how many send attempts have been made
  status: OutboxStatus;
  lastError?: string;
  lastAttemptAt?: string;  // ISO — when the most recent attempt was made
}

const STORAGE_KEY  = "pos_outbox";
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000; // doubles each retry (2 s, 4 s, 8 s, 16 s, 32 s)

// ─── persistence helpers ──────────────────────────────────────────────────────

function load(): OutboxEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as OutboxEntry[];
  } catch {
    return [];
  }
}

function save(entries: OutboxEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ─── public API ───────────────────────────────────────────────────────────────

/** Add a sale to the outbox for later sync. Idempotent on same id. */
export function enqueue(sale: unknown & { id: string }) {
  const entries = load();
  if (entries.some((e) => e.id === sale.id)) return; // already queued
  entries.push({
    id:       sale.id,
    payload:  sale,
    addedAt:  new Date().toISOString(),
    attempts: 0,
    status:   "pending",
  });
  save(entries);
}

/** Remove a successfully synced entry. */
export function dequeue(id: string) {
  save(load().filter((e) => e.id !== id));
}

/** Current snapshot of the outbox (for UI display). */
export function getOutbox(): OutboxEntry[] {
  return load();
}

/** Count of pending (not yet successfully synced) entries. */
export function pendingCount(): number {
  return load().filter((e) => e.status === "pending").length;
}

/** Mark all failed entries as pending so they are retried on next drain. */
export function retryFailed() {
  const entries = load().map((e) =>
    e.status === "failed" ? { ...e, status: "pending" as OutboxStatus, attempts: 0 } : e
  );
  save(entries);
}

// ─── drain ────────────────────────────────────────────────────────────────────

let draining = false;

/**
 * Attempt to flush all pending outbox entries to the server.
 * Safe to call multiple times — concurrent calls are collapsed.
 * Returns the number of entries that were successfully synced.
 */
export async function drainOutbox(): Promise<number> {
  if (draining) return 0;
  draining = true;
  let synced = 0;

  try {
    const entries = load().filter((e) => e.status === "pending");

    for (const entry of entries) {
      // Exponential back-off guard: skip entries whose back-off window hasn't
      // elapsed since the last attempt. drain() is called on reconnect, so we
      // check time elapsed rather than sleeping inside the loop.
      if (entry.attempts > 0) {
        if (entry.attempts >= MAX_ATTEMPTS) {
          const all = load();
          const idx = all.findIndex((e) => e.id === entry.id);
          if (idx !== -1) {
            all[idx] = { ...all[idx], status: "failed", lastError: `Exceeded ${MAX_ATTEMPTS} attempts` };
            save(all);
          }
          continue;
        }
        const delay = BASE_DELAY_MS * Math.pow(2, entry.attempts - 1); // 2s, 4s, 8s, 16s
        const msSinceLast = entry.lastAttemptAt
          ? Date.now() - new Date(entry.lastAttemptAt).getTime()
          : Infinity;
        if (msSinceLast < delay) continue; // back-off window not yet elapsed
      }

      try {
        const res = await fetch("/api/pos/orders", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(entry.payload),
        });

        if (res.ok || res.status === 409) {
          // 409 Conflict = already exists on server (idempotent duplicate) — treat as success
          dequeue(entry.id);
          synced++;
        } else {
          const json = await res.json().catch(() => ({})) as { error?: string };
          const all = load();
          const idx = all.findIndex((e) => e.id === entry.id);
          if (idx !== -1) {
            const next = all[idx].attempts + 1;
            all[idx] = {
              ...all[idx],
              attempts:      next,
              lastAttemptAt: new Date().toISOString(),
              lastError:     json.error ?? `HTTP ${res.status}`,
              status:        next >= MAX_ATTEMPTS ? "failed" : "pending",
            };
            save(all);
          }
        }
      } catch (err) {
        const all = load();
        const idx = all.findIndex((e) => e.id === entry.id);
        if (idx !== -1) {
          const next = all[idx].attempts + 1;
          all[idx] = {
            ...all[idx],
            attempts:      next,
            lastAttemptAt: new Date().toISOString(),
            lastError:     err instanceof Error ? err.message : "Network error",
            status:        next >= MAX_ATTEMPTS ? "failed" : "pending",
          };
          save(all);
        }
      }
    }
  } finally {
    draining = false;
  }

  return synced;
}
