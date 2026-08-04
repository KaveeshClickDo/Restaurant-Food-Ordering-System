/**
 * Paymentsense Connect provider — SLOT ONLY (not implemented yet).
 *
 * Selected when DOJO_PROVIDER=connect + DOJO_MODE=live. The legacy Connect API
 * (<host>.connect.paymentsense.cloud) has a DIFFERENT wire format from
 * api.dojo.tech: it drives the terminal by TID and is polled, with no separate
 * payment-intent / terminal-session objects, and different auth — HTTP Basic
 * with the API key as the password, plus `Software-House-Id` + `Installer-Id`
 * headers and `Accept: application/connect.v2+json`.
 *
 * Building it correctly needs Connect TEST credentials AND a physical terminal to
 * verify against (Connect has no hardware-free virtual terminal — see
 * docs/dojo/dojo-integration-reference.md). So it is intentionally left as a
 * loud, safe stub rather than untested guesswork: if a deployment is
 * mis-configured onto `connect`, every call fails clearly instead of silently
 * doing the wrong thing.
 *
 * To implement later: add a connectConfig() that reads the Connect env vars
 * (host / apiKey / softwareHouseId / installerId / tid / mid) and map each
 * DojoGateway method onto Connect's transaction-by-TID + poll flow.
 */

import type { DojoGateway } from "./gateway";

export class ConnectNotImplementedError extends Error {
  constructor() {
    super(
      "DOJO_PROVIDER=connect is selected but the Paymentsense Connect adapter is " +
        "not implemented yet. Use DOJO_PROVIDER=dojo_cloud (api.dojo.tech), or " +
        "complete lib/dojo/client.connect.ts once Connect test credentials and a " +
        "terminal are available.",
    );
    this.name = "ConnectNotImplementedError";
  }
}

/**
 * Returns a DojoGateway whose every method throws ConnectNotImplementedError.
 * Keeps the provider switch real and type-safe while the adapter is a stub.
 */
export function createConnectClient(): DojoGateway {
  const notReady = (): never => {
    throw new ConnectNotImplementedError();
  };
  return {
    createPaymentIntent: notReady,
    getPaymentIntent: notReady,
    listTerminals: notReady,
    createTerminalSession: notReady,
    getTerminalSession: notReady,
    submitSignature: notReady,
    cancelTerminalSession: notReady,
    createRefund: notReady,
  };
}
