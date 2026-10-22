/**
 * Starting a card-present payment, independent of HTTP. SERVER-SIDE ONLY.
 *
 * Used by the POS and waiter session routes (through sessionHandlers) and by
 * the dojo:demo script, so the simulator runs exactly the logic the tills do.
 * It deliberately imports nothing that needs Next or the database.
 *
 * Three rules from Dojo's go-live checklist live here:
 * - A retried sale reuses the payment intent of the earlier attempt.
 * - Before reusing it, check whether the earlier attempt actually took the
 *   money (an Expired session can have). If it did, report it as paid instead
 *   of charging the customer again.
 * - The terminal can be configured by its TID (what Dojo calls the machine,
 *   e.g. VCMSEEKSIP0) as well as by its API id (tm_…).
 */

import { DojoApiError } from "./errors";
import { isFundsTaken, saleResultFrom, toSnapshot, type DojoGateway } from "./gateway";
import type {
  DojoCaptureMode,
  DojoMoney,
  DojoPaymentIntent,
  DojoSessionSnapshot,
  DojoSessionType,
} from "./types";

export interface StartPaymentInput {
  sessionType: DojoSessionType;
  amount: DojoMoney;
  /** What the payment is for, e.g. "POS sale 3F9A2C1B". Cut to Dojo's 60
   *  characters; "Card sale" when empty (see paymentReference). */
  reference?: string;
  description?: string;
  captureMode?: DojoCaptureMode;
  /** Which machine: a Dojo terminal id ("tm_…") or its TID. Empty = first Available. */
  terminal?: string;
  /** Sale: the earlier attempt's intent, reused on retry. MatchedRefund: the intent to refund. */
  paymentIntentId?: string;
}

export interface StartPaymentResult {
  /** Null when no session was opened because an earlier attempt was already paid. */
  terminalId: string | null;
  paymentIntentId: string | null;
  terminalSessionId: string | null;
  snapshot: DojoSessionSnapshot;
}

/**
 * The session could not be opened after a new intent was created. Carries the
 * intent id so the client's retry reuses it instead of leaving it orphaned.
 */
export class DojoStartError extends Error {
  readonly original: unknown;
  readonly paymentIntentId: string | null;

  constructor(original: unknown, paymentIntentId: string | null) {
    super(original instanceof Error ? original.message : String(original));
    this.name = "DojoStartError";
    this.original = original;
    this.paymentIntentId = paymentIntentId;
  }
}

export async function startTerminalPayment(
  gateway: DojoGateway,
  input: StartPaymentInput,
): Promise<StartPaymentResult> {
  let paymentIntentId = input.paymentIntentId;
  let reuseIntent = false;

  if (input.sessionType === "Sale" && paymentIntentId) {
    const earlier = await findIntent(gateway, paymentIntentId);
    // Only the same charge counts: an earlier intent for a different amount is
    // another payment, and must neither be reused nor taken as this one paid.
    const sameCharge = earlier !== null
      && earlier.amount.value === input.amount.value
      && earlier.amount.currencyCode === input.amount.currencyCode;
    if (sameCharge && isFundsTaken(earlier.status)) return alreadyPaid(earlier);
    reuseIntent = sameCharge && earlier.status === "Created";
  }

  const terminalId = await resolveTerminalId(gateway, input.terminal);

  if (input.sessionType === "Sale" && !reuseIntent) {
    const intent = await gateway.createPaymentIntent({
      amount: input.amount,
      reference: paymentReference(input.reference),
      description: input.description,
      captureMode: input.captureMode ?? "Auto",
    });
    paymentIntentId = intent.id;
  }

  try {
    const session = await gateway.createTerminalSession({
      terminalId,
      sessionType: input.sessionType,
      paymentIntentId,
      // Refund sessions carry the amount: required for unlinked, and for matched
      // the only way the intent gets marked refunded (see client.ts).
      amount: input.sessionType === "Sale" ? undefined : input.amount,
    });
    return {
      terminalId,
      paymentIntentId: paymentIntentId ?? null,
      terminalSessionId: session.id,
      snapshot: toSnapshot(session, null),
    };
  } catch (err) {
    throw new DojoStartError(err, input.sessionType === "Sale" ? paymentIntentId ?? null : null);
  }
}

/** Dojo refuses a payment intent without a reference, or with one over 60
 *  characters (sandbox, 2026-10-21), so a screen's reference is cut to fit
 *  and an empty one becomes "Card sale". */
const MAX_REFERENCE_LENGTH = 60;

function paymentReference(wanted: string | undefined): string {
  const reference = wanted?.trim();
  return reference ? reference.slice(0, MAX_REFERENCE_LENGTH).trim() : "Card sale";
}

/** The earlier intent, or null when Dojo doesn't know it. Any other failure is
 *  rethrown: if we can't tell whether it was paid, charging again is the risk. */
async function findIntent(gateway: DojoGateway, id: string): Promise<DojoPaymentIntent | null> {
  try {
    return await gateway.getPaymentIntent(id);
  } catch (err) {
    if (err instanceof DojoApiError && err.status === 404) return null;
    throw err;
  }
}

function alreadyPaid(intent: DojoPaymentIntent): StartPaymentResult {
  const sessionId = paidSessionId(intent);
  const status = intent.status === "Authorized" ? "Authorized" : "Captured";
  return {
    terminalId: null,
    paymentIntentId: intent.id,
    terminalSessionId: sessionId,
    snapshot: {
      terminalSessionId: sessionId ?? "",
      paymentIntentId: intent.id,
      status,
      latestNotification: null,
      done: true,
      result: saleResultFrom(intent.id, sessionId ?? "", intent, status),
      message: null,
    },
  };
}

const PAID_SESSION: ReadonlySet<string> = new Set(["Captured", "Authorized", "SignatureVerificationAccepted"]);

/** The session that took the money: the latest successful sale session in the
 *  intent's history, else the latest session of any kind. */
function paidSessionId(intent: DojoPaymentIntent): string | null {
  const sessions = (intent.terminalSessionHistory ?? []).map((h) => h?.terminalSession).reverse();
  const paid = sessions.find((s) =>
    s?.id && PAID_SESSION.has(s.status ?? "") && (s.details?.sessionType ?? "Sale") === "Sale");
  return paid?.id ?? sessions.find((s) => s?.id)?.id ?? null;
}

async function resolveTerminalId(gateway: DojoGateway, wanted: string | undefined): Promise<string> {
  const value = wanted?.trim();
  if (value && value.startsWith("tm_")) return value;

  const terminals = await gateway.listTerminals(false);
  if (value) {
    const match = terminals.find((t) => t.properties?.tid?.toUpperCase() === value.toUpperCase());
    if (!match) throw new DojoApiError(404, `No card machine with TID ${value} on this Dojo account.`, null);
    return match.id;
  }

  const available = terminals.find((t) => t.status === "Available");
  if (available) return available.id;
  if (terminals.some((t) => t.status === "InUse")) {
    throw new DojoApiError(409, "Every card machine is busy.", null);
  }
  throw new DojoApiError(404, "No card machine is online.", null);
}
