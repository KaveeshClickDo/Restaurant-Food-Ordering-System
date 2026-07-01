/**
 * GET /api/pos/orders/collection — active collection orders for the POS pickup
 * queue (CollectionView) — BOTH online and POS walk-in orders (the tab splits
 * them into All / Online / Walk-in). POS walk-in orders still go through the
 * kitchen (pending → ready) before they can be collected, same as online.
 *
 * Thin wrapper over the shared listCollectionOrders() helper (also used by the
 * standalone /collection surface, which stays online-only). Requires a POS or
 * admin session.
 */

import { NextResponse } from "next/server";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { listCollectionOrders } from "@/lib/collectionOrders";

export async function GET() {
  const [pos, admin] = await Promise.all([getPosSession(), isAdminAuthenticated()]);
  if (!pos && !admin) return unauthorizedJson();

  const result = await listCollectionOrders({ includePos: true });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, orders: result.orders });
}
