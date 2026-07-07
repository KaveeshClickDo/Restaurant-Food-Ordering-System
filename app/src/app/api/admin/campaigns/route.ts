/**
 * GET  /api/admin/campaigns — list campaigns (history), newest first.
 * POST /api/admin/campaigns — create a campaign + freeze its recipient list.
 *
 * The POST takes the contact ids the admin selected in the panel, then
 * RE-VALIDATES them server-side: only contacts that are still opted-in, not
 * unsubscribed, and hold a real (non-@internal.local) email become recipient
 * rows. This is the suppression gate — a stale browser selection can never
 * email someone who opted out. The recipient rows are the send queue; the
 * actual sending happens in [id]/send.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseBody } from "@/lib/apiValidation";
import { CampaignCreateSchema } from "@/lib/schemas/campaign";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("email_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("admin/campaigns GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const campaigns = (data ?? []).map((c) => ({
    id:              c.id,
    subject:         c.subject,
    status:          c.status,
    totalRecipients: c.total_recipients,
    sentCount:       c.sent_count,
    failedCount:     c.failed_count,
    skippedCount:    c.skipped_count,
    createdAt:       c.created_at,
    completedAt:     c.completed_at,
  }));
  return NextResponse.json({ ok: true, campaigns });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, CampaignCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { subject, bodyHtml, contactIds, audience } = parsed.data;

  // Re-validate the selection: mailable = opted-in, not unsubscribed, real
  // email. This is the authoritative suppression gate.
  const { data: contacts, error: fetchErr } = await supabaseAdmin
    .from("reservation_customers")
    .select("id, email, name, marketing_opt_in, unsubscribed_at")
    .in("id", contactIds);

  if (fetchErr) {
    console.error("admin/campaigns POST fetch:", fetchErr.message);
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }

  const mailable = (contacts ?? []).filter((c) =>
    c.marketing_opt_in === true &&
    !c.unsubscribed_at &&
    typeof c.email === "string" &&
    !c.email.toLowerCase().endsWith("@internal.local"),
  );

  if (mailable.length === 0) {
    return NextResponse.json(
      { ok: false, error: "None of the selected contacts are opted in for marketing." },
      { status: 400 },
    );
  }

  const campaignId = crypto.randomUUID();
  const { error: insErr } = await supabaseAdmin.from("email_campaigns").insert({
    id:               campaignId,
    subject,
    body_html:        bodyHtml,
    status:           "draft",
    audience:         audience ?? {},
    total_recipients: mailable.length,
  });
  if (insErr) {
    console.error("admin/campaigns POST insert:", insErr.message);
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  // Freeze the recipient snapshot. Chunked insert keeps the payload sane for
  // large audiences.
  const rows = mailable.map((c) => ({
    id:          crypto.randomUUID(),
    campaign_id: campaignId,
    contact_id:  c.id,
    email:       c.email,
    name:        c.name ?? "",
    status:      "pending",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: rErr } = await supabaseAdmin
      .from("email_campaign_recipients")
      .insert(rows.slice(i, i + 500));
    if (rErr) {
      // Roll back the campaign so a half-built queue can't be sent.
      await supabaseAdmin.from("email_campaigns").delete().eq("id", campaignId);
      console.error("admin/campaigns POST recipients:", rErr.message);
      return NextResponse.json({ ok: false, error: rErr.message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { ok: true, id: campaignId, totalRecipients: mailable.length },
    { status: 201 },
  );
}
