/**
 * GET  /api/admin/signage — list every digital-signage display.
 * POST /api/admin/signage — create one (name only; slug is derived, the rest
 *                           start at sensible defaults with no slides yet).
 *
 * Backs the admin Digital Signage panel. The public TV screen reads a single
 * display by slug via the unauthenticated /api/signage/[slug] route.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { SignageCreateSchema } from "@/lib/schemas/signage";
import { SIGNAGE_COLUMNS, mapSignageRow, uniqueSlug } from "@/lib/signage";

export async function GET() {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("signage_displays")
    .select(SIGNAGE_COLUMNS)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, displays: (data ?? []).map(mapSignageRow) });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const parsed = await parseBody(request, SignageCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const name = parsed.data.name;

  const slug = await uniqueSlug(name);

  const { data, error } = await supabaseAdmin
    .from("signage_displays")
    .insert({ name, slug })
    .select(SIGNAGE_COLUMNS)
    .single();

  if (error) {
    // 23505 = unique_violation — a concurrent create grabbed the same slug
    // between uniqueSlug() and insert. Rare; surface as a retryable conflict.
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "That URL was just taken — try again." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, display: mapSignageRow(data) }, { status: 201 });
}
