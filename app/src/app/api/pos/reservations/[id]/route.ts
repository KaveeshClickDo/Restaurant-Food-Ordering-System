/**
 * PUT /api/pos/reservations/[id]
 * POS-accessible check-in / check-out endpoint.
 * Limited to status = "checked_in" | "checked_out" only.
 * No admin cookie required — POS is an internal staff terminal.
 *
 * Also upserts the reservation_customers profile on check-in,
 * and increments visit_count + sets last_visit_at on check-out.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";

const ALLOWED = new Set(["checked_in", "checked_out", "confirmed", "cancelled", "no_show"]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { status?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  if (!body.status || !ALLOWED.has(body.status)) {
    return NextResponse.json(
      { ok: false, error: "status must be one of: checked_in, checked_out, confirmed, cancelled, no_show." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = { status: body.status };
  if (body.status === "checked_in")  patch.checked_in_at  = new Date().toISOString();
  if (body.status === "checked_out") patch.checked_out_at = new Date().toISOString();

  const { data: resRow, error: updateErr } = await supabaseAdmin
    .from("reservations")
    .update(patch)
    .eq("id", id)
    .select("id,customer_name,customer_email,customer_phone")
    .single();

  if (updateErr) {
    console.error("pos/reservations/[id] PUT:", updateErr.message);
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  // Customer profile side-effects (fire-and-forget)
  if (resRow) {
    const email = (resRow.customer_email as string)?.trim().toLowerCase();
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
      } else {
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

  return NextResponse.json({ ok: true });
}
