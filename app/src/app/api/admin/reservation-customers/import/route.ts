/**
 * POST /api/admin/reservation-customers/import
 *
 * Bulk-adds marketing contacts from a CSV uploaded in Admin → Marketing →
 * Audience. The browser parses the file, maps its columns and posts normalised
 * rows in batches (see the Import modal in ReservationCustomersPanel), so this
 * route stays a thin, resumable wrapper around importMarketingContacts —
 * every batch is independent, and a dropped connection only loses that batch.
 *
 * Rows with a bad email are counted and returned, never fatal. Contacts that
 * already exist are enriched (tag added, blanks filled) and keep their visit /
 * order history; an existing unsubscribe is never revived by an import.
 *
 * Requires admin session cookie.
 */

import { NextRequest, NextResponse }                    from "next/server";
import { isAdminAuthenticated, unauthorizedResponse }    from "@/lib/adminAuth";
import { parseBody }                                     from "@/lib/apiValidation";
import { MarketingContactImportSchema }                  from "@/lib/schemas/customer";
import { importMarketingContacts }                       from "@/lib/marketingContacts";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, MarketingContactImportSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  try {
    const result = await importMarketingContacts({
      rows: parsed.data.rows,
      tags: parsed.data.tags,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    console.error("admin/reservation-customers/import POST:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
