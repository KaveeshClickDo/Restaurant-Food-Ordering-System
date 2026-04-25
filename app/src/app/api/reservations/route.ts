/**
 * POST /api/reservations
 * Creates a new table reservation. Re-validates availability server-side to
 * prevent race conditions between the frontend availability check and the INSERT.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import type { DiningTable, ReservationSystem } from "@/types";
import { sendReservationEmailServer }          from "@/lib/emailServer";

function toMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export async function POST(req: NextRequest) {
  let body: {
    tableId?: string;
    date?: string;
    time?: string;
    partySize?: number;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    note?: string;
    source?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { tableId, date, time, partySize, customerName, customerEmail, customerPhone, note, source } = body;

  if (!tableId || !date || !time || !partySize || !customerName || !customerEmail) {
    return NextResponse.json(
      { ok: false, error: "tableId, date, time, partySize, customerName, and customerEmail are required." },
      { status: 400 },
    );
  }

  // Reject past slots — 5-minute buffer for slow submissions
  if (new Date(`${date}T${time}`).getTime() < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: "This time slot has already passed. Please select a future time." },
      { status: 400 },
    );
  }

  // Load settings to get table info + slot duration
  const { data: settingsRow } = await supabaseAdmin
    .from("app_settings").select("data").limit(1).single();

  const tables: DiningTable[]  = settingsRow?.data?.diningTables ?? [];
  const rs: ReservationSystem  = settingsRow?.data?.reservationSystem ?? {};
  const slotDuration: number   = rs.slotDurationMinutes ?? 90;

  const table = tables.find((t) => t.id === tableId && t.active);
  if (!table) {
    return NextResponse.json({ ok: false, error: "Table not found or inactive." }, { status: 400 });
  }
  if (table.seats < partySize) {
    return NextResponse.json({ ok: false, error: "Party size exceeds table capacity." }, { status: 400 });
  }

  // Re-check availability (race condition protection)
  const { data: conflicts, error: conflictErr } = await supabaseAdmin
    .from("reservations")
    .select("id, time, status")
    .eq("date", date)
    .eq("table_id", tableId)
    .in("status", ["pending", "confirmed", "checked_in"]);

  // If the table doesn't exist yet, surface a clear setup error rather than a generic 500
  if (conflictErr && (conflictErr.message?.includes("schema cache") || conflictErr.message?.includes("not found"))) {
    return NextResponse.json(
      { ok: false, error: "The reservations table has not been created in your database yet. Please run the reservations migration SQL in your Supabase SQL Editor." },
      { status: 503 },
    );
  }

  const requestedMins = toMins(time);
  const hasConflict = (conflicts ?? []).some((r) =>
    r.status === "checked_in" ||
    Math.abs(toMins(r.time as string) - requestedMins) < slotDuration
  );

  if (hasConflict) {
    return NextResponse.json(
      { ok: false, error: "This table is no longer available at the selected time. Please choose another slot." },
      { status: 409 },
    );
  }

  const id           = crypto.randomUUID();
  const cancel_token = crypto.randomUUID();
  const row = {
    id,
    table_id:       table.id,
    table_label:    table.label,
    table_seats:    table.seats,
    section:        table.section,
    customer_name:  customerName.trim(),
    customer_email: customerEmail.trim().toLowerCase(),
    customer_phone: customerPhone?.trim() ?? "",
    date,
    time,
    party_size:     partySize,
    status:         "pending",
    note:           note?.trim() ?? null,
    source:         source ?? "online",
    cancel_token,
    created_at:     new Date().toISOString(),
  };

  let insertedWithToken = true;
  let { error } = await supabaseAdmin.from("reservations").insert(row);

  // If cancel_token or source columns don't exist yet (migration not run), retry without them
  if (error && (error.message?.includes("cancel_token") || error.message?.includes("source"))) {
    insertedWithToken = false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cancel_token: _ct, source: _src, ...baseRow } = row;
    const { error: retryError } = await supabaseAdmin.from("reservations").insert(baseRow);
    error = retryError ?? null;
  }

  if (error) {
    console.error("reservations POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Build the origin from the request so the cancel link is absolute
  const origin = req.headers.get("origin") ?? req.nextUrl.origin;

  // Send confirmation email (fire-and-forget — does not block the response)
  sendReservationEmailServer("reservation_confirmation", {
    id,
    customer_name:  row.customer_name,
    customer_email: row.customer_email,
    customer_phone: row.customer_phone,
    date:           row.date,
    time:           row.time,
    table_label:    row.table_label,
    party_size:     row.party_size,
    status:         row.status,
    note:           row.note,
    section:        row.section,
    // Only include cancel_token in email if we successfully stored it
    cancel_token:   insertedWithToken ? cancel_token : undefined,
  }, settingsRow?.data ?? {}, origin).catch(console.error);

  return NextResponse.json({ ok: true, reservationId: id });
}
