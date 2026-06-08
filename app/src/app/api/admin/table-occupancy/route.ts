/**
 * GET /api/admin/table-occupancy
 * Admin-only equivalent of /api/pos/tables/occupancy: the table ids physically
 * occupied right now by an active dine-in order. Used by the admin Table Status
 * panel so it reads an admin route rather than the POS one (no cross-surface
 * bypass). Read-only and fail-safe — errors return an empty list.
 */

import { NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { getActiveDineInTableIds } from "@/lib/tableOccupancy";

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  try {
    const ids = await getActiveDineInTableIds();
    return NextResponse.json({ ok: true, occupiedTableIds: Array.from(ids) });
  } catch {
    return NextResponse.json({ ok: true, occupiedTableIds: [] });
  }
}
