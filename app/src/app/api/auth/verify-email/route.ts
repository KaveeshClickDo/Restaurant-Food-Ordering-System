/**
 * POST /api/auth/verify-email
 * Verifies the token from the email link and marks the account as verified.
 */

import { NextRequest, NextResponse }   from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin }               from "@/lib/supabaseAdmin";
import { createSessionToken, setSessionCookie, COOKIE_CUSTOMER } from "@/lib/auth";
import { parseBody }                   from "@/lib/apiValidation";
import { VerifyEmailSchema }           from "@/lib/schemas/auth";

function hashToken(raw: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(raw).digest("hex");
}

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, VerifyEmailSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { email, token } = parsed.data;

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, email_verified, email_verification_token, email_verification_expires")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error?.code === "PGRST204") {
    return NextResponse.json({ ok: false, error: "Email verification is not set up yet. Apply supabase/schema.sql first." }, { status: 503 });
  }

  const invalid = () =>
    NextResponse.json({ ok: false, error: "Invalid or expired verification link." }, { status: 400 });

  if (!data) return invalid();

  // Already verified — treat as success (no fresh session — the user must
  // log in normally if they aren't already signed in).
  if (data.email_verified) return NextResponse.json({ ok: true, alreadyVerified: true });

  if (!data.email_verification_token || !data.email_verification_expires) return invalid();

  // Token expired?
  if (new Date(data.email_verification_expires) < new Date()) return invalid();

  // Timing-safe comparison
  const expected = hashToken(token);
  const stored   = data.email_verification_token;
  if (expected.length !== stored.length) return invalid();
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(stored, "hex"))) return invalid();

  await supabaseAdmin
    .from("customers")
    .update({ email_verified: true, email_verification_token: null, email_verification_expires: null })
    .eq("id", data.id);

  // First-time verification: issue the session cookie that register() withheld.
  // This lets the verify-email page land the customer on /account already
  // logged in, completing the registration flow.
  const sessionToken = createSessionToken({ id: data.id, role: "customer" });
  const res = NextResponse.json({ ok: true, customerId: data.id });
  setSessionCookie(res, COOKIE_CUSTOMER, sessionToken);
  return res;
}
