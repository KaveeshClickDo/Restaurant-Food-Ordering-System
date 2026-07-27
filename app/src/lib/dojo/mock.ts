/**
 * In-memory Dojo simulator — SERVER-SIDE ONLY, used when DOJO_MODE=mock.
 *
 * Lets us build and test the ENTIRE Pay-at-Counter flow with NO Dojo account or
 * key. It mirrors Dojo's own sandbox convention: the OUTCOME is chosen by the
 * terminal's id suffix, exactly like the real virtual terminals
 * (SIP0=success/signature, DIP0=declined, TIP0=expired, SIS0=refund-signature).
 * See docs/dojo/dojo-integration-reference.md §9.
 *
 * Progression is poll-count based and deterministic: each getTerminalSession()
 * advances the session one tick, so it settles in ~3 polls (~3s at 1 poll/sec) —
 * realistic for the UI while staying fast + repeatable for tests.
 *
 * State lives in module scope. The production deploy is a single long-lived Node
 * process (systemd `next start`), so this persists across requests; it resets on
 * restart, which is exactly what a simulator should do.
 */

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

type Outcome = "success" | "declined" | "expired" | "signature";

interface MockSession {
  session: DojoTerminalSession;
  outcome: Outcome;
  polls: number;
  signatureDecision: boolean | null;
}

const intents = new Map<string, DojoPaymentIntent>();
const sessions = new Map<string, MockSession>();

// Virtual terminals — the id suffix drives the forced outcome (Dojo-style).
const MOCK_TERMINALS: DojoTerminal[] = [
  { id: "tm_mock_success_SIP0", status: "Available", model: "MockPDQ", tid: "10000000" },
  { id: "tm_mock_declined_DIP0", status: "Available", model: "MockPDQ", tid: "20000000" },
  { id: "tm_mock_expired_TIP0", status: "Available", model: "MockPDQ", tid: "30000000" },
  { id: "tm_mock_signature_SIS0", status: "Available", model: "MockPDQ", tid: "40000000" },
];

function outcomeFor(terminalId: string): Outcome {
  const t = terminalId.toUpperCase();
  if (t.includes("DIP0") || t.includes("DECLINE")) return "declined";
  if (t.includes("TIP0") || t.includes("EXPIRE")) return "expired";
  if (t.includes("SIS0") || t.includes("SIGNATURE")) return "signature";
  return "success";
}

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

function captureIntent(paymentIntentId: string | undefined): void {
  if (!paymentIntentId) return;
  const pi = intents.get(paymentIntentId);
  if (!pi) return;
  pi.status = "Captured";
  pi.paymentDetails = {
    transactionId: rid("txn").replace(/_/g, "-"),
    transactionDateTime: nowIso(),
    message: "DEPOSITED",
    authCode: String(Math.floor(100000 + Math.random() * 900000)),
    card: {
      cardNumber: "44565300****1096",
      cardName: "MOCK CARD",
      cardType: "VISA",
      entryMode: "Contactless",
      verificationMethod: "Pin",
    },
  };
  pi.updatedAt = nowIso();
}

/** Advance a session one poll-tick toward its outcome. */
function advance(ms: MockSession): void {
  const s = ms.session;
  ms.polls += 1;
  const piId = s.details.sale?.paymentIntentId;

  // Terminal states never move again.
  if (["Captured", "Declined", "Expired", "Canceled", "SignatureVerificationAccepted", "SignatureVerificationRejected", "Authorized"].includes(s.status)) {
    return;
  }

  // Signature branch: once required, wait for a decision from submitSignature().
  if (s.status === "SignatureVerificationRequired") {
    if (ms.signatureDecision === true) { pushStatus(s, "SignatureVerificationAccepted"); captureIntent(piId); }
    else if (ms.signatureDecision === false) { pushStatus(s, "SignatureVerificationRejected"); const pi = piId ? intents.get(piId) : null; if (pi) pi.status = "Reversed"; }
    return;
  }

  switch (ms.polls) {
    case 1:
      pushStatus(s, "Initiated");
      pushNote(s, "PresentCard");
      break;
    case 2:
      pushNote(s, "PleaseWait");
      pushNote(s, "EnterPin");
      break;
    default: {
      // poll >= 3 → reach the forced outcome
      switch (ms.outcome) {
        case "declined": pushStatus(s, "Declined"); break;
        case "expired": pushStatus(s, "Expired"); break;
        case "signature": pushStatus(s, "SignatureVerificationRequired"); break;
        case "success":
        default:
          pushNote(s, "RemoveCard");
          pushStatus(s, "Captured");
          captureIntent(piId);
          break;
      }
    }
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
      if (!pi) throw new Error(`Mock: unknown payment intent ${paymentIntentId}`);
      return structuredClone(pi);
    },

    async listTerminals(): Promise<DojoTerminal[]> {
      return structuredClone(MOCK_TERMINALS);
    },

    async createTerminalSession(input: CreateTerminalSessionInput): Promise<DojoTerminalSession> {
      const id = rid("ts");
      const session: DojoTerminalSession = {
        id,
        terminalId: input.terminalId,
        status: "InitiateRequested",
        details: details(input),
        notificationEvents: [],
        statusEvents: [{ createdAt: nowIso(), status: "InitiateRequested", debugMessage: "" }],
        expireAt: new Date(Date.now() + 90_000).toISOString(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      sessions.set(id, { session, outcome: outcomeFor(input.terminalId), polls: 0, signatureDecision: null });
      return structuredClone(session);
    },

    async getTerminalSession(terminalSessionId: string): Promise<DojoTerminalSession> {
      const ms = sessions.get(terminalSessionId);
      if (!ms) throw new Error(`Mock: unknown terminal session ${terminalSessionId}`);
      advance(ms);
      return structuredClone(ms.session);
    },

    async submitSignature(terminalSessionId: string, accepted: boolean): Promise<DojoTerminalSession> {
      const ms = sessions.get(terminalSessionId);
      if (!ms) throw new Error(`Mock: unknown terminal session ${terminalSessionId}`);
      ms.signatureDecision = accepted;
      advance(ms); // apply immediately so the next poll reflects the decision
      return structuredClone(ms.session);
    },

    async cancelTerminalSession(terminalSessionId: string): Promise<DojoTerminalSession> {
      const ms = sessions.get(terminalSessionId);
      if (!ms) throw new Error(`Mock: unknown terminal session ${terminalSessionId}`);
      if (ms.session.status === "InitiateRequested" || ms.session.status === "Initiated") {
        pushStatus(ms.session, "CancelRequested");
        pushStatus(ms.session, "Canceled");
      }
      return structuredClone(ms.session);
    },

    async createRefund(input: CreateRefundInput): Promise<DojoRefundResult> {
      const pi = intents.get(input.paymentIntentId);
      if (pi) {
        pi.refundedAmount = (pi.refundedAmount ?? 0) + input.amount;
        pi.status = pi.refundedAmount >= (pi.amount.value ?? 0) ? "Refunded" : "Captured";
      }
      return { refundId: rid("rfnd"), message: `mock refund for ${input.paymentIntentId}` };
    },
  };
}
