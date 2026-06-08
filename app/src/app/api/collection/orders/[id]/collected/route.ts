/**
 * PUT /api/collection/orders/[id]/collected
 * Complete handover of an already-paid online collection order (ready →
 * delivered, no payment). Requires a collection-staff or admin session.
 * Delegates to the shared markCollectionCollected() helper.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollectionSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { markCollectionCollected } from "@/lib/collectionOrders";

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [staff, admin] = await Promise.all([getCollectionSession(), isAdminAuthenticated()]);
  if (!staff && !admin) return unauthorizedJson();

  const { id } = await params;
  const result = await markCollectionCollected(id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
