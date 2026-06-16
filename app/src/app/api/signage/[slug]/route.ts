/**
 * GET /api/signage/[slug] — PUBLIC, no auth. Powers the unattended TV screen at
 * /display/<slug>.
 *
 * Reads a single display by slug through the service-role client (the table is
 * locked to anon via RLS), and returns it only when `active`, exposing just the
 * enabled slides plus playback settings — never internal ids/timestamps. A
 * disabled display or unknown slug returns 404 so the page can show a neutral
 * "screen off" / not-found state.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SIGNAGE_COLUMNS, mapSignageRow } from "@/lib/signage";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const { data, error } = await supabaseAdmin
    .from("signage_displays")
    .select(SIGNAGE_COLUMNS)
    .ilike("slug", slug)
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data || data.active === false) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const display = mapSignageRow(data);
  // Trim to exactly what the TV needs — enabled slides only, no ids/timestamps.
  const payload = {
    name:       display.name,
    intervalMs: display.intervalMs,
    transition: display.transition,
    fit:        display.fit,
    background: display.background,
    slides: display.slides
      .filter((s) => s.enabled && s.imageUrl)
      .map((s) => ({ imageUrl: s.imageUrl })),
  };

  return NextResponse.json(
    { ok: true, display: payload },
    // Short edge cache: the page also polls, so admin edits surface within
    // ~15 s without hammering the DB from many screens.
    { headers: { "Cache-Control": "public, max-age=5, s-maxage=15, stale-while-revalidate=30" } },
  );
}
