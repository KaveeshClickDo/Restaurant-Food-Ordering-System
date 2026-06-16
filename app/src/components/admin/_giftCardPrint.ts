/**
 * Printable gift-card artwork for the admin panel.
 *
 * Produces a self-contained HTML document for one card — opened in a new window
 * and printed (see GiftCardsPanel.printCard). Used for INACTIVE pre-issued cards
 * so they can be printed and displayed in store; the card holds no spendable
 * balance until an admin activates it at the point of sale, so a printed code on
 * a rack is safe.
 *
 * Validity is shown as a relative span ("Valid for 1 year from date of issue")
 * rather than a concrete date, because the expiry clock only starts when the
 * card is activated/sold — there is no meaningful date to print beforehand.
 */

import type { GiftCard, RestaurantInfo } from "@/types";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string));

/** Numeric part only ("25" for whole amounts, "25.50" otherwise) — the symbol
 *  is rendered separately so it can be styled smaller. */
function fmtAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function buildGiftCardPrintHtml(card: GiftCard, restaurant: RestaurantInfo, sym: string): string {
  const name    = esc((restaurant.name || "Restaurant").toUpperCase());
  const tagline = restaurant.tagline ? esc(restaurant.tagline) : "";

  const addressLine = [
    restaurant.addressLine1,
    restaurant.addressLine2,
    restaurant.city,
    restaurant.postcode,
    restaurant.country,
  ].filter((p) => p && String(p).trim()).map((p) => esc(String(p))).join(", ");

  const phone  = restaurant.phone ? esc(restaurant.phone) : "";
  // Face value the card was issued for — NOT the remaining balance. A printed
  // card shows what it's worth as a gift, not how much has been spent.
  const amount = fmtAmount(card.initialAmount);

  // Real gift-card proportions: a 150mm × 80mm landscape rectangle (≈1.88:1,
  // standard voucher size) sized in mm so it prints true-to-life and can be cut
  // out. Dark background with faint gold "bokeh" sparkles + a gold corner ribbon.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Gift Card — ${esc(card.code)}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{background:#e2e8f0;font-family:Georgia,'Times New Roman',serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .wrap{display:flex;justify-content:center;align-items:center;min-height:100vh;padding:10mm}
  .card{position:relative;width:150mm;height:80mm;border-radius:4mm;overflow:hidden;color:#f8fafc;
        background:
          radial-gradient(1.2px 1.2px at 16% 28%,rgba(245,205,120,.9),transparent),
          radial-gradient(1.1px 1.1px at 28% 66%,rgba(245,205,120,.7),transparent),
          radial-gradient(1.4px 1.4px at 58% 20%,rgba(245,205,120,.85),transparent),
          radial-gradient(1.1px 1.1px at 74% 58%,rgba(245,205,120,.7),transparent),
          radial-gradient(1.5px 1.5px at 86% 34%,rgba(245,205,120,.9),transparent),
          radial-gradient(1.1px 1.1px at 46% 80%,rgba(245,205,120,.6),transparent),
          radial-gradient(circle at 84% 26%,rgba(245,200,90,.22),transparent 44%),
          linear-gradient(135deg,#0b1020 0%,#121a2e 55%,#1f2a44 100%);
        box-shadow:0 8mm 18mm rgba(15,23,42,.35)}
  .edge{position:absolute;inset:2.2mm;border:.4mm solid rgba(245,205,120,.35);border-radius:3mm;pointer-events:none}
  .ribbon{position:absolute;top:12mm;right:-16mm;width:66mm;transform:rotate(45deg);
          background:linear-gradient(180deg,#9a6a06,#f6cf5b 45%,#caa12f);color:#3a2c00;
          font-family:Arial,sans-serif;font-size:8pt;letter-spacing:4px;font-weight:700;text-align:center;
          padding:1.6mm 0;box-shadow:0 1mm 2mm rgba(0,0,0,.35)}
  .pad{position:relative;height:100%;padding:8mm 10mm}
  .brand{font-size:21pt;font-weight:700;letter-spacing:.5px}
  .tag{font-size:9pt;font-style:italic;color:#cbd5e1;margin-top:1mm}
  .gc{font-family:Arial,sans-serif;font-size:8.5pt;letter-spacing:5px;color:#f5c542;font-weight:700;margin-top:5mm}
  .amount{font-size:38pt;font-weight:800;line-height:1;margin-top:1mm}
  .amount small{font-size:17pt;vertical-align:super;font-weight:700;color:#e5e7eb;margin-right:1mm}
  .codebox{position:absolute;left:10mm;right:10mm;bottom:15mm;text-align:center;
           background:rgba(255,255,255,.06);border:.35mm dashed rgba(245,205,120,.6);border-radius:2.5mm;padding:3mm}
  .codebox .k{font-family:Arial,sans-serif;font-size:6.5pt;letter-spacing:3px;color:#94a3b8;text-transform:uppercase}
  .codebox .v{font-family:'Courier New',monospace;font-size:15pt;font-weight:700;letter-spacing:3px;margin-top:1.5mm;color:#fff}
  .foot{position:absolute;left:10mm;right:10mm;bottom:4.5mm;text-align:center;
        font-family:Arial,sans-serif;font-size:6.5pt;color:#aebbcd;line-height:1.5}
  @media print{ body{background:#fff} .wrap{min-height:auto;padding:0} .card{box-shadow:none} @page{margin:12mm} }
</style></head>
<body><div class="wrap"><div class="card">
  <div class="edge"></div>
  <div class="ribbon">GIFT</div>
  <div class="pad">
    <div class="brand">${name}</div>
    ${tagline ? `<div class="tag">${tagline}</div>` : ""}
    <div class="gc">GIFT CARD</div>
    <div class="amount"><small>${esc(sym)}</small>${amount}</div>
    <div class="codebox">
      <div class="k">Card Code</div>
      <div class="v">${esc(card.code)}</div>
    </div>
    <div class="foot">
      Valid for 1 year from date of issue &nbsp;·&nbsp; Redeem online, in store or by phone
      ${addressLine || phone ? `<br>${addressLine}${addressLine && phone ? " · " : ""}${phone ? `Tel: ${phone}` : ""}` : ""}
    </div>
  </div>
</div></div>
<script>window.onload=function(){window.focus();window.print();};window.onafterprint=function(){window.close();};</script>
</body></html>`;
}
