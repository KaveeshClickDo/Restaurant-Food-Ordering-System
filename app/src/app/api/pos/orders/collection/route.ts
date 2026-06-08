/**
 * GET /api/pos/orders/collection — active online collection orders for the
 * POS pickup queue (CollectionView).
 *
 * Thin wrapper over the shared listCollectionOrders() helper (also used by the
 * standalone /collection surface). Requires a POS or admin session.
 */

import { NextResponse } from "next/server";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { listCollectionOrders } from "@/lib/collectionOrders";

export async function GET() {
  const [pos, admin] = await Promise.all([getPosSession(), isAdminAuthenticated()]);
  if (!pos && !admin) return unauthorizedJson();

  const result = await listCollectionOrders();
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, orders: result.orders });
}
