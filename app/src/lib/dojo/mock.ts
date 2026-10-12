/**
 * In-memory Dojo simulator — SERVER-SIDE ONLY, used when DOJO_MODE=mock.
 *
 * Lets us build and test the whole Pay-at-Counter flow with no Dojo account or
 * key. Its nine virtual terminals copy the ones Dojo set up on our sandbox
 * account: same TIDs, same forced outcomes, so DOJO_TERMINAL_ID=VCMSEEKDIP0
 * means the same machine in mock and live mode.
 *
 *   VCMSEEKSIP0  chip & PIN, approved        VCMSEEKUIP0  unsuccessful result
 *   VCMSEEKSCN0  contactless, approved       VCMSEEKTIP0  timed out (Expired)
 *   VCMSEEKSIS0  signature check             VCMSEEKCIP0  cancelled on the machine
 *   VCMSEEKDIS0  signature, then declined    VCMSEEKSIP1  approved with a 10% tip
 *   VCMSEEKDIP0  declined
 *
 * UIP0 and DIS0 are our best guess at Dojo's statuses (Declined) until the
 * sandbox shows the real ones.
 *
 * It also behaves like Dojo where the POS has to cope: a busy terminal refuses
 * a second session (409), a cancel after the card is in is refused (422), a
 * signature left alone is accepted after 80 seconds, a late signature decision
 * is refused (422), and unknown ids are 404s. Errors are DojoApiErrors, so they
 * reach the POS through the same mapping as real ones.
 *
 * Progression is poll-count based and deterministic: each getTerminalSession()
 * advances the session one tick (card presented on the 2nd poll, result on the
 * 3rd), so a sale settles in about 3 seconds at the POS poll rate.
 *
 * State lives in module scope. The production deploy is a single long-lived Node
 * process (systemd `next start`), so this persists across requests; it resets on
 * restart, which is exactly what a simulator should do.
 */

import { DojoApiError } from "./client";
import type { DojoGateway } from "./gateway";
import type {
  CreatePaymentIntentInput,
  CreateRefundInput,
  CreateTerminalSessionInput,
  DojoNotificationEvent,
  DojoPaymentIntent,
  DojoRefundResult,
  DojoStatusEvent,
  DojoTerminal,
  DojoTerminalSession,
  DojoTerminalSessionDetails,
  DojoTerminalSessionStatus,
} from "./types";

type Outcome =
  | "approved"
  | "contactless"
  | "tip"
  | "signature"
  | "signatureDeclined"
  | "declined"
  | "unsuccessful"
  | "expired"
  | "canceledOnMachine";

const MOCK_TERMINALS: ReadonlyArray<{ tid: string; outcome: Outcome }> = [
  { tid: "VCMSEEKSIP0", outcome: "approved" },
  { tid: "VCMSEEKSCN0", outcome: "contactless" },
  { tid: "VCMSEEKSIS0", outcome: "signature" },
  { tid: "VCMSEEKDIS0", outcome: "signatureDeclined" },
  { tid: "VCMSEEKDIP0", outcome: "declined" },
  { tid: "VCMSEEKUIP0", outcome: "unsuccessful" },
  { tid: "VCMSEEKTIP0", outcome: "expired" },
  { tid: "VCMSEEKCIP0", outcome: "canceledOnMachine" },
  { tid: "VCMSEEKSIP1", outcome: "tip" },
];

const terminalIdOf = (tid: string) => `tm_mock_${tid}`;

/** Dojo finalises an unanswered signature check as accepted after 80 seconds. */
const SIGNATURE_TIMEOUT_MS = 80_000;
const SESSION_LIFETIME_MS = 90_000;

/** Session statuses that never change again. */
const FINAL: ReadonlySet<DojoTerminalSessionStatus> = new Set<DojoTerminalSessionStatus>([
  "Captured",
  "Authorized",
  "Declined",
  "Expired",
  "Canceled",
  "SignatureVerificationRejected",
]);

interface MockSession {
  session: DojoTerminalSession;
  outcome: Outcome;
  polls: number;
  cardPresented: boolean;
  signatureRequiredAt: number | null;
  signatureDecision: boolean | null;
}

const intents = new Map<string, DojoPaymentIntent>();
const sessions = new Map<string, MockSession>();

function nowIso(): string { return new Date().toISOString(); }
function rid(prefix: string): string {
  return `${prefix}_mock_${Math.random().toString(36).slice(2, 14)}`;
}

function pushStatus(s: DojoTerminalSession, status: DojoTerminalSessionStatus): void {
  s.status = status;
  const ev: DojoStatusEvent = { createdAt: nowIso(), status, debugMessage: "" };
  s.statusEvents.push(ev);
  s.updatedAt = ev.createdAt;
}

function pushNote(s: DojoTerminalSession, notificationType: string): void {
  const ev: DojoNotificationEvent = { createdAt: nowIso(), notificationType };
  s.notificationEvents.push(ev);
}

function getSession(id: string): MockSession {
  const ms = sessions.get(id);
  if (!ms) throw new DojoApiError(404, `Terminal session ${id} not found.`, null);
  return ms;
}

function isLive(ms: MockSession): boolean {
  return !FINAL.has(ms.session.status) && Date.now() < Date.parse(ms.session.expireAt ?? "");
}

function liveSessionOn(terminalId: string): boolean {
  for (const ms of sessions.values()) {
    if (ms.session.terminalId === terminalId && isLive(ms)) return true;
  }
  return false;
}

function captureIntent(paymentIntentId: string | undefined, outcome: Outcome): void {
  const pi = paymentIntentId ? intents.get(paymentIntentId) : undefined;
  if (!pi) return;
  const contactless = outcome === "contactless";
  pi.status = "Captured";
  if (outcome === "tip") {
    const tip = Math.round(pi.amount.value * 0.1);
    pi.tipsAmount = { value: tip, currencyCode: pi.amount.currencyCode };
    pi.totalAmount = { value: pi.amount.value + tip, currencyCode: pi.amount.currencyCode };
  }
  pi.paymentDetails = {
    transactionId: rid("txn").replace(/_/g, "-"),
    transactionDateTime: nowIso(),
    message: "DEPOSITED",
    authCode: String(Math.floor(100000 + Math.random() * 900000)),
    card: {
      cardNumber: "44565300****1096",
      cardName: "MOCK CARD",
      cardType: "VISA",
      entryMode: contactless ? "Contactless" : "Chip",
      verificationMethod: outcome === "signature" ? "Signature" : contactless ? "OnDevice" : "Pin",
    },
  };
  pi.updatedAt = nowIso();
}

function reverseIntent(paymentIntentId: string | undefined): void {
  const pi = paymentIntentId ? intents.get(paymentIntentId) : undefined;
  if (pi) { pi.status = "Reversed"; pi.updatedAt = nowIso(); }
}

/** Advance a session one poll-tick toward its outcome. */
function advance(ms: MockSession): void {
  const s = ms.session;
  if (FINAL.has(s.status)) return;
  if (Date.now() >= Date.parse(s.expireAt ?? "")) { pushStatus(s, "Expired"); return; }
  ms.polls += 1;
  const piId = s.details.sale?.paymentIntentId;

  switch (s.status) {
    case "CancelRequested":
      pushStatus(s, "Canceled");
      return;
    case "SignatureVerificationAccepted":
      // Dojo captures straight after an accepted signature.
      if (ms.outcome === "signatureDeclined") { pushNote(s, "Declined"); pushStatus(s, "Declined"); }
      else { pushNote(s, "Approved"); pushStatus(s, "Captured"); captureIntent(piId, ms.outcome); }
      return;
    case "SignatureVerificationRequired": {
      const timedOut = ms.signatureRequiredAt !== null
        && Date.now() - ms.signatureRequiredAt >= SIGNATURE_TIMEOUT_MS;
      if (ms.signatureDecision === false) { pushStatus(s, "SignatureVerificationRejected"); reverseIntent(piId); }
      else if (ms.signatureDecision === true || timedOut) pushStatus(s, "SignatureVerificationAccepted");
      return;
    }
  }

  if (ms.polls === 1) {
    pushStatus(s, "Initiated");
    pushNote(s, "PresentCard");
    return;
  }
  if (ms.polls === 2) {
    if (ms.outcome === "canceledOnMachine") { pushStatus(s, "Canceled"); return; }
    ms.cardPresented = true;
    pushNote(s, "PleaseWait");
    if (ms.outcome !== "contactless") pushNote(s, "EnterPin");
    return;
  }

  switch (ms.outcome) {
    case "declined":
      pushNote(s, "Declined");
      pushStatus(s, "Declined");
      break;
    case "unsuccessful":
      pushNote(s, "CardError");
      pushStatus(s, "Declined");
      break;
    case "expired":
      pushStatus(s, "Expired");
      break;
    case "signature":
    case "signatureDeclined":
      ms.signatureRequiredAt = Date.now();
      pushStatus(s, "SignatureVerificationRequired");
      break;
    default:
      pushNote(s, "Approved");
      if (ms.outcome !== "contactless") pushNote(s, "RemoveCard");
      pushStatus(s, "Captured");
      captureIntent(piId, ms.outcome);
  }
}

function details(input: CreateTerminalSessionInput): DojoTerminalSessionDetails {
  switch (input.sessionType) {
    case "Sale": return { sessionType: "Sale", sale: { paymentIntentId: input.paymentIntentId! } };
    case "MatchedRefund": return { sessionType: "MatchedRefund", matchedRefund: { paymentIntentId: input.paymentIntentId! } };
    case "UnlinkedRefund": return { sessionType: "UnlinkedRefund", unlinkedRefund: { amount: input.amount! } };
  }
}

export function createDojoMock(): DojoGateway {
  return {
    async createPaymentIntent(input: CreatePaymentIntentInput): Promise<DojoPaymentIntent> {
      const id = rid("pi");
      const pi: DojoPaymentIntent = {
        id,
        captureMode: input.captureMode ?? "Auto",
        status: "Created",
        paymentMethods: ["Card"],
        amount: input.amount,
        totalAmount: input.amount,
        refundedAmount: 0,
        reference: input.reference,
        description: input.description,
        paymentLink: `https://pay.dojo.tech/checkout/${id}`,
        paymentEvents: [],
        terminalSessionHistory: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      intents.set(id, pi);
      return structuredClone(pi);
    },

    async getPaymentIntent(paymentIntentId: string): Promise<DojoPaymentIntent> {
      const pi = intents.get(paymentIntentId);
      if (!pi) throw new DojoApiError(404, `Payment intent ${paymentIntentId} not found.`, null);
      return structuredClone(pi);
    },

    async listTerminals(availableOnly: boolean): Promise<DojoTerminal[]> {
      const all: DojoTerminal[] = MOCK_TERMINALS.map((t) => {
        const id = terminalIdOf(t.tid);
        return { id, status: liveSessionOn(id) ? "InUse" : "Available", properties: { tid: t.tid } };
      });
      return availableOnly ? all.filter((t) => t.status === "Available") : all;
    },

    async createTerminalSession(input: CreateTerminalSessionInput): Promise<DojoTerminalSession> {
      const terminal = MOCK_TERMINALS.find((t) => terminalIdOf(t.tid) === input.terminalId);
      if (!terminal) throw new DojoApiError(404, `Terminal ${input.terminalId} not found.`, null);
      if (liveSessionOn(input.terminalId)) {
        throw new DojoApiError(409, `Terminal ${input.terminalId} is busy with another session.`, null);
      }

      const id = rid("ts");
      if (input.sessionType !== "UnlinkedRefund") {
        const pi = input.paymentIntentId ? intents.get(input.paymentIntentId) : undefined;
        if (!pi) throw new DojoApiError(404, `Payment intent ${input.paymentIntentId} not found.`, null);
        if (input.sessionType === "Sale" && pi.status !== "Created") {
          throw new DojoApiError(422, `The status ${pi.status} does not allow a new sale session.`, null);
        }
        pi.terminalSessionHistory = [...(pi.terminalSessionHistory ?? []), { terminalSession: { id } }];
      }

      const session: DojoTerminalSession = {
        id,
        terminalId: input.terminalId,
        status: "InitiateRequested",
        details: details(input),
        notificationEvents: [],
        statusEvents: [{ createdAt: nowIso(), status: "InitiateRequested", debugMessage: "" }],
        expireAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      sessions.set(id, {
        session,
        outcome: terminal.outcome,
        polls: 0,
        cardPresented: false,
        signatureRequiredAt: null,
        signatureDecision: null,
      });
      return structuredClone(session);
    },

    async getTerminalSession(terminalSessionId: string): Promise<DojoTerminalSession> {
      const ms = getSession(terminalSessionId);
      advance(ms);
      return structuredClone(ms.session);
    },

    async submitSignature(terminalSessionId: string, accepted: boolean): Promise<DojoTerminalSession> {
      const ms = getSession(terminalSessionId);
      if (ms.session.status !== "SignatureVerificationRequired") {
        throw new DojoApiError(422, "Signature verification is not pending for this session.", null);
      }
      ms.signatureDecision = accepted;
      advance(ms); // apply now, so the response and the next poll reflect the decision
      return structuredClone(ms.session);
    },

    async cancelTerminalSession(terminalSessionId: string): Promise<DojoTerminalSession> {
      const ms = getSession(terminalSessionId);
      const s = ms.session;
      if (s.status === "CancelRequested" || s.status === "Canceled") return structuredClone(s);
      const beforeCard = s.status === "InitiateRequested" || (s.status === "Initiated" && !ms.cardPresented);
      if (!beforeCard) throw new DojoApiError(422, "Session cannot be canceled.", null);
      pushStatus(s, "CancelRequested"); // the next poll reports Canceled, as Dojo does
      return structuredClone(s);
    },

    async createRefund(input: CreateRefundInput): Promise<DojoRefundResult> {
      const pi = intents.get(input.paymentIntentId);
      if (!pi) throw new DojoApiError(404, `Payment intent ${input.paymentIntentId} not found.`, null);
      pi.refundedAmount = (pi.refundedAmount ?? 0) + input.amount;
      pi.status = pi.refundedAmount >= pi.amount.value ? "Refunded" : "Captured";
      return { refundId: rid("rfnd"), message: `mock refund for ${input.paymentIntentId}` };
    },
  };
}
