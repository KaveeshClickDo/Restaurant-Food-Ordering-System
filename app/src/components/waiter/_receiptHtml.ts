/**
 * Standalone HTML builder for the printable / emailable waiter receipt.
 * Used by ReceiptModal (print + email), BillEmailBar (email) and the bill
 * view's print preview so all three render the identical document.
 */

import type { WaiterReceipt } from "./_types";

export function buildReceiptHtml(receipt: WaiterReceipt, restaurantName: string, address: string, receiptPhone: string, receiptWebsite: string, vatNumber: string, thankYou: string, sym: string): string {
  const itemsHtml = receipt.items.map((it) =>
    `<tr>
      <td style="padding:2px 0;font-size:12px">${it.name} ×${it.qty}</td>
      <td style="padding:2px 0;font-size:12px;text-align:right">${sym}${(it.price * it.qty).toFixed(2)}</td>
    </tr>`
  ).join("");

  const payLabel = receipt.paymentMethod === "cash" ? "Cash" : receipt.paymentMethod === "card" ? "Card" : receipt.paymentMethod === "gift_card" ? "Gift Card" : "Table Service";
  const giftUsed = receipt.giftCardUsed ?? 0;
  // `total` is stored NET (gift card already deducted): it IS the money paid.
  // Re-add the card for the gross goods TOTAL line.
  const amountPaid = receipt.total;
  const grossTotal = Math.round((receipt.total + giftUsed) * 100) / 100;
  const rcptDiscount = receipt.discountAmount ?? 0;
  const rcptTip = receipt.tipAmount ?? 0;
  const rcptServiceFee = receipt.serviceFeeAmount ?? 0;
  const rcptVat = receipt.vatAmount ?? 0;
  const rcptSubtotal = receipt.subtotal ?? grossTotal;
  const vatLabel = receipt.vatInclusive
    ? `Incl. VAT${receipt.vatRate ? ` (${receipt.vatRate}%)` : ""}`
    : `VAT${receipt.vatRate ? ` (${receipt.vatRate}%)` : ""}`;
  // Subtotal / Discount / VAT / Tip / ServiceFee lines only appear when something applies.
  const breakdownHtml = (rcptDiscount > 0 || rcptTip > 0 || rcptVat > 0 || rcptServiceFee > 0)
    ? `<tr><td style="font-size:11px;color:#6b7280">Subtotal</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${rcptSubtotal.toFixed(2)}</td></tr>
       ${rcptDiscount > 0 ? `<tr><td style="font-size:11px;color:#16a34a">Discount${receipt.discountNote ? ` (${receipt.discountNote})` : ""}</td><td style="font-size:11px;color:#16a34a;text-align:right">−${sym}${rcptDiscount.toFixed(2)}</td></tr>` : ""}
       ${rcptServiceFee > 0 ? `<tr><td style="font-size:11px;color:#6b7280">Service Fee</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${rcptServiceFee.toFixed(2)}</td></tr>` : ""}
       ${rcptVat > 0 ? `<tr><td style="font-size:11px;color:#6b7280">${vatLabel}</td><td style="font-size:11px;color:#6b7280;text-align:right">${receipt.vatInclusive ? "" : "+"}${sym}${rcptVat.toFixed(2)}</td></tr>` : ""}
       ${rcptTip > 0 ? `<tr><td style="font-size:11px;color:#6b7280">Tip</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${rcptTip.toFixed(2)}</td></tr>` : ""}`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title></head>
<body style="margin:0;background:#f9fafb;font-family:monospace">
<div style="max-width:320px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-weight:700;font-size:16px;letter-spacing:1px">${restaurantName.toUpperCase()}</div>
    ${address?.trim() ? `<div style="font-size:11px;color:#6b7280;white-space:pre-line">${address.trim()}</div>` : ""}
    ${receiptPhone ? `<div style="font-size:11px;color:#6b7280">${receiptPhone}</div>` : ""}
    ${receiptWebsite ? `<div style="font-size:11px;color:#6b7280">${receiptWebsite}</div>` : ""}
    <div style="font-size:11px;color:#6b7280">${new Date(receipt.date).toLocaleString("en-GB")}</div>
    <div style="font-size:11px;color:#6b7280">Table: ${receipt.tableLabel}</div>
    <div style="font-size:11px;color:#6b7280">Served by: ${receipt.waiterName}</div>
    ${vatNumber ? `<div style="font-size:10px;color:#9ca3af">VAT No: ${vatNumber}</div>` : ""}
  </div>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">
    ${breakdownHtml}
    <tr><td style="font-size:13px;font-weight:700">TOTAL</td><td style="font-size:13px;font-weight:700;text-align:right">${sym}${grossTotal.toFixed(2)}</td></tr>
    ${giftUsed > 0 ? `<tr><td style="font-size:11px;color:#7c3aed">Gift card</td><td style="font-size:11px;color:#7c3aed;text-align:right">−${sym}${giftUsed.toFixed(2)}</td></tr>
    <tr><td style="font-size:12px;font-weight:700">PAID (${payLabel})</td><td style="font-size:12px;font-weight:700;text-align:right">${sym}${amountPaid.toFixed(2)}</td></tr>` : `<tr><td style="font-size:11px;color:#6b7280">Payment</td><td style="font-size:11px;color:#6b7280;text-align:right">${payLabel}</td></tr>`}
  </table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  ${thankYou ? `<div style="text-align:center;font-weight:600;color:#374151;font-size:12px">${thankYou}</div>` : ""}
</div></body></html>`;
}
