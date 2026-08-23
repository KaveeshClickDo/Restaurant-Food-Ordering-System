/**
 * POST /api/admin/campaigns/[id]/cancel — stop an in-flight broadcast.
 *
 * Exists because of a specific dead end. A broadcast that runs out of
 * allowance part-way through stays `sending` indefinitely: its remaining
 * recipients sit `pending`, waiting for a top-up that may never come. And
 * DELETE deliberately refuses anything in `sending`, so until now an owner who
 * changed their mind — or built the campaign by mistake — had no way out at
 * all. Their only option was to pay.
 *
 * Cancelling marks the untouched recipients `skipped`, never `failed`: nothing
 * was attempted for them, and calling that a failure would misreport the
 * campaign's stats forever. Recipients already sent stay sent — those emails
 * are gone and the record has to say so.
 *
 * Nothing is refunded, because nothing was charged: the Marketing API only
 * ever bills for what it actually handed to SES.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const { data: campaign } = await supabaseAdmin
    .from("email_campaigns")
    .select("id, status, sent_count")
    .eq("id", id)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ ok: false, error: "Broadcast not found." }, { status: 404 });
  }
  // Only an in-flight broadcast can be cancelled. A draft or a scheduled one is
  // deleted instead, and a finished one is history — pretending either can be
  // "cancelled" would just be a confusing second word for the same action.
  if (campaign.status !== "sending") {
    return NextResponse.json(
      { ok: false, error: `This broadcast isn't sending — it's ${campaign.status}.` },
      { status: 409 },
    );
  }

  // Recipients that were never attempted. Skipped, not failed.
  const { data: stopped, error: stopError } = await supabaseAdmin
    .from("email_campaign_recipients")
    .update({ status: "skipped", error: "Cancelled before sending." })
    .eq("campaign_id", id)
    .eq("status", "pending")
    .select("id");

  if (stopError) {
    console.error("campaigns/cancel recipients:", stopError.message);
    return NextResponse.json({ ok: false, error: "Could not stop the remaining sends." }, { status: 500 });
  }

  const skipped = stopped?.length ?? 0;

  // Re-tally from the recipient rows rather than trusting the counters. A
  // cancel can land while a batch is mid-flight, and the rows are the only
  // record that survives that race.
  const { data: tallies } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("status")
    .eq("campaign_id", id);

  const totals = { sent: 0, failed: 0, skipped: 0 };
  for (const t of tallies ?? []) {
    if (t.status === "sent") totals.sent++;
    else if (t.status === "failed") totals.failed++;
    else if (t.status === "skipped") totals.skipped++;
  }

  const { error } = await supabaseAdmin
    .from("email_campaigns")
    .update({
      status: "cancelled",
      sent_count: totals.sent,
      failed_count: totals.failed,
      skipped_count: totals.skipped,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("campaigns/cancel:", error.message);
    return NextResponse.json({ ok: false, error: "Could not cancel the broadcast." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sent: totals.sent, stopped: skipped });
}
