/**
 * POST /api/uploads/signage-image — store a digital-signage poster image in
 * Supabase Storage and return its public URL.
 *
 * Mirrors /api/uploads/floor-plan (admin-only, lazy bucket creation, public
 * URLs) but with a larger size cap: signage posters run fullscreen on TVs, so
 * they're higher-resolution than dish photos or floor plans.
 *
 * The returned URL is saved into a signage_displays.slides[] entry by the admin
 * Digital Signage panel; the public /display/<slug> page renders the slides as
 * a fullscreen poster / slideshow.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

export const runtime = "nodejs";

const BUCKET = "signage-images";
// Keep in sync with MAX_SIGNAGE_BYTES in app/src/lib/uploadImage.ts.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

// Created lazily on first upload so the system works on any deployment without
// a separate storage migration. Cached per server instance.
let bucketReady = false;
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ALLOWED_TYPES,
    });
    // Tolerate the create/create race between two concurrent first uploads.
    if (error && !/exist/i.test(error.message)) throw new Error(error.message);
  }
  bucketReady = true;
}

export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { ok: false, error: "Unsupported image type. Use JPEG, PNG, WebP, GIF or AVIF." },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Image is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum is 5 MB.` },
      { status: 413 },
    );
  }

  try {
    await ensureBucket();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage unavailable.";
    console.error("uploads/signage-image ensureBucket:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const extFromType = file.type.split("/")[1] ?? "jpg";
  const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") || extFromType;
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    cacheControl: "31536000", // 1 year — files are content-addressed by UUID, never overwritten.
    upsert: false,
  });
  if (error) {
    console.error("uploads/signage-image upload:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}
