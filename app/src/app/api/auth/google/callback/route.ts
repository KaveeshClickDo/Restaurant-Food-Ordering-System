/**
 * GET /api/auth/google/callback — completes the Google OAuth 2.0 flow.
 *
 * Steps:
 *  1. Validate CSRF state against the cookie written by /api/auth/google.
 *  2. Exchange the authorization code for an access token.
 *  3. Fetch the user's profile (email, name) from Google.
 *  4. Find an existing customer by email, or create one (no password required).
 *  5. Issue our standard HMAC session cookie and redirect home.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   NEXT_PUBLIC_SITE_URL
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID }    from "crypto";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  setSessionCookie,
  COOKIE_CUSTOMER,
} from "@/lib/auth";

function getSecret(): string {
  return (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
}

function verifyState(state: string): boolean {
  const dot = state.lastIndexOf(".");
  if (dot === -1) return false;
  const raw      = state.slice(0, dot);
  const sig      = state.slice(dot + 1);
  const expected = createHmac("sha256", getSecret()).update(raw).digest("hex");
  return sig === expected;
}

function clearStateCookie(res: NextResponse) {
  res.cookies.set("google_oauth_state", "", {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   0,
  });
}

interface GoogleProfile {
  sub:            string;
  email:          string;
  name:           string;
  picture?:       string;
  email_verified: boolean;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code       = searchParams.get("code");
  const state      = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${siteUrl}/?google_auth_error=${reason}`);
    clearStateCookie(res);
    return res;
  };

  // User denied access or Google returned an error
  if (oauthError || !code || !state) return fail("access_denied");

  // Validate CSRF state
  const stored = req.cookies.get("google_oauth_state")?.value;
  if (!stored || stored !== state || !verifyState(state)) return fail("invalid_state");

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("not_configured");

  const redirectUri = `${siteUrl}/api/auth/google/callback`;

  // ── Exchange code for access token ──────────────────────────────────────────
  let profile: GoogleProfile | null = null;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      console.error("[google/callback] token error:", tokenData.error);
      return fail("token_exchange_failed");
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    profile = await profileRes.json() as GoogleProfile;
  } catch (e) {
    console.error("[google/callback] fetch failed:", e);
    return fail("network_error");
  }

  if (!profile?.email) return fail("no_email");

  const email = profile.email.toLowerCase();
  const name  = profile.name?.trim() || email.split("@")[0];

  // ── Find or create customer ──────────────────────────────────────────────────
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (lookupErr) {
    console.error("[google/callback] lookup:", lookupErr.message);
    return fail("db_error");
  }

  let customerId: string;

  if (existing) {
    // Existing account — link by email (mark verified while we're here)
    customerId = existing.id;
    await supabaseAdmin
      .from("customers")
      .update({ email_verified: true })
      .eq("id", customerId)
      .then(() => {}); // fire-and-forget; column may not exist yet — that's fine
  } else {
    // New customer — create a password-less account
    customerId = randomUUID();
    const now  = new Date().toISOString();

    const baseRow = {
      id:              customerId,
      name,
      email,
      phone:           "",
      password:        "",
      tags:            [] as string[],
      favourites:      [] as string[],
      saved_addresses: [] as unknown[],
      store_credit:    0,
      created_at:      now,
    };

    // Try with migration columns; fall back if they don't exist yet
    const { error: insErr } = await supabaseAdmin.from("customers").insert({
      ...baseRow,
      password_hash:  "",
      email_verified: true,
    });

    if (insErr) {
      if (insErr.code === "PGRST204") {
        // Migration not applied — insert without new columns
        const { error: fbErr } = await supabaseAdmin.from("customers").insert(baseRow);
        if (fbErr) {
          console.error("[google/callback] insert fallback:", fbErr.message);
          return fail("account_creation_failed");
        }
      } else {
        console.error("[google/callback] insert:", insErr.message);
        return fail("account_creation_failed");
      }
    }
  }

  // ── Issue session cookie and redirect home ──────────────────────────────────
  const token = createSessionToken({ id: customerId, role: "customer" });
  const res   = NextResponse.redirect(`${siteUrl}/`);
  setSessionCookie(res, COOKIE_CUSTOMER, token);
  clearStateCookie(res);
  return res;
}
