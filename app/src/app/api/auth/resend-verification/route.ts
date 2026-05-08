/**
 * POST /api/auth/resend-verification
 * Generates a fresh verification token and re-sends the email.
 * Requires the customer to be logged in (reads session cookie).
 */

import { NextResponse }               from "next/server";
import { createHmac, randomBytes }    from "crypto";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { sendEmailDirect, fetchBrandPrimaryColor } from "@/lib/emailServer";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(raw: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(raw).digest("hex");
}

export async function POST() {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, email_verified")
    .eq("id", session.id)
    .single();

  if (error?.code === "PGRST204") {
    return NextResponse.json({ ok: false, error: "Email verification not set up yet. Run the auth migration first." }, { status: 503 });
  }
  if (error || !data) return unauthorizedJson();
  if (data.email_verified) return NextResponse.json({ ok: true, alreadyVerified: true });

  const rawToken    = randomBytes(32).toString("hex");
  const hashedToken = hashToken(rawToken);
  const expires     = new Date(Date.now() + VERIFY_TTL_MS).toISOString();

  await supabaseAdmin
    .from("customers")
    .update({ email_verification_token: hashedToken, email_verification_expires: expires })
    .eq("id", data.id);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const link    = `${siteUrl}/verify-email?token=${rawToken}&email=${encodeURIComponent(data.email)}`;

  if (!process.env.SMTP_HOST) {
    console.log("[resend-verification] Verify URL:", link);
  } else {
    const brandColor = await fetchBrandPrimaryColor();
    const result = await sendEmailDirect(
      data.email,
      "Verify your email address",
      `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2 style="margin-bottom:8px">Hi ${data.name}, confirm your email</h2>
        <p style="color:#555;margin-bottom:24px">
          Click the button below to verify your email address.
          This link expires in <strong>24 hours</strong>.
        </p>
        <a href="${link}"
           style="display:inline-block;background:${brandColor};color:#fff;font-weight:700;
                  text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px">
          Verify my email
        </a>
      </div>`,
    );
    if (!result.ok) console.error("[resend-verification] email failed:", result.error);
  }

  return NextResponse.json({ ok: true });
}
