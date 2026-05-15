/**
 * POST /api/admin/meal-periods — create a new meal period
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  let body: {
    id?: string;
    name?: string;
    enabled?: boolean;
    start_time?: string;
    end_time?: string;
    days_of_week?: number[];
    sort_order?: number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  if (!body.name || !body.start_time || !body.end_time) {
    return NextResponse.json(
      { ok: false, error: "name, start_time and end_time are required." },
      { status: 400 },
    );
  }

  const row: Record<string, unknown> = {
    name:         body.name,
    enabled:      body.enabled ?? true,
    start_time:   body.start_time,
    end_time:     body.end_time,
    days_of_week: body.days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
    sort_order:   body.sort_order ?? 0,
  };
  if (body.id) row.id = body.id;

  const { data, error } = await supabaseAdmin
    .from("meal_periods")
    .insert(row)
    .select()
    .single();
  if (error) {
    console.error("admin/meal-periods POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, mealPeriod: data });
}
