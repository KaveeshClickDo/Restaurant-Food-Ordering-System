/**
 * POST /api/guest-profile
 * Upserts a marketing contact when an ANONYMOUS (no-account) online order is
 * placed. No auth required — called client-side from CheckoutModal. Signed-in
 * orders are captured server-side by the order-creation paths instead.
 * Email is the unique key; merge rules live in lib/marketingContacts.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { rateLimit }                 from "@/lib/rateLimit";
import { parseBody }                 from "@/lib/apiValidation";
import { GuestProfileSchema }        from "@/lib/schemas/customer";
import { upsertMarketingContact }    from "@/lib/marketingContacts";

export async function POST(req: NextRequest) {
  // Per-IP rate limit — 10 upserts per minute. The endpoint accepts an
  // arbitrary email and writes to marketing_contacts; without a cap a bot
  // could pollute the CRM table.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`guest-profile:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please wait a minute." },
      { status: 429 },
    );
  }

  const parsed = await parseBody(req, GuestProfileSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { name, email, phone, orderTotal } = parsed.data;

  await upsertMarketingContact({
    email,
    source: "online_order",
    name,
    phone,
    order: { total: typeof orderTotal === "number" && orderTotal > 0 ? orderTotal : 0 },
  });

  return NextResponse.json({ ok: true });
}
