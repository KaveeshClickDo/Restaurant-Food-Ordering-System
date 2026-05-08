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
  group: "Customer" | "Order" | "Restaurant" | "Reservation" | "Branding";
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
  { name: "restaurant_name",     label: "Restaurant name",     group: "Restaurant",  preview: "Your Restaurant" },
  { name: "restaurant_phone",    label: "Restaurant phone",    group: "Restaurant",  preview: "020 7123 4567" },
  { name: "restaurant_address",  label: "Restaurant address",  group: "Restaurant",  preview: "42 Curry Lane, London" },
  // Tax
  { name: "order_vat",           label: "VAT amount",          group: "Order",       preview: "£3.33 (incl. 20% VAT)" },
  // Reservation
  { name: "booking_ref",         label: "Booking reference",   group: "Reservation", preview: "A1B2C3D4" },
  { name: "reservation_date",    label: "Reservation date",    group: "Reservation", preview: "25 Apr 2026" },
  { name: "reservation_time",    label: "Reservation time",    group: "Reservation", preview: "7:30 PM" },
  { name: "table_label",         label: "Table label",         group: "Reservation", preview: "Table 3" },
  { name: "party_size",          label: "Party size",          group: "Reservation", preview: "4" },
  { name: "reservation_status",  label: "Reservation status",  group: "Reservation", preview: "confirmed" },
  { name: "reservation_note",    label: "Special note",        group: "Reservation", preview: "Window seat preferred" },
  { name: "cancel_link",         label: "Cancel booking link", group: "Reservation", preview: "https://yourdomain.com/reservation/token" },
  { name: "review_url",          label: "Review link (Google/TripAdvisor)", group: "Reservation", preview: "https://g.page/r/yourplaceid/review" },
  // Branding
  { name: "brand_color",        label: "Brand primary color (hex)", group: "Branding", preview: "#f97316" },
  { name: "brand_color_light",  label: "Brand light tint (hex)",   group: "Branding", preview: "#fff7ed" },
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
  { event: "order_cancelled",         name: "Order Cancelled",         description: "Sent when an order is cancelled",                color: "bg-red-100",     textColor: "text-red-700",     emoji: "❌" },
  { event: "reservation_confirmation",   name: "Reservation Confirmed",    description: "Sent when a customer books a table",             color: "bg-teal-100",    textColor: "text-teal-700",    emoji: "📅" },
  { event: "reservation_update",         name: "Reservation Update",       description: "Sent when admin confirms or changes the status", color: "bg-blue-100",    textColor: "text-blue-700",    emoji: "🔄" },
  { event: "reservation_cancellation",   name: "Reservation Cancelled",    description: "Sent when a reservation is cancelled",           color: "bg-rose-100",    textColor: "text-rose-700",    emoji: "🚫" },
  { event: "reservation_review_request", name: "Post-Visit Review Request",description: "Sent automatically when a guest checks out",     color: "bg-yellow-100",  textColor: "text-yellow-700",  emoji: "⭐" },
];

// ─── Default templates ────────────────────────────────────────────────────────
// Heading colors use {{brand_color}} so they automatically follow admin brand settings.
// Semantic status colors (red=cancelled, green=delivered) are intentionally kept fixed.

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    event: "order_confirmation",
    name: "Order Confirmation",
    subject: "Your order is confirmed — {{order_id}}",
    body: `<h2 style="color:{{brand_color}};margin:0 0 16px 0">Thank you for your order! 🎉</h2>
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
    body: `<h2 style="color:{{brand_color}};margin:0 0 16px 0">Order Confirmed ✅</h2>
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
    enabled: true,
    lastModified: new Date(0).toISOString(),
  },
  // ── Reservation templates ──────────────────────────────────────────────────
  {
    event: "reservation_confirmation",
    name: "Reservation Confirmed",
    subject: "Your table reservation is confirmed — {{booking_ref}}",
    body: `<h2 style="color:{{brand_color}};margin:0 0 16px 0">Reservation Confirmed! 📅</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>We're delighted to confirm your table reservation at <strong>{{restaurant_name}}</strong>.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p>
  <strong>Booking Reference:</strong> {{booking_ref}}<br>
  <strong>Date:</strong> {{reservation_date}}<br>
  <strong>Time:</strong> {{reservation_time}}<br>
  <strong>Table:</strong> {{table_label}}<br>
  <strong>Party size:</strong> {{party_size}} guests
</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p style="color:#6b7280;font-size:14px">Please arrive on time. If your plans change, contact us at <strong>{{restaurant_phone}}</strong>.</p>
<p style="color:#6b7280;font-size:13px">Need to cancel? <a href="{{cancel_link}}" style="color:{{brand_color}}">Click here to cancel your booking</a>.</p>
<p>We look forward to welcoming you!</p>`,
    enabled: true,
    lastModified: new Date(0).toISOString(),
  },
  {
    event: "reservation_update",
    name: "Reservation Update",
    subject: "Your reservation update — {{booking_ref}}",
    body: `<h2 style="color:{{brand_color}};margin:0 0 16px 0">Reservation Update 🔄</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>Your reservation at <strong>{{restaurant_name}}</strong> has been updated.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p>
  <strong>Booking Reference:</strong> {{booking_ref}}<br>
  <strong>Date:</strong> {{reservation_date}}<br>
  <strong>Time:</strong> {{reservation_time}}<br>
  <strong>Table:</strong> {{table_label}}<br>
  <strong>Status:</strong> {{reservation_status}}
</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p style="color:#6b7280;font-size:14px">Questions? Contact us at <strong>{{restaurant_phone}}</strong>.</p>
<p>— The team at <strong>{{restaurant_name}}</strong></p>`,
    enabled: true,
    lastModified: new Date(0).toISOString(),
  },
  {
    event: "reservation_cancellation",
    name: "Reservation Cancelled",
    subject: "Your reservation has been cancelled — {{booking_ref}}",
    body: `<h2 style="color:#dc2626;margin:0 0 16px 0">Reservation Cancelled</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>We're sorry to inform you that your reservation at <strong>{{restaurant_name}}</strong> has been cancelled.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p>
  <strong>Booking Reference:</strong> {{booking_ref}}<br>
  <strong>Date:</strong> {{reservation_date}}<br>
  <strong>Time:</strong> {{reservation_time}}
</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p>If you have questions or would like to make a new booking, please contact us at <strong>{{restaurant_phone}}</strong>.</p>
<p>We hope to see you again soon.</p>`,
    enabled: false,
    lastModified: new Date(0).toISOString(),
  },
  {
    event: "reservation_review_request",
    name: "Post-Visit Review Request",
    subject: "Thank you for dining with us — leave us a review!",
    body: `<h2 style="color:{{brand_color}};margin:0 0 16px 0">Thank You for Visiting! ⭐</h2>
<p>Hi <strong>{{customer_name}}</strong>,</p>
<p>We hope you had a wonderful time at <strong>{{restaurant_name}}</strong> on <strong>{{reservation_date}}</strong>. It was a pleasure to have you.</p>
<p>If you enjoyed your visit, we'd love it if you could take a moment to share your experience — it means the world to our team.</p>
<div style="text-align:center;margin:28px 0">
  <a href="{{review_url}}" style="display:inline-block;background:{{brand_color}};color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none">Leave a Review ⭐</a>
</div>
<p style="color:#6b7280;font-size:14px">Your feedback helps us improve and lets other guests know what to expect. Thank you for your support!</p>
<p>We look forward to welcoming you back soon.</p>`,
    enabled: false,
    lastModified: new Date(0).toISOString(),
  },
];

// ─── Variable replacement ─────────────────────────────────────────────────────

/**
 * Escape a user-supplied string for safe inclusion in HTML email bodies.
 * Applied to any value that comes from user input (customer name, address, etc.)
 * so that HTML injection / phishing links cannot be crafted by malicious users.
 * System-generated values (order IDs, monetary amounts, dates) and pre-built
 * HTML fragments (order_items table, brand colours) do not need escaping.
 */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Derive a light tint from a hex brand color for use in email backgrounds. */
function brandColorLight(hex: string): string {
  // Parse R/G/B and blend 15% toward white (#fff7ed is the orange-50 equivalent)
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const blend = (c: number) => Math.round(c + (255 - c) * 0.88).toString(16).padStart(2, "0");
    return `#${blend(r)}${blend(g)}${blend(b)}`;
  } catch {
    return "#fff7ed";
  }
}

/** Build the variable map from real order/customer/settings data. */
export function buildVarMap(
  order: Order,
  customer: Customer | null,
  settings: AdminSettings,
): Record<string, string> {
  const primaryColor = settings.colors?.primaryColor ?? "#f97316";

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
    const vatColor  = order.vatInclusive ? "#9ca3af" : primaryColor;
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
    // User-supplied — must be HTML-escaped to prevent injection / phishing links.
    customer_name:      escHtml(customer?.name    ?? "Valued Customer"),
    customer_email:     escHtml(customer?.email   ?? ""),
    delivery_address:   escHtml(order.address     ?? ""),
    payment_method:     escHtml(order.paymentMethod ?? ""),
    // System-generated or admin-supplied — safe as-is.
    order_id:           order.id.toUpperCase(),
    order_date:         new Date(order.date).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }),
    order_items:        orderItemsTable,   // server-built HTML — do not escape
    order_total:        `£${order.total.toFixed(2)}`,
    order_status:       order.status,
    fulfillment_type:   order.fulfillment === "delivery" ? "Delivery" : "Collection",
    restaurant_name:    settings.restaurant.name,
    restaurant_phone:   settings.restaurant.phone,
    restaurant_address: restAddr,
    estimated_time:     estTime,
    order_vat:          buildVatString(order.vatAmount, order.vatInclusive, settings),
    brand_color:        primaryColor,       // hex — used in style attributes, not escaped
    brand_color_light:  brandColorLight(primaryColor),
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
  const primaryColor = settings.colors?.primaryColor ?? "#f97316";

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
    const vatColor  = previewInclusive ? "#9ca3af" : primaryColor;
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
    brand_color:       primaryColor,
    brand_color_light: brandColorLight(primaryColor),
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
  colors?: { primaryColor?: string; backgroundColor?: string },
): string {
  const headerBg = colors?.primaryColor?.trim() || "#f97316";

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
    <div style="background:${headerBg};padding:24px 32px">
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

/**
 * Low-level send: POSTs to the /api/email route.
 * SMTP credentials are read from server-side env vars in the API route —
 * they must NOT be passed from the browser.
 */
export async function sendEmailViaApi(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/email", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(params),
    });
    return await res.json() as { ok: boolean; error?: string };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Reservation email helpers ────────────────────────────────────────────────

export interface ReservationEmailData {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  date: string;        // "YYYY-MM-DD"
  time: string;        // "HH:MM"
  table_label: string;
  party_size: number;
  status: string;
  note?: string | null;
  section?: string;
  cancel_token?: string;  // used to build the self-service cancel link
}

/** Build variable map from a real reservation row + settings. */
export function buildReservationVarMap(
  res: ReservationEmailData,
  settings: AdminSettings,
  siteUrl = "",
): Record<string, string> {
  const primaryColor = settings.colors?.primaryColor ?? "#f97316";

  const [y, mo, d] = res.date.split("-").map(Number);
  const dateObj = new Date(y, mo - 1, d);
  const formattedDate = dateObj.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const [h, min] = res.time.split(":").map(Number);
  const timeObj = new Date(2000, 0, 1, h, min);
  const formattedTime = timeObj
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ].filter(Boolean).join(", ");

  const cancelLink = res.cancel_token
    ? `${siteUrl}/reservation/${res.cancel_token}`
    : "";

  return {
    customer_name:      escHtml(res.customer_name),
    customer_email:     escHtml(res.customer_email),
    booking_ref:        res.id.slice(0, 8).toUpperCase(),
    reservation_date:   formattedDate,
    reservation_time:   formattedTime,
    table_label:        escHtml(res.table_label),
    party_size:         String(res.party_size),
    reservation_status: res.status,
    reservation_note:   escHtml(res.note ?? ""),
    restaurant_name:    settings.restaurant.name,
    restaurant_phone:   settings.restaurant.phone,
    restaurant_address: restAddr,
    cancel_link:        cancelLink,
    review_url:         (settings.reservationSystem as { reviewUrl?: string })?.reviewUrl ?? "",
    brand_color:        primaryColor,
    brand_color_light:  brandColorLight(primaryColor),
  };
}

/** Build dummy variable map for the admin preview pane. */
export function buildReservationPreviewVarMap(settings: AdminSettings): Record<string, string> {
  const primaryColor = settings.colors?.primaryColor ?? "#f97316";

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ].filter(Boolean).join(", ");

  return {
    customer_name:      "Jane Smith",
    customer_email:     "jane@example.com",
    booking_ref:        "A1B2C3D4",
    reservation_date:   "25 Apr 2026",
    reservation_time:   "7:30 PM",
    table_label:        "Table 3",
    party_size:         "4",
    reservation_status: "confirmed",
    reservation_note:   "Window seat preferred",
    restaurant_name:    settings.restaurant.name,
    restaurant_phone:   settings.restaurant.phone,
    restaurant_address: restAddr,
    cancel_link:        "https://yourdomain.com/reservation/example-token",
    review_url:         (settings.reservationSystem as { reviewUrl?: string })?.reviewUrl ?? "https://g.page/r/review",
    brand_color:        primaryColor,
    brand_color_light:  brandColorLight(primaryColor),
  };
}

/**
 * Browser-side: find the reservation template for an event, apply variables,
 * and send via the /api/email route.
 * Silent no-op when the template is disabled or email is empty.
 * Fire-and-forget safe — never throws.
 */
export function sendReservationEmail(
  event: EmailTemplateEvent,
  res: ReservationEmailData,
  settings: AdminSettings,
): void {
  const template = settings.emailTemplates?.find((t) => t.event === event && t.enabled);
  if (!template) return;

  const to = res.customer_email?.trim();
  if (!to) return;

  const vars    = buildReservationVarMap(res, settings);
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
    settings.colors,
  );

  sendEmailViaApi({ to, subject, html })
    .then((result) => {
      if (!result.ok) {
        if (result.error?.toLowerCase().includes("smtp") && result.error?.toLowerCase().includes("not configured")) return;
        console.error("[email] Reservation send failed:", result.error);
      }
    })
    .catch(console.error);
}

/**
 * High-level: find the template for an event, apply variables, and send.
 * Silent no-op when the template is disabled.
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
    settings.colors,
  );

  sendEmailViaApi({ to, subject, html })
    .then((result) => {
      if (!result.ok) {
        // SMTP not configured is expected during development — not an error
        if (result.error?.toLowerCase().includes("smtp") && result.error?.toLowerCase().includes("not configured")) return;
        console.error("[email] Send failed:", result.error);
      }
    })
    .catch(console.error);
}
