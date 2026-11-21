/**
 * GET  /api/admin/campaigns — list broadcasts (history), newest first.
 * POST /api/admin/campaigns — create a DRAFT broadcast.
 *
 * A draft stores subject / body / preview text / audience descriptor but does
 * NOT freeze recipients — that happens at send time ([id]/send), so the
 * audience is always resolved against who's opted-in *then*. The composer can
 * keep PATCHing the draft until it's sent or scheduled.
 *
 * GET query params:
 *   page/pageSize  paginates via `.range()` (default page 1, pageSize 10,
 *                  max 100); returns `totalCount` (exact DB count, not
 *                  capped). `stats` (sentCount, totalSent, totalOpened) is a
 *                  separate aggregate over every campaign ever sent,
 *                  independent of the current page — the history panel's
 *                  summary tiles must reflect everything, not just one page.
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

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const page     = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 10));
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo   = rangeFrom + pageSize - 1;

  const [listResult, statsResult] = await Promise.all([
    supabaseAdmin
      .from("email_campaigns")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(rangeFrom, rangeTo),
    supabaseAdmin.from("email_campaigns").select("status, sent_count, opened_count"),
  ]);

  const { data, error, count } = listResult;
  if (error) {
    console.error("admin/campaigns GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (statsResult.error) console.error("admin/campaigns GET (stats):", statsResult.error.message);

  const sentRows = (statsResult.data ?? []).filter((r) => r.status === "sent");
  const stats = {
    sentCount:   sentRows.length,
    totalSent:   sentRows.reduce((s, r) => s + (r.sent_count ?? 0), 0),
    totalOpened: sentRows.reduce((s, r) => s + (r.opened_count ?? 0), 0),
  };

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
  return NextResponse.json({
    ok: true, campaigns, totalCount: count ?? campaigns.length, page, pageSize, stats,
  });
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
