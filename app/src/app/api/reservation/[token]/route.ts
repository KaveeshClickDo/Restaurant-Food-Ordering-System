/**
 * GET  /api/reservation/[token] — return limited booking details for guest self-service page
 * POST /api/reservation/[token] — guest cancels their own reservation via token link
 * No auth required — the token itself is the credential.
 */

import { NextRequest, NextResponse }  from "next/server";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { sendReservationEmailServer } from "@/lib/emailServer";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("id,customer_name,date,time,table_label,section,party_size,status,note")
    .eq("cancel_token", token)
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, reservation: data });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Fetch the full row before updating (need email + details for cancellation email)
  const { data: resRow, error: fetchErr } = await supabaseAdmin
    .from("reservations")
    .select("id,customer_name,customer_email,customer_phone,date,time,table_label,party_size,status,note,section,cancel_token")
    .eq("cancel_token", token)
    .single();

  if (fetchErr || !resRow) {
    return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
  }

  const cancellableStatuses = new Set(["pending", "confirmed"]);
  if (!cancellableStatuses.has(resRow.status as string)) {
    return NextResponse.json(
      { ok: false, error: "This booking cannot be cancelled (it may already be cancelled or checked in)." },
      { status: 409 },
    );
  }

  const { error: updateErr } = await supabaseAdmin
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("cancel_token", token);

  if (updateErr) {
    console.error("reservation/[token] POST:", updateErr.message);
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  // Send cancellation confirmation email (fire-and-forget)
  if (resRow.customer_email) {
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").limit(1).single();
    if (settingsRow?.data) {
      sendReservationEmailServer("reservation_cancellation", {
        id:             resRow.id,
        customer_name:  resRow.customer_name,
        customer_email: resRow.customer_email,
        customer_phone: resRow.customer_phone ?? "",
        date:           resRow.date,
        time:           resRow.time,
        table_label:    resRow.table_label,
        party_size:     resRow.party_size,
        status:         "cancelled",
        note:           resRow.note,
        section:        resRow.section ?? "",
        cancel_token:   resRow.cancel_token,
      }, settingsRow.data,
        req.headers.get("origin") ?? req.nextUrl.origin,
      ).catch(console.error);
    }
  }

  return NextResponse.json({ ok: true });
}
