/**
 * GET    /api/admin/campaigns/[id] — fetch one campaign (resume a draft, view stats).
 * PATCH  /api/admin/campaigns/[id] — update draft fields; schedule / unschedule.
 * DELETE /api/admin/campaigns/[id] — delete a draft or scheduled campaign.
 *
 * Editing is only allowed while the campaign is a draft or scheduled — once
 * it's sending/sent the content and audience are frozen.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseBody } from "@/lib/apiValidation";
import { CampaignUpdateSchema } from "@/lib/schemas/campaign";

export const runtime = "nodejs";

const EDITABLE = new Set(["draft", "scheduled"]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const { data: c, error } = await supabaseAdmin
    .from("email_campaigns").select("*").eq("id", id).maybeSingle();
  if (error)  return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!c)     return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  return NextResponse.json({
    ok: true,
    campaign: {
      id:              c.id,
      subject:         c.subject,
      bodyHtml:        c.body_html,
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
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, CampaignUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const { data: existing } = await supabaseAdmin
    .from("email_campaigns").select("status").eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (!EDITABLE.has(existing.status as string)) {
    return NextResponse.json({ ok: false, error: "This broadcast has already been sent and can't be edited." }, { status: 409 });
  }

  const patch: Record<string, unknown> = {};
  if (body.subject     !== undefined) patch.subject      = body.subject;
  if (body.bodyHtml    !== undefined) patch.body_html    = body.bodyHtml;
  if (body.previewText !== undefined) patch.preview_text = body.previewText;
  if (body.audience    !== undefined) patch.audience     = body.audience;
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt === null) {
      patch.scheduled_at = null;
      patch.status = "draft";
    } else {
      patch.scheduled_at = body.scheduledAt;
      patch.status = "scheduled";
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabaseAdmin.from("email_campaigns").update(patch).eq("id", id);
  if (error) {
    console.error("admin/campaigns PATCH:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const { data: existing } = await supabaseAdmin
    .from("email_campaigns").select("status").eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ ok: true });
  if (existing.status === "sending") {
    return NextResponse.json({ ok: false, error: "Can't delete a broadcast while it's sending." }, { status: 409 });
  }

  // recipients cascade-delete via the FK.
  const { error } = await supabaseAdmin.from("email_campaigns").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
