/**
 * /api/pos/clock — POS staff clock-in / clock-out.
 *
 *   GET  /api/pos/clock?staffId=&from=ISO&to=ISO    list entries
 *   POST /api/pos/clock                              { action, staffId, staffName }
 *
 * `action` is "in" or "out". The partial unique index
 * `uniq_pos_clock_open (staff_id) where clock_out is null` enforces
 * "at most one open entry per staff member" at the database level — a
 * second clock-in for someone already clocked-in is rejected by Postgres,
 * not application logic.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { getPosSession }             from "@/lib/auth";
import type { POSClockEntry }        from "@/types/pos";
import { parseBody }                 from "@/lib/apiValidation";
import { PosClockSchema }            from "@/lib/schemas/pos";

// ── snake_case row → POSClockEntry ──────────────────────────────────────────
type ClockRow = {
  id:            string;
  staff_id:      string;
  staff_name:    string;
  clock_in:      string;
  clock_out:     string | null;
  total_minutes: number | null;
  notes:         string | null;
};

function rowToEntry(r: ClockRow): POSClockEntry {
  return {
    id:           r.id,
    staffId:      r.staff_id,
    staffName:    r.staff_name,
    clockIn:      r.clock_in,
    clockOut:     r.clock_out ?? undefined,
    totalMinutes: r.total_minutes ?? undefined,
    notes:        r.notes ?? undefined,
  };
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getPosSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const staffId = searchParams.get("staffId");
  const from    = searchParams.get("from");
  const to      = searchParams.get("to");
  const limit   = Math.min(Number(searchParams.get("limit") ?? 500), 2000);

  let q = supabaseAdmin
    .from("pos_clock_entries")
    .select("*")
    .order("clock_in", { ascending: false })
    .limit(limit);

  if (staffId) q = q.eq("staff_id", staffId);
  if (from)    q = q.gte("clock_in", from);
  if (to)      q = q.lte("clock_in", to);

  const { data, error } = await q;
  if (error) {
    console.error("GET /api/pos/clock:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, entries: (data ?? []).map(rowToEntry) });
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getPosSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseBody(req, PosClockSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  if (body.action === "in") {
    const { data, error } = await supabaseAdmin
      .from("pos_clock_entries")
      .insert({
        staff_id:   body.staffId,
        staff_name: body.staffName,
        notes:      body.notes ?? null,
      })
      .select("*")
      .single();

    if (error) {
      // 23505 = unique-violation. The partial index uniq_pos_clock_open trips
      // when the staff member is already clocked in.
      if (error.code === "23505") {
        return NextResponse.json({ ok: false, error: "Already clocked in." }, { status: 409 });
      }
      console.error("POST /api/pos/clock (in):", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, entry: rowToEntry(data) });
  }

  if (body.action === "out") {
    // Find the open entry. supabase-js doesn't expose RETURNING with custom
    // SQL, so we look it up, compute total_minutes, then UPDATE … RETURNING.
    const { data: open, error: lookupErr } = await supabaseAdmin
      .from("pos_clock_entries")
      .select("id, clock_in")
      .eq("staff_id", body.staffId)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error("POST /api/pos/clock (out lookup):", lookupErr.message);
      return NextResponse.json({ ok: false, error: lookupErr.message }, { status: 500 });
    }
    if (!open) {
      return NextResponse.json({ ok: false, error: "No open clock-in to close." }, { status: 404 });
    }

    const clockOut     = new Date();
    const totalMinutes = Math.floor((clockOut.getTime() - new Date(open.clock_in).getTime()) / 60000);

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("pos_clock_entries")
      .update({
        clock_out:     clockOut.toISOString(),
        total_minutes: totalMinutes,
      })
      .eq("id", open.id)
      .select("*")
      .single();

    if (updErr) {
      console.error("POST /api/pos/clock (out update):", updErr.message);
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, entry: rowToEntry(updated) });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
