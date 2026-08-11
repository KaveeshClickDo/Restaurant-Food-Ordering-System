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
import { parseBody } from "@/lib/apiValidation";
import { CampaignTestSchema } from "@/lib/schemas/campaign";
import { buildCampaignEmail, fetchAdminSettings } from "@/lib/marketingCampaigns";
import { sendMarketingBatch, marketingApiConfigured } from "@/lib/marketingCloud";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  // A test costs nothing against the allowance — deliberately, so a draft can
  // be checked while out of credits, or before buying a package at all. The
  // Marketing API caps them per day instead, so they can't become free sending.
  if (!marketingApiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Broadcast sending isn't set up on this site yet." },
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

  // Sent through the same path as a real broadcast, so the test proves the
  // whole chain works — not just this server's ability to render an email.
  try {
    const result = await sendMarketingBatch({
      campaignRef: "test",
      fromName:    settings.receiptSettings?.restaurantName?.trim() || settings.restaurant?.name || "",
      test:        true,
      messages: [{
        ref:     crypto.randomUUID(),
        to,
        subject: `[TEST] ${email.subject}`,
        html:    email.html,
        headers: email.headers,
      }],
    });

    const rejected = result.rejected[0];
    if (rejected) {
      const error = rejected.reason === "rate_limited"
        ? "You've used today's test sends. Try again tomorrow."
        : rejected.detail ?? `Test send was rejected (${rejected.reason}).`;
      return NextResponse.json({ ok: false, error }, { status: 429 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the sending service.";
    console.error("campaigns/test:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
