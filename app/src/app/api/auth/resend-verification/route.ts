/**
 * POST /api/auth/resend-verification
 * Generates a fresh verification token and re-sends the email.
 *
 * Two modes:
 *  - Logged-in: uses the customer session cookie (existing flow, e.g. clicking
 *    "Resend" in the in-app verification banner).
 *  - Logged-out: looks the customer up by an `email` field in the body,
 *    rate-limited per IP. Used by the verify-email page after a fresh
 *    registration when the link has expired and the user is not yet signed in.
 *
 * To avoid email-enumeration leaks, the logged-out path returns 200 regardless
 * of whether the email is registered.
 */

import { NextRequest, NextResponse }  from "next/server";
import { createHmac, randomBytes }    from "crypto";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { sendEmailDirect, fetchBrandPrimaryColor } from "@/lib/emailServer";
import { getCustomerSession }         from "@/lib/auth";
import { rateLimit }                  from "@/lib/rateLimit";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(raw: string): string {
  const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
  return createHmac("sha256", secret).update(raw).digest("hex");
}

export async function POST(req: NextRequest) {
  const session = await getCustomerSession();

  let customerLookup: { id: string } | { email: string } | null = null;

  if (session) {
    customerLookup = { id: session.id };
  } else {
    // Logged-out path — accept email from body, rate-limit per IP
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const { limited } = rateLimit(`resend-verify:${ip}`, 5, 60_000);
    if (limited) {
      return NextResponse.json({ ok: false, error: "Too many requests. Please wait a minute." }, { status: 429 });
    }

    let body: { email?: string } = {};
    try { body = await req.json(); } catch { /* empty body OK */ }
    const email = body.email?.trim().toLowerCase();
    // Always return 200 in the logged-out path so we don't leak whether the
    // email is registered. Silently no-op when the input is missing/invalid.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: true });
    }
    customerLookup = { email };
  }

  const query = supabaseAdmin
    .from("customers")
    .select("id, name, email, email_verified");
  const { data, error } = "id" in customerLookup
    ? await query.eq("id", customerLookup.id).maybeSingle()
    : await query.eq("email", customerLookup.email).maybeSingle();

  if (error?.code === "PGRST204") {
    return NextResponse.json({ ok: false, error: "Email verification not set up yet. Apply supabase/schema.sql first." }, { status: 503 });
  }
  // Logged-out path: silently succeed if the email isn't in the table
  if (!data) {
    return NextResponse.json({ ok: true });
  }
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
