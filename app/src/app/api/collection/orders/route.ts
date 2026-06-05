/**
 * GET /api/collection/orders?view=active|history&period=today|7d|30d
 *   active  → online collection orders still in play (the pickup board)
 *   history → completed (delivered) pickups within the period
 *
 * Requires a collection-staff or admin session.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollectionSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { listCollectionOrders, periodToSinceISO } from "@/lib/collectionOrders";

export async function GET(req: NextRequest) {
  const [staff, admin] = await Promise.all([getCollectionSession(), isAdminAuthenticated()]);
  if (!staff && !admin) return unauthorizedJson();

  const { searchParams } = new URL(req.url);
  const history = searchParams.get("view") === "history";
  const sinceISO = history ? periodToSinceISO(searchParams.get("period")) : undefined;

  const result = await listCollectionOrders({ history, sinceISO });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, orders: result.orders });
}
