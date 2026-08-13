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

export class DojoApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "DojoApiError";
    this.status = status;
    this.body = body;
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOpts {
  method: Method;
  path: string;
  body?: unknown;
  /** Add the software-house-id / reseller-id headers (terminal endpoints). */
  terminal?: boolean;
  /** Idempotency-Key header (refunds). */
  idempotencyKey?: string;
}

async function request<T>(opts: RequestOpts): Promise<T> {
  const cfg = dojoConfig();
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
  if (opts.idempotencyKey) headers["IdempotencyKey"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(cfg.baseUrl + opts.path, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      // Never cache payment calls.
      cache: "no-store",
    });
  } catch (err) {
    throw new DojoApiError(0, `Network error calling Dojo: ${err instanceof Error ? err.message : String(err)}`, null);
  }

  const text = await res.text();
  const json = text ? safeParse(text) : null;

  if (!res.ok) {
    const message =
      (json && typeof json === "object" && "message" in json && typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : null) ?? `Dojo API ${opts.method} ${opts.path} failed with ${res.status}`;
    throw new DojoApiError(res.status, message, json ?? text);
  }
  return (json as T);
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

function sessionDetails(input: CreateTerminalSessionInput): DojoTerminalSessionDetails {
  switch (input.sessionType) {
    case "Sale":
      return { sessionType: "Sale", sale: { paymentIntentId: input.paymentIntentId! } };
    case "MatchedRefund":
      return { sessionType: "MatchedRefund", matchedRefund: { paymentIntentId: input.paymentIntentId! } };
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
