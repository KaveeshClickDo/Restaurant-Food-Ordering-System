/**
 * GET /api/admin/reservation-customers/[id]/reservations
 * Returns all reservations for a customer identified by their customer profile id.
 * Looks up the email from the customer record, then fetches reservations by that email.
 * Requires admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  // Resolve email from customer profile
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("reservation_customers")
    .select("email")
    .eq("id", id)
    .single();

  if (custErr || !customer) {
    return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("id, date, time, table_label, party_size, status, note, checked_in_at, checked_out_at, created_at")
    .eq("customer_email", customer.email)
    .order("date", { ascending: false })
    .order("time", { ascending: false });

  if (error) {
    console.error("reservation-customers/[id]/reservations GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reservations: data ?? [] });
}
