/**
 * GET /api/admin/reservation-customers
 * Returns all reservation customer profiles, ordered by last visit descending.
 * Requires admin session cookie.
 */

import { NextResponse }                        from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import type { ReservationCustomer }             from "@/types";

function mapRow(row: Record<string, unknown>): ReservationCustomer {
  return {
    id:              row.id               as string,
    email:           row.email            as string,
    name:            row.name             as string,
    phone:           row.phone            as string,
    visitCount:      (row.visit_count     as number) ?? 0,
    firstVisitAt:    row.first_visit_at   as string | undefined,
    lastVisitAt:     row.last_visit_at    as string | undefined,
    orderCount:      (row.order_count     as number) ?? 0,
    totalSpend:      parseFloat(String(row.total_spend ?? "0")),
    lastOrderAt:     row.last_order_at    as string | undefined,
    tags:            (row.tags as string[]) ?? [],
    notes:           row.notes            as string,
    marketingOptIn:  row.marketing_opt_in as boolean,
    createdAt:       row.created_at       as string,
    updatedAt:       row.updated_at       as string,
  };
}

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("reservation_customers")
    .select("*")
    .order("last_visit_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("admin/reservation-customers GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const customers = (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
  return NextResponse.json({ ok: true, customers });
}
