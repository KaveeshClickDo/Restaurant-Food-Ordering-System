/**
 * GET /api/track/open?r=<recipientId> — email open-tracking pixel (public).
 *
 * Every campaign email embeds <img src="…/api/track/open?r=<recipient row id>">.
 * When the recipient's client loads images, this fires: on the FIRST open we
 * stamp opened_at and bump the campaign's opened_count. Always returns a 1x1
 * transparent GIF with no-cache headers so repeat opens still reach us (but
 * only the first is counted).
 *
 * The recipient id is a random uuid — unguessable enough for a soft metric.
 * Never errors to the client; a tracking failure must not show a broken image.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function pixelResponse(): NextResponse {
  return new NextResponse(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type":  "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma":        "no-cache",
    },
  });
}

export async function GET(req: NextRequest) {
  const recipientId = req.nextUrl.searchParams.get("r")?.trim();
  if (!recipientId) return pixelResponse();

  try {
    // Only the first open counts. Guard on opened_at is null so a re-open (or a
    // proxy prefetch firing twice) can't double-count.
    const { data: rec } = await supabaseAdmin
      .from("email_campaign_recipients")
      .select("id, campaign_id, opened_at")
      .eq("id", recipientId)
      .maybeSingle();

    if (rec && !rec.opened_at) {
      const now = new Date().toISOString();
      const { data: claimed } = await supabaseAdmin
        .from("email_campaign_recipients")
        .update({ opened_at: now })
        .eq("id", recipientId)
        .is("opened_at", null)          // race guard — only one update wins
        .select("id")
        .maybeSingle();

      if (claimed) {
        // Bump the campaign's opened_count via the current tally (no atomic
        // increment RPC here; recompute from the authoritative rows).
        const { count } = await supabaseAdmin
          .from("email_campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", rec.campaign_id)
          .not("opened_at", "is", null);
        await supabaseAdmin
          .from("email_campaigns")
          .update({ opened_count: count ?? 0 })
          .eq("id", rec.campaign_id);
      }
    }
  } catch (err) {
    console.error("track/open:", err instanceof Error ? err.message : err);
  }

  return pixelResponse();
}
