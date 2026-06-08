/**
 * POST /api/pos/orders/[id]/settle
 * Takes payment for an online COLLECTION order at the POS counter and completes
 * the handover (paid + delivered + loyalty). Thin wrapper over the shared
 * settleCollectionOrder() helper (also used by the standalone /collection
 * surface). Requires a POS or admin session.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated }      from "@/lib/adminAuth";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { parseBody }                 from "@/lib/apiValidation";
import { PosCollectionSettleSchema } from "@/lib/schemas/pos";
import { settleCollectionOrder }     from "@/lib/collectionOrders";

async function isPosOrAdmin(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  return Boolean(await getPosSession());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isPosOrAdmin()) return unauthorizedJson();

  const { id } = await params;
  const parsed = await parseBody(req, PosCollectionSettleSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const result = await settleCollectionOrder(id, parsed.data.paymentMethod);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
