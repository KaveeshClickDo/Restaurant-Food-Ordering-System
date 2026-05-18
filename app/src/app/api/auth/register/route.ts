/**
 * POST /api/auth/register — public customer self-registration.
 * Hashes password with bcrypt, stores it in password_hash, then sends an
 * email verification link. The legacy plaintext `password` column was
 * dropped in the latest schema migration — only password_hash is written.
 */

import { NextRequest, NextResponse }  from "next/server";
import bcrypt                         from "bcryptjs";
import { rateLimit }                  from "@/lib/rateLimit";
import { createHmac, randomBytes }    from "crypto";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { sendEmailDirect, fetchBrandPrimaryColor } from "@/lib/emailServer";
import { emailConfigured }        from "@/lib/emailSender";
import { parseBody }              from "@/lib/apiValidation";
import { RegisterSchema }         from "@/lib/schemas/auth";

// Issue a session cookie immediately on register only when the auth migration
// hasn't been applied yet — in that case email_verified doesn't exist and the
// login route will accept the account regardless. Once the migration is in
// place, the cookie is withheld until /api/auth/verify-email is hit.

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(raw: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(raw).digest("hex");
}

async function sendVerificationEmail(to: string, name: string, rawToken: string) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const link    = `${siteUrl}/verify-email?token=${rawToken}&email=${encodeURIComponent(to)}`;

  if (!emailConfigured()) {
    console.log("[register] Verification URL (no email provider configured):", link);
    return;
  }

  const brandColor = await fetchBrandPrimaryColor();

  const result = await sendEmailDirect(
    to,
    "Verify your email address",
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
      <h2 style="margin-bottom:8px">Hi ${name}, confirm your email</h2>
      <p style="color:#555;margin-bottom:24px">
        Thanks for signing up! Click the button below to verify your email address.
        This link expires in <strong>24 hours</strong>.
      </p>
      <a href="${link}"
         style="display:inline-block;background:${brandColor};color:#fff;font-weight:700;
                text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px">
        Verify my email
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:28px">
        If you did not create an account you can safely ignore this email.
      </p>
    </div>`,
  );

  if (!result.ok) console.error("[register] verification email failed:", result.error);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`register:${ip}`, 5, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many registration attempts. Please wait a minute." }, { status: 429 });
  }

  const parsed = await parseBody(req, RegisterSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { id, name, email, phone, password, createdAt } = parsed.data;

  // ── Duplicate check ───────────────────────────────────────────────────────
  const { data: existing } = await supabaseAdmin
    .from("customers").select("id").eq("email", email.trim().toLowerCase()).maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: false, error: "An account with this email already exists." }, { status: 409 });
  }

  // ── Hash password + generate verification token ───────────────────────────
  const passwordHash = await bcrypt.hash(password, 10);
  const rawToken     = randomBytes(32).toString("hex");
  const hashedToken  = hashToken(rawToken);
  const tokenExpires = new Date(Date.now() + VERIFY_TTL_MS).toISOString();

  const baseRow = {
    id,
    name:            name.trim(),
    email:           email.trim().toLowerCase(),
    phone:           phone?.trim() ?? "",
    created_at:      createdAt ?? new Date().toISOString(),
    tags:            [],
    favourites:      [],
    saved_addresses: [],
    store_credit:    0,
  };

  // ── Insert ────────────────────────────────────────────────────────────────
  const { error: errInsert } = await supabaseAdmin.from("customers").insert({
    ...baseRow,
    password_hash:              passwordHash,
    email_verified:             false,
    email_verification_token:   hashedToken,
    email_verification_expires: tokenExpires,
  });

  if (errInsert) {
    console.error("auth/register:", errInsert.message);
    return NextResponse.json({ ok: false, error: errInsert.message }, { status: 500 });
  }

  // ── Send verification email ───────────────────────────────────────────────
  await sendVerificationEmail(email.trim().toLowerCase(), name.trim(), rawToken);

  return NextResponse.json({
    ok: true,
    requiresVerification: true,
    email: email.trim().toLowerCase(),
  });
}
