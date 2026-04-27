/**
 * POST /api/auth/reset-password/confirm — complete a password reset.
 * Verifies the raw token against the stored HMAC hash and updates the password.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import bcrypt                          from "bcryptjs";
import { supabaseAdmin }               from "@/lib/supabaseAdmin";

function hashToken(token: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  let body: { email?: string; token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { email, token, password } = body;
  if (!email?.trim() || !token || !password) {
    return NextResponse.json(
      { ok: false, error: "email, token, and password are required." },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 6 characters." },
      { status: 400 },
    );
  }

  const { data } = await supabaseAdmin
    .from("customers")
    .select("id, reset_token, reset_token_expires")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  const invalid = () =>
    NextResponse.json({ ok: false, error: "Invalid or expired reset link." }, { status: 400 });

  if (!data?.reset_token || !data.reset_token_expires) return invalid();

  // Token expired?
  if (new Date(data.reset_token_expires) < new Date()) return invalid();

  // Timing-safe token comparison
  const expected = hashToken(token);
  const stored   = data.reset_token;
  if (expected.length !== stored.length) return invalid();
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(stored, "hex"))) return invalid();

  const passwordHash = await bcrypt.hash(password, 10);
  await supabaseAdmin
    .from("customers")
    .update({ password_hash: passwordHash, password: "", reset_token: null, reset_token_expires: null })
    .eq("id", data.id);

  return NextResponse.json({ ok: true });
}
