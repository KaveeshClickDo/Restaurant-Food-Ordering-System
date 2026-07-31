/**
 * GET /api/admin/marketing/status
 *
 * What the Marketing tab asks before it renders: does this install have an
 * email package, and how many sends are left? The browser calls THIS route,
 * and this route calls the Marketing API server-to-server — which is the whole
 * point. A browser request comes from the owner's laptop; only a call made by
 * this server carries this server's IP, and the IP is how DirectDine knows
 * which restaurant is asking.
 *
 * `?force=1` skips the cache — used right after a purchase so the tab unlocks
 * without waiting a minute.
 *
 * Requires admin session cookie.
 */

import { NextRequest, NextResponse }                     from "next/server";
import { isAdminAuthenticated, unauthorizedResponse }     from "@/lib/adminAuth";
import { getMarketingStatus }                             from "@/lib/marketingCloud";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const force  = req.nextUrl.searchParams.get("force") === "1";
  const status = await getMarketingStatus({ force });

  return NextResponse.json({ ok: true, status });
}
