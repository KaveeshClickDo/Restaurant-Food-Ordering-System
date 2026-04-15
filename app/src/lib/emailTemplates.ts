/**
 * Email template utilities — browser-safe (no Node.js APIs).
 *
 * Handles:
 *  - Variable replacement in subject + body
 *  - Wrapping body HTML in a full email document
 *  - Calling the /api/email API route to actually send
 */

import type { AdminSettings, Customer, EmailTemplate, EmailTemplateEvent, Order } from "@/types";

// ─── Variable registry ────────────────────────────────────────────────────────

export interface VarDef {
  name: string;
  label: string;
  group: "Customer" | "Order" | "Restaurant";
  preview: string; // value used in the template preview
}

export const TEMPLATE_VARS: VarDef[] = [
  // Customer
  { name: "customer_name",       label: "Customer name",       group: "Customer",    preview: "Jane Smith" },
  { name: "customer_email",      label: "Customer email",      group: "Customer",    preview: "jane@example.com" },
  // Order
  { name: "order_id",            label: "Order ID",            group: "Order",       preview: "ORD-A1B2C3D4" },
  { name: "order_date",          label: "Order date",          group: "Order",       preview: "11 Apr 2026, 12:34" },
  { name: "order_items",         label: "Order items (table)", group: "Order",       preview: "<i>(items table)</i>" },
  { name: "order_total",         label: "Order total",         group: "Order",       preview: "£18.45" },
  { name: "order_status",        label: "Order status",        group: "Order",       preview: "confirmed" },
  { name: "fulfillment_type",    label: "Fulfillment type",    group: "Order",       preview: "Delivery" },
  { name: "delivery_address",    label: "Delivery address",    group: "Order",       preview: "42 Example St, London" },
  { name: "payment_method",      label: "Payment method",      group: "Order",       preview: "Cash on Delivery" },
  { name: "estimated_time",      label: "Estimated time (min)", group: "Order",      preview: "30–45" },
  // Restaurant
  { name: "restaurant_name",     label: "Restaurant name",     group: "Restaurant",  preview: "Spice Garden" },
  { name: "restaurant_phone",    label: "Restaurant phone",    group: "Restaurant",  preview: "020 7123 4567" },
  { name: "restaurant_address",  label: "Restaurant address",  group: "Restaurant",  preview: "42 Curry Lane, London" },
  // Tax
  { name: "order_vat",           label: "VAT amount",          group: "Order",       preview: "£3.33 (incl. 20% VAT)" },
];

// ─── Event metadata ───────────────────────────────────────────────────────────

export interface EventConfig {
  event: EmailTemplateEvent;
  name: string;
  description: string;
  color: string;        // Tailwind bg class
  textColor: string;    // Tailwind text class
  emoji: string;
}

export const EVENT_CONFIGS: EventConfig[] = [
  { event: "order_confirmation", name: "Order Confirmation", description: "Sent when a customer places an order",        color: "bg-orange-100", textColor: "text-orange-700", emoji: "🧾" },
  { event: "order_confirmed",    name: "Order Confirmed",    description: "Sent when admin confirms the order",          color: "bg-blue-100",   textColor: "text-blue-700",   emoji: "✅" },
  { event: "order_preparing",    name: "Order Preparing",    description: "Sent when kitchen starts preparing",         color: "bg-amber-100",  textColor: "text-amber-700",  emoji: "🍳" },
  { event: "order_ready",        name: "Order Ready",        description: "Sent when the order is ready",               color: "bg-green-100",  textColor: "text-green-700",  emoji: "🥡" },
  { event: "order_delivered",    name: "Order Delivered",    description: "Sent when the order has been delivered",     color: "bg-emerald-100",textColor: "text-emerald-700",emoji: "🚀" },
  { event: "order_cancelled",    name: "Order Cancelled",    description: "Sent when an order is cancelled",            color: "bg-red-100",    textColor: "text-red-700",    emoji: "❌" },
];

// ─── Default templates ────────────────────────────────────────────────────────

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    event: "order_confirmation",
    name: "Order Confirmation",
    subject: "Your order is confirmed — {{order_id}}",
    body: `<h2 style="color:#ea580c;margin:0 0 16px 0">Thank you for your order! 🎉</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>We've received your order and it's being processed. Here's a summary:</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p>
  <strong>Order ID:</strong> {{order_id}}<br>
  <strong>Date:</strong> {{order_date}}<br>
  <strong>Fulfillment:</strong> {{fulfillment_type}}<br>
  <strong>Payment:</strong> {{payment_method}}
</p>
<h3 style="color:#374151;margin:20px 0 10px 0;font-size:15px">Your items:</h3>
{{order_items}}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p style="color:#6b7280;font-size:14px">Questions? Call us at <strong>{{restaurant_phone}}</strong> or reply to this email.</p>
<p>Thanks for choosing <strong>{{restaurant_name}}</strong>!</p>`,
    enabled: true,
    lastModified: new Date(0).toISOString(),
  },
  {
    event: "order_confirmed",
    name: "Order Confirmed",
    subject: "Your order has been confirmed — {{restaurant_name}}",
    body: `<h2 style="color:#2563eb;margin:0 0 16px 0">Order Confirmed ✅</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>Your order <strong>{{order_id}}</strong> has been confirmed and our team is getting started.</p>
<p><strong>Estimated time:</strong> {{estimated_time}} minutes</p>
<p>We'll notify you as soon as your order is ready.</p>
<p style="color:#6b7280;font-size:14px">— The team at <strong>{{restaurant_name}}</strong></p>`,
    enabled: true,
    lastModified: new Date(0).toISOString(),
  },
  {
    event: "order_preparing",
    name: "Order Preparing",
    subject: "We're preparing your order — {{order_id}}",
    body: `<h2 style="color:#d97706;margin:0 0 16px 0">Your Order is Being Prepared 🍳</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>Great news — our kitchen is working on your order <strong>{{order_id}}</strong> right now.</p>
<p>We'll have it ready for you shortly. Thank you for your patience!</p>
<p style="color:#6b7280;font-size:14px">— The team at <strong>{{restaurant_name}}</strong></p>`,
    enabled: true,
    lastModified: new Date(0).toISOString(),
  },
  {
    event: "order_ready",
    name: "Order Ready",
    subject: "Your order is ready! — {{order_id}}",
    body: `<h2 style="color:#16a34a;margin:0 0 16px 0">Your Order is Ready! 🥡</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>Your order <strong>{{order_id}}</strong> is ready!</p>
<p><strong>Fulfillment:</strong> {{fulfillment_type}}</p>
<p>{{delivery_address}}</p>
<p style="color:#6b7280;font-size:14px">— The team at <strong>{{restaurant_name}}</strong></p>`,
    enabled: true,
    lastModified: new Date(0).toISOString(),
  },
  {
    event: "order_delivered",
    name: "Order Delivered",
    subject: "Your order has been delivered — enjoy! 🚀",
    body: `<h2 style="color:#059669;margin:0 0 16px 0">Order Delivered! 🚀</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>Your order <strong>{{order_id}}</strong> has been delivered. We hope you enjoy your meal!</p>
<p>We'd love to see you again — visit <strong>{{restaurant_name}}</strong> or order online anytime.</p>
<p>Bon appétit! 🍽️</p>
<p style="color:#6b7280;font-size:14px">— The team at <strong>{{restaurant_name}}</strong></p>`,
    enabled: true,
    lastModified: new Date(0).toISOString(),
  },
  {
    event: "order_cancelled",
    name: "Order Cancelled",
    subject: "Order cancellation notice — {{order_id}}",
    body: `<h2 style="color:#dc2626;margin:0 0 16px 0">Order Cancelled</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>We're sorry to inform you that your order <strong>{{order_id}}</strong> has been cancelled.</p>
<p>If you have any questions, please contact us at <strong>{{restaurant_phone}}</strong>.</p>
<p>We apologise for any inconvenience and hope to serve you again soon.</p>
<p style="color:#6b7280;font-size:14px">— The team at <strong>{{restaurant_name}}</strong></p>`,
    enabled: false,
    lastModified: new Date(0).toISOString(),
  },
];

// ─── Variable replacement ─────────────────────────────────────────────────────

/** Build the variable map from real order/customer/settings data. */
export function buildVarMap(
  order: Order,
  customer: Customer | null,
  settings: AdminSettings,
): Record<string, string> {
  const itemsHtml = order.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">${i.name} × ${i.qty}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;white-space:nowrap">£${(i.price * i.qty).toFixed(2)}</td>
        </tr>`,
    )
    .join("");

  // ── Totals breakdown ───────────────────────────────────────────────────────
  const subtotalAmt = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  const vatRate     = settings.taxSettings?.rate ?? 0;

  let totalsHtml = `
    <tr>
      <td style="padding:8px 8px 4px;font-weight:600;color:#374151;border-top:2px solid #e5e7eb">Subtotal</td>
      <td style="padding:8px 8px 4px;text-align:right;font-weight:600;color:#374151;border-top:2px solid #e5e7eb">£${subtotalAmt.toFixed(2)}</td>
    </tr>`;

  if (order.deliveryFee && order.deliveryFee > 0) {
    totalsHtml += `
    <tr>
      <td style="padding:4px 8px;color:#6b7280">Delivery fee</td>
      <td style="padding:4px 8px;text-align:right;color:#6b7280">£${order.deliveryFee.toFixed(2)}</td>
    </tr>`;
  }
  if (order.serviceFee && order.serviceFee > 0) {
    totalsHtml += `
    <tr>
      <td style="padding:4px 8px;color:#6b7280">Service fee</td>
      <td style="padding:4px 8px;text-align:right;color:#6b7280">£${order.serviceFee.toFixed(2)}</td>
    </tr>`;
  }
  if (order.couponDiscount && order.couponDiscount > 0) {
    totalsHtml += `
    <tr>
      <td style="padding:4px 8px;color:#16a34a;font-weight:600">Coupon (${order.couponCode ?? ""})</td>
      <td style="padding:4px 8px;text-align:right;color:#16a34a;font-weight:600">−£${order.couponDiscount.toFixed(2)}</td>
    </tr>`;
  }
  if (order.vatAmount && order.vatAmount > 0) {
    const vatLabel  = order.vatInclusive ? `VAT incl. (${vatRate}%)` : `VAT (${vatRate}%)`;
    const vatColor  = order.vatInclusive ? "#9ca3af" : "#ea580c";
    const vatPrefix = order.vatInclusive ? "" : "+";
    totalsHtml += `
    <tr>
      <td style="padding:4px 8px;color:${vatColor};font-weight:600">${vatLabel}</td>
      <td style="padding:4px 8px;text-align:right;color:${vatColor};font-weight:600">${vatPrefix}£${order.vatAmount.toFixed(2)}</td>
    </tr>`;
  }
  totalsHtml += `
    <tr style="background:#f9fafb">
      <td style="padding:8px;font-weight:700;font-size:15px;color:#111827;border-top:2px solid #e5e7eb">Total</td>
      <td style="padding:8px;text-align:right;font-weight:700;font-size:15px;color:#111827;border-top:2px solid #e5e7eb">£${order.total.toFixed(2)}</td>
    </tr>`;

  const vatNote = order.vatAmount && order.vatAmount > 0 && order.vatInclusive
    ? `<p style="margin:4px 0 0 0;font-size:11px;color:#9ca3af;text-align:right">Prices include ${vatRate}% VAT</p>`
    : "";

  const orderItemsTable = `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:6px 8px;text-align:left;font-weight:600;color:#374151">Item</th>
          <th style="padding:6px 8px;text-align:right;font-weight:600;color:#374151">Price</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot>${totalsHtml}</tfoot>
    </table>${vatNote}`;

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.addressLine2,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ]
    .filter(Boolean)
    .join(", ");

  const estTime =
    order.fulfillment === "delivery"
      ? String(settings.restaurant.deliveryTime)
      : String(settings.restaurant.collectionTime);

  return {
    customer_name:      customer?.name        ?? "Valued Customer",
    customer_email:     customer?.email       ?? "",
    order_id:           order.id.toUpperCase(),
    order_date:         new Date(order.date).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }),
    order_items:        orderItemsTable,
    order_total:        `£${order.total.toFixed(2)}`,
    order_status:       order.status,
    fulfillment_type:   order.fulfillment === "delivery" ? "Delivery" : "Collection",
    delivery_address:   order.address ?? "",
    payment_method:     order.paymentMethod ?? "",
    restaurant_name:    settings.restaurant.name,
    restaurant_phone:   settings.restaurant.phone,
    restaurant_address: restAddr,
    estimated_time:     estTime,
    order_vat:          buildVatString(order.vatAmount, order.vatInclusive, settings),
  };
}

function buildVatString(
  vatAmount: number | undefined,
  vatInclusive: boolean | undefined,
  settings: AdminSettings,
): string {
  const tax = settings.taxSettings;
  if (!tax?.enabled || !vatAmount || vatAmount <= 0) return "";
  const mode = vatInclusive ? `incl. ${tax.rate}% VAT` : `${tax.rate}% VAT`;
  return `£${vatAmount.toFixed(2)} (${mode})`;
}

/** Replace {{variable}} placeholders with actual values. */
export function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** Build the preview var map using dummy data (no real order needed). */
export function buildPreviewVarMap(settings: AdminSettings): Record<string, string> {
  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ]
    .filter(Boolean)
    .join(", ");

  const previewVatEnabled = settings.taxSettings?.enabled && (settings.taxSettings?.rate ?? 0) > 0;
  const previewSubtotal   = 14.97;  // 11.98 + 2.99
  const previewDelivery   = 2.99;
  const previewService    = parseFloat((previewSubtotal * (settings.restaurant.serviceFee / 100)).toFixed(2));
  const previewVatRate    = settings.taxSettings?.rate ?? 20;
  const previewInclusive  = settings.taxSettings?.inclusive ?? true;
  const previewVatAmt     = previewVatEnabled
    ? parseFloat((previewSubtotal * previewVatRate / (previewInclusive ? 100 + previewVatRate : 100)).toFixed(2))
    : 0;
  const previewTotal      = previewSubtotal + previewDelivery + previewService + (previewInclusive ? 0 : previewVatAmt);

  let previewTotals = `
    <tr>
      <td style="padding:8px 8px 4px;font-weight:600;color:#374151;border-top:2px solid #e5e7eb">Subtotal</td>
      <td style="padding:8px 8px 4px;text-align:right;font-weight:600;color:#374151;border-top:2px solid #e5e7eb">£${previewSubtotal.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding:4px 8px;color:#6b7280">Delivery fee</td>
      <td style="padding:4px 8px;text-align:right;color:#6b7280">£${previewDelivery.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding:4px 8px;color:#6b7280">Service fee (${settings.restaurant.serviceFee}%)</td>
      <td style="padding:4px 8px;text-align:right;color:#6b7280">£${previewService.toFixed(2)}</td>
    </tr>`;
  if (previewVatEnabled && previewVatAmt > 0) {
    const vatLabel  = previewInclusive ? `VAT incl. (${previewVatRate}%)` : `VAT (${previewVatRate}%)`;
    const vatColor  = previewInclusive ? "#9ca3af" : "#ea580c";
    const vatPrefix = previewInclusive ? "" : "+";
    previewTotals += `
    <tr>
      <td style="padding:4px 8px;color:${vatColor};font-weight:600">${vatLabel}</td>
      <td style="padding:4px 8px;text-align:right;color:${vatColor};font-weight:600">${vatPrefix}£${previewVatAmt.toFixed(2)}</td>
    </tr>`;
  }
  previewTotals += `
    <tr style="background:#f9fafb">
      <td style="padding:8px;font-weight:700;font-size:15px;color:#111827;border-top:2px solid #e5e7eb">Total</td>
      <td style="padding:8px;text-align:right;font-weight:700;font-size:15px;color:#111827;border-top:2px solid #e5e7eb">£${previewTotal.toFixed(2)}</td>
    </tr>`;

  const previewVatNote = previewVatEnabled && previewVatAmt > 0 && previewInclusive
    ? `<p style="margin:4px 0 0 0;font-size:11px;color:#9ca3af;text-align:right">Prices include ${previewVatRate}% VAT</p>`
    : "";

  const itemsTable = `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0">
      <thead><tr style="background:#f9fafb">
        <th style="padding:6px 8px;text-align:left;font-weight:600;color:#374151">Item</th>
        <th style="padding:6px 8px;text-align:right;font-weight:600;color:#374151">Price</th>
      </tr></thead>
      <tbody>
        <tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">Chicken Tikka Masala × 2</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right">£11.98</td></tr>
        <tr><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">Garlic Naan × 1</td><td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right">£2.99</td></tr>
      </tbody>
      <tfoot>${previewTotals}</tfoot>
    </table>${previewVatNote}`;

  return {
    customer_name:      "Jane Smith",
    customer_email:     "jane@example.com",
    order_id:           "ORD-A1B2C3D4",
    order_date:         "11 Apr 2026, 12:34",
    order_items:        itemsTable,
    order_total:        `£${previewTotal.toFixed(2)}`,
    order_status:       "confirmed",
    fulfillment_type:   "Delivery",
    delivery_address:   "42 Example Street, London, E1 6RF",
    payment_method:     "Cash on Delivery",
    estimated_time:     `${settings.restaurant.deliveryTime}`,
    restaurant_name:    settings.restaurant.name,
    restaurant_phone:   settings.restaurant.phone,
    restaurant_address: restAddr,
    order_vat: previewVatEnabled && previewVatAmt > 0
      ? buildVatString(previewVatAmt, previewInclusive, settings)
      : "",
  };
}

// ─── Full email document builder ──────────────────────────────────────────────

/** Wrap the template body in a full responsive email document. */
export function buildEmailDocument(
  bodyHtml: string,
  restaurantName: string,
  restaurantAddress: string,
  phone: string,
  receiptSettings?: import("@/types").ReceiptSettings,
): string {
  // Logo block — only when showLogo is on and a URL is provided
  const logoBlock =
    receiptSettings?.showLogo && receiptSettings.logoUrl?.trim()
      ? `<div style="margin-bottom:12px">
           <img src="${receiptSettings.logoUrl.trim()}" alt="${restaurantName}" style="max-height:60px;max-width:180px;object-fit:contain" />
         </div>`
      : "";

  // Header uses the receipt-specific name when available
  const headerName = receiptSettings?.restaurantName?.trim() || restaurantName;

  // Footer contact line
  const footerParts: string[] = [headerName];
  if (restaurantAddress)                        footerParts.push(restaurantAddress);
  const footerPhone = receiptSettings?.phone?.trim() || phone;
  if (footerPhone)                              footerParts.push(footerPhone);
  if (receiptSettings?.website?.trim())         footerParts.push(receiptSettings.website.trim());
  if (receiptSettings?.email?.trim())           footerParts.push(receiptSettings.email.trim());
  if (receiptSettings?.vatNumber?.trim())       footerParts.push(`VAT: ${receiptSettings.vatNumber.trim()}`);

  // Optional bottom messages
  const bottomBlock =
    receiptSettings?.customMessage?.trim()
      ? `<p style="color:#9ca3af;font-size:12px;margin:6px 0 0 0">${receiptSettings.customMessage.trim()}</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${headerName}</title>
</head>
<body style="margin:0;padding:20px 10px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <!-- Header -->
    <div style="background:#ea580c;padding:24px 32px">
      ${logoBlock}
      <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:bold;letter-spacing:-0.3px">${headerName}</h1>
    </div>
    <!-- Body -->
    <div style="padding:32px;color:#374151;font-size:15px;line-height:1.65">
      ${bodyHtml}
    </div>
    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center">
      <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.6">
        ${footerParts.join(" &middot; ")}
      </p>
      ${bottomBlock}
    </div>
  </div>
</body>
</html>`;
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Low-level send: POSTs to the /api/email route. */
export async function sendEmailViaApi(params: {
  to: string;
  subject: string;
  html: string;
  smtp: SmtpConfig;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res  = await fetch("/api/email", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(params),
    });
    return await res.json() as { ok: boolean; error?: string };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * High-level: find the template for an event, apply variables, and send.
 * Silent no-op when SMTP is not configured or template is disabled.
 * Fire-and-forget safe — never throws.
 */
export function sendOrderEmail(
  event: EmailTemplateEvent,
  order: Order,
  customer: Customer | null,
  settings: AdminSettings,
): void {
  const template = settings.emailTemplates?.find((t) => t.event === event && t.enabled);
  if (!template) return;

  const to = customer?.email?.trim();
  if (!to) return;

  if (!settings.smtpHost?.trim()) {
    console.info("[email] SMTP not configured — skipping", event);
    return;
  }

  const vars    = buildVarMap(order, customer, settings);
  const subject = applyVars(template.subject, vars);
  const body    = applyVars(template.body,    vars);

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ].filter(Boolean).join(", ");

  const html = buildEmailDocument(
    body,
    settings.restaurant.name,
    restAddr,
    settings.restaurant.phone,
    settings.receiptSettings,
  );

  sendEmailViaApi({
    to,
    subject,
    html,
    smtp: {
      host:     settings.smtpHost,
      port:     Number(settings.smtpPort) || 587,
      user:     settings.smtpUser,
      password: settings.smtpPassword,
    },
  }).then((result) => {
    if (!result.ok) console.error("[email] Send failed:", result.error);
  }).catch(console.error);
}
