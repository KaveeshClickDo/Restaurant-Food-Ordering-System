/**
 * GET  /api/pos/reservations — list reservations (with optional date filter).
 * POST /api/pos/reservations — create a walk-in or phone reservation.
 *
 * Both require a POS session. The admin Reservations panel uses
 * /api/admin/reservations. The GET replaces the direct
 * `supabase.from("reservations")` reads in POS components.
 */

import { NextRequest, NextResponse }  from "next/server";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { parseBody }                  from "@/lib/apiValidation";
import { ReservationPosSchema }       from "@/lib/schemas/reservation";
import { createReservation }          from "@/lib/reservations";

export async function GET(req: NextRequest) {
  const pos = await getPosSession();
  if (!pos) return unauthorizedJson();

  const { searchParams } = new URL(req.url);
  const date  = searchParams.get("date");
  const from  = searchParams.get("from");
  const to    = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit") ?? 500), 2000);

  let q = supabaseAdmin
    .from("reservations")
    .select("*")
    .order("date", { ascending: true })
    .order("time", { ascending: true })
    .limit(limit);

  if (date) q = q.eq("date", date);
  if (from) q = q.gte("date", from);
  if (to)   q = q.lte("date", to);

  const { data, error } = await q;
  if (error) {
    console.error("pos/reservations GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, reservations: data ?? [] });
}

export async function POST(req: NextRequest) {
  const pos = await getPosSession();
  if (!pos) return unauthorizedJson();

  const parsed = await parseBody(req, ReservationPosSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const {
    tableId, tableLabel, tableSeats, section,
    date, time, partySize, customerName, customerEmail, customerPhone,
    note, source, paymentMethod, marketingOptIn,
  } = parsed.data;

  // Load settings (slot duration + email templates) and the table itself — we
  // read VIP price from the live row, never trusting a client-supplied amount.
  const [{ data: settingsRow }, { data: tableRow }] = await Promise.all([
    supabaseAdmin.from("app_settings").select("data").limit(1).single(),
    supabaseAdmin
      .from("dining_tables")
      .select("id, label, seats, section, is_vip, vip_price")
      .eq("id", tableId)
      .maybeSingle(),
  ]);
  const slotDuration: number = settingsRow?.data?.reservationSystem?.slotDurationMinutes ?? 90;

  // VIP tables require the booking fee to be collected (cash/card at the till —
  // no gateway). Validate against the live table record so a non-VIP table
  // can't be charged and a VIP table can't be booked fee-free.
  const isVip   = !!tableRow?.is_vip && Number(tableRow.vip_price ?? 0) > 0;
  const vipFee  = isVip ? Number(tableRow!.vip_price ?? 0) : 0;
  if (isVip && !paymentMethod) {
    return NextResponse.json(
      { ok: false, error: "This is a VIP table — collect the booking fee (cash or card) before confirming." },
      { status: 400 },
    );
  }

  const isWalkIn = source === "walk-in";
  const result = await createReservation(
    {
      tableId,
      // Prefer the live table record; fall back to the client values if the
      // lookup missed (table just created / cache lag).
      tableLabel:    tableRow?.label ?? tableLabel,
      tableSeats:    tableRow?.seats ?? tableSeats ?? 0,
      section:       tableRow?.section ?? section ?? "",
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
      paymentRef:    isVip && paymentMethod ? `pos:${paymentMethod}` : null,
      slotDurationMinutes: slotDuration,
      marketingConsent: marketingOptIn,
    },
    settingsRow?.data ?? null,
    req.headers.get("origin") ?? req.nextUrl.origin,
  );

  if (!result.ok) {
    console.error("pos/reservations POST:", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json({ ok: true, reservationId: result.reservationId });
}
