"use client";

/**
 * posLocalDb.ts — durable on-device storage for the offline POS path.
 *
 * Wraps @capacitor-community/sqlite. Only operational inside the Capacitor
 * Android shell — on web every function gracefully returns null / [] / false
 * so the same module imports cleanly in both environments.
 *
 * Two tables today:
 *   - outbox     pending sales waiting to sync (see posOutbox.ts for the
 *                higher-level enqueue/drain API that sits on top of this)
 *   - kv_cache   menu / customer / settings snapshots so the POS can render
 *                fully offline
 *
 * Phase 4 adds a `staff_credentials` table for the offline PIN cache.
 *
 * Design choices:
 *   - **Never throws.** Every call is wrapped in try/catch and degrades to
 *     null / false. The offline UI must never crash because the DB write
 *     failed.
 *   - **Lazy + memoised init.** `getDb()` runs the open + schema migrations
 *     exactly once per session; subsequent calls reuse the open connection.
 *   - **Dynamic import.** The @capacitor-community/sqlite package is loaded
 *     via `await import(...)` only when running on native, keeping the web
 *     bundle from carrying the plugin's Capacitor-only side effects.
 *   - **No encryption (yet).** The Phase 4 credentials cache will move to
 *     an encrypted DB or column-level encryption via Android Keystore.
 *     Phase 1's outbox + menu cache hold no secrets.
 */

import { isCapacitorAndroid } from "./capacitorBridge";

const DB_NAME    = "pos_local";
const DB_VERSION = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

export type OutboxStatus = "pending" | "failed" | "syncing";

export interface OutboxEntry {
  id:             string;
  payload:        unknown;      // the original POSSale-shaped payload, JSON-stringified at rest
  status:         OutboxStatus;
  attempts:       number;
  lastError?:     string;
  addedAt:        string;       // ISO 8601
  lastAttemptAt?: string;       // ISO 8601
}

// Minimal subset of @capacitor-community/sqlite's API the wrapper actually
// touches. Defined locally so this module doesn't pin a transitive type
// surface and so the web bundle isn't forced to include the plugin's types.
interface LocalDbHandle {
  open(): Promise<unknown>;
  execute(sql: string): Promise<unknown>;
  run(sql: string, values?: unknown[]): Promise<unknown>;
  query(sql: string, values?: unknown[]): Promise<{ values?: Record<string, unknown>[] }>;
  close(): Promise<unknown>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

// SQLite has no native timestamp type. Storing ISO 8601 strings is the
// recommended pattern — sortable lexicographically and round-trip safe.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT    PRIMARY KEY,
  payload         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  added_at        TEXT    NOT NULL,
  last_attempt_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
CREATE INDEX IF NOT EXISTS idx_outbox_added  ON outbox(added_at);

CREATE TABLE IF NOT EXISTS kv_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// ─── Init (lazy, memoised) ────────────────────────────────────────────────────

let dbPromise: Promise<LocalDbHandle | null> | null = null;

// 256-bit random passphrase for the encrypted on-device DB. Generated once per
// device and persisted by the plugin in the Android Keystore-backed secure
// store (setEncryptionSecret) — it never leaves the device and is never shown.
// crypto.getRandomValues is available because the bundled app runs in a secure
// context (https://localhost).
function generateDbSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function openDb(): Promise<LocalDbHandle | null> {
  if (!isCapacitorAndroid()) return null;
  try {
    // Dynamic import so the plugin only loads on native.
    const mod = await import("@capacitor-community/sqlite");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqlite = new (mod as any).SQLiteConnection((mod as any).CapacitorSQLite);

    // ── Encryption-at-rest (Phase 4 hardening) ───────────────────────────────
    // The DB holds cached bcrypt PIN hashes; a 6-digit PIN is brute-forceable
    // against a stolen plaintext-hash file, so the DB is encrypted with a
    // device-bound key. Ensure the secret exists first — the plugin stores it
    // in the Android Keystore-backed secure store; we only ever set it once.
    try {
      const stored = await sqlite.isSecretStored();
      if (!stored?.result) await sqlite.setEncryptionSecret(generateDbSecret());
    } catch (e) {
      console.error("[posLocalDb] encryption secret setup failed:", e);
    }

    let conn: LocalDbHandle;
    const isOpen = await sqlite.isConnection(DB_NAME, false).catch(() => null);
    if (isOpen?.result) {
      conn = await sqlite.retrieveConnection(DB_NAME, false);
    } else {
      // Choose the encryption mode:
      //   • legacy plaintext DB from a pre-encryption build → "encryption"
      //     migrates it IN PLACE (data — incl. any queued outbox sales — kept).
      //   • already-encrypted DB → "secret" opens it with the stored key.
      //   • fresh install (no DB yet) → "secret" creates a new encrypted DB.
      let mode = "secret";
      try {
        const exists = (await sqlite.isDatabase(DB_NAME))?.result;
        if (exists) {
          const enc = (await sqlite.isDatabaseEncrypted(DB_NAME))?.result;
          mode = enc ? "secret" : "encryption";
        }
      } catch { /* default to "secret" */ }
      conn = await sqlite.createConnection(DB_NAME, true, mode, DB_VERSION, false);
    }

    await conn.open();
    await conn.execute(SCHEMA_SQL);
    return conn;
  } catch (err) {
    console.error("[posLocalDb] openDb failed:", err);
    return null;
  }
}

async function getDb(): Promise<LocalDbHandle | null> {
  if (!isCapacitorAndroid()) return null;
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

/**
 * Force a re-open on the next call. Used after destructive errors where the
 * connection may be in a half-broken state.
 */
export function resetLocalDbHandle(): void {
  dbPromise = null;
}

/**
 * Returns true once the on-device DB has been opened successfully. Web always
 * returns false. Useful for the offline-mode UI to decide whether to show a
 * "preparing local storage…" splash on first launch.
 */
export async function isLocalDbReady(): Promise<boolean> {
  if (!isCapacitorAndroid()) return false;
  const db = await getDb();
  return db !== null;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToEntry(r: Record<string, unknown>): OutboxEntry {
  let payload: unknown = null;
  try { payload = JSON.parse(String(r.payload ?? "null")); }
  catch { /* keep null — payload was corrupted; surface via list and let caller drop */ }
  return {
    id:            String(r.id),
    payload,
    status:        (r.status as OutboxStatus) ?? "pending",
    attempts:      Number(r.attempts ?? 0),
    lastError:     r.last_error      != null ? String(r.last_error)      : undefined,
    addedAt:       String(r.added_at ?? ""),
    lastAttemptAt: r.last_attempt_at != null ? String(r.last_attempt_at) : undefined,
  };
}

// ─── Outbox API (used by posOutbox.ts) ────────────────────────────────────────

/**
 * Insert a sale into the outbox. Idempotent on `id` — re-inserting the same
 * id is a no-op (`INSERT OR IGNORE`), preserving the original `added_at`
 * and `attempts` so retries don't reset.
 */
export async function outboxAdd(entry: { id: string; payload: unknown }): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.run(
      `INSERT OR IGNORE INTO outbox (id, payload, status, attempts, added_at)
       VALUES (?, ?, 'pending', 0, ?)`,
      [entry.id, JSON.stringify(entry.payload), new Date().toISOString()],
    );
    return true;
  } catch (err) {
    console.error("[posLocalDb] outboxAdd:", err);
    return false;
  }
}

export async function outboxList(status?: OutboxStatus): Promise<OutboxEntry[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const result = status
      ? await db.query(`SELECT * FROM outbox WHERE status = ? ORDER BY added_at ASC`, [status])
      : await db.query(`SELECT * FROM outbox ORDER BY added_at ASC`);
    return (result.values ?? []).map(rowToEntry);
  } catch (err) {
    console.error("[posLocalDb] outboxList:", err);
    return [];
  }
}

export async function outboxGet(id: string): Promise<OutboxEntry | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.query(`SELECT * FROM outbox WHERE id = ? LIMIT 1`, [id]);
    const row = result.values?.[0];
    return row ? rowToEntry(row) : null;
  } catch (err) {
    console.error("[posLocalDb] outboxGet:", err);
    return null;
  }
}

/**
 * Patch an outbox entry. Only the fields named here are mutable — `id`,
 * `payload`, and `added_at` are immutable and any attempt to change them is
 * silently dropped.
 */
export async function outboxUpdate(
  id: string,
  patch: Partial<Pick<OutboxEntry, "status" | "attempts" | "lastError" | "lastAttemptAt">>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const cols: string[] = [];
  const vals: unknown[] = [];
  if (patch.status        !== undefined) { cols.push("status = ?");          vals.push(patch.status); }
  if (patch.attempts      !== undefined) { cols.push("attempts = ?");        vals.push(patch.attempts); }
  if (patch.lastError     !== undefined) { cols.push("last_error = ?");      vals.push(patch.lastError ?? null); }
  if (patch.lastAttemptAt !== undefined) { cols.push("last_attempt_at = ?"); vals.push(patch.lastAttemptAt ?? null); }
  if (cols.length === 0) return true;

  try {
    vals.push(id);
    await db.run(`UPDATE outbox SET ${cols.join(", ")} WHERE id = ?`, vals);
    return true;
  } catch (err) {
    console.error("[posLocalDb] outboxUpdate:", err);
    return false;
  }
}

export async function outboxDelete(id: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.run(`DELETE FROM outbox WHERE id = ?`, [id]);
    return true;
  } catch (err) {
    console.error("[posLocalDb] outboxDelete:", err);
    return false;
  }
}

export async function outboxCount(status?: OutboxStatus): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const result = status
      ? await db.query(`SELECT COUNT(*) AS n FROM outbox WHERE status = ?`, [status])
      : await db.query(`SELECT COUNT(*) AS n FROM outbox`);
    return Number(result.values?.[0]?.n ?? 0);
  } catch (err) {
    console.error("[posLocalDb] outboxCount:", err);
    return 0;
  }
}

// ─── KV cache API (menu / customers / settings snapshots) ────────────────────

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.query(`SELECT value FROM kv_cache WHERE key = ? LIMIT 1`, [key]);
    const row = result.values?.[0];
    if (!row) return null;
    return JSON.parse(String(row.value)) as T;
  } catch (err) {
    console.error("[posLocalDb] kvGet:", err);
    return null;
  }
}

export async function kvSet<T>(key: string, value: T): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.run(
      `INSERT INTO kv_cache (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), new Date().toISOString()],
    );
    return true;
  } catch (err) {
    console.error("[posLocalDb] kvSet:", err);
    return false;
  }
}

export async function kvDelete(key: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.run(`DELETE FROM kv_cache WHERE key = ?`, [key]);
    return true;
  } catch (err) {
    console.error("[posLocalDb] kvDelete:", err);
    return false;
  }
}
