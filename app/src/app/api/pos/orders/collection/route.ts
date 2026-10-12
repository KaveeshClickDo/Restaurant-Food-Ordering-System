/**
 * GET /api/pos/orders/collection?view=active|history&period=today|7d|30d
 *   active (default) — live pickups, online + POS walk-in (All/Online/Walk-in tabs).
 *   history — completed online pickups only, for the Online scope's History tab.
 *
 * Thin wrapper over the shared listCollectionOrders() helper (also used by the
 * standalone /collection surface). Requires a POS or admin session.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { listCollectionOrders, periodToSinceISO } from "@/lib/collectionOrders";

export async function GET(req: NextRequest) {
  const [pos, admin] = await Promise.all([getPosSession(), isAdminAuthenticated()]);
  if (!pos && !admin) return unauthorizedJson();

  const { searchParams } = new URL(req.url);
  const history = searchParams.get("view") === "history";
  const sinceISO = history ? periodToSinceISO(searchParams.get("period")) : undefined;

  const result = await listCollectionOrders({ includePos: !history, history, sinceISO });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, orders: result.orders });
}
