/**
 * The Dojo gateway, while DOJO_MODE is live. SERVER-SIDE ONLY.
 *
 * Kept apart from index.ts, whose re-exports pull in the database client, so
 * recordPayment.ts can use it without an import cycle.
 */

import { createDojoClient } from "./client";
import { dojoMode } from "./config";
import { DojoDisabledError } from "./errors";
import type { DojoGateway } from "./gateway";

export function getDojoGateway(): DojoGateway {
  if (dojoMode() !== "live") throw new DojoDisabledError();
  return createDojoClient();
}
