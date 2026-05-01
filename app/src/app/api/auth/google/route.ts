/**
 * GET /api/auth/google — kicks off the Google OAuth 2.0 flow.
 * Generates a signed CSRF state, stores it in a short-lived httpOnly cookie,
 * then redirects the browser to Google's consent screen.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   NEXT_PUBLIC_SITE_URL  (e.g. https://yoursite.com)
 */

import { NextResponse } from "next/server";
import { randomBytes, createHmac } from "crypto";

function getSecret(): string {
  return (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
}

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Google OAuth is not configured (GOOGLE_CLIENT_ID missing)." },
      { status: 500 },
    );
  }

  const siteUrl     = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${siteUrl}/api/auth/google/callback`;

  // CSRF state: random hex + HMAC signature so the callback can verify it
  const raw   = randomBytes(16).toString("hex");
  const sig   = createHmac("sha256", getSecret()).update(raw).digest("hex");
  const state = `${raw}.${sig}`;

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "openid email profile",
    state,
    access_type:   "online",
    prompt:        "select_account",
  });

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );

  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   600, // 10 minutes — enough time to complete the Google consent flow
  });

  return res;
}
