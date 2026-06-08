/**
 * POST /api/print
 *
 * Accepts a raw ESC/POS byte array and forwards it to an IP thermal printer
 * over a direct TCP socket (the standard "RAW" protocol used by Epson, Star,
 * Citizen, and most other thermal printers on port 9100).
 *
 * For operational staff (POS / kitchen / waiter). The admin Integrations panel
 * test-print uses its own /api/admin/print route — there is no admin bypass here.
 *
 * This must run in the Node.js runtime (not Edge) because the relay uses
 * `net.Socket`. Next.js App Router defaults to Node.js for API routes.
 */

import { NextResponse } from "next/server";
import {
  getPosSession,
  getKitchenSession,
  getWaiterSession,
  unauthorizedJson,
} from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { PrintSchema } from "@/lib/schemas/pos";
import { relayPrintJob } from "@/lib/printRelay";

async function isStaffAuthenticated(): Promise<boolean> {
  const [pos, kitchen, waiter] = await Promise.all([
    getPosSession(),
    getKitchenSession(),
    getWaiterSession(),
  ]);
  return Boolean(pos || kitchen || waiter);
}

export async function POST(request: Request) {
  if (!await isStaffAuthenticated()) return unauthorizedJson();

  const parsed = await parseBody(request, PrintSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { ip, port, bytes } = parsed.data;

  const result = await relayPrintJob(ip, port, bytes);
  return NextResponse.json(
    result.ok ? { ok: true } : { ok: false, error: result.error },
    { status: result.status },
  );
}
