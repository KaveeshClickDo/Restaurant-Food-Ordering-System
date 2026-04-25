/**
 * PATCH /api/admin/reservation-customers/[id]
 * Updates editable fields on a customer profile: notes, tags, marketingOptIn.
 * Requires admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  let body: { notes?: string; tags?: string[]; marketingOptIn?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.notes        !== undefined) patch.notes            = body.notes.trim();
  if (body.tags         !== undefined) patch.tags             = body.tags;
  if (body.marketingOptIn !== undefined) patch.marketing_opt_in = body.marketingOptIn;

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
