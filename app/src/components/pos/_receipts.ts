import { POSSale, POSSettings } from "@/types/pos";

export interface DineInOrder {
  id: string;
  tableLabel: string;
  staffName: string;
  covers: number;
  items: { name: string; qty: number; price: number }[];
  total: number;
  status: string;
  /** Money state ("paid"/"refunded"/"partially_refunded"…) — refunds live here, not on status. */
  paymentStatus?: string;
  paymentMethod: string;
  date: string;
  refundedAmount?: number;
  /** Amount of the bill paid by gift card (gross total − this = money in). */
  giftCardUsed?: number;
}

/**
 * Refund state of a dine-in order. It lives in paymentStatus — a refunded
 * order keeps status "delivered" (the food was served).
 */
export function dineInRefundState(
  o: Pick<DineInOrder, "paymentStatus">,
): "refunded" | "partially_refunded" | null {
  if (o.paymentStatus === "refunded") return "refunded";
  if (o.paymentStatus === "partially_refunded") return "partially_refunded";
  return null;
}

export function buildReceiptHtml(sale: POSSale, settings: POSSettings, restaurantNameOverride?: string): string {
  const sym = settings.currencySymbol;
  const restaurantName = (restaurantNameOverride || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant").toUpperCase();
  const taxRate = sale.taxRate ?? settings.taxRate;
  const taxInclusive = sale.taxInclusive ?? settings.taxInclusive;
  const vatLabel = taxInclusive ? `VAT (${taxRate}% incl.)` : `VAT (${taxRate}%)`;
  const vatSign = taxInclusive ? "" : "+";

  const row = (l: string, r: string, bold = false, color = "#374151") =>
    `<tr><td style="padding:1px 0;color:${color};${bold ? "font-weight:700;" : ""}font-size:12px">${l}</td><td style="padding:1px 0;color:${color};${bold ? "font-weight:700;" : ""}font-size:12px;text-align:right">${r}</td></tr>`;

  const itemsHtml = sale.items.map((item) => {
    const mods = item.modifiers.map((m) => `<div style="font-size:11px;color:#6b7280;padding-left:8px">+ ${m.optionLabel}</div>`).join("");
    const note = item.note ? `<div style="font-size:11px;color:#f97316;padding-left:8px;font-style:italic">"${item.note}"</div>` : "";
    return `<tr><td style="padding:2px 0;font-size:12px">${item.name} ×${item.quantity}${mods}${note}</td><td style="padding:2px 0;font-size:12px;text-align:right">${sym}${(item.price * item.quantity).toFixed(2)}</td></tr>`;
  }).join("");

  let paymentHtml = "";
  const gcAmount = sale.giftCard?.amount ?? 0;

  // 1. Show the gift card deduction first
  if (sale.giftCard) {
    const codeStr = sale.giftCard.code ? ` (..${sale.giftCard.code.slice(-4)})` : "";
    paymentHtml += `<tr><td style="font-size:11px;color:#6b7280">Gift Card${codeStr}</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${sale.giftCard.amount.toFixed(2)}</td></tr>`;
  }

  // 2. Show the remaining amount paid by Cash/Card/Split
  if (sale.paymentMethod === "split") {
    paymentHtml += sale.payments.map((p) =>
      `<tr><td style="font-size:11px;color:#6b7280;text-transform:capitalize">${p.method}</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${p.amount.toFixed(2)}</td></tr>`
    ).join("");
  } else if (sale.paymentMethod === "cash") {
    const cashPaid = sale.cashTendered ?? (sale.total - gcAmount);
    paymentHtml += `<tr><td style="font-size:11px;color:#6b7280">Cash</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${cashPaid.toFixed(2)}</td></tr>`;
    if ((sale.changeGiven ?? 0) > 0) {
      paymentHtml += `<tr><td style="font-size:11px;color:#6b7280">Change</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${sale.changeGiven!.toFixed(2)}</td></tr>`;
    }
  } else if (sale.paymentMethod === "gift_card") {
    // Covered entirely by gift card. (Fallback safety if sale.giftCard was missing)
    if (!sale.giftCard) {
      paymentHtml += `<tr><td style="font-size:11px;color:#6b7280">Gift Card</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${sale.total.toFixed(2)}</td></tr>`;
    }
  } else {
    // Card or other payment methods
    const charged = sale.total - gcAmount;
    paymentHtml += `<tr><td style="font-size:11px;color:#6b7280;text-transform:capitalize">${sale.paymentMethod}</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${charged.toFixed(2)}</td></tr>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f9fafb;font-family:monospace">
<div style="max-width:360px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
  <div style="text-align:center;margin-bottom:16px">
    ${settings.receiptShowLogo && settings.receiptLogoUrl?.trim() ? `<div style="margin-bottom:12px;display:block;"><img src="${settings.receiptLogoUrl.trim()}" alt="Logo" style="max-height:40px;width:auto;display:inline-block;vertical-align:middle;" /></div>`: ""}
    <div style="font-weight:700;font-size:16px;letter-spacing:1px">${restaurantName}</div>
    ${settings.receiptPhone ? `<div style="font-size:11px;color:#6b7280">${settings.receiptPhone}</div>` : ""}
    ${settings.receiptWebsite ? `<div style="font-size:11px;color:#6b7280">${settings.receiptWebsite}</div>` : ""}
    <div style="font-size:11px;color:#6b7280">${new Date(sale.date).toLocaleString("en-GB")}</div>
    <div style="font-size:11px;color:#6b7280">Receipt #${sale.receiptNo}</div>
    ${sale.staffName ? `<div style="font-size:11px;color:#6b7280">Served by: ${sale.staffName}</div>` : ""}
    ${sale.customerName ? `<div style="font-size:11px;color:#6b7280">Customer: ${sale.customerName}</div>` : ""}
    ${settings.receiptVatNumber ? `<div style="font-size:10px;color:#9ca3af">VAT No: ${settings.receiptVatNumber}</div>` : ""}
  </div>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">
    ${row("Subtotal", `${sym}${sale.subtotal.toFixed(2)}`)}
    ${sale.discountAmount > 0 ? row(`Discount${sale.discountNote ? ` (${sale.discountNote})` : ""}`, `-${sym}${sale.discountAmount.toFixed(2)}`, false, "#16a34a") : ""}
    ${sale.taxAmount > 0 ? row(vatLabel, `${vatSign}${sym}${sale.taxAmount.toFixed(2)}`, false, "#6b7280") : ""}
    ${sale.tipAmount > 0 ? row("Tip", `${sym}${sale.tipAmount.toFixed(2)}`) : ""}
    ${sale.serviceFeeAmount > 0 ? row("Service Fee", `${sym}${sale.serviceFeeAmount.toFixed(2)}`) : ""}
    ${row("TOTAL", `${sym}${sale.total.toFixed(2)}`, true)}
    ${paymentHtml}
  </table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  ${settings.receiptThankYouMessage ? `<div style="text-align:center;font-weight:600;color:#374151;font-size:12px;margin-bottom:4px">${settings.receiptThankYouMessage}</div>` : ""}
  ${settings.receiptCustomMessage ? `<div style="text-align:center;color:#6b7280;font-size:11px">${settings.receiptCustomMessage}</div>` : ""}
</div></body></html>`;
}

export function buildDineInReceiptHtml(order: DineInOrder, settings: POSSettings, restaurantNameOverride?: string): string {
  const name = (restaurantNameOverride || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant").toUpperCase();
  const sym = settings.currencySymbol;
  const itemsHtml = order.items.map((it) =>
    `<tr><td style="padding:2px 0;font-size:12px">${it.name} ×${it.qty}</td><td style="padding:2px 0;font-size:12px;text-align:right">${sym}${(it.price * it.qty).toFixed(2)}</td></tr>`
  ).join("");
  const payLabel = order.paymentMethod === "cash" ? "Cash" : order.paymentMethod === "card" ? "Card" : "Table Service";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f9fafb;font-family:monospace">
<div style="max-width:320px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-weight:700;font-size:16px;letter-spacing:1px">${name}</div>
    ${settings.receiptPhone ? `<div style="font-size:11px;color:#6b7280">${settings.receiptPhone}</div>` : ""}
    <div style="font-size:11px;color:#6b7280">${new Date(order.date).toLocaleString("en-GB")}</div>
    <div style="font-size:11px;color:#6b7280">Table: ${order.tableLabel}</div>
    <div style="font-size:11px;color:#6b7280">Served by: ${order.staffName}</div>
    ${order.covers > 0 ? `<div style="font-size:11px;color:#6b7280">${order.covers} cover${order.covers !== 1 ? "s" : ""}</div>` : ""}
    ${settings.receiptVatNumber ? `<div style="font-size:10px;color:#9ca3af">VAT No: ${settings.receiptVatNumber}</div>` : ""}
  </div>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="font-size:13px;font-weight:700">TOTAL</td><td style="font-size:13px;font-weight:700;text-align:right">${sym}${order.total.toFixed(2)}</td></tr>
    <tr><td style="font-size:11px;color:#6b7280">Payment</td><td style="font-size:11px;color:#6b7280;text-align:right">${payLabel}</td></tr>
  </table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  ${settings.receiptThankYouMessage ? `<div style="text-align:center;font-weight:600;font-size:12px">${settings.receiptThankYouMessage}</div>` : ""}
</div></body></html>`;
}
