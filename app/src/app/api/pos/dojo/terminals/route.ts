/**
 * GET /api/pos/dojo/terminals — list Dojo card terminals for this account.
 *
 * Returns only Available terminals by default (?all=1 for every status). The POS
 * uses this to pick a machine (or confirm the pinned DOJO_TERMINAL_ID is free).
 * Namespaced under /dojo to avoid the existing /api/pos/terminals (the till/POS
 * device concept — unrelated to Dojo hardware).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { getDojoGateway } from "@/lib/dojo";
import { dojoErrorResponse } from "@/lib/dojo/respond";

export async function GET(req: NextRequest) {
  const session = await getAnyStaffSession();
  if (!session) return unauthorizedJson();

  const all = new URL(req.url).searchParams.get("all") === "1";
  try {
    const terminals = await getDojoGateway().listTerminals(!all);
    return NextResponse.json({
      ok: true,
      terminals: terminals.map((t) => ({ id: t.id, status: t.status, model: t.model ?? null })),
    });
  } catch (err) {
    return dojoErrorResponse(err);
  }
}
