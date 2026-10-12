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

import { DojoApiError } from "./client";
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
    if (earlier && isFundsTaken(earlier.status)) return alreadyPaid(earlier);
    reuseIntent = earlier !== null
      && earlier.status === "Created"
      && earlier.amount.value === input.amount.value
      && earlier.amount.currencyCode === input.amount.currencyCode;
  }

  const terminalId = await resolveTerminalId(gateway, input.terminal);

  if (input.sessionType === "Sale" && !reuseIntent) {
    const intent = await gateway.createPaymentIntent({
      amount: input.amount,
      reference: input.reference,
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
      amount: input.sessionType === "UnlinkedRefund" ? input.amount : undefined,
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
  const sessionId = lastSessionId(intent);
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

function lastSessionId(intent: DojoPaymentIntent): string | null {
  const history = intent.terminalSessionHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const id = history[i]?.terminalSession?.id;
    if (id) return id;
  }
  return null;
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
