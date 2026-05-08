/**
 * POST /api/auth/reset-password — request a password reset.
 * Generates a secure random token, stores its HMAC-signed hash in the DB,
 * and (when SMTP is configured) sends an email with the reset link.
 * Always returns { ok: true } to avoid leaking which emails are registered.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes }   from "crypto";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { sendEmailDirect, fetchBrandPrimaryColor } from "@/lib/emailServer";
import { RESET_TOKEN_TTL_MS }        from "@/lib/auth";

function hashToken(token: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: "Email is required." }, { status: 400 });
  }

  // Always respond with ok: true — never reveal if email exists
  const { data } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!data) return NextResponse.json({ ok: true });

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = hashToken(rawToken);
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  await supabaseAdmin
    .from("customers")
    .update({ reset_token: hashedToken, reset_token_expires: expires })
    .eq("id", data.id);

  const siteUrl  = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const resetUrl = `${siteUrl}/login?action=reset&token=${rawToken}&email=${encodeURIComponent(email)}`;

  if (process.env.SMTP_HOST) {
    const brandColor = await fetchBrandPrimaryColor();
    const result = await sendEmailDirect(
      email,
      "Reset your password",
      `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2 style="margin-bottom:8px">Password reset request</h2>
        <p style="color:#555;margin-bottom:24px">
          Click the button below to set a new password.
          This link expires in <strong>1 hour</strong>.
        </p>
        <a href="${resetUrl}"
           style="display:inline-block;background:${brandColor};color:#fff;font-weight:700;
                  text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px">
          Reset my password
        </a>
        <p style="color:#aaa;font-size:12px;margin-top:28px">
          If you did not request a password reset you can safely ignore this email.
        </p>
      </div>`,
    );
    if (!result.ok) console.error("[reset-password] email failed:", result.error);
  } else {
    console.log("[reset-password] Reset URL (no SMTP):", resetUrl);
  }

  return NextResponse.json({ ok: true });
}
