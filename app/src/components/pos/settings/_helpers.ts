import { POSOffer } from "@/types/pos";
import { uploadMenuImage } from "@/lib/uploadImage";

export const PRESET_COLORS = [
  "#f97316","#8b5cf6","#f59e0b","#06b6d4","#10b981","#ec4899","#3b82f6",
  "#ef4444","#84cc16","#14b8a6","#a855f7","#f43f5e",
];

export function buildOffer(
  d: {
    offerValue: string; offerType: POSOffer["type"]; offerLabel: string;
    offerActive: boolean; offerStart: string; offerEnd: string;
    offerBuyQty: string; offerFreeQty: string; offerMinQty: string;
  },
  // The offer that already existed on the item before this edit (if any). Its
  // channel scope is preserved so a POS edit never silently rewrites an
  // admin-set scope (e.g. "both" or "online only"). When there is no existing
  // offer, a freshly-created POS offer defaults to in-store only — POS admins
  // own the till, not the online menu.
  existingOffer?: POSOffer,
): POSOffer | undefined {
  const needsValue = ["percent","fixed","price","multibuy","qty_discount"].includes(d.offerType);
  const needsBuy   = ["bogo","multibuy"].includes(d.offerType);
  if (needsValue && !d.offerValue) return undefined;
  if (needsBuy   && !d.offerBuyQty) return undefined;
  if (d.offerType === "bogo" && !d.offerFreeQty) return undefined;
  if (d.offerType === "qty_discount" && !d.offerMinQty) return undefined;
  return {
    type:      d.offerType,
    value:     parseFloat(d.offerValue)   || 0,
    label:     d.offerLabel.trim()        || undefined,
    active:    d.offerActive,
    startDate: d.offerStart               || undefined,
    endDate:   d.offerEnd                 || undefined,
    buyQty:    d.offerBuyQty  ? parseInt(d.offerBuyQty)  : undefined,
    freeQty:   d.offerFreeQty ? parseInt(d.offerFreeQty) : undefined,
    minQty:    d.offerMinQty  ? parseInt(d.offerMinQty)  : undefined,
    // Preserve the prior scope (including undefined = "both"); default new
    // POS offers to in-store only.
    channels:  existingOffer ? existingOffer.channels : ["in_store"],
  };
}

/**
 * Uploads an image file to Supabase Storage and passes the resulting public
 * URL to `setter`. Validation / upload failures are reported via `onError`
 * (or logged if no handler is given). We no longer inline base64 into the row
 * — that overflowed Realtime's payload cap and blanked images (see
 * lib/uploadImage.ts).
 */
export async function handleImageFile(
  file: File,
  setter: (url: string) => void,
  onError?: (message: string) => void,
) {
  try {
    const url = await uploadMenuImage(file);
    setter(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    if (onError) onError(message);
    else console.error("handleImageFile:", message);
  }
}
