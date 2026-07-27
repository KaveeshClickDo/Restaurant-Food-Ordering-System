/**
 * GET /api/admin/dojo/status — powers the Admin → Integrations → Card Terminal
 * panel. Admin-only. Reports whether the DOJO_MODE env master is on (so the
 * panel can LOCK the toggle when it isn't), the mode, and the current effective
 * state. It never returns the API key or any secret.
 */

import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { dojoMode, isDojoEnabled, isDojoSandboxKey, getDojoAdminEnabled, isDojoEffectivelyEnabled } from "@/lib/dojo";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const mode = dojoMode();
  return NextResponse.json({
    ok: true,
    envMode: mode,                 // "off" | "mock" | "live"
    envAvailable: isDojoEnabled(), // env master is on (mode !== off)
    sandbox: mode === "live" ? isDojoSandboxKey() : mode === "mock",
    adminEnabled: await getDojoAdminEnabled(),
    effectiveEnabled: await isDojoEffectivelyEnabled(),
  });
}
