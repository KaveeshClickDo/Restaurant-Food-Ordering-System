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
import type { Reservation, ReservationSystem }  from "@/types";
import { parseBody }                            from "@/lib/apiValidation";
import { ReservationAdminSchema }               from "@/lib/schemas/reservation";
import { createReservation }                    from "@/lib/reservations";

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
    vipFee:        row.vip_fee        != null ? Number(row.vip_fee) : undefined,
    paymentStatus: row.payment_status as Reservation["paymentStatus"],
    paymentMethod: row.payment_method as string | undefined,
    paymentRef:    row.payment_ref    as string | undefined,
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
    note, source, paymentMethod,
  } = parsed.data;

  // Reject past slots — 5 min grace for slow submissions. Walk-ins are exempt:
  // they're seated at the current in-progress slot, which is intentionally a few
  // minutes in the past (mirrors the POS route, which has no past-slot guard).
  if (source !== "walk-in" && new Date(`${date}T${time}`).getTime() < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: "This time slot has already passed. Please select a future time." },
      { status: 400 },
    );
  }

  // Load settings + verify the table exists. Use server-side table data for
  // label/seats/section/VIP price — never trust client values.
  const [{ data: settingsRow }, { data: tableRow }] = await Promise.all([
    supabaseAdmin.from("app_settings").select("data").limit(1).single(),
    supabaseAdmin
      .from("dining_tables")
      .select("id, label, seats, section, active, is_vip, vip_price")
      .eq("id", tableId)
      .maybeSingle(),
  ]);

  const rs: ReservationSystem = settingsRow?.data?.reservationSystem ?? {} as ReservationSystem;
  const slotDuration: number  = rs.slotDurationMinutes ?? 90;
  const maxPartySize: number  = rs.maxPartySize ?? 20;
  const blackoutDates: string[] = rs.blackoutDates ?? [];

  if (!tableRow || !tableRow.active) {
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

  // VIP tables require the (non-refundable) booking fee, collected as cash/card
  // here — same model as POS, no payment gateway on the admin surface.
  const isVip  = !!tableRow.is_vip && Number(tableRow.vip_price ?? 0) > 0;
  const vipFee = isVip ? Number(tableRow.vip_price ?? 0) : 0;
  if (isVip && !paymentMethod) {
    return NextResponse.json(
      { ok: false, error: "This is a VIP table — record the booking fee (cash or card) before confirming." },
      { status: 400 },
    );
  }

  const isWalkIn = source === "walk-in";
  const result = await createReservation(
    {
      tableId:       tableRow.id,
      tableLabel:    tableRow.label,
      tableSeats:    tableRow.seats,
      section:       tableRow.section ?? "",
      customerName,
      customerEmail,
      customerPhone,
      date, time, partySize,
      status:        isWalkIn ? "checked_in" : "pending",
      note:          note ?? null,
      source,
      vipFee,
      paymentStatus: isVip ? "paid" : "none",
      paymentMethod: isVip ? paymentMethod : null,
      paymentRef:    isVip && paymentMethod ? `admin:${paymentMethod}` : null,
      slotDurationMinutes: slotDuration,
    },
    settingsRow?.data ?? null,
    req.headers.get("origin") ?? req.nextUrl.origin,
  );

  if (!result.ok) {
    console.error("admin/reservations POST:", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json({ ok: true, reservationId: result.reservationId });
}
