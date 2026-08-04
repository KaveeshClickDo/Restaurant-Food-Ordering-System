/**
 * GET /api/pos/dojo/config — tells the POS client whether the Dojo card-terminal
 * flow is available, WITHOUT ever exposing the API key or any secret.
 *
 * The POS calls this on mount; when `enabled` is false it shows exactly today's
 * behaviour (manual card record). `mode` lets the UI badge mock vs live during
 * development. Requires a POS session (this is a POS-only surface).
 */

import { NextResponse } from "next/server";
import { requirePosSession } from "@/lib/posPermissions";
import { dojoMode, dojoProvider, isDojoSandboxKey, isDojoEffectivelyEnabled } from "@/lib/dojo";

export async function GET() {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;

  const mode = dojoMode();
  // `enabled` = env master AND admin toggle. This is what the POS UI gates on.
  return NextResponse.json({
    ok: true,
    enabled: await isDojoEffectivelyEnabled(),
    mode, // "off" | "mock" | "live"
    provider: dojoProvider(), // "dojo_cloud" | "connect" (informational; UI is provider-agnostic)
    sandbox: mode === "live" ? isDojoSandboxKey() : mode === "mock",
  });
}
