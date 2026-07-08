/**
 * GET /api/admin/pos-clock — POS attendance records for the admin panel.
 *
 * Feeds the Attendance & Wages tab on /admin?tab=pos-staff: clock entries for
 * any date range (not just today) plus the staff roster with hourly rates, so
 * the panel can compute per-staff hours and wages (hours × hourly_rate).
 *
 * Query params:
 *   • from    — ISO lower bound on clock_in (inclusive)
 *   • to      — ISO upper bound on clock_in (inclusive)
 *   • staffId — narrow to one staff member
 *   • limit   — page size (default 1000, max 5000)
 *
 * Admin authentication required. This is the "admin tree" counterpart of the
 * POS-side /api/pos/clock (which POS sessions use, scoped by permission).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const from    = searchParams.get("from");
  const to      = searchParams.get("to");
  const staffId = searchParams.get("staffId");
  const limit   = Math.min(Number(searchParams.get("limit") ?? 1000), 5000);

  let q = supabaseAdmin
    .from("pos_clock_entries")
    .select("id, staff_id, staff_name, clock_in, clock_out, total_minutes, notes")
    .order("clock_in", { ascending: false })
    .limit(limit);
  if (from)    q = q.gte("clock_in", from);
  if (to)      q = q.lte("clock_in", to);
  if (staffId) q = q.eq("staff_id", staffId);

  // Roster fetched alongside so the panel can join hourly_rate / avatar even
  // for staff with zero entries in the range (they still belong in the table).
  const [entriesRes, staffRes] = await Promise.all([
    q,
    supabaseAdmin
      .from("pos_staff")
      .select("id, name, role, active, hourly_rate, avatar_color")
      .order("name", { ascending: true }),
  ]);

  if (entriesRes.error) {
    console.error("GET /api/admin/pos-clock (entries):", entriesRes.error.message);
    return NextResponse.json({ ok: false, error: entriesRes.error.message }, { status: 500 });
  }
  if (staffRes.error) {
    console.error("GET /api/admin/pos-clock (staff):", staffRes.error.message);
    return NextResponse.json({ ok: false, error: staffRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    entries: (entriesRes.data ?? []).map((r) => ({
      id:           r.id,
      staffId:      r.staff_id,
      staffName:    r.staff_name,
      clockIn:      r.clock_in,
      clockOut:     r.clock_out ?? undefined,
      totalMinutes: r.total_minutes ?? undefined,
      notes:        r.notes ?? undefined,
    })),
    staff: (staffRes.data ?? []).map((s) => ({
      id:          s.id,
      name:        s.name,
      role:        s.role,
      active:      s.active,
      hourlyRate:  s.hourly_rate != null ? Number(s.hourly_rate) : undefined,
      avatarColor: s.avatar_color,
    })),
  });
}
