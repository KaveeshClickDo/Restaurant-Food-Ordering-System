/**
 * POST /api/admin/campaigns/test — send a rendered preview of a campaign to
 * one address (the admin's own). Byte-identical to the real send: same
 * builder, same unsubscribe footer + RFC 8058 headers, {{name}}/{{email}}
 * resolved against the test recipient. Nothing is persisted — this never
 * touches the campaigns tables.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { sendEmail, emailConfigured } from "@/lib/emailSender";
import { parseBody } from "@/lib/apiValidation";
import { CampaignTestSchema } from "@/lib/schemas/campaign";
import { buildCampaignEmail, fetchAdminSettings } from "@/lib/marketingCampaigns";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  if (!emailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Email is not configured (set RESEND_API_KEY or SMTP_HOST)." },
      { status: 503 },
    );
  }

  const parsed = await parseBody(req, CampaignTestSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { subject, bodyHtml, previewText, to } = parsed.data;

  const settings = await fetchAdminSettings();
  if (!settings) {
    return NextResponse.json({ ok: false, error: "Restaurant settings not found." }, { status: 500 });
  }

  const email = buildCampaignEmail({
    subjectTemplate:  subject,
    bodyTemplate:     bodyHtml,
    previewText,
    recipientName:    to.split("@")[0],
    recipientEmail:   to,
    // A test isn't tied to a real contact; the token resolves to a harmless
    // "link looks incomplete" page if ever clicked. No tracking pixel on tests.
    unsubscribeToken: "preview",
    settings,
  });

  const result = await sendEmail({
    to,
    subject: `[TEST] ${email.subject}`,
    html:    email.html,
    headers: email.headers,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
