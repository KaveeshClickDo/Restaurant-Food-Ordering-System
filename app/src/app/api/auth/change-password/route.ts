/**
 * POST /api/auth/change-password — change password for the logged-in customer.
 * Requires a valid customer session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt                         from "bcryptjs";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { ok: false, error: "currentPassword and newPassword are required." },
      { status: 400 },
    );
  }
  if (newPassword.length < 6) {
    return NextResponse.json(
      { ok: false, error: "New password must be at least 6 characters." },
      { status: 400 },
    );
  }

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
    .update({ password_hash: newHash, password: "" })
    .eq("id", session.id);

  if (error) {
    console.error("[change-password]", error.message);
    return NextResponse.json({ ok: false, error: "Failed to update password." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
