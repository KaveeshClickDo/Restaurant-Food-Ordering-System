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

export interface CreateDojoSessionBody {
  amount: number;               // major units (e.g. 12.50)
  currencyCode?: string;
  reference?: string;
  description?: string;
  terminalId?: string;
  captureMode?: "Auto" | "Manual";
  sessionType?: "Sale" | "MatchedRefund" | "UnlinkedRefund";
  paymentIntentId?: string;
}

export interface CreateDojoSessionResult {
  terminalId: string;
  paymentIntentId: string | null;
  terminalSessionId: string;
  snapshot: DojoSessionSnapshot;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase() + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Request to ${path} failed (${res.status}).`);
  }
  return json;
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
  });
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
