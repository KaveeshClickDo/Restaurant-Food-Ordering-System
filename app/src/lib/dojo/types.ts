/**
 * Dojo API types — Pay at Counter (Terminals) integration.
 *
 * Transcribed from the v3 OpenAPI spec (docs.dojo.tech/api/v3/bundled.json) and
 * the live doc pages, re-verified 2026-08-12.
 * See docs/dojo/dojo-integration-reference.md.
 *
 * SERVER-SIDE ONLY. These describe the wire shapes we exchange with
 * https://api.dojo.tech. The POS client never imports this file — it talks to
 * our own /api/pos/dojo/* routes, which return the trimmed DTOs at the bottom.
 */

// ── Money ─────────────────────────────────────────────────────────────────────
// Dojo expresses money in MINOR units (1000 = £10.00) with an ISO-4217 code.
export interface DojoMoney {
  value: number;        // minor units (pence)
  currencyCode: string; // e.g. "GBP"
}

// ── Payment intent ──────────────────────────────────────────────────────────
export type DojoCaptureMode = "Auto" | "Manual";

export type DojoPaymentIntentStatus =
  | "Created"
  | "Authorized"
  | "Captured"
  | "Reversed"
  | "Refunded"
  | "Canceled";

export interface DojoCardDetails {
  cardNumber?: string;         // masked, e.g. "44565300****1096"
  cardName?: string;
  expiryDate?: string;
  cardType?: string;           // "VISA" | "MASTERCARD" | ...
  entryMode?: string;          // "Contactless" | "Chip" | ...
  verificationMethod?: string; // "Pin" | "Signature" | ...
}

export interface DojoPaymentDetails {
  transactionId?: string;
  transactionDateTime?: string;
  message?: string;            // e.g. "DEPOSITED"
  authCode?: string;
  card?: DojoCardDetails;
}

/** One entry of PaymentIntent.terminalSessionHistory. The sandbox logs a copy of
 *  the session at each status change, oldest first, so one session appears
 *  several times (seen 2026-10-21). */
export interface DojoTerminalSessionHistoryEntry {
  terminalSession?: {
    id?: string;
    status?: string;
    details?: { sessionType?: string } | null;
  } | null;
}

export interface DojoPaymentIntent {
  id: string;                  // "pi_..."
  captureMode: DojoCaptureMode;
  status: DojoPaymentIntentStatus;
  paymentMethods?: string[];
  amount: DojoMoney;
  /** Tip the customer added on the card machine (gratuity prompt), if any. */
  tipsAmount?: DojoMoney | null;
  cashbackAmount?: DojoMoney | null;
  totalAmount?: DojoMoney | null;
  refundedAmount?: number;
  reference?: string;
  description?: string;
  paymentLink?: string;
  paymentDetails?: DojoPaymentDetails;
  paymentEvents?: unknown[];
  terminalSessionHistory?: DojoTerminalSessionHistoryEntry[] | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePaymentIntentInput {
  amount: DojoMoney;
  reference?: string;
  description?: string;
  captureMode?: DojoCaptureMode; // defaults to "Auto"
  /** Card-not-present (MOTO): skips the "Present Card" screen. */
  cardHolderNotPresent?: boolean;
}

// ── Terminals ──────────────────────────────────────────────────────────────
export type DojoTerminalStatus = "Available" | "InUse" | "Offline" | string;

export interface DojoTerminal {
  id: string;                  // "tm_..."  (Dojo terminal id, NOT the hardware TID)
  status: DojoTerminalStatus;
  /** The TID lives here, not at the top level (OpenAPI Terminal.properties). */
  properties?: { tid?: string | null } | null;
  updatedAt?: string;
}

// ── Terminal sessions ────────────────────────────────────────────────────────
export type DojoSessionType = "Sale" | "MatchedRefund" | "UnlinkedRefund";

export type DojoTerminalSessionStatus =
  | "InitiateRequested"
  | "Initiated"
  | "Authorized"
  | "Captured"
  | "CancelRequested"
  | "Canceled"
  | "SignatureVerificationRequired"
  | "SignatureVerificationAccepted"
  | "SignatureVerificationRejected"
  | "Expired"
  | "Declined";

/** Screen prompts the terminal shows the cardholder — surface these to staff.
 *  The spec's list (TerminalSessionNotificationType), plus TapCard. */
export type DojoNotificationType =
  | "Approved"
  | "Declined"
  | "PresentCard"
  | "PresentOnlyOneCard"
  | "PleaseWait"
  | "EnterPin"
  | "RemoveCard"
  | "InsertCard"
  | "ReEnterCard"
  | "CardUnsupported"
  | "CardError"
  | "TapCard"
  | string;

export interface DojoNotificationEvent {
  createdAt: string;
  notificationType: DojoNotificationType;
}

export interface DojoStatusEvent {
  createdAt: string;
  status: DojoTerminalSessionStatus;
  debugMessage?: string;
}

export interface DojoTerminalSessionDetails {
  sessionType: DojoSessionType;
  sale?: { paymentIntentId: string };
  matchedRefund?: { paymentIntentId: string; amount?: DojoMoney };
  unlinkedRefund?: { amount: DojoMoney };
}

export interface DojoTerminalSession {
  id: string;                  // "ts_..."
  terminalId: string;
  status: DojoTerminalSessionStatus;
  details: DojoTerminalSessionDetails;
  notificationEvents: DojoNotificationEvent[];
  statusEvents: DojoStatusEvent[];
  expireAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTerminalSessionInput {
  terminalId: string;
  sessionType: DojoSessionType;
  /** Required for Sale and MatchedRefund. */
  paymentIntentId?: string;
  /** Required for UnlinkedRefund; also sent for MatchedRefund (see client.ts). */
  amount?: DojoMoney;
}

// ── Refunds ───────────────────────────────────────────────────────────────────
export interface CreateRefundInput {
  paymentIntentId: string;
  amount: number;              // minor units
  refundReason?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface DojoRefundResult {
  refundId: string;
  message?: string;
}

// ── Webhook payloads ──────────────────────────────────────────────────────────
/** A webhook body as the route reads it. Every field is optional: the route
 *  only acts on what is present (payment_intent.status_updated carries both
 *  paymentIntentId and paymentStatus). */
export interface DojoWebhookEvent {
  id?: string;
  event?: string;
  accountId?: string;
  createdAt?: string;
  data?: {
    paymentIntentId?: string;
    paymentStatus?: DojoPaymentIntentStatus;
    captureMode?: DojoCaptureMode;
  };
}

// ── Trimmed DTOs returned by our /api/pos/dojo/* routes to the POS client ─────
// The POS client only needs these — never the full Dojo objects or any secret.

/** A single poll snapshot the POS UI drives its state machine from. */
export interface DojoSessionSnapshot {
  terminalSessionId: string;
  paymentIntentId: string | null;
  status: DojoTerminalSessionStatus;
  /** Latest screen prompt to show staff (from notificationEvents), if any. */
  latestNotification: DojoNotificationType | null;
  /** True once status is a settled state and polling should stop. */
  done: boolean;
  /** Set once the flow succeeds — carries what we persist on the sale. */
  result: DojoSaleResult | null;
  /** Human-readable reason on a non-success terminal state. */
  message: string | null;
}

/** The card-payment result we persist on the pos_sales row. */
export interface DojoSaleResult {
  paymentIntentId: string;
  terminalSessionId: string;
  transactionId: string | null;
  authCode: string | null;
  cardScheme: string | null;   // cardType, e.g. "VISA"
  cardLast4: string | null;
  /** Tip added on the card machine, MAJOR units; null when none. */
  tipAmount: number | null;
  /** What Dojo reports as the intent's total, MAJOR units. */
  totalAmount: number | null;
  status: DojoPaymentIntentStatus | DojoTerminalSessionStatus;
}
