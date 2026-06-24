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
import type { PrinterSettings } from "@/types";
import { ReceiptBuilder } from "./escpos";
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
  opts: { paperWidth: number; restaurantName: string },
): number[] {
  const W   = [32, 48].includes(opts.paperWidth) ? opts.paperWidth : 48;
  const sym = settings.currencySymbol || "£";
  const b   = new ReceiptBuilder();

  // ── Header ────────────────────────────────────────────────────────────────
  b.init()
   .align("center")
   .bold(true)
   .size(true, true)
   .line(opts.restaurantName.toUpperCase())
   .size(false, false)
   .bold(false);

  if (settings.receiptPhone?.trim())     b.line(settings.receiptPhone.trim());
  if (settings.receiptWebsite?.trim())   b.line(settings.receiptWebsite.trim());
  if (settings.receiptVatNumber?.trim()) b.line(`VAT: ${settings.receiptVatNumber.trim()}`);

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
    b.twoCol(`${item.name} x${item.quantity}`, money(item.price * item.quantity, sym), W);
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

  // ── Footer ──────────────────────────────────────────────────────────────--
  b.separator("=", W).align("center").feed(1);
  if (settings.receiptThankYouMessage?.trim()) b.bold(true).line(settings.receiptThankYouMessage.trim()).bold(false);
  if (settings.receiptCustomMessage?.trim())   b.line(settings.receiptCustomMessage.trim());

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

/**
 * High-level: print a POS sale to the configured printer.
 *
 * Returns `{ browser: true }` when the caller should fall back to window.print()
 * (printer disabled or set to "browser" mode) — those modes have no ESC/POS
 * byte path. Otherwise returns the transport result.
 */
export async function printPOSSale(
  sale: POSSale,
  settings: POSSettings,
  printer: PrinterSettings | undefined,
  restaurantName: string,
): Promise<{ ok: boolean; error?: string; browser?: boolean }> {
  if (!printer?.enabled || printer.connection === "browser") {
    return { ok: false, browser: true };
  }
  const bytes = buildPOSReceiptBytes(sale, settings, {
    paperWidth: printer.paperWidth,
    restaurantName,
  });
  return sendReceiptToPrinter(bytes, printer);
}
