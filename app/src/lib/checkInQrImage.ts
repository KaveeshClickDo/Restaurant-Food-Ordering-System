/**
 * PNG image of a booking's check-in QR code, for emails (an inline attachment
 * the email shows through cid:). Server-only.
 */

import { checkInQrText } from "@/lib/reservationCheckIn";

/** `width` is in pixels; emails show it at half size, so it stays sharp on
 *  high-resolution phone screens. */
export async function checkInQrPng(code: string, width = 360): Promise<Buffer> {
  const mod = await import("qrcode");
  const toBuffer = mod.toBuffer ?? mod.default?.toBuffer;
  return toBuffer(checkInQrText(code), { type: "png", errorCorrectionLevel: "M", margin: 2, width });
}
