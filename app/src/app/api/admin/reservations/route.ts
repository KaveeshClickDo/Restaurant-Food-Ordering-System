/**
 * GET  /api/admin/reservations  — list reservations (filtered)
 * POST /api/admin/reservations  — create walk-in or phone reservation.
 *
 * Validation matches the POS path: looks up the table server-side, hard-blocks
 * double-booking at the same time, rejects blackout/past dates and oversized
 * parties. Capacity is intentionally not enforced — admins can pull chairs.
 * Both require admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { sendReservationEmailServer }           from "@/lib/emailServer";
import type { Reservation, DiningTable, ReservationSystem } from "@/types";
import { parseBody }                            from "@/lib/apiValidation";
import { ReservationAdminSchema }               from "@/lib/schemas/reservation";

function toMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function mapRow(row: Record<string, unknown>): Reservation {
  return {
    id:            row.id            as string,
    tableId:       row.table_id      as string,
    tableLabel:    row.table_label   as string,
    tableSeats:    row.table_seats   as number,
    section:       row.section       as string,
    customerName:  row.customer_name  as string,
    customerEmail: row.customer_email as string,
    customerPhone: row.customer_phone as string,
    date:          row.date          as string,
    time:          row.time          as string,
    partySize:     row.party_size    as number,
    status:        row.status        as Reservation["status"],
    note:          row.note          as string | undefined,
    createdAt:     row.created_at    as string,
    checkedInAt:   row.checked_in_at  as string | undefined,
    checkedOutAt:  row.checked_out_at as string | undefined,
    source:        row.source         as string | undefined,
    cancelToken:   row.cancel_token   as string | undefined,
  };
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { searchParams } = req.nextUrl;
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");
  const status = searchParams.get("status");

  let query = supabaseAdmin
    .from("reservations")
    .select("*")
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (from)   query = query.gte("date", from);
  if (to)     query = query.lte("date", to);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error("admin/reservations GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const reservations = (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
  return NextResponse.json({ ok: true, reservations });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, ReservationAdminSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const {
    tableId, date, time, partySize, customerName, customerEmail, customerPhone,
    note, source,
  } = parsed.data;

  // Reject past slots — 5 min grace for slow submissions
  if (new Date(`${date}T${time}`).getTime() < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: "This time slot has already passed. Please select a future time." },
      { status: 400 },
    );
  }

  // Load settings + verify the table exists. Use server-side table data for
  // label/seats/section — never trust client values.
  const [{ data: settingsRow }, { data: tableRow }] = await Promise.all([
    supabaseAdmin.from("app_settings").select("data").limit(1).single(),
    supabaseAdmin
      .from("dining_tables")
      .select("id, label, seats, section, active")
      .eq("id", tableId)
      .maybeSingle(),
  ]);

  const rs: ReservationSystem = settingsRow?.data?.reservationSystem ?? {} as ReservationSystem;
  const slotDuration: number  = rs.slotDurationMinutes ?? 90;
  const maxPartySize: number  = rs.maxPartySize ?? 20;
  const blackoutDates: string[] = rs.blackoutDates ?? [];

  const table = tableRow && tableRow.active ? (tableRow as DiningTable) : null;
  if (!table) {
    return NextResponse.json({ ok: false, error: "Table not found or inactive." }, { status: 400 });
  }
  if (partySize > maxPartySize) {
    return NextResponse.json(
      { ok: false, error: `Party size exceeds the restaurant maximum of ${maxPartySize}.` },
      { status: 400 },
    );
  }
  if (blackoutDates.includes(date)) {
    return NextResponse.json(
      { ok: false, error: "Restaurant is closed on this date (blackout). Remove the blackout in Settings or pick another date." },
      { status: 400 },
    );
  }

  // Hard-block double booking. Mirrors the POS conflict check — checked_in
  // tables are always blocked, others only if their time window overlaps.
  const { data: conflicts, error: conflictErr } = await supabaseAdmin
    .from("reservations")
    .select("id, time, status")
    .eq("date", date)
    .eq("table_id", tableId)
    .in("status", ["pending", "confirmed", "checked_in"]);

  if (conflictErr && !conflictErr.message?.includes("schema cache") && !conflictErr.message?.includes("not found")) {
    console.error("admin/reservations conflict check:", conflictErr.message);
    return NextResponse.json({ ok: false, error: conflictErr.message }, { status: 500 });
  }

  const requestedMins = toMins(time);
  const hasConflict = (conflicts ?? []).some((r) =>
    r.status === "checked_in" ||
    Math.abs(toMins(r.time as string) - requestedMins) < slotDuration
  );
  if (hasConflict) {
    return NextResponse.json(
      { ok: false, error: "This table is already reserved at the selected time. Please choose a different table or time." },
      { status: 409 },
    );
  }

  const id           = crypto.randomUUID();
  const cancel_token = crypto.randomUUID();
  const now          = new Date().toISOString();
  // Walk-ins are physically present → checked_in immediately. Phone bookings → pending.
  const status       = source === "walk-in" ? "checked_in" : "pending";

  const row: Record<string, unknown> = {
    id,
    table_id:       table.id,
    table_label:    table.label,
    table_seats:    table.seats,
    section:        table.section ?? "",
    customer_name:  customerName.trim(),
    customer_email: customerEmail?.trim().toLowerCase() ?? "",
    customer_phone: customerPhone?.trim() ?? "",
    date,
    time,
    party_size:     partySize,
    status,
    note:           note?.trim() ?? null,
    source,
    cancel_token,
    created_at:     now,
  };
  if (status === "checked_in") row.checked_in_at = now;

  const { error } = await supabaseAdmin.from("reservations").insert(row);
  if (error) {
    console.error("admin/reservations POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Upsert guest profile when email is provided
  const email = customerEmail?.trim().toLowerCase();
  if (email) {
    const { data: existing } = await supabaseAdmin
      .from("reservation_customers")
      .select("id, first_visit_at")
      .eq("email", email)
      .single();

    if (existing) {
      await supabaseAdmin.from("reservation_customers").update({
        name: customerName.trim(), phone: customerPhone?.trim() ?? "",
        updated_at: now,
        ...(existing.first_visit_at ? {} : { first_visit_at: now }),
      }).eq("email", email);
    } else {
      await supabaseAdmin.from("reservation_customers").insert({
        email, name: customerName.trim(), phone: customerPhone?.trim() ?? "",
        visit_count: 0, first_visit_at: now, created_at: now, updated_at: now,
      });
    }
  }

  // Confirmation email for phone bookings (walk-ins are already here)
  if (source === "phone" && email && settingsRow?.data) {
    sendReservationEmailServer("reservation_confirmation", {
      id, customer_name: customerName.trim(),
      customer_email: email,
      customer_phone: customerPhone?.trim() ?? "",
      date, time, table_label: table.label,
      party_size: partySize, status, note: note ?? null,
      section: table.section ?? "", cancel_token,
    }, settingsRow.data, req.headers.get("origin") ?? req.nextUrl.origin).catch(console.error);
  }

  return NextResponse.json({ ok: true, reservationId: id });
}
