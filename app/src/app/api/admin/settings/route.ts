/**
 * POST /api/admin/settings — upsert the restaurant settings blob.
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { SettingsUpdateSchema }                 from "@/lib/schemas/settings";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, SettingsUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ id: 1, data: body.data, updated_at: new Date().toISOString() });

  if (error) {
    console.error("admin/settings POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
