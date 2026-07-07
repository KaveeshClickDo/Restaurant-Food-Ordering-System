/**
 * GET  /api/admin/campaigns — list broadcasts (history), newest first.
 * POST /api/admin/campaigns — create a DRAFT broadcast.
 *
 * A draft stores subject / body / preview text / audience descriptor but does
 * NOT freeze recipients — that happens at send time ([id]/send), so the
 * audience is always resolved against who's opted-in *then*. The composer can
 * keep PATCHing the draft until it's sent or scheduled.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseBody } from "@/lib/apiValidation";
import { CampaignCreateSchema } from "@/lib/schemas/campaign";
import { resolveAudience, type Audience } from "@/lib/marketingCampaigns";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("email_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("admin/campaigns GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const campaigns = (data ?? []).map((c) => ({
    id:              c.id,
    subject:         c.subject,
    previewText:     c.preview_text ?? "",
    status:          c.status,
    audience:        c.audience ?? { mode: "all" },
    scheduledAt:     c.scheduled_at ?? undefined,
    totalRecipients: c.total_recipients,
    sentCount:       c.sent_count,
    failedCount:     c.failed_count,
    skippedCount:    c.skipped_count,
    openedCount:     c.opened_count ?? 0,
    createdAt:       c.created_at,
    completedAt:     c.completed_at ?? undefined,
  }));
  return NextResponse.json({ ok: true, campaigns });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, CampaignCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { subject, bodyHtml, previewText, audience } = parsed.data;

  const id = crypto.randomUUID();
  const { error } = await supabaseAdmin.from("email_campaigns").insert({
    id,
    subject,
    body_html:    bodyHtml,
    preview_text: previewText,
    status:       "draft",
    audience,
  });
  if (error) {
    console.error("admin/campaigns POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Return the current resolved recipient count so the composer can show it
  // live without freezing anyone yet.
  const recipients = await resolveAudience(audience as Audience);
  return NextResponse.json({ ok: true, id, recipientCount: recipients.length }, { status: 201 });
}
