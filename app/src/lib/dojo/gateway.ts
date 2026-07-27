/**
 * DojoGateway — the interface both the real HTTP client and the mock implement.
 * SERVER-SIDE ONLY. Route handlers depend on this, never on a concrete impl, so
 * mock ↔ sandbox ↔ live is a config flip (see getDojoGateway in ./index).
 */

import type {
  CreatePaymentIntentInput,
  CreateRefundInput,
  CreateTerminalSessionInput,
  DojoPaymentIntent,
  DojoRefundResult,
  DojoSaleResult,
  DojoSessionSnapshot,
  DojoTerminal,
  DojoTerminalSession,
} from "./types";

export interface DojoGateway {
  /** POST /payment-intents */
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<DojoPaymentIntent>;
  /** GET /payment-intents/{id} */
  getPaymentIntent(paymentIntentId: string): Promise<DojoPaymentIntent>;
  /** GET /terminals?statuses=Available */
  listTerminals(availableOnly: boolean): Promise<DojoTerminal[]>;
  /** POST /terminal-sessions */
  createTerminalSession(input: CreateTerminalSessionInput): Promise<DojoTerminalSession>;
  /** GET /terminal-sessions/{id} */
  getTerminalSession(terminalSessionId: string): Promise<DojoTerminalSession>;
  /** PUT /terminal-sessions/{id}/signature */
  submitSignature(terminalSessionId: string, accepted: boolean): Promise<DojoTerminalSession>;
  /** PUT /terminal-sessions/{id}/cancel */
  cancelTerminalSession(terminalSessionId: string): Promise<DojoTerminalSession>;
  /** POST /payment-intents/{id}/refunds */
  createRefund(input: CreateRefundInput): Promise<DojoRefundResult>;
}

// ── Shared helpers (impl-agnostic) ────────────────────────────────────────────

/** Statuses at which polling stops — the session has settled. */
const SETTLED: ReadonlySet<string> = new Set([
  "Authorized",
  "Captured",
  "SignatureVerificationAccepted",
  "SignatureVerificationRejected",
  "Canceled",
  "Declined",
  "Expired",
]);

/** Statuses that still need polling. */
export function isInFlight(status: string): boolean {
  return status === "InitiateRequested" || status === "Initiated" || status === "CancelRequested";
}

export function isSettled(status: string): boolean {
  return SETTLED.has(status);
}

/** Was this a successful collection (funds captured or authorized)? */
export function isSuccess(status: string): boolean {
  return status === "Captured" || status === "Authorized" || status === "SignatureVerificationAccepted";
}

function lastFourOf(masked: string | null | undefined): string | null {
  if (!masked) return null;
  const digits = masked.replace(/[^0-9]/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Build the result we persist on the sale from a settled intent + session. */
export function toSaleResult(
  session: DojoTerminalSession,
  intent: DojoPaymentIntent | null,
): DojoSaleResult {
  const pd = intent?.paymentDetails;
  return {
    paymentIntentId: session.details.sale?.paymentIntentId ?? intent?.id ?? "",
    terminalSessionId: session.id,
    transactionId: pd?.transactionId ?? null,
    authCode: pd?.authCode ?? null,
    cardScheme: pd?.card?.cardType ?? null,
    cardLast4: lastFourOf(pd?.card?.cardNumber),
    status: intent?.status ?? session.status,
  };
}

/**
 * Reduce a terminal session (+ optional final intent) to the snapshot the POS
 * UI drives its state machine from. Keeps all Dojo internals server-side.
 */
export function toSnapshot(
  session: DojoTerminalSession,
  intent: DojoPaymentIntent | null,
): DojoSessionSnapshot {
  const settled = isSettled(session.status);
  const success = isSuccess(session.status);
  const notes = session.notificationEvents;
  const latestNotification = notes.length > 0 ? notes[notes.length - 1].notificationType : null;

  let message: string | null = null;
  switch (session.status) {
    case "Declined": message = "Card declined. Ask for another payment method or retry."; break;
    case "Canceled": message = "Payment cancelled."; break;
    case "Expired": message = "Result unconfirmed — check the card machine screen, then record the sale manually or retry."; break;
    case "SignatureVerificationRejected": message = "Signature rejected — payment reversed."; break;
    default: message = null;
  }

  return {
    terminalSessionId: session.id,
    paymentIntentId: session.details.sale?.paymentIntentId ?? null,
    status: session.status,
    latestNotification,
    done: settled,
    result: success ? toSaleResult(session, intent) : null,
    message,
  };
}

/**
 * Build a snapshot, fetching the final payment intent when the session has
 * succeeded on a Sale (so the snapshot carries transactionId / authCode / card).
 * Intent-fetch failures degrade gracefully — the success snapshot is still
 * returned, just without card details.
 */
export async function resolveSnapshot(
  gateway: DojoGateway,
  session: DojoTerminalSession,
): Promise<DojoSessionSnapshot> {
  let intent: DojoPaymentIntent | null = null;
  const piId = session.details.sale?.paymentIntentId;
  if (isSuccess(session.status) && piId) {
    try { intent = await gateway.getPaymentIntent(piId); } catch { /* keep null */ }
  }
  return toSnapshot(session, intent);
}
