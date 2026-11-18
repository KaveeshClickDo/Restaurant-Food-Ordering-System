/**
 * GET /api/admin/dojo/status — powers the Admin → Integrations → Card Terminal
 * panel. Admin-only. Reports whether the DOJO_MODE env master is on (so the
 * panel can LOCK the toggle when it isn't), the mode, the current effective
 * state, and the names of settings live mode is missing. It never returns the
 * API key or any setting's value.
 */

import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import {
  dojoMode, isDojoEnabled, isDojoSandboxKey, getDojoAdminEnabled, isDojoEffectivelyEnabled, missingDojoSettings,
} from "@/lib/dojo";

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
    missingSettings: missingDojoSettings(), // e.g. ["DOJO_SOFTWARE_HOUSE_ID"]: card payments will fail
  });
}
