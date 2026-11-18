/**
 * Picks the Dojo gateway for the current DOJO_MODE. SERVER-SIDE ONLY.
 *
 * Callers get the simulator or the real client from here, so mock ↔ sandbox ↔
 * live is purely a config change. Kept apart from index.ts, whose re-exports
 * pull in the database client, so recordPayment.ts can use it without an
 * import cycle.
 */

import { createDojoClient } from "./client";
import { dojoMode } from "./config";
import { DojoDisabledError } from "./errors";
import type { DojoGateway } from "./gateway";
import { createDojoMock } from "./mock";

export function getDojoGateway(): DojoGateway {
  const mode = dojoMode();
  if (mode === "mock") return createDojoMock();
  if (mode === "live") return createDojoClient();
  throw new DojoDisabledError();
}
