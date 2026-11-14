import type { ReceiptSettings } from "@/types";

/** Booking details to render on the receipt — built either client-side from
 *  the Add-booking form right after a successful POST, or from an existing
 *  `reservations` list row when staff reopen it later. Any source: the list
 *  also holds online bookings, not just POS-created walk-in/phone ones. */
export interface ReservationReceiptData {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  date: string;   // "YYYY-MM-DD"
  time: string;   // "HH:MM", 24h
  partySize: number;
  tableLabel: string;
  section: string;
  source: string;
  note: string;
  /** Staff who took the booking — only known right after POS creates it, not
   *  stored on the row, so empty when reopened from the list. */
  staffName: string;
  vipFee: number;
  paymentMethod?: string;
}

/** Short guest-facing reference — matches the id prefix already shown in the
 *  POS reservations list (ReservationsView.tsx). */
export function reservationReference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

const SOURCE_LABELS: Record<string, string> = {
  online: "Online", "walk-in": "Walk-in", phone: "Phone booking", other: "Other",
};

export function reservationSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? "Other";
}

/** Fixed footer line — intentionally NOT Receipt Settings' thankYouMessage/
 *  customMessage (those are for a goods receipt); every booking receipt
 *  closes with this same message regardless of admin settings. */
export const RESERVATION_THANK_YOU = "Thank you for your reservation — we look forward to welcoming you!";

export function fmtResDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtResTime(timeStr: string): string {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

/**
 * Standalone HTML builder — used for the Email Receipt box and the PDF /
 * browser-print fallback. The on-screen modal renders its own JSX kept
 * visually in sync with this (ReservationReceiptModal.tsx), same split the
 * POS sale receipt uses (_receipts.ts vs ReceiptModal.tsx).
 *
 * Fixed layout, not the order/sale receipt shape — booking details only, no
 * items/totals. Header uses Receipt Settings but intentionally skips
 * thankYouMessage/customMessage (those are for a goods receipt, not a booking
 * confirmation).
 */
export function buildReservationReceiptHtml(
  res: ReservationReceiptData,
  receipt: ReceiptSettings,
  restaurantName: string,
  sym: string,
): string {
  const name = (restaurantName || receipt.restaurantName?.trim() || "Restaurant").toUpperCase();

  const row = (l: string, r: string, bold = false) =>
    `<tr><td style="padding:2px 0;color:#6b7280;${bold ? "font-weight:700;color:#111827;" : ""}font-size:12px">${l}</td><td style="padding:2px 0;text-align:right;${bold ? "font-weight:700;color:#111827;" : ""}font-size:12px">${r}</td></tr>`;

  const vipHtml = res.vipFee > 0 ? `
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">
    ${row("VIP booking fee", `${sym}${res.vipFee.toFixed(2)}`, true)}
    ${res.paymentMethod ? row("Paid by", res.paymentMethod.charAt(0).toUpperCase() + res.paymentMethod.slice(1)) : ""}
  </table>` : "";

  const noteHtml = res.note.trim() ? `
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <div style="font-size:11px;color:#6b7280"><span style="font-weight:700;color:#374151">Note:</span> ${res.note.trim()}</div>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reservation Receipt</title></head>
<body style="margin:0;background:#f9fafb;font-family:monospace">
<div style="max-width:320px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
  <div style="text-align:center;margin-bottom:16px">
    ${receipt.showLogo && receipt.logoUrl?.trim() ? `<div style="margin-bottom:12px"><img src="${receipt.logoUrl.trim()}" alt="Logo" style="max-height:40px;width:auto;display:inline-block;vertical-align:middle;" /></div>` : ""}
    <div style="font-weight:700;font-size:16px;letter-spacing:1px">${name}</div>
    ${receipt.address?.trim() ? `<div style="font-size:11px;color:#6b7280;white-space:pre-line">${receipt.address.trim()}</div>` : ""}
    ${receipt.phone ? `<div style="font-size:11px;color:#6b7280">${receipt.phone}</div>` : ""}
    ${receipt.website ? `<div style="font-size:11px;color:#6b7280">${receipt.website}</div>` : ""}
    ${receipt.email ? `<div style="font-size:11px;color:#6b7280">${receipt.email}</div>` : ""}
    ${receipt.companyNumber ? `<div style="font-size:10px;color:#9ca3af">Company No: ${receipt.companyNumber}</div>` : ""}
    ${receipt.vatNumber ? `<div style="font-size:10px;color:#9ca3af">VAT No: ${receipt.vatNumber}</div>` : ""}
  </div>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <div style="text-align:center;font-weight:700;font-size:13px;letter-spacing:0.5px;margin-bottom:10px">RESERVATION CONFIRMATION</div>
  <table style="width:100%;border-collapse:collapse">
    ${row("Reference", reservationReference(res.id), true)}
    ${row("Guest", res.customerName)}
    ${row("Party size", String(res.partySize))}
    ${row("Date", fmtResDate(res.date))}
    ${row("Time", fmtResTime(res.time))}
    ${row("Table", res.tableLabel + (res.section ? ` (${res.section})` : ""))}
    ${row("Booking type", reservationSourceLabel(res.source))}
    ${res.staffName ? row("Taken by", res.staffName) : ""}
  </table>
  ${vipHtml}
  ${noteHtml}
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <div style="text-align:center;font-weight:700;color:#374151;font-size:12px">${RESERVATION_THANK_YOU}</div>
</div></body></html>`;
}
