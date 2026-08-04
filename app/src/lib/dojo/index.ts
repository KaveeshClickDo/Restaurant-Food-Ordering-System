/**
 * Dojo gateway selector. SERVER-SIDE ONLY.
 *
 * Route handlers call getDojoGateway() and get the mock or the real client
 * depending on DOJO_MODE (and, in live mode, DOJO_PROVIDER) — so
 * mock ↔ sandbox ↔ live and dojo_cloud ↔ connect are purely config changes.
 */

import { createDojoClient } from "./client";
import { createConnectClient } from "./client.connect";
import { createDojoMock } from "./mock";
import { dojoMode, dojoProvider } from "./config";
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
  if (mode === "mock") return createDojoMock(); // provider-agnostic simulator
  if (mode === "live") {
    return dojoProvider() === "connect" ? createConnectClient() : createDojoClient();
  }
  throw new DojoDisabledError();
}

export type { DojoGateway } from "./gateway";
export { isDojoEnabled, dojoMode, dojoProvider, dojoConfig, isDojoSandboxKey, type DojoProvider } from "./config";
export { isDojoEffectivelyEnabled, getDojoAdminEnabled } from "./effectiveFlag";
export { recordDojoPayment, type DojoSource, type DojoResultInput } from "./recordPayment";
export { toSnapshot, toSaleResult, resolveSnapshot, isSettled, isInFlight, isSuccess } from "./gateway";
export { DojoApiError } from "./client";
export { createConnectClient, ConnectNotImplementedError } from "./client.connect";
