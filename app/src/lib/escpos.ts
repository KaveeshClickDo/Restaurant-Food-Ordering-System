/**
 * ESC/POS receipt builder + printer client
 *
 * Works entirely in the browser — no Node.js APIs used here.
 * The actual TCP connection is made server-side via /api/print.
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
      // Truncate left side with a tilde indicator
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
  const W  = settings.printer.paperWidth;
  const r  = settings.restaurant;
  const rs = settings.receiptSettings;
  const b  = new ReceiptBuilder();

  // ── Header ────────────────────────────────────────────────────────────────
  // Use receipt-specific name/contact fields; fall back to restaurant profile.
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

  // ── Order details ─────────────────────────────────────────────────────────
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

  // ── Items ─────────────────────────────────────────────────────────────────
  b.bold(true).twoCol("ITEM", "PRICE", W).bold(false);
  b.separator("-", W);

  for (const item of order.items) {
    b.twoCol(`${item.name} x${item.qty}`, fmt(item.price * item.qty), W);
  }

  b.separator("-", W);

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);

  // Use the VAT stored on the order — this reflects the exact amount charged at
  // checkout and stays correct even if tax settings change afterwards.
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
    const vatLabel = vatInclusive
      ? `Incl. VAT (${vatRate}%)`
      : `VAT (${vatRate}%)`;
    const vatValue = vatInclusive ? fmt(vatAmount) : `+${fmt(vatAmount)}`;
    b.twoCol(vatLabel, vatValue, W);
  }

  b.separator("=", W)
   .bold(true)
   .twoCol("TOTAL", fmt(order.total), W)
   .bold(false);

  if (showVat && vatInclusive) {
    b.align("center").line(`Prices include ${vatRate}% VAT`).align("left");
  }

  b.separator("=", W);

  // ── Footer ────────────────────────────────────────────────────────────────
  const thankYou     = rs?.thankYouMessage?.trim() || "Thank you for your order!";
  const customMsg    = rs?.customMessage?.trim()   || "";

  b.align("center")
   .feed(1)
   .bold(true)
   .line(thankYou)
   .bold(false);

  if (customMsg) b.line(customMsg);

  b.feed(5)
   .cut();

  return b.build();
}

/** Build a short test-connection receipt. */
export function buildTestReceipt(settings: AdminSettings): number[] {
  const W = settings.printer.paperWidth;
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
   .line(`Auto-print: ${settings.printer.autoPrint ? "Enabled" : "Disabled"}`)
   .line(`Paper: ${W === 48 ? "80 mm" : "58 mm"} (${W} chars)`)
   .feed(5)
   .cut();

  return b.build();
}

// ─── Printer client ──────────────────────────────────────────────────────────

const MAX_RETRIES   = 3;
const RETRY_DELAY   = 2_000; // ms

/**
 * Send bytes to the configured IP thermal printer via the /api/print route.
 * Retries up to MAX_RETRIES times. Never throws — returns ok/error.
 */
export async function sendToPrinter(
  bytes: number[],
  ip: string,
  port: number,
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res  = await fetch("/api/print", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ip, port, bytes }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) return { ok: true };
      // Non-retryable API error (bad config, etc.)
      if (attempt === MAX_RETRIES) return { ok: false, error: data.error };
    } catch (err) {
      if (attempt === MAX_RETRIES) return { ok: false, error: String(err) };
    }
    // Wait before retrying
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
  return { ok: false, error: "Max retries exceeded" };
}

/**
 * Print an order receipt if the printer is enabled and autoPrint is on.
 * Fire-and-forget safe — logs errors to console, never throws.
 */
export async function printOrder(
  order: Order,
  settings: AdminSettings,
): Promise<void> {
  const { printer } = settings;
  if (!printer.enabled || !printer.autoPrint) return;
  if (!printer.ip.trim()) {
    console.warn("[printer] Auto-print skipped — no IP configured");
    return;
  }
  try {
    const bytes  = buildReceipt(order, settings);
    const result = await sendToPrinter(bytes, printer.ip, printer.port);
    if (!result.ok) {
      console.error("[printer] Print failed:", result.error);
    }
  } catch (err) {
    console.error("[printer] Unexpected error:", err);
  }
}
