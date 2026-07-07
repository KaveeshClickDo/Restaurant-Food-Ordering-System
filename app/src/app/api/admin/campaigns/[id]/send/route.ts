/**
 * POST /api/admin/campaigns/[id]/send — process ONE batch of a broadcast.
 *
 * First call freezes the recipient snapshot from the campaign's audience
 * (re-validating opt-in) and flips status draft → sending. Each call then
 * sends a small batch and returns `{ done, remaining, totals }`. The composer
 * calls this in a loop until `done`, so a big broadcast drains across many
 * short requests instead of one long one a serverless runtime would kill.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { emailConfigured } from "@/lib/emailSender";
import {
  ensureRecipientsFrozen, processCampaignBatch, fetchAdminSettings, type Audience,
} from "@/lib/marketingCampaigns";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  if (!emailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Email is not configured (set RESEND_API_KEY or SMTP_HOST)." },
      { status: 503 },
    );
  }

  const { data: campaign, error } = await supabaseAdmin
    .from("email_campaigns")
    .select("id, subject, body_html, preview_text, audience, status")
    .eq("id", id)
    .maybeSingle();
  if (error)      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!campaign)  return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  if (campaign.status === "cancelled") {
    return NextResponse.json({ ok: false, error: "Campaign was cancelled." }, { status: 409 });
  }
  if (campaign.status === "sent") {
    return NextResponse.json({ ok: true, done: true, remaining: 0, totals: { sent: 0, failed: 0, skipped: 0 } });
  }

  const settings = await fetchAdminSettings();
  if (!settings) {
    return NextResponse.json({ ok: false, error: "Restaurant settings not found." }, { status: 500 });
  }

  // Freeze recipients on the first batch (idempotent thereafter).
  const frozen = await ensureRecipientsFrozen(id, (campaign.audience ?? { mode: "all" }) as Audience);
  if (frozen === 0) {
    await supabaseAdmin.from("email_campaigns")
      .update({ status: "sent", completed_at: new Date().toISOString(), total_recipients: 0 })
      .eq("id", id);
    return NextResponse.json(
      { ok: false, error: "No opted-in contacts match this audience.", done: true, remaining: 0 },
      { status: 400 },
    );
  }

  const outcome = await processCampaignBatch(campaign, settings);
  return NextResponse.json({ ok: true, ...outcome });
}
