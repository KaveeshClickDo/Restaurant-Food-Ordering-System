/**
 * POST /api/auth/reset-password — request a password reset.
 * Generates a secure random token, stores its HMAC-signed hash in the DB,
 * and (when SMTP is configured) sends an email with the reset link.
 * Always returns { ok: true } to avoid leaking which emails are registered.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes }   from "crypto";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
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

  // Send email if SMTP is configured
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const resetUrl = `${siteUrl}/login?action=reset&token=${rawToken}&email=${encodeURIComponent(email)}`;

  if (process.env.SMTP_HOST) {
    try {
      await fetch(`${siteUrl}/api/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          subject: "Reset your password",
          html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p>
                 <p><a href="${resetUrl}">${resetUrl}</a></p>
                 <p>If you did not request this, you can safely ignore this email.</p>`,
        }),
      });
    } catch (err) {
      console.error("reset-password: email send failed:", err instanceof Error ? err.message : err);
    }
  } else {
    // Development fallback — log the reset URL to server console
    console.log("[reset-password] Reset URL:", resetUrl);
  }

  return NextResponse.json({ ok: true });
}
