/**
 * CLIENT-SIDE helpers for the Dojo terminal flow. Safe to import in the POS
 * bundle: it only calls our own /api/pos/dojo/* routes and imports TYPES (erased
 * at build) — never the server gateway, config, or any secret.
 *
 * Every call goes through apiBase() so it works in the bundled Capacitor APK,
 * where a bare "/api/…" would resolve to https://localhost and 404
 * (see lib/apiBase.ts + the pos-offline apiBase rule).
 */

import { apiBase } from "@/lib/apiBase";
import type { DojoSessionSnapshot } from "@/lib/dojo/types";

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

/** Read whether the Dojo terminal flow is enabled (no secret exposed). */
export function getDojoConfig(): Promise<DojoClientConfig & { ok: true }> {
  return jsonFetch<DojoClientConfig & { ok: true }>("/api/pos/dojo/config");
}

export function createDojoSession(body: CreateDojoSessionBody): Promise<CreateDojoSessionResult & { ok: true }> {
  return jsonFetch<CreateDojoSessionResult & { ok: true }>("/api/pos/dojo/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getDojoSession(id: string): Promise<{ ok: true; snapshot: DojoSessionSnapshot }> {
  return jsonFetch<{ ok: true; snapshot: DojoSessionSnapshot }>(`/api/pos/dojo/sessions/${encodeURIComponent(id)}`);
}

export function signDojoSession(id: string, accepted: boolean): Promise<{ ok: true; snapshot: DojoSessionSnapshot }> {
  return jsonFetch<{ ok: true; snapshot: DojoSessionSnapshot }>(`/api/pos/dojo/sessions/${encodeURIComponent(id)}/signature`, {
    method: "PUT",
    body: JSON.stringify({ accepted }),
  });
}

export function cancelDojoSession(id: string): Promise<{ ok: true; snapshot: DojoSessionSnapshot }> {
  return jsonFetch<{ ok: true; snapshot: DojoSessionSnapshot }>(`/api/pos/dojo/sessions/${encodeURIComponent(id)}/cancel`, {
    method: "PUT",
  });
}
