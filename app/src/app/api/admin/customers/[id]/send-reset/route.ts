/**
 * POST /api/admin/customers/[id]/send-reset — admin sends a password-reset
 * email to a customer.
 *
 * Body: { email: string }
 * Requires admin authentication. Generates a single-use reset token (1 hour
 * TTL), stores its HMAC hash on the customers row, and emails the customer
 * a /login?action=reset link.
 */

import { NextRequest, NextResponse }                   from "next/server";
import { createHmac, randomBytes }                     from "crypto";
import { z }                                           from "zod";
import { supabaseAdmin }                               from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse }  from "@/lib/adminAuth";
import { sendEmailDirect, fetchBrandPrimaryColor }     from "@/lib/emailServer";
import { RESET_TOKEN_TTL_MS }                          from "@/lib/auth";
import { parseBody }                                   from "@/lib/apiValidation";

function hashToken(rawToken: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(rawToken).digest("hex");
}

function buildResetEmail(name: string, resetUrl: string, brandColor: string): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;padding:24px">
      <h2 style="margin-bottom:8px;color:#111">Password reset request</h2>
      <p style="color:#555;margin-bottom:8px">Hi ${name},</p>
      <p style="color:#555;margin-bottom:24px">
        An admin has initiated a password reset for your account.
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
    </div>`;
}

const SendResetSchema = z.object({
  email: z.string().trim().email("A valid email is required."),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  // id is not used for the lookup (we use email — matches the legacy route's
  // behaviour and keeps the surface symmetric), but resolve the param anyway
  // so Next doesn't complain about an unused dynamic segment.
  await context.params;

  const parsed = await parseBody(req, SendResetSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const normalizedEmail = parsed.data.email.toLowerCase();
  const siteUrl    = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const brandColor = await fetchBrandPrimaryColor();

  const { data } = await supabaseAdmin
    .from("customers")
    .select("id, name")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  }

  const rawToken    = randomBytes(32).toString("hex");
  const hashedToken = hashToken(rawToken);
  const expires     = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  await supabaseAdmin
    .from("customers")
    .update({ reset_token: hashedToken, reset_token_expires: expires })
    .eq("id", data.id);

  const resetUrl = `${siteUrl}/login?action=reset&token=${rawToken}&email=${encodeURIComponent(normalizedEmail)}`;
  const html     = buildResetEmail(data.name ?? "Customer", resetUrl, brandColor);

  const result = await sendEmailDirect(normalizedEmail, "Reset your password", html);
  if (!result.ok) {
    console.error("[admin/customers/send-reset] email failed:", result.error);
    return NextResponse.json({ ok: false, error: result.error ?? "Failed to send email." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
