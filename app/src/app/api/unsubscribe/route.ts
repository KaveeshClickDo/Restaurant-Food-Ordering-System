/**
 * /api/unsubscribe — public marketing opt-out endpoint (no auth).
 *
 * The bearer secret is the contact's unsubscribe_token (a uuid minted per
 * contact row), carried in the ?token= query param. Two verbs:
 *
 *   POST  — actually unsubscribes. This is the RFC 8058 one-click target:
 *           Gmail/Yahoo POST here directly from their native "Unsubscribe"
 *           button (List-Unsubscribe-Post: List-Unsubscribe=One-Click), and
 *           the /unsubscribe confirm page posts here too.
 *   GET   — never unsubscribes (link prefetchers must not opt people out);
 *           redirects the human to the /unsubscribe confirm page instead.
 *
 * Unsubscribing sets marketing_opt_in=false + unsubscribed_at=now. The
 * campaign sender suppresses on either signal, and re-running the schema
 * migration never reverts it (the opt-in flip is guarded one-time).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";

function getToken(req: NextRequest): string {
  return req.nextUrl.searchParams.get("token")?.trim() ?? "";
}

export async function GET(req: NextRequest) {
  const token = getToken(req);
  const url   = new URL(`/unsubscribe${token ? `?token=${encodeURIComponent(token)}` : ""}`, req.nextUrl.origin);
  return NextResponse.redirect(url, 307);
}

export async function POST(req: NextRequest) {
  // Public endpoint keyed by a guessable-in-theory token — cap per-IP probing.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`unsubscribe:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  const token = getToken(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("marketing_contacts")
    .update({
      marketing_opt_in: false,
      unsubscribed_at:  new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    })
    .eq("unsubscribe_token", token)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("unsubscribe POST:", error.message);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
  // Unknown token still answers 200 — an unsubscribe request must never
  // "fail" for the person clicking it, and a 404 would leak token validity.
  return NextResponse.json({ ok: true, matched: !!data });
}
