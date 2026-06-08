/**
 * PATCH /api/customers/[id] — customer self-service profile update.
 * Only a strict allowlist of fields can be written: favourites, saved_addresses,
 * name, and phone. Sensitive fields (store_credit, tags, password, email) are
 * explicitly blocked so a caller can never escalate their own privileges.
 * Requires a customer session matching the [id] in the URL — a customer may
 * only update their own profile.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { parseBody }                 from "@/lib/apiValidation";
import { CustomerProfileUpdateSchema } from "@/lib/schemas/customer";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await getCustomerSession();
  if (!session || session.id !== id) return unauthorizedJson();

  const parsed = await parseBody(req, CustomerProfileUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  // CustomerProfileUpdateSchema already restricts to allowed fields.
  const patch: Record<string, unknown> = { ...parsed.data };

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No allowed fields provided." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("customers").update(patch).eq("id", id);
  if (error) {
    console.error("customers/[id] PATCH:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
