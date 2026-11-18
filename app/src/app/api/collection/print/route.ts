/**
 * POST /api/collection/print
 *
 * Thermal-printer relay for the standalone /collection surface — the
 * collection-staff equivalent of /api/print (POS / kitchen / waiter) and
 * /api/admin/print (admin). Used to print a receipt after taking payment.
 * Requires a collection-staff or admin session. Shares the allowlist + TCP send
 * logic in lib/printRelay.
 *
 * Node.js runtime only (the relay uses `net.Socket`).
 */

import { NextResponse } from "next/server";
import { getCollectionSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { PrintSchema } from "@/lib/schemas/pos";
import { relayPrintJob } from "@/lib/printRelay";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const [staff, admin] = await Promise.all([getCollectionSession(), isAdminAuthenticated()]);
  if (!staff && !admin) return unauthorizedJson();

  const parsed = await parseBody(request, PrintSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { ip, port, bytes } = parsed.data;

  const result = await relayPrintJob(ip, port, bytes);
  return NextResponse.json(
    result.ok ? { ok: true } : { ok: false, error: result.error },
    { status: result.status },
  );
}