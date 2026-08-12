/**
 * Dojo gateway selector. SERVER-SIDE ONLY.
 *
 * Route handlers call getDojoGateway() and get the mock or the real client
 * depending on DOJO_MODE — so mock ↔ sandbox ↔ live is purely a config change.
 */

import { createDojoClient } from "./client";
import { createDojoMock } from "./mock";
import { dojoMode } from "./config";
import type { DojoGateway } from "./gateway";

/** Thrown when a Dojo route is hit while the feature is off. */
export class DojoDisabledError extends Error {
  constructor() {
    super("Dojo payments are not enabled (DOJO_MODE=off).");
    this.name = "DojoDisabledError";
  }
}

export function getDojoGateway(): DojoGateway {
  const mode = dojoMode();
  if (mode === "mock") return createDojoMock();
  if (mode === "live") return createDojoClient();
  throw new DojoDisabledError();
}

export type { DojoGateway } from "./gateway";
export { isDojoEnabled, dojoMode, dojoConfig, isDojoSandboxKey } from "./config";
export { isDojoEffectivelyEnabled, getDojoAdminEnabled } from "./effectiveFlag";
export { recordDojoPayment, type DojoSource, type DojoResultInput } from "./recordPayment";
export { toSnapshot, toSaleResult, resolveSnapshot, isSettled, isInFlight, isSuccess } from "./gateway";
export { DojoApiError } from "./client";
