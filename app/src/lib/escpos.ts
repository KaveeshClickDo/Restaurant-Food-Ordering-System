/**
 * ESC/POS receipt builder + printer client
 *
 * Supports three connection modes:
 *  - "network": server-side TCP proxy via /api/print (IP thermal printers)
 *  - "usb":     Web USB API — direct browser → USB printer (Chrome/Edge)
 *  - "browser": window.print() with HTML receipt — universal fallback
 */

import type { AdminSettings, Order } from "@/types";

// ─── ESC/POS byte constants ──────────────────────────────────────────────────

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

// ─── Receipt builder ─────────────────────────────────────────────────────────

export class ReceiptBuilder {
  private buf: number[] = [];

  /** ESC @ — reset printer to factory defaults */
  init() {
    this.buf.push(ESC, 0x40);
    return this;
  }

  /** ESC a n — text alignment */
  align(a: "left" | "center" | "right") {
    const n = a === "left" ? 0 : a === "center" ? 1 : 2;
    this.buf.push(ESC, 0x61, n);
    return this;
  }

  /** ESC E n — bold on/off */
  bold(on: boolean) {
    this.buf.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /**
   * ESC ! n — character size
   *  doubleHeight = bit 0, doubleWidth = bit 4
   */
  size(doubleHeight: boolean, doubleWidth: boolean) {
    const n = (doubleWidth ? 0x10 : 0x00) | (doubleHeight ? 0x01 : 0x00);
    this.buf.push(ESC, 0x21, n);
    return this;
  }

  /** Append raw ASCII text (non-ASCII chars mapped to '?') */
  text(str: string) {
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      this.buf.push(code < 128 ? code : 0x3f); // '?' for multibyte
    }
    return this;
  }

  /** Text followed by a line-feed */
  line(str = "") {
    this.text(str);
    this.buf.push(LF);
    return this;
  }

  /** Feed n blank lines */
  feed(n = 1) {
    for (let i = 0; i < n; i++) this.buf.push(LF);
    return this;
  }

  /** Horizontal separator */
  separator(char = "-", width = 48) {
    return this.line(char.repeat(width));
  }

  /**
   * Two-column row — left text padded, right text right-aligned.
   * Total output is exactly `width` characters.
   */
  twoCol(left: string, right: string, width: number) {
    const leftWidth = width - right.length;
    let l: string;
    if (left.length > leftWidth - 1) {
      l = left.slice(0, leftWidth - 2) + "~ ";
    } else {
      l = left.padEnd(leftWidth);
    }
    return this.line(l + right);
  }

  /** GS V 41 03 — partial paper cut with 3-line feed */
  cut() {
    this.buf.push(GS, 0x56, 0x41, 0x03);
    return this;
  }

  /**
   * ESC p 0 t1 t2 — open cash drawer on port 0.
   * t1/t2 are on/off pulse durations in units of 2 ms (25 = 50 ms, 250 = 500 ms).
   * Works for drawers wired to the DK port on the printer (RJ11).
   */
  kickDrawer(t1 = 0x19, t2 = 0xfa) {
    this.buf.push(ESC, 0x70, 0x00, t1, t2);
    return this;
  }

  build(): number[] {
    return [...this.buf];
  }
}

// ─── Receipt templates ───────────────────────────────────────────────────────

function fmt(n: number) {
  return `£${n.toFixed(2)}`;
}

/** Build a full order receipt as ESC/POS bytes. */
export function buildReceipt(order: Order, settings: AdminSettings): number[] {
  const W  = [32, 48].includes(settings.printer.paperWidth) ? settings.printer.paperWidth : 48;
  const r  = settings.restaurant;
  const rs = settings.receiptSettings;
  const b  = new ReceiptBuilder();

  const receiptName  = rs?.restaurantName?.trim() || r.name;
  const receiptPhone = rs?.phone?.trim()           || r.phone;

  b.init()
   .align("center")
   .bold(true)
   .size(true, true)
   .line(receiptName.toUpperCase())
   .size(false, false)
   .bold(false)
   .line(r.addressLine1)
   .line(r.addressLine2 ? `${r.addressLine2}, ${r.city}` : r.city)
   .line(r.postcode);

  if (receiptPhone)        b.line(receiptPhone);
  if (rs?.website?.trim()) b.line(rs.website.trim());
  if (rs?.email?.trim())   b.line(rs.email.trim());
  if (rs?.vatNumber?.trim()) b.line(`VAT: ${rs.vatNumber.trim()}`);

  b.separator("=", W);

  b.align("left")
   .bold(true)
   .line(`ORDER ${order.id.toUpperCase()}`)
   .bold(false)
   .line(`Date: ${new Date(order.date).toLocaleString("en-GB", {
     day: "2-digit", month: "short", year: "numeric",
     hour: "2-digit", minute: "2-digit",
   })}`)
   .line(`Type: ${order.fulfillment === "delivery" ? "DELIVERY" : "COLLECTION"}`);

  if (order.address)       b.line(`To: ${order.address}`);
  if (order.paymentMethod) b.line(`Pay: ${order.paymentMethod}`);

  b.separator("=", W);

  b.bold(true).twoCol("ITEM", "PRICE", W).bold(false);
  b.separator("-", W);

  for (const item of order.items) {
    b.twoCol(`${item.name} x${item.qty}`, fmt(item.price * item.qty), W);
  }

  b.separator("-", W);

  const subtotal     = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  const vatAmount    = order.vatAmount ?? 0;
  const vatInclusive = order.vatInclusive ?? true;
  const vatRate      = settings.taxSettings?.rate ?? 0;
  const showVat      = vatAmount > 0 && (settings.taxSettings?.showBreakdown ?? true);

  b.twoCol("Subtotal", fmt(subtotal), W);
  if (order.deliveryFee && order.deliveryFee > 0) {
    b.twoCol("Delivery fee", fmt(order.deliveryFee), W);
  }
  if (order.serviceFee && order.serviceFee > 0) {
    b.twoCol("Service fee", fmt(order.serviceFee), W);
  }
  if (order.couponDiscount && order.couponDiscount > 0) {
    b.twoCol(`Coupon (${order.couponCode ?? ""})`, `-${fmt(order.couponDiscount)}`, W);
  }
  if (showVat) {
    const vatLabel = vatInclusive ? `Incl. VAT (${vatRate}%)` : `VAT (${vatRate}%)`;
    const vatValue = vatInclusive ? fmt(vatAmount) : `+${fmt(vatAmount)}`;
    b.twoCol(vatLabel, vatValue, W);
  }

  b.separator("=", W)
   .bold(true)
   .twoCol("TOTAL", fmt(order.total), W)
   .bold(false);

  if (order.tipAmount && order.tipAmount > 0) {
    b.twoCol("Tip", fmt(order.tipAmount), W);
  }
  if (order.changeGiven !== undefined && order.changeGiven > 0) {
    b.twoCol("Change", fmt(order.changeGiven), W);
  }

  if (showVat && vatInclusive) {
    b.align("center").line(`Prices include ${vatRate}% VAT`).align("left");
  }

  b.separator("=", W);

  const thankYou  = rs?.thankYouMessage?.trim() || "Thank you for your order!";
  const customMsg = rs?.customMessage?.trim()   || "";

  b.align("center")
   .feed(1)
   .bold(true)
   .line(thankYou)
   .bold(false);

  if (customMsg) b.line(customMsg);

  b.feed(5).cut();

  return b.build();
}

/** Build a short test-connection receipt. */
export function buildTestReceipt(settings: AdminSettings): number[] {
  const W = [32, 48].includes(settings.printer.paperWidth) ? settings.printer.paperWidth : 48;
  const r = settings.restaurant;
  const b = new ReceiptBuilder();

  b.init()
   .align("center")
   .bold(true)
   .size(true, true)
   .line("TEST PRINT")
   .size(false, false)
   .bold(false)
   .separator("=", W)
   .line(r.name)
   .line(`Printer: ${settings.printer.name || "Unnamed"}`)
   .line(new Date().toLocaleString("en-GB", {
     day: "2-digit", month: "short", year: "numeric",
     hour: "2-digit", minute: "2-digit",
   }))
   .separator("=", W)
   .bold(true)
   .line("Printer connected!")
   .bold(false)
   .line(`Mode: ${settings.printer.connection ?? "network"}`)
   .line(`Auto-print: ${settings.printer.autoPrint ? "Enabled" : "Disabled"}`)
   .line(`Paper: ${W === 48 ? "80 mm" : "58 mm"} (${W} chars)`)
   .feed(5)
   .cut();

  return b.build();
}

// ─── Network printer (server-side TCP proxy) ─────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY = 2_000;

/**
 * Send bytes to an IP thermal printer via the /api/print route.
 * Retries up to MAX_RETRIES times. Never throws — returns ok/error.
 */
export async function sendToPrinter(
  bytes: number[],
  ip: string,
  port: number,
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res  = await fetch("/api/print", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ip, port, bytes }),
        signal:  controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) return { ok: true };
      if (attempt === MAX_RETRIES) return { ok: false, error: data.error };
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error && err.name === "AbortError"
        ? `Print request timed out after 15 s (attempt ${attempt})`
        : String(err);
      if (attempt === MAX_RETRIES) return { ok: false, error: msg };
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
  return { ok: false, error: "Max retries exceeded" };
}

// ─── Bluetooth printer (Android native via Capacitor) ────────────────────────

/**
 * Send raw ESC/POS bytes to a Bluetooth thermal printer.
 * Delegates to the native BluetoothPrinterPlugin via capacitorBridge.
 * Only works inside the Capacitor Android shell — returns a clear error on web.
 */
export async function sendToPrinterBluetooth(
  bytes: number[],
  address: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!address.trim()) {
    return { ok: false, error: "No Bluetooth printer selected. Choose a paired device in printer settings." };
  }
  // Dynamic import so the bridge doesn't affect the Next.js server bundle
  const { sendBluetooth } = await import("./capacitorBridge");
  return sendBluetooth(address.trim(), bytes);
}

// ─── Web USB printer (direct browser → USB) ──────────────────────────────────

// Extended navigator type for Web USB API
interface USBDevice {
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ status: string }>;
  configuration: {
    interfaces: Array<{
      alternate: {
        endpoints: Array<{
          direction: "in" | "out";
          type: "bulk" | "interrupt" | "isochronous";
          endpointNumber: number;
        }>;
      };
    }>;
  } | null;
}

interface USBApi {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: { filters: Array<{ classCode?: number; vendorId?: number }> }): Promise<USBDevice>;
}

function getUSBApi(): USBApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { usb?: USBApi }).usb ?? null;
}

/**
 * Send bytes directly to a USB printer using the Web USB API.
 * Only works in Chrome/Edge (Firefox/Safari don't support Web USB).
 *
 * @param promptIfNeeded  When true (manual print), opens the browser device picker
 *                        if no printer has been authorized yet.
 *                        When false (auto-print), silently skips if no device is paired.
 */
export async function sendToPrinterUSB(
  bytes: number[],
  { promptIfNeeded = true }: { promptIfNeeded?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const usb = getUSBApi();
  if (!usb) {
    return {
      ok: false,
      error: "Web USB is not supported in this browser. Use Google Chrome or Microsoft Edge.",
    };
  }

  let device: USBDevice | undefined;

  try {
    // Reuse a previously authorized device
    const devices = await usb.getDevices();
    device = devices[0];

    // Only open the picker when explicitly triggered (e.g. "Print" button)
    if (!device) {
      if (!promptIfNeeded) {
        return { ok: false, error: "USB printer selection cancelled." };
      }
      device = await usb.requestDevice({
        filters: [
          { classCode: 7 }, // USB Printer class (most ESC/POS thermal printers)
        ],
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No device selected") || msg.includes("cancelled")) {
      return { ok: false, error: "USB printer selection cancelled." };
    }
    return { ok: false, error: `USB device error: ${msg}` };
  }

  try {
    await device.open();

    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const iface = device.configuration?.interfaces[0];
    if (!iface) throw new Error("No USB interface found on this printer.");

    await device.claimInterface(0);

    const endpoint = iface.alternate.endpoints.find(
      (e) => e.direction === "out" && e.type === "bulk"
    );
    if (!endpoint) {
      throw new Error(
        "No bulk OUT endpoint found. This device may not be an ESC/POS printer, " +
        "or may require a different USB configuration."
      );
    }

    const result = await device.transferOut(endpoint.endpointNumber, new Uint8Array(bytes));
    if (result.status !== "ok") {
      throw new Error(`USB transfer status: ${result.status}`);
    }

    await device.close();
    return { ok: true };
  } catch (err) {
    try { await device.close(); } catch { /* ignore close errors */ }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `USB print error: ${msg}` };
  }
}

// ─── Browser print (window.print() fallback) ─────────────────────────────────

/** Build an HTML receipt string for browser print. */
function buildReceiptHTML(
  lines: string[],
  title: string,
  paperWidth: number,
): string {
  const mmWidth = paperWidth === 48 ? "80mm" : "58mm";
  const rows = lines.map((l) => `<div class="line">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      width: ${mmWidth};
      padding: 4mm;
    }
    .line { white-space: pre; line-height: 1.4; }
    @media print {
      @page { margin: 0; size: ${mmWidth} auto; }
      body { width: ${mmWidth}; }
    }
  </style>
</head>
<body>${rows}</body>
</html>`;
}

/**
 * Open browser print dialog with an HTML receipt.
 * Works on any browser and any printer the OS can see (USB, Bluetooth, network).
 * Requires the user to confirm in the browser's print dialog.
 */
export function printReceiptBrowser(
  order: Order,
  settings: AdminSettings,
): { ok: boolean; error?: string } {
  if (typeof window === "undefined") {
    return { ok: false, error: "Browser print is not available server-side." };
  }

  const r   = settings.restaurant;
  const rs  = settings.receiptSettings;
  const W   = settings.printer.paperWidth;
  const sep = "-".repeat(W);
  const dbl = "=".repeat(W);

  const receiptName  = rs?.restaurantName?.trim() || r.name;
  const receiptPhone = rs?.phone?.trim()           || r.phone;

  const lines: string[] = [];

  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((W - s.length) / 2));
    return " ".repeat(pad) + s;
  };

  const twoCol = (left: string, right: string) => {
    const leftW = W - right.length;
    const l = left.length > leftW - 1 ? left.slice(0, leftW - 2) + "~" : left.padEnd(leftW);
    return l + right;
  };

  lines.push(center(receiptName.toUpperCase()));
  lines.push(center(r.addressLine1));
  lines.push(center(r.addressLine2 ? `${r.addressLine2}, ${r.city}` : r.city));
  lines.push(center(r.postcode));
  if (receiptPhone)          lines.push(center(receiptPhone));
  if (rs?.website?.trim())   lines.push(center(rs.website.trim()));
  if (rs?.email?.trim())     lines.push(center(rs.email.trim()));
  if (rs?.vatNumber?.trim()) lines.push(center(`VAT: ${rs.vatNumber.trim()}`));
  lines.push(dbl);

  lines.push(`ORDER ${order.id.toUpperCase()}`);
  lines.push(`Date: ${new Date(order.date).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })}`);
  lines.push(`Type: ${order.fulfillment === "delivery" ? "DELIVERY" : "COLLECTION"}`);
  if (order.address)       lines.push(`To: ${order.address}`);
  if (order.paymentMethod) lines.push(`Pay: ${order.paymentMethod}`);
  lines.push(dbl);

  lines.push(twoCol("ITEM", "PRICE"));
  lines.push(sep);

  for (const item of order.items) {
    lines.push(twoCol(`${item.name} x${item.qty}`, fmt(item.price * item.qty)));
  }

  lines.push(sep);

  const subtotal     = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  const vatAmount    = order.vatAmount ?? 0;
  const vatInclusive = order.vatInclusive ?? true;
  const vatRate      = settings.taxSettings?.rate ?? 0;
  const showVat      = vatAmount > 0 && (settings.taxSettings?.showBreakdown ?? true);

  lines.push(twoCol("Subtotal", fmt(subtotal)));
  if (order.deliveryFee && order.deliveryFee > 0) lines.push(twoCol("Delivery fee", fmt(order.deliveryFee)));
  if (order.serviceFee  && order.serviceFee  > 0) lines.push(twoCol("Service fee",  fmt(order.serviceFee)));
  if (order.couponDiscount && order.couponDiscount > 0) {
    lines.push(twoCol(`Coupon (${order.couponCode ?? ""})`, `-${fmt(order.couponDiscount)}`));
  }
  if (showVat) {
    const vatLabel = vatInclusive ? `Incl. VAT (${vatRate}%)` : `VAT (${vatRate}%)`;
    const vatValue = vatInclusive ? fmt(vatAmount) : `+${fmt(vatAmount)}`;
    lines.push(twoCol(vatLabel, vatValue));
  }

  lines.push(dbl);
  lines.push(twoCol("TOTAL", fmt(order.total)));
  if (order.tipAmount && order.tipAmount > 0) lines.push(twoCol("Tip", fmt(order.tipAmount)));
  if (order.changeGiven !== undefined && order.changeGiven > 0) lines.push(twoCol("Change", fmt(order.changeGiven)));
  if (showVat && vatInclusive) lines.push(center(`Prices include ${vatRate}% VAT`));
  lines.push(dbl);
  lines.push("");
  lines.push(center(rs?.thankYouMessage?.trim() || "Thank you for your order!"));
  if (rs?.customMessage?.trim()) lines.push(center(rs.customMessage.trim()));

  const html = buildReceiptHTML(lines, `Receipt — ${order.id}`, W);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, "_blank", "width=400,height=600");
  if (!win) {
    URL.revokeObjectURL(url);
    return { ok: false, error: "Pop-up was blocked. Allow pop-ups for this site and try again." };
  }
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
    URL.revokeObjectURL(url);
  }, 400);

  return { ok: true };
}

// ─── Unified dispatcher ──────────────────────────────────────────────────────

/**
 * Print an order receipt using the configured connection mode.
 * Optionally kicks the cash drawer after printing (for cash payments).
 * Fire-and-forget safe — logs errors to console, never throws.
 */
export async function printOrder(
  order: Order,
  settings: AdminSettings,
  opts: { kickDrawer?: boolean } = {},
): Promise<void> {
  const { printer } = settings;
  if (!printer.enabled || !printer.autoPrint) return;

  const mode = printer.connection ?? "network";

  try {
    let bytes = buildReceipt(order, settings);

    // Append cash drawer kick command when requested
    if (opts.kickDrawer) {
      const b = new ReceiptBuilder();
      b.kickDrawer();
      bytes = [...bytes, ...b.build()];
    }

    let result: { ok: boolean; error?: string };

    if (mode === "bluetooth") {
      result = await sendToPrinterBluetooth(bytes, printer.bluetoothAddress ?? "");
    } else if (mode === "usb") {
      result = await sendToPrinterUSB(bytes, { promptIfNeeded: false });
    } else if (mode === "browser") {
      result = printReceiptBrowser(order, settings);
    } else {
      // network — try native TCP first (Android, works offline on LAN)
      // then fall back to /api/print server proxy
      if (!printer.ip.trim()) {
        console.warn("[printer] Auto-print skipped — no IP configured");
        return;
      }
      const { sendTcpNative } = await import("./capacitorBridge");
      const nativeResult = await sendTcpNative(printer.ip, printer.port, bytes);
      if (nativeResult.ok || nativeResult.error !== "native_unavailable") {
        result = nativeResult;
      } else {
        result = await sendToPrinter(bytes, printer.ip, printer.port);
      }
    }

    if (!result.ok && result.error !== "USB printer selection cancelled.") {
      console.error("[printer] Print failed:", result.error);
    }
  } catch (err) {
    console.error("[printer] Unexpected error:", err);
  }
}
