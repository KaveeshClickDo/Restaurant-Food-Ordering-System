/**
 * POST /api/auth/driver/reset-password — self-service forgot-password for drivers.
 * Always returns { ok: true } — never reveals whether an email is registered.
 * Generates a signed token, stores it in drivers.reset_token, and emails the link.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes }   from "crypto";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { sendEmailDirect, fetchBrandPrimaryColor } from "@/lib/emailServer";
import { emailConfigured }          from "@/lib/emailSender";
import { RESET_TOKEN_TTL_MS }        from "@/lib/auth";
import { rateLimit }                 from "@/lib/rateLimit";
import { parseBody }                 from "@/lib/apiValidation";
import { ResetPasswordRequestSchema } from "@/lib/schemas/auth";

function hashToken(rawToken: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(rawToken).digest("hex");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`driver-reset:${ip}`, 3, 60_000);
  if (limited) {
    // Still respond ok to avoid leaking whether the address was throttled —
    // attacker can't distinguish "rate-limited" from "no such email".
    return NextResponse.json({ ok: true });
  }

  const parsed = await parseBody(req, ResetPasswordRequestSchema);
  if (!parsed.ok) {
    // Malformed body: still respond ok so we never reveal email existence.
    return NextResponse.json({ ok: true });
  }
  const email = parsed.data.email.trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: true });

  // Look up driver — silently do nothing if not found
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id, name")
    .eq("email", email)
    .maybeSingle();

  if (!data) return NextResponse.json({ ok: true });

  const rawToken    = randomBytes(32).toString("hex");
  const hashedToken = hashToken(rawToken);
  const expires     = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  await supabaseAdmin
    .from("drivers")
    .update({ reset_token: hashedToken, reset_token_expires: expires })
    .eq("id", data.id);

  const siteUrl  = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const resetUrl = `${siteUrl}/driver/login?action=reset&token=${rawToken}&email=${encodeURIComponent(email)}`;

  if (emailConfigured()) {
    const brandColor = await fetchBrandPrimaryColor();
    const html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;padding:24px">
        <h2 style="margin-bottom:8px;color:#111">Driver password reset</h2>
        <p style="color:#555;margin-bottom:8px">Hi ${data.name ?? "there"},</p>
        <p style="color:#555;margin-bottom:24px">
          Click the button below to set a new password for your driver account.
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
      </div>`;

    const result = await sendEmailDirect(email, "Reset your driver password", html);
    if (!result.ok) {
      console.error("[driver/reset-password] email failed:", result.error);
    }
  } else {
    console.log("[driver/reset-password] Reset URL (no email provider configured):", resetUrl);
  }

  return NextResponse.json({ ok: true });
}
