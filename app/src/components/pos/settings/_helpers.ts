import { POSOffer } from "@/types/pos";

export const PRESET_COLORS = [
  "#f97316","#8b5cf6","#f59e0b","#06b6d4","#10b981","#ec4899","#3b82f6",
  "#ef4444","#84cc16","#14b8a6","#a855f7","#f43f5e",
];

export function buildOffer(d: {
  offerValue: string; offerType: POSOffer["type"]; offerLabel: string;
  offerActive: boolean; offerStart: string; offerEnd: string;
  offerBuyQty: string; offerFreeQty: string; offerMinQty: string;
}): POSOffer | undefined {
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
  };
}

export function handleImageFile(file: File, setter: (url: string) => void) {
  const reader = new FileReader();
  reader.onload = (e) => { if (e.target?.result) setter(e.target.result as string); };
  reader.readAsDataURL(file);
}
