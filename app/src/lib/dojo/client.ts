/**
 * Real Dojo HTTP client — talks to https://api.dojo.tech. SERVER-SIDE ONLY.
 *
 * Auth per docs: `Authorization: Basic <api_key>` where "Basic " is a LITERAL
 * prefix — the key is NOT base64-encoded. Every call carries the dated `version`
 * header. Terminal endpoints additionally require `software-house-id` (and
 * accept an optional `reseller-id`).
 * See docs/dojo/dojo-integration-reference.md §1 for the verified header matrix.
 */

import { dojoConfig } from "./config";
import { DojoApiError, DojoConfigError } from "./errors";
import type { DojoGateway } from "./gateway";
import type {
  CreatePaymentIntentInput,
  CreateRefundInput,
  CreateTerminalSessionInput,
  DojoPaymentIntent,
  DojoRefundResult,
  DojoTerminal,
  DojoTerminalSession,
  DojoTerminalSessionDetails,
} from "./types";

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOpts {
  method: Method;
  path: string;
  body?: unknown;
  /** Add the software-house-id / reseller-id headers (terminal endpoints). */
  terminal?: boolean;
  /** `idempotencyKey` header (refunds). */
  idempotencyKey?: string;
}

/** Longest wait for one Dojo call. A timeout is reported as status 0 (network),
 *  so the till treats the result as unknown rather than failed. */
const DOJO_TIMEOUT_MS = 15_000;

async function request<T>(opts: RequestOpts): Promise<T> {
  const cfg = dojoConfig();
  // Dojo requires it on the terminal endpoints. Refusing every call without it,
  // not just those, stops a payment before its intent is created.
  if (!cfg.softwareHouseId) throw new DojoConfigError("DOJO_SOFTWARE_HOUSE_ID");
  const headers: Record<string, string> = {
    Authorization: `Basic ${cfg.apiKey}`,
    version: cfg.version,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.terminal) {
    headers["software-house-id"] = cfg.softwareHouseId;
    headers["reseller-id"] = cfg.resellerId;
  }
  if (opts.idempotencyKey) headers["idempotencyKey"] = opts.idempotencyKey;

  let res: Response;
  let text: string;
  try {
    res = await fetch(cfg.baseUrl + opts.path, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      // Never cache payment calls.
      cache: "no-store",
      signal: AbortSignal.timeout(DOJO_TIMEOUT_MS),
    });
    // Inside the try: the timeout also covers reading the body.
    text = await res.text();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new DojoApiError(
      0,
      timedOut
        ? `Dojo didn't answer within ${DOJO_TIMEOUT_MS / 1000}s (${opts.method} ${opts.path}).`
        : `Network error calling Dojo: ${err instanceof Error ? err.message : String(err)}`,
      null,
    );
  }

  const json = text ? safeParse(text) : null;

  if (!res.ok) {
    const message = errorMessage(json) ?? `Dojo API ${opts.method} ${opts.path} failed with ${res.status}`;
    throw new DojoApiError(res.status, message, json ?? text);
  }
  return (json as T);
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Dojo's own words for a failure. Its errors are problem details (title,
 * detail, and per-field `errors`); older endpoints use `message`. The key case
 * varies by endpoint (the refunds endpoint sends "Detail"), so keys are matched
 * case-insensitively.
 */
function errorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const body = Object.fromEntries(
    Object.entries(json as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const summary = text(body.message) ?? text(body.detail) ?? text(body.title);
  const fields = body.errors && typeof body.errors === "object"
    ? Object.entries(body.errors as Record<string, unknown>)
        .map(([field, v]) => `${field}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
        .join("; ")
    : "";
  const parts = [summary, fields].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" — ") : null;
}

function sessionDetails(input: CreateTerminalSessionInput): DojoTerminalSessionDetails {
  switch (input.sessionType) {
    case "Sale":
      return { sessionType: "Sale", sale: { paymentIntentId: input.paymentIntentId! } };
    case "MatchedRefund":
      // The amount is optional in the schema, but without it the sandbox leaves
      // the intent Captured with refundedAmount 0 (tested 2026-10-14); Dojo's own
      // example sends it. So it is always sent when known.
      return {
        sessionType: "MatchedRefund",
        matchedRefund: { paymentIntentId: input.paymentIntentId!, ...(input.amount ? { amount: input.amount } : {}) },
      };
    case "UnlinkedRefund":
      return { sessionType: "UnlinkedRefund", unlinkedRefund: { amount: input.amount! } };
  }
}

export function createDojoClient(): DojoGateway {
  return {
    createPaymentIntent(input: CreatePaymentIntentInput) {
      return request<DojoPaymentIntent>({
        method: "POST",
        path: "/payment-intents",
        body: {
          amount: input.amount,
          reference: input.reference,
          description: input.description,
          captureMode: input.captureMode ?? "Auto",
          ...(input.cardHolderNotPresent ? { cardHolderNotPresent: true } : {}),
        },
      });
    },

    getPaymentIntent(paymentIntentId: string) {
      return request<DojoPaymentIntent>({
        method: "GET",
        path: `/payment-intents/${encodeURIComponent(paymentIntentId)}`,
      });
    },

    async listTerminals(availableOnly: boolean) {
      const qs = availableOnly ? "?statuses=Available" : "";
      const list = await request<DojoTerminal[]>({ method: "GET", path: `/terminals${qs}`, terminal: true });
      return Array.isArray(list) ? list : [];
    },

    createTerminalSession(input: CreateTerminalSessionInput) {
      return request<DojoTerminalSession>({
        method: "POST",
        path: "/terminal-sessions",
        terminal: true,
        body: { terminalId: input.terminalId, details: sessionDetails(input) },
      });
    },

    getTerminalSession(terminalSessionId: string) {
      return request<DojoTerminalSession>({
        method: "GET",
        path: `/terminal-sessions/${encodeURIComponent(terminalSessionId)}`,
        terminal: true,
      });
    },

    submitSignature(terminalSessionId: string, accepted: boolean) {
      return request<DojoTerminalSession>({
        method: "PUT",
        path: `/terminal-sessions/${encodeURIComponent(terminalSessionId)}/signature`,
        terminal: true,
        body: { accepted },
      });
    },

    cancelTerminalSession(terminalSessionId: string) {
      return request<DojoTerminalSession>({
        method: "PUT",
        path: `/terminal-sessions/${encodeURIComponent(terminalSessionId)}/cancel`,
        terminal: true,
      });
    },

    createRefund(input: CreateRefundInput) {
      return request<DojoRefundResult>({
        method: "POST",
        path: `/payment-intents/${encodeURIComponent(input.paymentIntentId)}/refunds`,
        idempotencyKey: input.idempotencyKey,
        body: { amount: input.amount, refundReason: input.refundReason, notes: input.notes },
      });
    },
  };
}
