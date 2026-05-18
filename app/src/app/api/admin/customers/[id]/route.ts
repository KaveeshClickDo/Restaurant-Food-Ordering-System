/**
 * PUT /api/admin/customers/[id] — customer update (admin only).
 * Requires a valid admin session cookie. Body whitelisted via zod — only
 * the documented profile / store-credit fields are writable. Password and
 * verification-token columns are reachable only through the dedicated
 * /api/admin/users routes.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { AdminCustomerUpdateSchema }            from "@/lib/schemas/customer";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, AdminCustomerUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("customers").update(parsed.data).eq("id", id);
  if (error) {
    console.error("admin/customers/[id] PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
