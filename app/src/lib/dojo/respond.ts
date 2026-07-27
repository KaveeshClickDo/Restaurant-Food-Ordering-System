/**
 * Shared error → HTTP response mapping for the /api/pos/dojo/* routes.
 * SERVER-SIDE ONLY.
 */

import { NextResponse } from "next/server";
import { DojoApiError } from "./client";
import { DojoDisabledError } from "./index";

/** Convert to minor units (pence) for the Dojo API. */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

/** Map a thrown error from the gateway/routes to a JSON NextResponse. */
export function dojoErrorResponse(err: unknown): NextResponse {
  if (err instanceof DojoDisabledError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
  }
  if (err instanceof DojoApiError) {
    // Pass Dojo's own status through when it's a client-meaningful 4xx; collapse
    // network (status 0) and 5xx to 502 Bad Gateway.
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    return NextResponse.json({ ok: false, error: err.message, dojoStatus: err.status }, { status });
  }
  const message = err instanceof Error ? err.message : "Unexpected Dojo error.";
  console.error("[dojo] route error:", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}
