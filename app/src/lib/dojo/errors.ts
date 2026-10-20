/**
 * Dojo errors, and what staff see for them. SERVER-SIDE ONLY, and free of
 * Next/db imports so the dojo:demo and dojo:sandbox scripts can use it too.
 *
 * Dojo's go-live checklist expects a specific message for each failure: a
 * wrong API key, an offline or unknown terminal (404), a busy terminal (409),
 * and a cancel sent after the card was presented (422). The same status means
 * different things per operation, so the caller says which one failed.
 */

/** A call to Dojo failed: `status` is Dojo's HTTP status (0 = network). */
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

/** Thrown when a Dojo route is used while DOJO_MODE is off. */
export class DojoDisabledError extends Error {
  constructor() {
    super("Dojo payments are not enabled (DOJO_MODE=off).");
    this.name = "DojoDisabledError";
  }
}

export type DojoOp = "create" | "poll" | "signature" | "cancel" | "terminals" | "refund";

export type DojoErrorCode =
  | "auth"                 // API key or software-house-id refused
  | "terminal_unavailable" // terminal offline, unknown, or none online
  | "terminal_busy"
  | "cancel_too_late"      // the card is already in; the payment carries on
  | "network"              // Dojo unreachable or failing; result unknown
  | "rejected";            // anything else Dojo refused

export interface DescribedDojoError {
  /** Status for OUR response. A Dojo 401/403 becomes 502: the staff session is fine. */
  httpStatus: number;
  code: DojoErrorCode;
  /** Plain words for the till. */
  message: string;
}

export function describeDojoError(err: DojoApiError, op: DojoOp): DescribedDojoError {
  const s = err.status;

  if (s === 401 || s === 403) {
    return {
      httpStatus: 502,
      code: "auth",
      message: "The card machine isn't set up correctly. Ask an admin to check the Dojo API key.",
    };
  }
  if (s === 0 || s >= 500) {
    return {
      httpStatus: 502,
      code: "network",
      message: "Can't reach Dojo right now. Check the internet connection, then try again.",
    };
  }
  if (op === "cancel" && (s === 409 || s === 422)) {
    return {
      httpStatus: s,
      code: "cancel_too_late",
      message: "Too late to cancel: the customer has already presented their card. Wait for the result.",
    };
  }
  if (op === "signature" && (s === 409 || s === 422)) {
    return {
      httpStatus: s,
      code: "rejected",
      message: "The signature check has already finished. The result will show in a moment.",
    };
  }
  if ((op === "create" || op === "terminals") && s === 404) {
    return {
      httpStatus: 404,
      code: "terminal_unavailable",
      message: "The card machine can't be reached. Check it's switched on and connected, then try again.",
    };
  }
  if (op === "create" && s === 409) {
    // Dojo's own wording for this 409: "the terminal is either offline or currently in use".
    return {
      httpStatus: 409,
      code: "terminal_busy",
      message: "The card machine isn't available: it's busy or offline. Finish or cancel what's on its screen, check it's on, then try again.",
    };
  }
  if (s === 404) {
    return {
      httpStatus: 404,
      code: "rejected",
      message: "Dojo can't find this payment. Check the card machine screen for the result.",
    };
  }
  return {
    httpStatus: s >= 400 && s < 500 ? s : 502,
    code: "rejected",
    message: `Dojo refused the request: ${err.message}`,
  };
}
