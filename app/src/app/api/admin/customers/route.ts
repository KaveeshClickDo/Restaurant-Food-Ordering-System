/**
 * POST /api/admin/customers — admin creates a customer record directly.
 * Requires a valid admin session cookie. Body whitelisted via zod —
 * password_hash / reset_token / email_verification_token cannot be set here
 * (admins use the dedicated /api/admin/users/[id]/set-password route).
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { AdminCustomerCreateSchema }            from "@/lib/schemas/customer";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, AdminCustomerCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const { error } = await supabaseAdmin.from("customers").insert(parsed.data);
  if (error) {
    console.error("admin/customers POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
