/**
 * POST /api/admin/settings — upsert the restaurant settings blob.
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  let body: { data?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.data || typeof body.data !== "object") {
    return NextResponse.json({ ok: false, error: "Missing 'data' field." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ id: 1, data: body.data, updated_at: new Date().toISOString() });

  if (error) {
    console.error("admin/settings POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
