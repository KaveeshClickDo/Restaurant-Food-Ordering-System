/**
 * POST /api/admin/print
 *
 * Admin-only thermal-printer relay — the admin-session equivalent of /api/print
 * (which is for POS / kitchen / waiter). Used by the admin Integrations panel's
 * "Test print" action. Shares the allowlist + TCP send logic in lib/printRelay.
 *
 * Node.js runtime only (the relay uses `net.Socket`).
 */

import { NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { PrintSchema } from "@/lib/schemas/pos";
import { relayPrintJob } from "@/lib/printRelay";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(request, PrintSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { ip, port, bytes } = parsed.data;

  const result = await relayPrintJob(ip, port, bytes);
  return NextResponse.json(
    result.ok ? { ok: true } : { ok: false, error: result.error },
    { status: result.status },
  );
}
