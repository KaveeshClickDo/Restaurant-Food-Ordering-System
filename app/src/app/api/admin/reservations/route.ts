/**
 * GET  /api/admin/reservations          — list reservations (filtered)
 * POST /api/admin/reservations          — create walk-in or phone reservation (skips availability check)
 * Both require admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { sendReservationEmailServer }           from "@/lib/emailServer";
import type { Reservation }                     from "@/types";

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

  let body: {
    tableId?: string; tableLabel?: string; tableSeats?: number; section?: string;
    date?: string; time?: string; partySize?: number;
    customerName?: string; customerEmail?: string; customerPhone?: string;
    note?: string; source?: string; status?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const {
    tableId, tableLabel, tableSeats, section,
    date, time, partySize, customerName, customerEmail, customerPhone,
    note, source = "walk-in", status = "checked_in",
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

  // Upsert guest profile for walk-ins that have an email
  if (customerEmail) {
    const email = customerEmail.trim().toLowerCase();
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

  // Send confirmation email for phone bookings (walk-ins are already here)
  if (source === "phone" && customerEmail) {
    const { data: settingsRow } = await supabaseAdmin.from("app_settings").select("data").limit(1).single();
    if (settingsRow?.data) {
      sendReservationEmailServer("reservation_confirmation", {
        id, customer_name: customerName.trim(),
        customer_email: customerEmail.trim().toLowerCase(),
        customer_phone: customerPhone?.trim() ?? "",
        date, time, table_label: tableLabel,
        party_size: partySize, status, note: note ?? null,
        section: section ?? "", cancel_token,
      }, settingsRow.data, req.headers.get("origin") ?? req.nextUrl.origin).catch(console.error);
    }
  }

  return NextResponse.json({ ok: true, reservationId: id });
}
