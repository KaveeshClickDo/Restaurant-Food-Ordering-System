/**
 * POST /api/uploads/menu-image — store a menu/product image in Supabase
 * Storage and return its public URL.
 *
 * Why a dedicated route instead of base64-in-DB:
 *   menu_items is in the Realtime publication. A base64 image inflates the row
 *   ~1.33× and pushes it past Realtime's ~1 MB payload cap, so live UPDATE
 *   events arrive with the image column dropped and every connected client
 *   blanks the picture. Storing only a short public URL keeps rows tiny.
 *
 * Auth: same gate as menu writes — admin session OR a POS manager with the
 * `canManageMenu` permission (see requirePosPermission).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosPermission } from "@/lib/posPermissions";

export const runtime = "nodejs";

const BUCKET = "menu-images";
// Keep in sync with MAX_IMAGE_BYTES in app/src/lib/uploadImage.ts.
const MAX_BYTES = 1024 * 1024; // 1 MB
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
  const gate = await requirePosPermission("canManageMenu");
  if (!gate.ok) return gate.response;

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
      { ok: false, error: `Image is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum is 1 MB.` },
      { status: 413 },
    );
  }

  try {
    await ensureBucket();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage unavailable.";
    console.error("uploads/menu-image ensureBucket:", message);
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
    console.error("uploads/menu-image upload:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}
