/**
 * POST /api/admin/marketing/checkout-link
 *
 * Turns "the owner clicked a package" into a URL to open. The link is built by
 * DirectDine, never here — this server doesn't know prices, currencies, or
 * which customer account it belongs to, and shouldn't.
 *
 * Like the status route, the call to DirectDine is made BY THIS SERVER, so it
 * carries this server's IP and DirectDine can tell which restaurant is asking.
 * The browser then opens the returned URL in a new tab, where the owner logs
 * in — so identity at the point of payment comes from their login, and nothing
 * security-relevant travels in the URL.
 *
 * Requires admin session cookie.
 */

import { NextRequest, NextResponse }                  from "next/server";
import { isAdminAuthenticated, unauthorizedResponse }  from "@/lib/adminAuth";
import { getMarketingStatus }                          from "@/lib/marketingCloud";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  let packageId = "";
  try {
    const body = await req.json() as { packageId?: unknown };
    packageId = typeof body.packageId === "string" ? body.packageId.trim().slice(0, 64) : "";
  } catch { /* no body is fine — fall back to the generic buy page */ }

  const status = await getMarketingStatus();
  if (status.state !== "none") {
    // Either they already have a package, or we can't reach DirectDine. Either
    // way there's no meaningful checkout link to hand back.
    return NextResponse.json(
      { ok: false, error: "No packages are available to buy right now." },
      { status: 409 },
    );
  }

  const url = packageId
    ? `${status.buyUrl}${status.buyUrl.includes("?") ? "&" : "?"}package=${encodeURIComponent(packageId)}`
    : status.buyUrl;

  return NextResponse.json({ ok: true, url });
}
