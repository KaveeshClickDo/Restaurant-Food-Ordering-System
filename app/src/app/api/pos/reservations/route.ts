/**
 * POST /api/pos/reservations
 * Creates a walk-in or phone reservation from the POS terminal.
 * Skips the availability check — staff can see the room.
 * No admin cookie required; POS is an internal staff terminal.
 */

import { NextRequest, NextResponse }  from "next/server";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { sendReservationEmailServer } from "@/lib/emailServer";

export async function POST(req: NextRequest) {
  let body: {
    tableId?: string; tableLabel?: string; tableSeats?: number; section?: string;
    date?: string; time?: string; partySize?: number;
    customerName?: string; customerEmail?: string; customerPhone?: string;
    note?: string; source?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const {
    tableId, tableLabel, tableSeats, section,
    date, time, partySize, customerName, customerEmail, customerPhone,
    note, source = "walk-in",
  } = body;

  if (!tableId || !tableLabel || !date || !time || !partySize || !customerName) {
    return NextResponse.json(
      { ok: false, error: "tableId, tableLabel, date, time, partySize and customerName are required." },
      { status: 400 },
    );
  }

  const id           = crypto.randomUUID();
  const cancel_token = crypto.randomUUID();
  const now          = new Date().toISOString();
  const isWalkIn     = source === "walk-in";

  const row: Record<string, unknown> = {
    id,
    table_id:       tableId,
    table_label:    tableLabel,
    table_seats:    tableSeats ?? 0,
    section:        section ?? "",
    customer_name:  customerName.trim(),
    customer_email: customerEmail?.trim().toLowerCase() ?? "",
    customer_phone: customerPhone?.trim() ?? "",
    date,
    time,
    party_size:     partySize,
    status:         isWalkIn ? "checked_in" : "pending",
    note:           note?.trim() ?? null,
    source,
    created_at:     now,
  };

  // Walk-ins are already here — mark the time immediately
  if (isWalkIn) row.checked_in_at = now;

  // Try with cancel_token; fall back gracefully if column not yet migrated
  let { error } = await supabaseAdmin.from("reservations").insert({ ...row, cancel_token });
  if (error?.message?.includes("cancel_token") || error?.message?.includes("source")) {
    const { error: retry } = await supabaseAdmin.from("reservations").insert(row);
    error = retry ?? null;
  }
  if (error) {
    console.error("pos/reservations POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Upsert guest profile when email is provided
  const email = customerEmail?.trim().toLowerCase();
  if (email) {
    const { data: existing } = await supabaseAdmin
      .from("reservation_customers").select("id, first_visit_at").eq("email", email).single();
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

  // Confirmation email for phone bookings (walk-ins are already present)
  if (source === "phone" && email) {
    const { data: settingsRow } = await supabaseAdmin.from("app_settings").select("data").limit(1).single();
    if (settingsRow?.data) {
      sendReservationEmailServer("reservation_confirmation", {
        id, customer_name: customerName.trim(),
        customer_email: email,
        customer_phone: customerPhone?.trim() ?? "",
        date, time, table_label: tableLabel,
        party_size: partySize, status: "pending",
        note: note ?? null, section: section ?? "", cancel_token,
      }, settingsRow.data, req.headers.get("origin") ?? req.nextUrl.origin).catch(console.error);
    }
  }

  return NextResponse.json({ ok: true, reservationId: id });
}
