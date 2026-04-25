/**
 * PUT  /api/admin/reservations/[id]  — update status
 * DELETE /api/admin/reservations/[id] — permanently delete a reservation
 * Both require admin session cookie.
 *
 * Status transitions and side-effects:
 *  pending   → confirmed        : sends reservation_update email
 *  confirmed → checked_in       : records checked_in_at, upserts reservation_customer (first_visit_at)
 *  checked_in → checked_out     : records checked_out_at, increments reservation_customer visit_count
 *  any       → cancelled        : sends reservation_cancellation email
 *  any       → no_show          : no email
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { sendReservationEmailServer }           from "@/lib/emailServer";
import type { EmailTemplateEvent }              from "@/types";

const VALID_STATUSES = new Set([
  "pending", "confirmed", "checked_in", "checked_out", "cancelled", "no_show",
]);

const STATUS_EMAIL_MAP: Partial<Record<string, EmailTemplateEvent>> = {
  confirmed:  "reservation_update",
  cancelled:  "reservation_cancellation",
};

// Build the DB update payload for a given status transition
function buildUpdatePayload(status: string): Record<string, unknown> {
  const base: Record<string, unknown> = { status };
  if (status === "checked_in")  base.checked_in_at  = new Date().toISOString();
  if (status === "checked_out") base.checked_out_at = new Date().toISOString();
  return base;
}


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

  const updatePayload = buildUpdatePayload(body.status);

  const { error } = await supabaseAdmin
    .from("reservations")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    console.error("admin/reservations/[id] PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Fire side-effects in parallel (email + customer upsert) — don't block response
  const emailEvent = STATUS_EMAIL_MAP[body.status];
  if (emailEvent || body.status === "checked_in" || body.status === "checked_out") {
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

    if (resRow) {
      // Review request email on check-out
      if (body.status === "checked_out" && settingsRow?.data) {
        sendReservationEmailServer("reservation_review_request", {
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

      // Customer upsert (check-in/out)
      if (body.status === "checked_in" || body.status === "checked_out") {
        const email = (resRow.customer_email as string)?.trim().toLowerCase();
        if (email) {
          if (body.status === "checked_in") {
            // Upsert customer record, set first_visit_at if this is first visit
            const { data: existing } = await supabaseAdmin
              .from("reservation_customers")
              .select("id, first_visit_at")
              .eq("email", email)
              .single();

            if (existing) {
              await supabaseAdmin
                .from("reservation_customers")
                .update({
                  name:       resRow.customer_name ?? existing,
                  phone:      resRow.customer_phone ?? "",
                  updated_at: new Date().toISOString(),
                  ...(existing.first_visit_at ? {} : { first_visit_at: new Date().toISOString() }),
                })
                .eq("email", email);
            } else {
              await supabaseAdmin.from("reservation_customers").insert({
                email,
                name:           resRow.customer_name ?? "",
                phone:          resRow.customer_phone ?? "",
                visit_count:    0,
                first_visit_at: new Date().toISOString(),
                created_at:     new Date().toISOString(),
                updated_at:     new Date().toISOString(),
              });
            }
          } else {
            // checked_out: increment visit_count + set last_visit_at
            const { data: existing } = await supabaseAdmin
              .from("reservation_customers")
              .select("id, visit_count")
              .eq("email", email)
              .single();

            if (existing) {
              await supabaseAdmin
                .from("reservation_customers")
                .update({
                  visit_count:   (existing.visit_count as number) + 1,
                  last_visit_at: new Date().toISOString(),
                  updated_at:    new Date().toISOString(),
                })
                .eq("email", email);
            }
          }
        }
      }

      // Email notification
      if (emailEvent && settingsRow?.data) {
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
