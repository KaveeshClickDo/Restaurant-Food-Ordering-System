/**
 * PATCH  /api/admin/signage/[id] — update a display. Every field is optional;
 *                                  `slides` replaces the whole poster list
 *                                  (add / reorder / toggle / delete all flow
 *                                  through here).
 * DELETE /api/admin/signage/[id] — remove a display (and its public URL).
 *
 * Note: deleting a display does NOT delete the poster files from the
 * `signage-images` storage bucket — they're cheap, content-addressed, and may
 * be shared. Orphans can be swept later if ever needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { SignageUpdateSchema } from "@/lib/schemas/signage";
import { SIGNAGE_COLUMNS, mapSignageRow, slugify, uniqueSlug } from "@/lib/signage";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, SignageUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.name       !== undefined) patch.name        = body.name;
  if (body.active     !== undefined) patch.active       = body.active;
  if (body.intervalMs !== undefined) patch.interval_ms  = body.intervalMs;
  if (body.transition !== undefined) patch.transition   = body.transition;
  if (body.fit        !== undefined) patch.fit          = body.fit;
  if (body.background !== undefined) patch.background    = body.background;

  // Re-sequence slide order to a clean 0..n-1 so reorder/delete never leave gaps
  // or duplicate indexes the player would render out of sequence.
  if (body.slides !== undefined) {
    patch.slides = body.slides
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s, i) => ({ id: s.id, imageUrl: s.imageUrl, order: i, enabled: s.enabled }));
  }

  // Slug change: normalize, then ensure it's still unique (ignoring self). If
  // the admin typed a value that collides, uniqueSlug appends -2/-3 rather than
  // failing — the panel re-reads the saved slug from the response.
  if (body.slug !== undefined) {
    patch.slug = await uniqueSlug(slugify(body.slug), id);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("signage_displays")
    .update(patch)
    .eq("id", id)
    .select(SIGNAGE_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: false, error: "That URL is already taken." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Display not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, display: mapSignageRow(data) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { id } = await params;

  const { error } = await supabaseAdmin.from("signage_displays").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
