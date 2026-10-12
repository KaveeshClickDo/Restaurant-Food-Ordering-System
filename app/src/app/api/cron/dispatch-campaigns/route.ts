/**
 * GET/POST /api/cron/dispatch-campaigns — scheduled-broadcast worker.
 *
 * There is no other background scheduler in this app, so this endpoint is the
 * trigger for scheduled broadcasts. Hit it on a schedule (every ~5 minutes).
 * This app runs as a systemd service on a Debian server, so the natural setup
 * is the server's own crontab (or a systemd timer) hitting the local port with
 * a curl call to this path plus `?secret=YOUR_CRON_SECRET`. A DB-side trigger
 * also works: Supabase pg_cron + pg_net can POST this URL on a schedule instead
 * of a server cron. See docs/marketing/SCHEDULING.md for the exact commands.
 *
 * Auth: requires CRON_SECRET (env). Accepts it as a Bearer token or ?secret=.
 * If CRON_SECRET is unset the endpoint refuses (503) rather than run open.
 *
 * Each run: promotes due 'scheduled' campaigns to sending (freezing their
 * recipients), then processes ONE batch for each in-flight campaign. Sends are
 * resumable, so repeated ticks drain each broadcast gradually — no single
 * request has to send the whole thing.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { emailConfigured } from "@/lib/emailSender";
import {
  ensureRecipientsFrozen, processCampaignBatch, fetchAdminSettings, type Audience,
} from "@/lib/marketingCampaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap campaigns advanced per tick so one invocation stays within the runtime.
const MAX_CAMPAIGNS_PER_TICK = 3;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const query  = req.nextUrl.searchParams.get("secret")?.trim();
  return bearer === secret || query === secret;
}

async function handle(req: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!emailConfigured()) {
    return NextResponse.json({ ok: false, error: "Email not configured." }, { status: 503 });
  }

  const now = new Date().toISOString();

  // 1. Promote due scheduled campaigns → freeze recipients (flips to sending).
  const { data: due } = await supabaseAdmin
    .from("email_campaigns")
    .select("id, audience")
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .limit(MAX_CAMPAIGNS_PER_TICK);
  for (const c of due ?? []) {
    await ensureRecipientsFrozen(c.id as string, (c.audience ?? { mode: "all" }) as Audience);
  }

  // 2. Advance every in-flight (sending) campaign by one batch.
  const settings = await fetchAdminSettings();
  if (!settings) {
    return NextResponse.json({ ok: false, error: "Settings not found." }, { status: 500 });
  }
  const { data: sending } = await supabaseAdmin
    .from("email_campaigns")
    .select("id, subject, body_html, preview_text")
    .eq("status", "sending")
    .limit(MAX_CAMPAIGNS_PER_TICK);

  const results: Array<{ id: string; done: boolean; remaining: number }> = [];
  for (const c of sending ?? []) {
    const outcome = await processCampaignBatch(c, settings);
    results.push({ id: c.id as string, done: outcome.done, remaining: outcome.remaining });
  }

  return NextResponse.json({ ok: true, promoted: (due ?? []).length, advanced: results });
}

export const GET  = handle;
export const POST = handle;
