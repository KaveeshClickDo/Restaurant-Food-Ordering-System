/**
 * POST /api/auth/change-password — change password for the logged-in customer.
 * Requires a valid customer session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt                         from "bcryptjs";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { parseBody }                  from "@/lib/apiValidation";
import { ChangePasswordSchema }       from "@/lib/schemas/auth";

export async function POST(req: NextRequest) {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();

  const parsed = await parseBody(req, ChangePasswordSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { currentPassword, newPassword } = parsed.data;

  // Fetch stored hash
  const { data } = await supabaseAdmin
    .from("customers")
    .select("password_hash")
    .eq("id", session.id)
    .maybeSingle();

  if (!data?.password_hash) {
    return NextResponse.json(
      { ok: false, error: "Account not found." },
      { status: 404 },
    );
  }

  const match = await bcrypt.compare(currentPassword, data.password_hash);
  if (!match) {
    return NextResponse.json(
      { ok: false, error: "Current password is incorrect." },
      { status: 400 },
    );
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabaseAdmin
    .from("customers")
    .update({ password_hash: newHash })
    .eq("id", session.id);

  if (error) {
    console.error("[change-password]", error.message);
    return NextResponse.json({ ok: false, error: "Failed to update password." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
