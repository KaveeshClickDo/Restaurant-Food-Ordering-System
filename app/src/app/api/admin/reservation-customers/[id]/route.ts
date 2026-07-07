/**
 * PATCH /api/admin/reservation-customers/[id]
 * Updates editable fields on a customer profile: notes, tags, marketingOptIn.
 * Requires admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { ReservationCustomerUpdateSchema }      from "@/lib/schemas/customer";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, ReservationCustomerUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.notes        !== undefined) patch.notes            = body.notes.trim();
  if (body.tags         !== undefined) patch.tags             = body.tags;
  if (body.marketingOptIn !== undefined) {
    patch.marketing_opt_in = body.marketingOptIn;
    // Opting out stamps unsubscribed_at (the campaign sender suppresses on
    // either signal); re-enabling clears it so the contact is mailable again.
    patch.unsubscribed_at  = body.marketingOptIn ? null : new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("reservation_customers")
    .update(patch)
    .eq("id", id);

  if (error) {
    console.error("admin/reservation-customers/[id] PATCH:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
