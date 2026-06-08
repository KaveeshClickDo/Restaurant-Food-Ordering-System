/**
 * POST /api/collection/orders/[id]/settle
 * Take payment for an unpaid, ready online collection order (paid + delivered +
 * loyalty). Requires a collection-staff or admin session. Delegates to the
 * shared settleCollectionOrder() helper.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollectionSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { PosCollectionSettleSchema } from "@/lib/schemas/pos";
import { settleCollectionOrder } from "@/lib/collectionOrders";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [staff, admin] = await Promise.all([getCollectionSession(), isAdminAuthenticated()]);
  if (!staff && !admin) return unauthorizedJson();

  const { id } = await params;
  const parsed = await parseBody(req, PosCollectionSettleSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const result = await settleCollectionOrder(id, parsed.data.paymentMethod);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
