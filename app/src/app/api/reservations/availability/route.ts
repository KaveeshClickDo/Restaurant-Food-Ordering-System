/**
 * GET /api/reservations/availability?date=YYYY-MM-DD&time=HH:MM&partySize=N
 *
 * Returns the list of active dining tables that are available at the requested
 * date + time for the given party size. A table is considered unavailable if it
 * has a confirmed or pending reservation whose time window overlaps the requested
 * slot (overlap = |t_existing - t_requested| < slotDurationMinutes).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import type { DiningTable, ReservationSystem } from "@/types";

function toMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const date      = searchParams.get("date")      ?? "";
  const time      = searchParams.get("time")      ?? "";
  const partySize = parseInt(searchParams.get("partySize") ?? "0", 10);

  if (!date || !time || !partySize) {
    return NextResponse.json({ ok: false, error: "date, time, and partySize are required." }, { status: 400 });
  }

  // Reject slots in the past. Constructing without "Z" so JS treats it as local server time.
  // Allow a 5-minute buffer for slow form submissions.
  const slotMs = new Date(`${date}T${time}`).getTime();
  if (slotMs < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: "This time slot has already passed. Please select a future time." },
      { status: 400 },
    );
  }

  // Load tables + reservation settings from app_settings
  const { data: settingsRow } = await supabaseAdmin
    .from("app_settings").select("data").limit(1).single();

  const tables: DiningTable[]      = settingsRow?.data?.diningTables ?? [];
  const rs: ReservationSystem      = settingsRow?.data?.reservationSystem ?? {};
  const slotDuration: number       = rs.slotDurationMinutes ?? 90;
  const maxPartySize: number       = rs.maxPartySize ?? 20;
  const blackoutDates: string[]    = rs.blackoutDates ?? [];

  // Reject if the date is blacked out
  if (blackoutDates.includes(date)) {
    return NextResponse.json({ ok: true, availableTables: [], blackout: true });
  }

  // Reject if party size exceeds restaurant maximum
  if (partySize > maxPartySize) {
    return NextResponse.json(
      { ok: false, error: `Maximum party size is ${maxPartySize}. Please call us for larger groups.` },
      { status: 400 },
    );
  }

  // Only tables that are active and can seat the party
  const eligibleTables = tables.filter(
    (t) => t.active && t.seats >= partySize
  );

  if (eligibleTables.length === 0) {
    return NextResponse.json({ ok: true, availableTables: [] });
  }

  // Fetch all active reservations for this date (pending, confirmed, or currently occupied)
  const { data: existing, error } = await supabaseAdmin
    .from("reservations")
    .select("table_id, time, status")
    .eq("date", date)
    .in("status", ["pending", "confirmed", "checked_in"]);

  if (error) {
    // Table not yet created — treat as zero existing reservations so all eligible
    // tables show as available. The POST route will surface the setup error clearly.
    if (error.message?.includes("schema cache") || error.message?.includes("not found")) {
      const allAvailable = eligibleTables.map(({ id, label, seats, section }) => ({ id, label, seats, section }));
      return NextResponse.json({ ok: true, availableTables: allAvailable });
    }
    console.error("reservations/availability GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const requestedMins = toMins(time);

  // Build set of table IDs that are unavailable:
  // - checked_in tables are physically occupied — blocked regardless of time window
  // - pending/confirmed reservations within the slot duration window are blocked
  const bookedTableIds = new Set<string>();
  for (const r of existing ?? []) {
    if (r.status === "checked_in") {
      bookedTableIds.add(r.table_id as string);
    } else {
      const existingMins = toMins(r.time as string);
      if (Math.abs(existingMins - requestedMins) < slotDuration) {
        bookedTableIds.add(r.table_id as string);
      }
    }
  }

  const availableTables = eligibleTables
    .filter((t) => !bookedTableIds.has(t.id))
    .map(({ id, label, seats, section }) => ({ id, label, seats, section }));

  return NextResponse.json({ ok: true, availableTables });
}
