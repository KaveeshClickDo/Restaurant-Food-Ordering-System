/**
 * PUT  /api/admin/reservations/[id]  — update status (confirmed / cancelled / no_show)
 * DELETE /api/admin/reservations/[id] — permanently delete a reservation
 * Both require admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { sendReservationEmailServer }           from "@/lib/emailServer";
import type { EmailTemplateEvent }              from "@/types";

const VALID_STATUSES = new Set(["pending", "confirmed", "cancelled", "no_show"]);

// Map status → email event (only statuses that warrant a customer notification)
const STATUS_EMAIL_MAP: Record<string, EmailTemplateEvent> = {
  confirmed:  "reservation_update",
  cancelled:  "reservation_cancellation",
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  let body: { status?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return NextResponse.json(
      { ok: false, error: `status must be one of: ${[...VALID_STATUSES].join(", ")}.` },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("reservations")
    .update({ status: body.status })
    .eq("id", id);

  if (error) {
    console.error("admin/reservations/[id] PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Send status-change email if this status has a mapped template
  const emailEvent = STATUS_EMAIL_MAP[body.status];
  if (emailEvent) {
    // Fetch reservation + settings in parallel for the email
    const [{ data: resRow }, { data: settingsRow }] = await Promise.all([
      supabaseAdmin
        .from("reservations")
        .select("id,customer_name,customer_email,customer_phone,date,time,table_label,party_size,status,note,section")
        .eq("id", id)
        .single(),
      supabaseAdmin
        .from("app_settings")
        .select("data")
        .limit(1)
        .single(),
    ]);

    if (resRow && settingsRow?.data) {
      sendReservationEmailServer(emailEvent, {
        id:             resRow.id,
        customer_name:  resRow.customer_name,
        customer_email: resRow.customer_email,
        customer_phone: resRow.customer_phone ?? "",
        date:           resRow.date,
        time:           resRow.time,
        table_label:    resRow.table_label,
        party_size:     resRow.party_size,
        status:         resRow.status,
        note:           resRow.note,
        section:        resRow.section ?? "",
      }, settingsRow.data).catch(console.error);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("reservations")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("admin/reservations/[id] DELETE:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
