/**
 * POST /api/pos/reservations
 * Creates a walk-in or phone reservation from the POS terminal.
 * Hard-blocks double-booking (table conflict at same time); allows capacity
 * overrides since staff can pull extra chairs or merge tables.
 * Requires a POS or admin session.
 */

import { NextRequest, NextResponse }  from "next/server";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { sendReservationEmailServer } from "@/lib/emailServer";
import { isAdminAuthenticated }       from "@/lib/adminAuth";
import { getPosSession, unauthorizedJson } from "@/lib/auth";

function toMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export async function POST(req: NextRequest) {
  const [pos, admin] = await Promise.all([getPosSession(), isAdminAuthenticated()]);
  if (!pos && !admin) return unauthorizedJson();

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
  // Phone bookings always need a callback number — staff must be able to
  // reach the guest. UI also enforces this; this is the server-side gate.
  if (source === "phone" && !customerPhone?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Phone number is required for phone bookings." },
      { status: 400 },
    );
  }

  // Load settings once — used for both conflict detection (slot duration) and
  // the phone-booking confirmation email further down.
  const { data: settingsRow } = await supabaseAdmin
    .from("app_settings").select("data").limit(1).single();
  const slotDuration: number = settingsRow?.data?.reservationSystem?.slotDurationMinutes ?? 90;

  // Hard-block double booking. The UI also disables booked tables, but a stale
  // client or a concurrent booking can still hit this — reject with 409 so the
  // staff member sees a clear message and picks a different table.
  // Capacity is intentionally NOT enforced here: staff can pull chairs / merge
  // tables, so the UI shows a soft warning instead.
  const { data: conflicts, error: conflictErr } = await supabaseAdmin
    .from("reservations")
    .select("id, time, status")
    .eq("date", date)
    .eq("table_id", tableId)
    .in("status", ["pending", "confirmed", "checked_in"]);

  if (conflictErr && !conflictErr.message?.includes("schema cache") && !conflictErr.message?.includes("not found")) {
    console.error("pos/reservations conflict check:", conflictErr.message);
    return NextResponse.json({ ok: false, error: conflictErr.message }, { status: 500 });
  }

  const requestedMins = toMins(time);
  const hasConflict = (conflicts ?? []).some((r) =>
    r.status === "checked_in" ||
    Math.abs(toMins(r.time as string) - requestedMins) < slotDuration
  );
  if (hasConflict) {
    return NextResponse.json(
      { ok: false, error: "This table is already reserved at the selected time. Please choose a different table." },
      { status: 409 },
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
  if (source === "phone" && email && settingsRow?.data) {
    sendReservationEmailServer("reservation_confirmation", {
      id, customer_name: customerName.trim(),
      customer_email: email,
      customer_phone: customerPhone?.trim() ?? "",
      date, time, table_label: tableLabel,
      party_size: partySize, status: "pending",
      note: note ?? null, section: section ?? "", cancel_token,
    }, settingsRow.data, req.headers.get("origin") ?? req.nextUrl.origin).catch(console.error);
  }

  return NextResponse.json({ ok: true, reservationId: id });
}
