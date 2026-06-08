/**
 * GET /api/waiter/reservations?date=YYYY-MM-DD
 * Returns the active reservations for a single day so the /waiter table grid can
 * show "reserved" / "next booking" awareness alongside live occupancy.
 *
 * Requires a waiter session (the POS reservation endpoints require a POS/admin
 * cookie, which waiters don't carry — hence this waiter-scoped read).
 *
 * Read-only and fail-safe: any DB problem (including a database that predates
 * the reservations table) returns an empty list rather than an error, so the
 * table grid never breaks because of the reservation overlay.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { requireWaiterAuth }         from "@/lib/waiterAuth";

// Only statuses that still "hold" a table are relevant to the floor. Cancelled /
// checked_out / no_show bookings are history and must not affect the grid.
const ACTIVE_STATUSES = ["pending", "confirmed", "checked_in"];

// Map DB snake_case → the camelCase shape the waiter UI reads.
function mapRow(row: Record<string, unknown>) {
  return {
    id:           row.id            as string,
    tableLabel:   row.table_label   as string,
    section:      (row.section as string | null) ?? "",
    customerName: row.customer_name as string,
    partySize:    Number(row.party_size ?? 0),
    date:         row.date          as string,
    time:         row.time          as string,
    status:       row.status        as string,
    note:         (row.note as string | null) ?? null,
    source:       (row.source as string | null) ?? null,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requireWaiterAuth();
  if (authError) return authError;

  // Client supplies its own local date so server/browser timezone differences
  // can't shift which day's bookings show up.
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "A valid ?date=YYYY-MM-DD is required." }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select("id, table_label, section, customer_name, party_size, date, time, status, note, source")
      .eq("date", date)
      .in("status", ACTIVE_STATUSES)
      .order("time", { ascending: true })
      .limit(500);

    // Table not migrated yet, or any other read error — degrade to "no
    // reservations" so the grid still renders normally.
    if (error) {
      console.warn("waiter/reservations GET (non-fatal):", error.message);
      return NextResponse.json({ ok: true, reservations: [] });
    }

    return NextResponse.json({
      ok: true,
      reservations: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.warn("[waiter/reservations]", message);
    return NextResponse.json({ ok: true, reservations: [] });
  }
}
