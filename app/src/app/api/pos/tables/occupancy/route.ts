/**
 * GET /api/pos/tables/occupancy
 * Returns the table ids that are physically occupied right now by an active
 * dine-in order (a party the waiter has seated and started ordering for).
 *
 * The POS / admin Table-Status dashboards already derive "occupied" from
 * checked-in reservations; this lets them ALSO show tables occupied by a
 * walk-in order that has no reservation row — so all the staff surfaces agree
 * on what "occupied" means.
 *
 * Requires a POS session. The admin Table Status panel uses its own
 * /api/admin/table-occupancy route (admin session). Read-only and fail-safe: an
 * error returns an empty list so the dashboards still render.
 */

import { NextResponse }                    from "next/server";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { getActiveDineInTableIds }         from "@/lib/tableOccupancy";

export async function GET() {
  const pos = await getPosSession();
  if (!pos) return unauthorizedJson();

  try {
    const ids = await getActiveDineInTableIds();
    return NextResponse.json({ ok: true, occupiedTableIds: Array.from(ids) });
  } catch {
    return NextResponse.json({ ok: true, occupiedTableIds: [] });
  }
}
