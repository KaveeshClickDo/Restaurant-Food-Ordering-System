/**
 * CLIENT-SIDE helpers for the Dojo terminal flow. Safe to import in the POS
 * bundle: it only calls our own /api/{pos,waiter}/dojo/* routes and imports
 * TYPES (erased at build) — never the server gateway, config, or any secret.
 *
 * Every call goes through apiBase() so it works in the bundled Capacitor APK,
 * where a bare "/api/…" would resolve to https://localhost and 404
 * (see lib/apiBase.ts + the pos-offline apiBase rule).
 *
 * `scope` picks which surface's routes to call. The /waiter UI must only ever
 * call /api/waiter/*, so it passes "waiter"; the POS family (till, collection,
 * gift card, reservation) uses "pos". Both hit the same shared server handlers,
 * differing only in the auth gate.
 */

import { apiBase } from "@/lib/apiBase";
import type { DojoSessionSnapshot } from "@/lib/dojo/types";

export type DojoScope = "pos" | "waiter";

const root = (scope: DojoScope) => `/api/${scope}/dojo`;

export interface DojoClientConfig {
  enabled: boolean;
  mode: "off" | "mock" | "live";
  sandbox: boolean;
}

/** Starting a card-present sale (the routes take nothing else). */
export interface CreateDojoSessionBody {
  amount: number;               // major units (e.g. 12.50)
  currencyCode?: string;
  reference?: string;
  description?: string;
  terminalId?: string;
  /** The earlier attempt's intent, so a retry reuses it. */
  paymentIntentId?: string;
}

export interface CreateDojoSessionResult {
  /** Null when no session was opened because an earlier attempt was already paid. */
  terminalId: string | null;
  paymentIntentId: string | null;
  terminalSessionId: string | null;
  snapshot: DojoSessionSnapshot;
  /** Simulator or sandbox key: no real money moves. */
  test: boolean;
}

/** Longest wait for our server per call; a timeout surfaces as code "network".
 *  Starting a payment makes up to four Dojo calls in a row (15s limit each), so
 *  its wait is longer than that: giving up first would lose the payment intent
 *  of a session the server did open, and a retry would then make a new one. */
const CALL_TIMEOUT_MS = 20_000;
const START_TIMEOUT_MS = 90_000;

/**
 * A failed call to our Dojo routes. `message` is written for staff; `code` is
 * the server's classification (lib/dojo/errors.ts, e.g. "terminal_busy",
 * "cancel_too_late", "network"); `paymentIntentId` is set when a session
 * failed after its intent was created, so the retry can reuse it.
 */
export class DojoRequestError extends Error {
  readonly httpStatus: number;
  readonly code: string | null;
  readonly paymentIntentId: string | null;

  constructor(message: string, httpStatus: number, code: string | null, paymentIntentId: string | null) {
    super(message);
    this.name = "DojoRequestError";
    this.httpStatus = httpStatus;
    this.code = code;
    this.paymentIntentId = paymentIntentId;
  }
}

async function jsonFetch<T>(path: string, init: RequestInit = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const noAnswer = () => new DojoRequestError(
    controller.signal.aborted
      ? "The server didn't answer in time."
      : "Can't reach the server. Check the internet connection.",
    0, "network", null,
  );
  try {
    let res: Response;
    try {
      res = await fetch(apiBase() + path, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    } catch {
      throw noAnswer();
    }
    const json = (await res.json().catch(() => ({}))) as T & {
      ok?: boolean;
      error?: string;
      code?: string;
      paymentIntentId?: string | null;
    };
    // Timed out while the body was arriving: there is no answer to use.
    if (controller.signal.aborted) throw noAnswer();
    // Every route answers ok: true on success, so anything else is a failure.
    if (!res.ok || json.ok !== true) {
      throw new DojoRequestError(
        json.error || `Request to ${path} failed (${res.status}).`,
        res.status,
        json.code ?? null,
        json.paymentIntentId ?? null,
      );
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read whether the Dojo terminal flow is enabled (no secret exposed). POS-only:
 * the waiter app gets its flag from /api/waiter/config alongside its other
 * bootstrap data, so it never needs this call.
 */
export function getDojoConfig(): Promise<DojoClientConfig & { ok: true }> {
  return jsonFetch<DojoClientConfig & { ok: true }>("/api/pos/dojo/config");
}

export function createDojoSession(
  body: CreateDojoSessionBody,
  scope: DojoScope = "pos",
): Promise<CreateDojoSessionResult & { ok: true }> {
  return jsonFetch<CreateDojoSessionResult & { ok: true }>(`${root(scope)}/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  }, START_TIMEOUT_MS);
}

export function getDojoSession(
  id: string,
  scope: DojoScope = "pos",
): Promise<{ ok: true; snapshot: DojoSessionSnapshot }> {
  return jsonFetch<{ ok: true; snapshot: DojoSessionSnapshot }>(
    `${root(scope)}/sessions/${encodeURIComponent(id)}`,
  );
}

export function signDojoSession(
  id: string,
  accepted: boolean,
  scope: DojoScope = "pos",
): Promise<{ ok: true; snapshot: DojoSessionSnapshot }> {
  return jsonFetch<{ ok: true; snapshot: DojoSessionSnapshot }>(
    `${root(scope)}/sessions/${encodeURIComponent(id)}/signature`,
    { method: "PUT", body: JSON.stringify({ accepted }) },
  );
}

export function cancelDojoSession(
  id: string,
  scope: DojoScope = "pos",
): Promise<{ ok: true; snapshot: DojoSessionSnapshot }> {
  return jsonFetch<{ ok: true; snapshot: DojoSessionSnapshot }>(
    `${root(scope)}/sessions/${encodeURIComponent(id)}/cancel`,
    { method: "PUT" },
  );
}
