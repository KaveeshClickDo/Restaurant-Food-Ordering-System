/**
 * GET /api/admin/reservations?from=YYYY-MM-DD&to=YYYY-MM-DD&status=...
 * Returns reservations filtered by optional date range and/or status.
 * Requires admin session cookie.
 * Maps snake_case DB columns → camelCase to match the Reservation TypeScript type.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import type { Reservation }                     from "@/types";

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
