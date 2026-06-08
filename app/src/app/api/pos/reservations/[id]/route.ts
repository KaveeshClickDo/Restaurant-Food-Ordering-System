/**
 * PUT /api/pos/reservations/[id]
 * POS-accessible check-in / check-out / status-change endpoint.
 * Requires a POS session. The admin Reservations panel uses
 * /api/admin/reservations/[id].
 *
 * Status transitions and side-effects (mirrors /api/admin/reservations/[id]):
 *  → confirmed   : sends reservation_update
 *  → checked_in  : records checked_in_at, upserts reservation_customer,
 *                  sends reservation_check_in
 *  → checked_out : records checked_out_at, increments visit_count + last_visit_at,
 *                  sends reservation_review_request
 *  → cancelled   : sends reservation_cancellation
 *  → no_show     : no email
 */

import { NextRequest, NextResponse }       from "next/server";
import { supabaseAdmin }                   from "@/lib/supabaseAdmin";
import { sendReservationEmailServer }      from "@/lib/emailServer";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import type { EmailTemplateEvent }         from "@/types";
import { parseBody }                       from "@/lib/apiValidation";
import { z }                               from "zod";

const PosReservationStatusSchema = z.object({
  status: z.enum(["checked_in", "checked_out", "confirmed", "cancelled", "no_show"]),
});

// Keep in lockstep with /api/admin/reservations/[id]. Any status with a mapped
// event sends the guest an email after the row is updated.
const STATUS_EMAIL_MAP: Partial<Record<string, EmailTemplateEvent>> = {
  confirmed:   "reservation_update",
  cancelled:   "reservation_cancellation",
  checked_in:  "reservation_check_in",
  checked_out: "reservation_review_request",
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pos = await getPosSession();
  if (!pos) return unauthorizedJson();

  const { id } = await params;

  const parsed = await parseBody(req, PosReservationStatusSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = { status: body.status };
  if (body.status === "checked_in")  patch.checked_in_at  = new Date().toISOString();
  if (body.status === "checked_out") patch.checked_out_at = new Date().toISOString();

  const { data: resRow, error: updateErr } = await supabaseAdmin
    .from("reservations")
    .update(patch)
    .eq("id", id)
    .select("id,customer_name,customer_email,customer_phone,date,time,table_label,party_size,status,note,section,cancel_token")
    .single();

  if (updateErr) {
    console.error("pos/reservations/[id] PUT:", updateErr.message);
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  if (resRow) {
    const email = (resRow.customer_email as string)?.trim().toLowerCase();

    // Customer profile upsert — only on check-in (create/refresh) and check-out
    // (increment visit_count). Other statuses must not touch this table.
    if (email) {
      if (body.status === "checked_in") {
        const { data: existing } = await supabaseAdmin
          .from("reservation_customers")
          .select("id, first_visit_at")
          .eq("email", email)
          .single();

        if (existing) {
          await supabaseAdmin
            .from("reservation_customers")
            .update({
              name:       resRow.customer_name ?? "",
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
      } else if (body.status === "checked_out") {
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

    // Status-change email (fire-and-forget). Same map as admin so POS and
    // admin send the same messages for the same transitions.
    const emailEvent = STATUS_EMAIL_MAP[body.status];
    if (emailEvent && email) {
      const { data: settingsRow } = await supabaseAdmin
        .from("app_settings").select("data").limit(1).single();
      if (settingsRow?.data) {
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
          cancel_token:   resRow.cancel_token as string | undefined,
        }, settingsRow.data, req.headers.get("origin") ?? req.nextUrl.origin).catch(console.error);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
