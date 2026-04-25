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
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { tableId, date, time, partySize, customerName, customerEmail, customerPhone, note } = body;

  if (!tableId || !date || !time || !partySize || !customerName || !customerEmail) {
    return NextResponse.json(
      { ok: false, error: "tableId, date, time, partySize, customerName, and customerEmail are required." },
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
    .select("id, time")
    .eq("date", date)
    .eq("table_id", tableId)
    .in("status", ["pending", "confirmed"]);

  // If the table doesn't exist yet, surface a clear setup error rather than a generic 500
  if (conflictErr && (conflictErr.message?.includes("schema cache") || conflictErr.message?.includes("not found"))) {
    return NextResponse.json(
      { ok: false, error: "The reservations table has not been created in your database yet. Please run the reservations migration SQL in your Supabase SQL Editor." },
      { status: 503 },
    );
  }

  const requestedMins = toMins(time);
  const hasConflict = (conflicts ?? []).some(
    (r) => Math.abs(toMins(r.time as string) - requestedMins) < slotDuration
  );

  if (hasConflict) {
    return NextResponse.json(
      { ok: false, error: "This table is no longer available at the selected time. Please choose another slot." },
      { status: 409 },
    );
  }

  const id = crypto.randomUUID();
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
    created_at:     new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("reservations").insert(row);
  if (error) {
    console.error("reservations POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

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
  }, settingsRow?.data ?? {}).catch(console.error);

  return NextResponse.json({ ok: true, reservationId: id });
}
