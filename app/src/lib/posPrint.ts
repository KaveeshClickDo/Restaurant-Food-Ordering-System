/**
 * posPrint.ts — POS sale → thermal receipt, the offline-capable print path.
 *
 * Two responsibilities:
 *   1. buildPOSReceiptBytes — render a POSSale as ESC/POS bytes (mirrors the
 *      on-screen ReceiptModal: header, OFFLINE-SALE label, items+modifiers,
 *      totals, payment breakdown, footer). Width-aware (58 mm / 80 mm).
 *   2. sendReceiptToPrinter — dispatch those bytes to the configured printer,
 *      **preferring the native offline-capable transport on Android**:
 *        • bluetooth → native BluetoothPrinter plugin
 *        • usb       → native UsbPrinter plugin (web falls back to Web USB)
 *        • network   → native TcpPrinter (direct device→printer, works offline);
 *                      web / missing plugin falls back to the /api/print proxy
 *        • browser   → handled by the caller (window.print of the HTML receipt)
 *
 * This is the POS twin of escpos.ts (which targets admin Order objects and the
 * server proxy). Kept separate so the POS path can reach the printer with no
 * server in the loop — the whole reason the POS ships as a native app.
 */

import type { POSSale, POSSettings } from "@/types/pos";
import type { AdminSettings, PrinterSettings, ReceiptSettings } from "@/types";
import type { DineInOrder } from "@/components/pos/_receipts";
import { ReceiptBuilder, logoToRaster, paperDotWidth, resolveActivePrinter } from "./escpos";
import { sendToPrinter, sendToPrinterUSB } from "./escpos";
import { isCapacitorAndroid, sendBluetooth, sendUsb, sendTcpNative } from "./capacitorBridge";

/** A sale rung while offline carries an OFF<seq> receipt number. */
function isOfflineReceipt(receiptNo: string): boolean {
  return receiptNo.startsWith("OFF");
}

function money(n: number, sym: string): string {
  return `${sym}${n.toFixed(2)}`;
}

/**
 * Render a POS sale as ESC/POS bytes. `restaurantName` is passed in (the modal
 * already resolves it from admin branding → POS receipt name → business name)
 * so this stays a pure function of the sale + receipt settings.
 */
export function buildPOSReceiptBytes(
  sale: POSSale,
  settings: POSSettings,
  opts: { paperWidth: number; restaurantName: string; receipt: ReceiptSettings; logoBytes?: number[] | null },
): number[] {
  const W   = [32, 48].includes(opts.paperWidth) ? opts.paperWidth : 48;
  const sym = settings.currencySymbol || "£";
  const rc  = opts.receipt; // shared receiptSettings (Admin → Receipt / POS → Receipt)
  const b   = new ReceiptBuilder();

  // ── Header ────────────────────────────────────────────────────────────────
  b.init().align("center");
  if (opts.logoBytes && opts.logoBytes.length) b.raw(opts.logoBytes).feed(1);
  b.bold(true)
   .size(true, true)
   .line(opts.restaurantName.toUpperCase())
   .size(false, false)
   .bold(false);

  if (rc.address?.trim())   rc.address.split("\n").forEach((ln) => { if (ln.trim()) b.line(ln.trim()); });
  if (rc.phone?.trim())     b.line(rc.phone.trim());
  if (rc.website?.trim())   b.line(rc.website.trim());
  if (rc.email?.trim())     b.line(rc.email.trim());
  if (rc.vatNumber?.trim()) b.line(`VAT: ${rc.vatNumber.trim()}`);

  const when = new Date(sale.date).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  b.line(when).line(`Receipt #${sale.receiptNo}`);

  if (isOfflineReceipt(sale.receiptNo)) b.bold(true).line("OFFLINE SALE").bold(false);
  if (sale.staffName)    b.line(`Served by: ${sale.staffName}`);
  if (sale.customerName) b.line(`Customer: ${sale.customerName}`);

  b.separator("=", W);

  // ── Items ───────────────────────────────────────────────────────────────--
  b.align("left");
  for (const item of sale.items) {
    b.itemRow(`${item.name} x${item.quantity}`, money(item.price * item.quantity, sym), W);
    for (const m of item.modifiers ?? []) b.line(`  + ${m.optionLabel}`);
    if (item.note) b.line(`  "${item.note}"`);
  }

  b.separator("-", W);

  // ── Totals ──────────────────────────────────────────────────────────────--
  b.twoCol("Subtotal", money(sale.subtotal, sym), W);
  if (sale.discountAmount > 0) {
    const label = sale.discountNote ? `Discount (${sale.discountNote})` : "Discount";
    b.twoCol(label, `-${money(sale.discountAmount, sym)}`, W);
  }
  if (sale.taxAmount > 0 && settings.showBreakdown) {
    const label = sale.taxInclusive ? `VAT (${sale.taxRate}% incl.)` : `VAT (${sale.taxRate}%)`;
    const value = sale.taxInclusive ? money(sale.taxAmount, sym) : `+${money(sale.taxAmount, sym)}`;
    b.twoCol(label, value, W);
  }
  if (sale.tipAmount > 0)        b.twoCol("Tip", money(sale.tipAmount, sym), W);
  if (sale.serviceFeeAmount > 0) b.twoCol("Service Fee", money(sale.serviceFeeAmount, sym), W);

  // `total` is stored NET of the gift card; re-add it for the gross goods total.
  const giftAmt    = sale.giftCardUsed ?? sale.giftCard?.amount ?? 0;
  const grossTotal = Math.round((sale.total + giftAmt) * 100) / 100;

  b.separator("=", W).bold(true).twoCol("TOTAL", money(grossTotal, sym), W).bold(false);

  // ── Payment breakdown ─────────────────────────────────────────────────────
  if (giftAmt > 0) {
    const tail = sale.giftCard?.code ? ` (..${sale.giftCard.code.slice(-4)})` : "";
    b.twoCol(`Gift Card${tail}`, money(giftAmt, sym), W);
  }
  if (sale.paymentMethod === "split") {
    for (const p of sale.payments) b.twoCol(p.method, money(p.amount, sym), W);
  } else if (sale.paymentMethod === "cash") {
    b.twoCol("Cash", money(sale.cashTendered ?? sale.total, sym), W);
    if ((sale.changeGiven ?? 0) > 0) b.twoCol("Change", money(sale.changeGiven!, sym), W);
  } else if (sale.paymentMethod !== "gift_card") {
    b.twoCol(sale.paymentMethod, money(sale.total, sym), W);
  }
  // A tip the customer added on the card machine, apart from the total.
  const cardTip = sale.cardTipAmount ?? 0;
  if (cardTip > 0) {
    b.twoCol("Tip on card machine", money(cardTip, sym), W);
    b.twoCol("Card total", money(Math.round((sale.total + cardTip) * 100) / 100, sym), W);
  }

  // ── Footer ──────────────────────────────────────────────────────────────--
  b.separator("=", W).align("center").feed(1);
  if (rc.thankYouMessage?.trim()) b.bold(true).line(rc.thankYouMessage.trim()).bold(false);
  if (rc.customMessage?.trim())   b.line(rc.customMessage.trim());

  b.feed(5).cut();
  return b.build();
}

/** Render a dine-in table bill as ESC/POS bytes — mirrors buildDineInReceiptHtml.
 *  `settings` needs only currencySymbol/taxRate, so non-POS callers can pass those two alone. */
export function buildDineInReceiptBytes(
  order: DineInOrder,
  settings: Pick<POSSettings, "currencySymbol" | "taxRate">,
  opts: { paperWidth: number; restaurantName: string; receipt: ReceiptSettings; logoBytes?: number[] | null },
): number[] {
  const W   = [32, 48].includes(opts.paperWidth) ? opts.paperWidth : 48;
  const sym = settings.currencySymbol || "£";
  const rc  = opts.receipt;
  const b   = new ReceiptBuilder();

  b.init().align("center");
  if (opts.logoBytes && opts.logoBytes.length) b.raw(opts.logoBytes).feed(1);
  b.bold(true)
   .size(true, true)
   .line(opts.restaurantName.toUpperCase())
   .size(false, false)
   .bold(false);

  if (rc.address?.trim())   rc.address.split("\n").forEach((ln) => { if (ln.trim()) b.line(ln.trim()); });
  if (rc.phone?.trim())     b.line(rc.phone.trim());
  if (rc.vatNumber?.trim()) b.line(`VAT: ${rc.vatNumber.trim()}`);

  b.line(new Date(order.date).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }));
  b.bold(true).line(`Table: ${order.tableLabel}`).bold(false);
  if (order.staffName) b.line(`Served by: ${order.staffName}`);
  if (order.covers > 0) b.line(`${order.covers} cover${order.covers !== 1 ? "s" : ""}`);

  b.separator("=", W).align("left");
  for (const it of order.items) b.itemRow(`${it.name} x${it.qty}`, money(it.price * it.qty, sym), W);
  b.separator("-", W);

  const subtotal    = order.items.reduce((s, l) => s + l.price * l.qty, 0);
  const discount    = order.discountAmount || 0;
  const tip         = order.tipAmount || 0;
  const serviceFee  = order.serviceFeeAmount || 0;
  const vat         = order.vatAmount || 0;
  const giftCard    = order.giftCardUsed || 0;
  if (discount > 0 || tip > 0 || vat > 0 || serviceFee > 0) {
    b.twoCol("Subtotal", money(subtotal, sym), W);
    if (discount > 0) b.twoCol(order.discountNote ? `Discount (${order.discountNote})` : "Discount", `-${money(discount, sym)}`, W);
    if (vat > 0) {
      const rate = order.vatRate != null ? order.vatRate : settings.taxRate;
      const label = `${order.vatInclusive ? "Incl. VAT" : "VAT"}${rate ? ` (${rate}%)` : ""}`;
      b.twoCol(label, `${order.vatInclusive ? "" : "+"}${money(vat, sym)}`, W);
    }
    if (tip > 0)        b.twoCol("Tip", money(tip, sym), W);
    if (serviceFee > 0) b.twoCol("Service Fee", money(serviceFee, sym), W);
  }

  // `total` is stored NET of the gift card; re-add it for the gross goods total.
  const grossTotal = Math.round((order.total + giftCard) * 100) / 100;
  b.separator("=", W).bold(true).twoCol("TOTAL", money(grossTotal, sym), W).bold(false);

  const payLabel =
    order.paymentMethod === "cash" ? "Cash" :
    order.paymentMethod === "card" ? "Card" :
    order.paymentMethod === "gift_card" ? "Gift Card" : "Table Service";
  if (giftCard > 0) {
    b.twoCol("Gift card", `-${money(giftCard, sym)}`, W);
    b.bold(true).twoCol(`PAID (${payLabel})`, money(order.total, sym), W).bold(false);
  } else {
    b.twoCol("Payment", payLabel, W);
  }

  b.separator("=", W).align("center").feed(1);
  if (rc.thankYouMessage?.trim()) b.bold(true).line(rc.thankYouMessage.trim()).bold(false);

  b.feed(5).cut();
  return b.build();
}

/**
 * Send raw ESC/POS bytes to the configured printer. Native-first on Android so
 * it works with no server in the loop (offline). Never throws.
 *
 * The "browser" connection mode is NOT handled here — it has no byte stream;
 * the caller prints the HTML receipt via window.print() instead.
 */
export async function sendReceiptToPrinter(
  bytes: number[],
  printer: PrinterSettings,
): Promise<{ ok: boolean; error?: string }> {
  const android = isCapacitorAndroid();

  switch (printer.connection) {
    case "bluetooth":
      if (!printer.bluetoothAddress?.trim()) {
        return { ok: false, error: "No Bluetooth printer selected. Choose one in Settings → Hardware." };
      }
      return sendBluetooth(printer.bluetoothAddress.trim(), bytes);

    case "usb":
      // Native USB host inside the app; Web USB (Chrome/Edge) on the desktop.
      return android ? sendUsb(bytes) : sendToPrinterUSB(bytes, { promptIfNeeded: false });

    case "network": {
      if (!printer.ip?.trim()) {
        return { ok: false, error: "No printer IP set. Add one in Settings → Hardware." };
      }
      if (android) {
        // Direct device→printer TCP — works offline on the LAN.
        const r = await sendTcpNative(printer.ip.trim(), printer.port, bytes);
        if (r.error !== "native_unavailable") return r; // native plugin handled it (ok or real error)
      }
      // Web, or native plugin missing → server-side proxy (needs the backend).
      return sendToPrinter(bytes, printer.ip.trim(), printer.port);
    }

    default:
      return { ok: false, error: "browser_mode" };
  }
}

/** POS staff can't edit the Kitchen printer, so reword errors that point at Settings → Hardware. */
function kitchenErrorMessage(raw: string | undefined): string {
  if (!raw) return "The Kitchen printer failed.";
  if (raw === "browser_mode") {
    return "The Kitchen printer is set to Browser print, which can't print automatically. An admin can change it in Admin → Integrations.";
  }
  if (raw.startsWith("No printer IP set")) {
    return "The Kitchen printer has no IP address. An admin can set it in Admin → Integrations.";
  }
  if (raw.startsWith("No Bluetooth printer selected")) {
    return "The Kitchen printer has no Bluetooth device chosen. An admin can set it in Admin → Integrations.";
  }
  return raw; // already names the address or device
}

/** Automatic kitchen print for a new POS sale, if the kitchen printer's
 *  Auto-print is on. Call once per sale — not from the Print button or
 *  reprints. Never throws. `skipped` means there was nothing to print. */
export async function printSaleToKitchen(
  sale: POSSale,
  settings: POSSettings,
  appSettings: AdminSettings,
  restaurantName: string,
  receipt: ReceiptSettings,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const printer = resolveActivePrinter(appSettings, "kitchen");
  if (!printer || !printer.autoPrint) return { ok: true, skipped: true };
  try {
    const logoBytes = receipt.showLogo && receipt.logoUrl
      ? await logoToRaster(receipt.logoUrl, paperDotWidth(printer.paperWidth), { dither: receipt.logoDither })
      : null;
    const bytes = buildPOSReceiptBytes(sale, settings, { paperWidth: printer.paperWidth, restaurantName, receipt, logoBytes });
    const result = await sendReceiptToPrinter(bytes, printer);
    if (result.ok) return { ok: true };
    console.error("[printer:kitchen] POS sale print failed:", result.error);
    return { ok: false, error: kitchenErrorMessage(result.error) };
  } catch (err) {
    console.error("[printer:kitchen] Unexpected error:", err);
    return { ok: false, error: kitchenErrorMessage(err instanceof Error ? err.message : undefined) };
  }
}

/**
 * High-level: print a POS sale on the active "pos" printer only. Used for both
 * the automatic print and the Print button / reprints, so it never touches the
 * kitchen (see printSaleToKitchen).
 *
 * Returns `{ noPrinter: true }` when there is no active "pos" printer, and
 * `{ browser: true }` when it's in "browser" mode (no ESC/POS byte path).
 * Otherwise returns the transport result.
 */
export async function printPOSSale(
  sale: POSSale,
  settings: POSSettings,
  appSettings: AdminSettings,
  restaurantName: string,
  receipt: ReceiptSettings,
): Promise<{ ok: boolean; error?: string; browser?: boolean; noPrinter?: boolean }> {
  const printer = resolveActivePrinter(appSettings, "pos");
  if (!printer) return { ok: false, noPrinter: true };
  if (printer.connection === "browser") return { ok: false, browser: true };
  // Pre-render the logo raster (async) when Show Logo is on.
  const logoBytes = receipt.showLogo && receipt.logoUrl
    ? await logoToRaster(receipt.logoUrl, paperDotWidth(printer.paperWidth), { dither: receipt.logoDither })
    : null;
  const bytes = buildPOSReceiptBytes(sale, settings, {
    paperWidth: printer.paperWidth,
    restaurantName,
    receipt,
    logoBytes,
  });
  return sendReceiptToPrinter(bytes, printer);
}

/**
 * Print a settled dine-in bill on the active "pos" printer only (manual print:
 * ignores Auto-print, never touches the kitchen). Same return contract as printPOSSale.
 */
export async function printDineInBill(
  order: DineInOrder,
  settings: Pick<POSSettings, "currencySymbol" | "taxRate">,
  appSettings: AdminSettings,
  restaurantName: string,
  receipt: ReceiptSettings,
): Promise<{ ok: boolean; error?: string; browser?: boolean; noPrinter?: boolean }> {
  const printer = resolveActivePrinter(appSettings, "pos");
  if (!printer) return { ok: false, noPrinter: true };
  if (printer.connection === "browser") return { ok: false, browser: true };
  const logoBytes = receipt.showLogo && receipt.logoUrl
    ? await logoToRaster(receipt.logoUrl, paperDotWidth(printer.paperWidth), { dither: receipt.logoDither })
    : null;
  const bytes = buildDineInReceiptBytes(order, settings, {
    paperWidth: printer.paperWidth,
    restaurantName,
    receipt,
    logoBytes,
  });
  return sendReceiptToPrinter(bytes, printer);
}
