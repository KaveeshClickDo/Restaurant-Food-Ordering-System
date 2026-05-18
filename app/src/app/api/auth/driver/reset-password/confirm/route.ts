/**
 * POST /api/auth/driver/reset-password/confirm — complete a driver password reset.
 * Verifies the raw token against the stored HMAC hash and updates the password.
 */

import { NextRequest, NextResponse }   from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import bcrypt                          from "bcryptjs";
import { supabaseAdmin }               from "@/lib/supabaseAdmin";
import { parseBody }                   from "@/lib/apiValidation";
import { ResetPasswordConfirmSchema }  from "@/lib/schemas/auth";

function hashToken(rawToken: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(rawToken).digest("hex");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = await parseBody(req, ResetPasswordConfirmSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { email, token, password } = parsed.data;

  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id, reset_token, reset_token_expires")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  const invalid = (): NextResponse =>
    NextResponse.json({ ok: false, error: "Invalid or expired reset link." }, { status: 400 });

  if (!data?.reset_token || !data.reset_token_expires) return invalid();

  if (new Date(data.reset_token_expires as string) < new Date()) return invalid();

  const expected = hashToken(token);
  const stored   = data.reset_token as string;

  if (expected.length !== stored.length) return invalid();
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(stored, "hex"))) return invalid();

  const passwordHash = await bcrypt.hash(password, 12);

  const { error } = await supabaseAdmin
    .from("drivers")
    .update({
      password_hash:        passwordHash,
      reset_token:          null,
      reset_token_expires:  null,
    })
    .eq("id", data.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
