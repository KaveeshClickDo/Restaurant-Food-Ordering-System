/**
 * GET /api/admin/reservations?from=YYYY-MM-DD&to=YYYY-MM-DD&status=pending
 * Returns reservations filtered by optional date range and/or status.
 * Requires admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

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

  return NextResponse.json({ ok: true, reservations: data ?? [] });
}
