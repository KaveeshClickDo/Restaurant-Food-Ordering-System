/**
 * Client-side helper for menu / product image uploads.
 *
 * Images used to be read with FileReader.readAsDataURL and stored as base64
 * data URLs directly in the `menu_items.image` column. That bloated each row
 * and — because `menu_items` is in the Supabase Realtime publication — pushed
 * row payloads over Realtime's ~1 MB cap, so live UPDATE events arrived with
 * the image column dropped and clients blanked the picture ("disappearing
 * images"). Now we POST the raw file to /api/uploads/menu-image, which stores
 * it in Supabase Storage and returns a short public URL. Rows stay tiny and
 * Realtime payloads never exceed the limit.
 */

import { apiBase } from "@/lib/apiBase";

// Cap on the file actually POSTed. Keep in sync with MAX_BYTES in
// app/src/app/api/uploads/menu-image/route.ts. prepareMenuImage() below
// keeps uploads well under this, so it's mostly a safety net.
export const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB
export const MAX_IMAGE_LABEL = "1 MB";

// Cap on the raw file the user picks, before prepareMenuImage() resizes it.
// Generous since phone photos are often several MB.
const MAX_RAW_INPUT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_RAW_INPUT_LABEL = "5 MB";

// Resize target + re-encode quality. Covers the widest dish-photo display
// (mobile grid card/modal, ~640 CSS px) at up to 2x DPR.
const MENU_IMAGE_MAX_DIMENSION = 1200; // px
const MENU_IMAGE_WEBP_QUALITY = 0.8;
const MENU_IMAGE_JPEG_QUALITY = 0.82; // fallback when webp isn't supported

/**
 * Returns a human-readable error string if `file` is not an acceptable image,
 * or null when it's fine. Checks the file before resizing.
 */
export function imageSizeError(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file.";
  if (file.size > MAX_RAW_INPUT_BYTES) {
    return `Image is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum is ${MAX_RAW_INPUT_LABEL}.`;
  }
  return null;
}

/**
 * Decodes `file`, preferring createImageBitmap (auto-corrects EXIF rotation)
 * and falling back to an <img> element if unsupported.
 */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall back to the <img> path below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode image."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sourceDimensions(src: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if (src instanceof HTMLImageElement) {
    return { width: src.naturalWidth || src.width, height: src.naturalHeight || src.height };
  }
  return { width: src.width, height: src.height };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resizes + re-encodes a picked menu image before upload, since dish photos
 * are shown small (see MENU_IMAGE_MAX_DIMENSION). Same white-fill canvas
 * approach as logoToRaster() in lib/escpos.ts, so transparent PNGs don't
 * turn black.
 *
 * Returns `file` unchanged on failure, if it's already small, or for GIFs
 * (keeps the animation).
 */
async function prepareMenuImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file;

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeImage(file);
  } catch (err) {
    console.error("prepareMenuImage: decode failed, uploading original:", err);
    return file;
  }

  try {
    const { width, height } = sourceDimensions(source);
    if (!width || !height) return file;

    const longEdge = Math.max(width, height);
    if (longEdge <= MENU_IMAGE_MAX_DIMENSION) return file;

    const scale = MENU_IMAGE_MAX_DIMENSION / longEdge;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // flatten transparency onto white, like logoToRaster
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);

    let blob = await canvasToBlob(canvas, "image/webp", MENU_IMAGE_WEBP_QUALITY);
    let ext = "webp";
    if (!blob || blob.type !== "image/webp") {
      // Some engines silently return PNG instead of webp — retry as JPEG.
      blob = await canvasToBlob(canvas, "image/jpeg", MENU_IMAGE_JPEG_QUALITY);
      ext = "jpg";
    }
    if (!blob) return file;

    const base = file.name.replace(/\.[^.]+$/, "") || "menu-image";
    return new File([blob], `${base}.${ext}`, { type: blob.type, lastModified: file.lastModified });
  } catch (err) {
    console.error("prepareMenuImage: resize failed, uploading original:", err);
    return file;
  } finally {
    if (source instanceof ImageBitmap) source.close();
  }
}

// Receipt logos are stored inline as a base64 data URL (like the restaurant logo
// in Admin → Operations), so they live in the settings blob and work everywhere
// — admin, POS web, and the bundled APK — with no upload endpoint. Kept small so
// the settings blob doesn't bloat.
export const MAX_LOGO_BYTES = 400 * 1024; // 400 KB

/**
 * Read an image File as a base64 data URL (client-side, no network). Rejects with
 * a user-facing message when it isn't an image or exceeds `maxBytes`.
 */
export function readImageAsDataUrl(file: File, maxBytes = MAX_LOGO_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file (PNG, JPG, WebP…).")); return;
    }
    if (file.size > maxBytes) {
      reject(new Error(`Image is too large (${(file.size / 1024).toFixed(0)} KB). Max ${Math.round(maxBytes / 1024)} KB.`)); return;
    }
    const reader = new FileReader();
    reader.onload  = (e) => {
      const r = e.target?.result;
      if (typeof r === "string") resolve(r);
      else reject(new Error("Could not read image."));
    };
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads an image file and resolves to its public URL. Resizes it first
 * (see prepareMenuImage). Throws a user-facing Error on failure.
 */
export async function uploadMenuImage(file: File): Promise<string> {
  const rawErr = imageSizeError(file);
  if (rawErr) throw new Error(rawErr);

  const prepared = await prepareMenuImage(file);
  if (prepared.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large after optimizing (${(prepared.size / 1024 / 1024).toFixed(2)} MB). Maximum is ${MAX_IMAGE_LABEL}.`,
    );
  }

  const body = new FormData();
  body.append("file", prepared);

  const res = await fetch(apiBase() + "/api/uploads/menu-image", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !json.ok || !json.url) {
    throw new Error(json.error || "Upload failed. Please try again.");
  }
  return json.url;
}

export async function deleteMenuImage(url: string | undefined | null): Promise<void> {
  if (!url || url.startsWith("data:")) return;
  try {
    await fetch("/api/uploads/menu-image", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch (err) {
    console.error("Failed to delete menu image file:", err);
  }
}

// ── Floor-plan image (reservation table map) ──────────────────────────────────
// Larger cap than menu images — floor plans are full-room photos/diagrams.
// Keep in sync with MAX_BYTES in app/src/app/api/uploads/floor-plan/route.ts.
export const MAX_FLOOR_PLAN_BYTES = 3 * 1024 * 1024; // 3 MB
export const MAX_FLOOR_PLAN_LABEL = "3 MB";

/** Like imageSizeError, but for the floor-plan upload's larger limit. */
export function floorPlanSizeError(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file.";
  if (file.size > MAX_FLOOR_PLAN_BYTES) {
    return `Image is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum is ${MAX_FLOOR_PLAN_LABEL}.`;
  }
  return null;
}

/**
 * Uploads a floor-plan image and resolves to its public URL. Throws an Error
 * with a user-facing message on validation failure or a non-OK response.
 */
export async function uploadFloorPlanImage(file: File): Promise<string> {
  const err = floorPlanSizeError(file);
  if (err) throw new Error(err);

  const body = new FormData();
  body.append("file", file);

  const res = await fetch(apiBase() + "/api/uploads/floor-plan", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !json.ok || !json.url) {
    throw new Error(json.error || "Upload failed. Please try again.");
  }
  return json.url;
}

/**
 * Permanently deletes a floor-plan image from Supabase Storage.
 */
export async function deleteFloorPlanImage(url: string): Promise<void> {
  if (!url) return;
  try {
    const res = await fetch("/api/uploads/floor-plan", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) console.warn("Bucket cleanup failed:", json.error);
  } catch (err) {
    console.error("Failed to delete floor plan file:", err);
  }
}

// ── Signage poster image (digital menu boards) ────────────────────────────────
// Largest cap of the three — signage posters run fullscreen on TVs, so they're
// higher-resolution than dish photos or floor plans.
// Keep in sync with MAX_BYTES in app/src/app/api/uploads/signage-image/route.ts.
export const MAX_SIGNAGE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_SIGNAGE_LABEL = "25 MB";

/** Like imageSizeError, but for the signage upload's larger limit. */
export function signageSizeError(file: File): string | null {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (!isImage && !isVideo) return "Please choose an image or video file.";
  if (file.size > MAX_SIGNAGE_BYTES) {
    return `Image is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum is ${MAX_SIGNAGE_LABEL}.`;
  }
  return null;
}

/**
 * Uploads a signage poster image and resolves to its public URL. Throws an
 * Error with a user-facing message on validation failure or a non-OK response.
 */
export async function uploadSignageImage(file: File): Promise<string> {
  const err = signageSizeError(file);
  if (err) throw new Error(err);

  const body = new FormData();
  body.append("file", file);

  const res = await fetch(apiBase() + "/api/uploads/signage-image", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !json.ok || !json.url) {
    throw new Error(json.error || "Upload failed. Please try again.");
  }
  return json.url;
}
