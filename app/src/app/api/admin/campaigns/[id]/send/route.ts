/**
 * POST /api/admin/campaigns/[id]/send — process ONE batch of a campaign.
 *
 * Resumable by design. Each call:
 *   1. claims up to BATCH_SIZE 'pending' recipients for this campaign,
 *   2. for each: re-checks the contact is still opted-in (skip if not),
 *      renders the personalised email, sends it (throttled ~2/sec to stay
 *      under Resend's account rate limit), then stamps the row,
 *   3. updates the campaign's counters and returns `{ remaining, done }`.
 *
 * The admin UI calls this in a loop until `done` is true, so a large campaign
 * is drained across many short requests instead of one long one that a
 * serverless runtime would kill. Rows are marked only AFTER a successful send,
 * so a crash never silently drops a recipient.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendEmail, emailConfigured } from "@/lib/emailSender";
import { buildCampaignEmail, fetchAdminSettings } from "@/lib/marketingCampaigns";

export const runtime = "nodejs";

// Small batches keep each request well under the serverless wall clock. At
// ~500ms throttle between sends, 12 sends ≈ 6s per call.
const BATCH_SIZE = 12;
const SEND_INTERVAL_MS = 500; // ~2 sends/sec — Resend's account-wide cap.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id: campaignId } = await params;

  if (!emailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Email is not configured (set RESEND_API_KEY or SMTP_HOST)." },
      { status: 503 },
    );
  }

  const { data: campaign, error: cErr } = await supabaseAdmin
    .from("email_campaigns")
    .select("id, subject, body_html, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (cErr)       return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
  if (!campaign)  return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  if (campaign.status === "cancelled") {
    return NextResponse.json({ ok: false, error: "Campaign was cancelled." }, { status: 409 });
  }

  const settings = await fetchAdminSettings();
  if (!settings) {
    return NextResponse.json({ ok: false, error: "Restaurant settings not found." }, { status: 500 });
  }

  // Flip draft → sending on the first batch.
  if (campaign.status === "draft") {
    await supabaseAdmin.from("email_campaigns").update({ status: "sending" }).eq("id", campaignId);
  }

  // Claim a batch of pending recipients.
  const { data: batch, error: bErr } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("id, contact_id, email, name")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .limit(BATCH_SIZE);
  if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });

  let sent = 0, failed = 0, skipped = 0;

  for (const r of batch ?? []) {
    // Re-check opt-in at send time — a contact may have unsubscribed after the
    // snapshot was frozen. Also fetch the live unsubscribe token for the footer.
    const { data: contact } = await supabaseAdmin
      .from("reservation_customers")
      .select("marketing_opt_in, unsubscribed_at, unsubscribe_token")
      .eq("id", r.contact_id ?? "")
      .maybeSingle();

    if (!contact || contact.marketing_opt_in !== true || contact.unsubscribed_at) {
      await supabaseAdmin.from("email_campaign_recipients")
        .update({ status: "skipped", error: "Not opted in at send time." })
        .eq("id", r.id);
      skipped++;
      continue;
    }

    const email = buildCampaignEmail({
      subjectTemplate:  campaign.subject,
      bodyTemplate:     campaign.body_html,
      recipientName:    r.name ?? "",
      recipientEmail:   r.email,
      unsubscribeToken: contact.unsubscribe_token as string,
      settings,
    });

    const result = await sendEmail({
      to:      r.email,
      subject: email.subject,
      html:    email.html,
      headers: email.headers,
    });

    if (result.ok) {
      await supabaseAdmin.from("email_campaign_recipients")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
        .eq("id", r.id);
      sent++;
    } else {
      await supabaseAdmin.from("email_campaign_recipients")
        .update({ status: "failed", error: result.error ?? "Send failed." })
        .eq("id", r.id);
      failed++;
    }

    await sleep(SEND_INTERVAL_MS);
  }

  // How many still pending after this batch?
  const { count: remaining } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "pending");

  // Roll up live counters from the recipient rows (authoritative — survives
  // overlapping calls better than incrementing).
  const { data: tallies } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("status")
    .eq("campaign_id", campaignId);
  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (const t of tallies ?? []) {
    if (t.status === "sent")    counts.sent++;
    else if (t.status === "failed")  counts.failed++;
    else if (t.status === "skipped") counts.skipped++;
  }

  const done = (remaining ?? 0) === 0;
  await supabaseAdmin.from("email_campaigns").update({
    sent_count:    counts.sent,
    failed_count:  counts.failed,
    skipped_count: counts.skipped,
    ...(done ? { status: "sent", completed_at: new Date().toISOString() } : {}),
  }).eq("id", campaignId);

  return NextResponse.json({
    ok: true,
    done,
    remaining: remaining ?? 0,
    batch: { sent, failed, skipped },
    totals: counts,
  });
}
