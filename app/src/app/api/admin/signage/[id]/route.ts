/**
 * PATCH  /api/admin/signage/[id] — update a display. Every field is optional;
 *                                  `slides` replaces the whole poster list.
 *                                  (add / reorder / toggle / delete all flow
 *                                  through here).
 * DELETE /api/admin/signage/[id] — remove a display (and its public URL).
 *                                   plus all files in that display's slides[] from the signage-images bucket.
 *
 * Note: deleting a display does delete the poster files from the
 * `signage-images` storage bucket - the admin panel is the only way to remove a display, 
 * so this is safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { SignageUpdateSchema } from "@/lib/schemas/signage";
import { SIGNAGE_COLUMNS, mapSignageRow, slugify, uniqueSlug } from "@/lib/signage";

const BUCKET_NAME = "signage-images";

// Helper to extract the internal storage path from a public URL
function extractStoragePath(url: string): string | null {
  if (!url) return null;
  const parts = url.split(`/${BUCKET_NAME}/`);
  return parts.length > 1 ? parts[1] : null;
}

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

  let filesToDelete: string[] = [];

  // Re-sequence slide order and figure out if any media was deleted
  if (body.slides !== undefined) {
    // 1. Fetch existing slides from DB to compare what is being removed
    const { data: existingData } = await supabaseAdmin
      .from("signage_displays")
      .select("slides")
      .eq("id", id)
      .single();

    if (existingData && existingData.slides) {
      // Create a set of URLs that are being kept
      const incomingUrls = new Set(body.slides.map(s => s.imageUrl));
      
      // Find URLs that exist in DB but aren't in the incoming request
      filesToDelete = (existingData.slides as any[])
        .filter(s => !incomingUrls.has(s.imageUrl))
        .map(s => extractStoragePath(s.imageUrl))
        .filter(Boolean) as string[];
    }

    // 2. Prepare the new slides array
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

  // If DB update was successful, delete the orphaned files from the bucket
  if (filesToDelete.length > 0) {
    const { error: storageError } = await supabaseAdmin.storage.from(BUCKET_NAME).remove(filesToDelete);
    if (storageError) console.error("Failed to delete old signage media:", storageError);
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

  // 1. Fetch the display first so we know which files to delete
  const { data: existingData } = await supabaseAdmin
    .from("signage_displays")
    .select("slides")
    .eq("id", id)
    .single();

  // 2. Delete the record from the database
  const { error } = await supabaseAdmin.from("signage_displays").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // 3. If DB deletion was successful, wipe all associated media from the bucket
  if (existingData && existingData.slides) {
    const filesToDelete = (existingData.slides as any[])
      .map(s => extractStoragePath(s.imageUrl))
      .filter(Boolean) as string[];

    if (filesToDelete.length > 0) {
      const { error: storageError } = await supabaseAdmin.storage.from(BUCKET_NAME).remove(filesToDelete);
      if (storageError) console.error("Failed to delete signage media on display deletion:", storageError);
    }
  }

  return NextResponse.json({ ok: true });
}