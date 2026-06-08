/**
 * PUT    /api/admin/meal-periods/[id] — update a meal period
 * DELETE /api/admin/meal-periods/[id] — delete a meal period (cascades the join table)
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseBody } from "@/lib/apiValidation";
import { MealPeriodUpdateSchema } from "@/lib/schemas/menu";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, MealPeriodUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.name         !== undefined) patch.name         = body.name;
  if (body.enabled      !== undefined) patch.enabled      = body.enabled;
  if (body.start_time   !== undefined) patch.start_time   = body.start_time;
  if (body.end_time     !== undefined) patch.end_time     = body.end_time;
  if (body.days_of_week !== undefined) patch.days_of_week = body.days_of_week;
  if (body.sort_order   !== undefined) patch.sort_order   = body.sort_order;
  if (body.theme_color  !== undefined) patch.theme_color  = body.theme_color;

  const { error } = await supabaseAdmin
    .from("meal_periods")
    .update(patch)
    .eq("id", id);
  if (error) {
    console.error("admin/meal-periods/[id] PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
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
    .from("meal_periods")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("admin/meal-periods/[id] DELETE:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
