/**
 * PATCH /api/admin/pos-clock/[id] — close a forgotten open clock entry.
 *
 * Someone who never pressed Clock Out accrues unbounded hours and blocks
 * their next clock-in (the DB allows one open entry per staff member). Only
 * an admin can repair that, by closing the entry at a stated time:
 *
 *   body: { clockOut?: ISO }   — defaults to now; must be after clock_in
 *
 * The update is guarded on `clock_out is null`, so closing an entry twice
 * (or racing the staff member's own clock-out) is a no-op 409, never a
 * silently overwritten record — these rows feed payroll.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";

const CloseEntrySchema = z.object({
  clockOut: z.string().datetime({ offset: true }).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, CloseEntrySchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const { data: entry, error: lookupErr } = await supabaseAdmin
    .from("pos_clock_entries")
    .select("id, clock_in, clock_out, notes")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ ok: false, error: lookupErr.message }, { status: 500 });
  if (!entry)    return NextResponse.json({ ok: false, error: "Clock entry not found." }, { status: 404 });
  if (entry.clock_out) {
    return NextResponse.json({ ok: false, error: "Entry is already closed." }, { status: 409 });
  }

  const clockOut = parsed.data.clockOut ? new Date(parsed.data.clockOut) : new Date();
  const clockIn  = new Date(entry.clock_in);
  if (clockOut.getTime() <= clockIn.getTime()) {
    return NextResponse.json({ ok: false, error: "Clock-out must be after clock-in." }, { status: 400 });
  }

  const totalMinutes = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000);

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("pos_clock_entries")
    .update({
      clock_out:     clockOut.toISOString(),
      total_minutes: totalMinutes,
      // Append the audit marker instead of clobbering an existing note.
      notes:         entry.notes ? `${entry.notes} · Closed by admin` : "Closed by admin",
    })
    .eq("id", id)
    .is("clock_out", null)
    .select("id, staff_id, staff_name, clock_in, clock_out, total_minutes, notes")
    .maybeSingle();
  if (updErr)   return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: "Entry was already closed." }, { status: 409 });

  return NextResponse.json({
    ok: true,
    entry: {
      id:           updated.id,
      staffId:      updated.staff_id,
      staffName:    updated.staff_name,
      clockIn:      updated.clock_in,
      clockOut:     updated.clock_out,
      totalMinutes: updated.total_minutes,
      notes:        updated.notes ?? undefined,
    },
  });
}
