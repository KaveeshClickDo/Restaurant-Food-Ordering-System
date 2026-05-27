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
 * Requires a POS or admin session. Read-only and fail-safe: an error returns an
 * empty list so the dashboards still render.
 */

import { NextResponse }                    from "next/server";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated }            from "@/lib/adminAuth";
import { getActiveDineInTableIds }         from "@/lib/tableOccupancy";

export async function GET() {
  const [pos, admin] = await Promise.all([getPosSession(), isAdminAuthenticated()]);
  if (!pos && !admin) return unauthorizedJson();

  try {
    const ids = await getActiveDineInTableIds();
    return NextResponse.json({ ok: true, occupiedTableIds: Array.from(ids) });
  } catch {
    return NextResponse.json({ ok: true, occupiedTableIds: [] });
  }
}
