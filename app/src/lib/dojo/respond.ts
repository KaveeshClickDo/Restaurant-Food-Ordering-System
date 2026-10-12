/**
 * Shared error → HTTP response mapping for the /api/{pos,waiter}/dojo/* routes.
 * SERVER-SIDE ONLY.
 */

import { NextResponse } from "next/server";
import { DojoApiError } from "./client";
import { describeDojoError, type DojoOp } from "./errors";
import { DojoStartError } from "./flow";
import { DojoDisabledError } from "./index";

/** Convert to minor units (pence) for the Dojo API. */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

/**
 * Map a thrown error from the gateway/routes to a JSON NextResponse.
 * `error` is written for staff; `code` lets the client pick the right screen;
 * `detail` keeps Dojo's own wording for debugging; `paymentIntentId` (set when
 * a session failed after its intent was created) lets the retry reuse it.
 */
export function dojoErrorResponse(err: unknown, op: DojoOp): NextResponse {
  const paymentIntentId = err instanceof DojoStartError ? err.paymentIntentId : null;
  const cause = err instanceof DojoStartError ? err.original : err;

  if (cause instanceof DojoDisabledError) {
    return NextResponse.json(
      { ok: false, error: cause.message, code: "disabled", paymentIntentId },
      { status: 503 },
    );
  }
  if (cause instanceof DojoApiError) {
    const described = describeDojoError(cause, op);
    console.error(`[dojo] ${op} failed: Dojo ${cause.status} ${cause.message}`);
    return NextResponse.json(
      {
        ok: false,
        error: described.message,
        code: described.code,
        dojoStatus: cause.status,
        detail: cause.message,
        paymentIntentId,
      },
      { status: described.httpStatus },
    );
  }
  const message = cause instanceof Error ? cause.message : "Unexpected Dojo error.";
  console.error(`[dojo] ${op} route error:`, message);
  return NextResponse.json({ ok: false, error: message, code: "unexpected", paymentIntentId }, { status: 500 });
}
