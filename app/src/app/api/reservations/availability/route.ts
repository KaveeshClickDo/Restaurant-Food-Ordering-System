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
import { getOrderOccupiedTableIds, getActiveDineInTableIds } from "@/lib/tableOccupancy";
import { resolveFloorPlans } from "@/lib/floorPlans";

function toMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// DB rows are snake_case; the booking UI consumes camelCase. Carry the VIP
// fields through so the modal can show the crown + booking fee, and the floor-
// plan coordinates so the booking page can render the interactive table map.
type TableRow = DiningTable & { is_vip?: boolean; vip_price?: number; pos_x?: number | null; pos_y?: number | null; floor_plan_id?: string | null };
function toPublicTable(t: TableRow, defaultFloorId: string | null = null) {
  return {
    id:       t.id,
    label:    t.label,
    seats:    t.seats,
    section:  t.section,
    isVip:    t.is_vip ?? false,
    vipPrice: Number(t.vip_price ?? 0),
    posX:     t.pos_x ?? null,
    posY:     t.pos_y ?? null,
    // Tables placed before multi-floor support carry no floor id — they belong
    // to the first configured floor plan (resolved here so the client need not).
    floorId:  t.floor_plan_id ?? defaultFloorId,
  };
}

// Map status for a placed table: bookable now, taken for this slot, or simply
// too small for the requested party. The booking-page map colours each marker
// by this and only lets the guest pick an "available" one.
type MapStatus = "available" | "booked" | "too_small";
function toMapTable(t: TableRow, status: MapStatus, defaultFloorId: string | null) {
  return { ...toPublicTable(t, defaultFloorId), status };
}
// Every active table that has been placed on the floor plan, regardless of
// whether it fits the party — so the rendered map matches the real room.
function placedTables(tables: TableRow[]): TableRow[] {
  return tables.filter((t) => t.active && t.pos_x != null && t.pos_y != null);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const date      = searchParams.get("date")      ?? "";
  const time      = searchParams.get("time")      ?? "";
  const partySize = parseInt(searchParams.get("partySize") ?? "0", 10);
  // Walk-ins are seated at the *current in-progress slot*, which is a few minutes
  // in the past by design. allowPast=1 tells us this is a "seat now" query so we
  // (a) skip the past-slot guard and (b) judge occupancy by who's physically at
  // the table right now, rather than by the booking time window.
  const allowPast = searchParams.get("allowPast") === "1";

  if (!date || !time || !partySize) {
    return NextResponse.json({ ok: false, error: "date, time, and partySize are required." }, { status: 400 });
  }

  // Reject slots in the past. Constructing without "Z" so JS treats it as local server time.
  // Allow a 5-minute buffer for slow form submissions. Skipped for seat-now (walk-in) queries.
  const slotMs = new Date(`${date}T${time}`).getTime();
  if (!allowPast && slotMs < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: "This time slot has already passed. Please select a future time." },
      { status: 400 },
    );
  }

  // Load reservation settings from app_settings, dining tables from their own table
  const [{ data: settingsRow }, { data: tableRows }] = await Promise.all([
    supabaseAdmin.from("app_settings").select("data").limit(1).single(),
    supabaseAdmin
      .from("dining_tables")
      .select("id, label, number, seats, section, active, sort_order, is_vip, vip_price, pos_x, pos_y, floor_plan_id")
      .order("sort_order", { ascending: true }),
  ]);

  const tables: TableRow[]         = (tableRows ?? []) as TableRow[];
  const rs: ReservationSystem      = settingsRow?.data?.reservationSystem ?? {};
  // First configured floor plan — the home of legacy placed tables (null floor id).
  const defaultFloorId: string | null = resolveFloorPlans(rs)[0]?.id ?? null;
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
      const allAvailable = eligibleTables.map((t) => toPublicTable(t, defaultFloorId));
      // No reservations table yet → nothing is booked; placed tables are
      // available unless they're physically too small for the party.
      const mapTables = placedTables(tables).map((t) =>
        toMapTable(t, t.seats < partySize ? "too_small" : "available", defaultFloorId),
      );
      return NextResponse.json({ ok: true, availableTables: allAvailable, bookedTableIds: [], mapTables });
    }
    console.error("reservations/availability GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const requestedMins = toMins(time);

  // bookedTableIds = physically unavailable (hard block).
  // upcomingByTable = tableId → earliest upcoming booking time today within the
  //   window. Seat-now only: a soft "booked at X" heads-up the staff can override.
  const bookedTableIds = new Set<string>();
  const upcomingByTable: Record<string, string> = {};
  for (const r of existing ?? []) {
    const rTime = r.time as string;
    if (allowPast) {
      // Seat-now (walk-in): only a guest physically present blocks the table.
      // A checked-out / cancelled booking isn't in this list, so it frees up.
      if (r.status === "checked_in") { bookedTableIds.add(r.table_id as string); continue; }
      // An upcoming booking does NOT block a walk-in — record it as a warning so
      // the staff can decide whether to seat the table anyway.
      if (Math.abs(toMins(rTime) - requestedMins) < slotDuration) {
        const id = r.table_id as string;
        if (!upcomingByTable[id] || rTime < upcomingByTable[id]) upcomingByTable[id] = rTime;
      }
      continue;
    }
    // Future booking: every status blocks only its own sitting window, so a
    // checked-in guest's table can still be booked for a *later* sitting today.
    if (Math.abs(toMins(rTime) - requestedMins) < slotDuration) {
      bookedTableIds.add(r.table_id as string);
    }
  }

  // Tables physically occupied by an active dine-in order (a seated walk-in with
  // no reservation row). Best-effort — degrades to "no extra blocks" on error so
  // a booking is never blocked by an infrastructure hiccup.
  if (allowPast) {
    // Seat-now: any active dine-in order means the table is taken right now,
    // regardless of when the order started (long meals stay blocked).
    const live = await getActiveDineInTableIds();
    for (const id of live) bookedTableIds.add(id);
  } else {
    // Future slot: block only when the order's sitting window overlaps the slot.
    const tablesByLabel = new Map<string, string>(tables.map((t) => [t.label, t.id]));
    const orderOccupancy = await getOrderOccupiedTableIds({
      date, requestedMins, slotDurationMinutes: slotDuration,
      slotIntervalMinutes: rs.slotIntervalMinutes, openTime: rs.openTime, tablesByLabel,
    });
    for (const id of orderOccupancy.ids) bookedTableIds.add(id);
  }

  const availableTables = eligibleTables
    .filter((t) => !bookedTableIds.has(t.id))
    .map((t) => toPublicTable(t, defaultFloorId));

  // Floor-plan map: every placed active table with a per-slot status. A table
  // too small for the party is "too_small"; one taken for this slot is "booked";
  // the rest are "available" (and selectable in the map UI).
  const mapTables = placedTables(tables).map((t) => {
    const status: MapStatus =
      t.seats < partySize        ? "too_small"
      : bookedTableIds.has(t.id) ? "booked"
      :                            "available";
    return toMapTable(t, status, defaultFloorId);
  });

  return NextResponse.json({
    ok: true,
    availableTables,
    mapTables,
    bookedTableIds: Array.from(bookedTableIds),
    // Seat-now only: tables that are free to use but booked again soon, so the
    // picker can warn ("booked 6:00") and let staff decide.
    upcomingByTable,
  });
}
