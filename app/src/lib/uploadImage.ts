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

// Keep in sync with MAX_BYTES in app/src/app/api/uploads/menu-image/route.ts.
export const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB
export const MAX_IMAGE_LABEL = "1 MB";

/**
 * Returns a human-readable error string if `file` is not an acceptable image,
 * or null when it's fine. Lets callers warn before the upload round-trip.
 */
export function imageSizeError(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file.";
  if (file.size > MAX_IMAGE_BYTES) {
    return `Image is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum is ${MAX_IMAGE_LABEL}.`;
  }
  return null;
}

/**
 * Uploads an image file and resolves to its public URL. Throws an Error with a
 * user-facing message on validation failure or a non-OK response.
 */
export async function uploadMenuImage(file: File): Promise<string> {
  const err = imageSizeError(file);
  if (err) throw new Error(err);

  const body = new FormData();
  body.append("file", file);

  const res = await fetch("/api/uploads/menu-image", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !json.ok || !json.url) {
    throw new Error(json.error || "Upload failed. Please try again.");
  }
  return json.url;
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

  const res = await fetch("/api/uploads/floor-plan", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !json.ok || !json.url) {
    throw new Error(json.error || "Upload failed. Please try again.");
  }
  return json.url;
}
