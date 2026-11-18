/**
 * Server-side email helpers.
 *
 * Every send funnels through the dispatcher in `lib/emailSender.ts`, which
 * picks Resend (when RESEND_API_KEY is set) or SMTP. Higher-level helpers
 * here (sendOrderConfirmationEmail, sendReservationEmailServer, etc.) just
 * build the HTML and hand it off — none of them know which provider is
 * actually sending.
 *
 * Server-only: never import from a client component.
 */

import type { AdminSettings, Customer, EmailTemplateEvent, Order, OrderStatus, RefundMethod } from "@/types";
import {
  applyVars,
  buildEmailDocument,
  buildVarMap,
  buildReservationVarMap,
  checkInQrEmailBlock,
  DEFAULT_EMAIL_TEMPLATES,
  escHtml,
} from "./emailTemplates";
import type { ReservationEmailData } from "./emailTemplates";
import { sendEmail, emailConfigured, type EmailAttachment } from "./emailSender";
import { supabaseAdmin } from "./supabaseAdmin";
import { bookingReference, CHECK_IN_QR_CID } from "./reservationCheckIn";
import { checkInQrPng } from "./checkInQrImage";

/**
 * Fetch just the brand primary color from the admin settings row.
 * Used by auth email routes so their button colors match the brand.
 * Falls back to the default orange if the row doesn't exist yet.
 */
export async function fetchBrandPrimaryColor(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();
    return (data?.data?.colors?.primaryColor as string | undefined)?.trim() || "#f97316";
  } catch {
    return "#f97316";
  }
}

/** Send a raw HTML email. Thin wrapper around the dispatcher in
 *  `emailSender.ts` so existing callers ({@link sendOrderConfirmationEmail},
 *  {@link sendReservationEmailServer}, password-reset routes, etc.) don't
 *  need to know whether Resend or SMTP is delivering. */
export async function sendEmailDirect(
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<{ ok: boolean; error?: string }> {
  return sendEmail({ to, subject, html, attachments });
}

/** Reservation emails that carry the guest's check-in QR code. */
const CHECK_IN_QR_EVENTS: readonly EmailTemplateEvent[] = ["reservation_confirmation", "reservation_update"];

/** The check-in QR image for this email, or null when it shouldn't have one
 *  (other events, or a booking that has already started or ended). */
async function checkInQrAttachment(event: EmailTemplateEvent, res: ReservationEmailData): Promise<EmailAttachment | null> {
  if (!CHECK_IN_QR_EVENTS.includes(event)) return null;
  if (res.status !== "pending" && res.status !== "confirmed") return null;
  let code = res.check_in_code;
  if (!code) {
    // Status-change callers don't select the code; read it here. Best-effort:
    // a database without the column just sends the email without a QR.
    const { data } = await supabaseAdmin.from("reservations").select("check_in_code").eq("id", res.id).maybeSingle();
    code = (data as { check_in_code?: string } | null)?.check_in_code ?? undefined;
  }
  if (!code) return null;
  try {
    return {
      filename:    `booking-${bookingReference(res.id)}-check-in.png`,
      content:     await checkInQrPng(code),
      contentType: "image/png",
      cid:         CHECK_IN_QR_CID,
    };
  } catch (err) {
    console.error("[email] check-in QR image failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Build a reservation email from its template, without sending it. The
 * confirmation emails get the check-in QR: as an inline image where the
 * template has {{checkin_qr}}, or added after the message when a saved
 * (older) template doesn't have the tag yet. Returns null when the template
 * is switched off or there is no recipient.
 */
export async function buildReservationEmail(
  event: EmailTemplateEvent,
  res: ReservationEmailData,
  settings: AdminSettings,
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "",
): Promise<{ to: string; subject: string; html: string; attachments: EmailAttachment[] } | null> {
  const template = settings.emailTemplates?.find((t) => t.event === event && t.enabled);
  if (!template) return null;

  const to = res.customer_email?.trim();
  if (!to) return null;

  const vars = buildReservationVarMap(res, settings, siteUrl);
  let bodyTemplate = template.body;
  const attachments: EmailAttachment[] = [];
  const qr = await checkInQrAttachment(event, res);
  if (qr) {
    attachments.push(qr);
    vars.checkin_qr = checkInQrEmailBlock(bookingReference(res.id));
    if (!bodyTemplate.includes("{{checkin_qr}}")) bodyTemplate += "\n{{checkin_qr}}";
  }

  const subject = applyVars(template.subject, vars);
  const body    = applyVars(bodyTemplate,     vars);

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

  return { to, subject, html, attachments };
}

/**
 * High-level server-side reservation email sender: builds the email
 * ({@link buildReservationEmail}) and sends it.
 * Silent no-op when the template is disabled or email sending isn't set up.
 * Never throws — logs errors to console only.
 */
export async function sendReservationEmailServer(
  event: EmailTemplateEvent,
  res: ReservationEmailData,
  settings: AdminSettings,
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "",
): Promise<void> {
  if (!emailConfigured()) return;
  try {
    const email = await buildReservationEmail(event, res, settings, siteUrl);
    if (!email) return;
    const result = await sendEmailDirect(email.to, email.subject, email.html, email.attachments);
    if (!result.ok) console.error(`[email] ${event} failed for ${email.to}:`, result.error);
  } catch (err) {
    console.error(`[email] ${event} failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Server-side order confirmation email.
 * Fetches the customer and admin settings from Supabase, finds the enabled
 * order_confirmation template, builds the HTML, and sends it.
 * Silent no-op when SMTP is not configured, the template is disabled, or
 * the customer cannot be found. Never throws.
 */
export async function sendOrderConfirmationEmail(row: {
  id: string;
  customer_id: string;
  fulfillment: string;
  total: number;
  items: Array<{ name: string; qty: number; price: number }>;
  payment_method?: string;
  address?: string;
  delivery_fee?: number;
  service_fee?: number;
  vat_amount?: number;
  vat_inclusive?: boolean;
  coupon_code?: string;
  coupon_discount?: number;
  store_credit_used?: number;
  gift_card_used?: number;
  delivery_code?: string;
  date?: string;
}): Promise<void> {
  const customerId = row.customer_id;
  if (!customerId || customerId === "guest") return;

  const [{ data: settingsRow }, { data: cust }] = await Promise.all([
    supabaseAdmin.from("app_settings").select("data").limit(1).single(),
    supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, created_at, tags")
      .eq("id", customerId)
      .single(),
  ]);

  const settings = settingsRow?.data as AdminSettings | undefined;
  if (!settings || !cust?.email) return;

  const templates = settings.emailTemplates?.length ? settings.emailTemplates : DEFAULT_EMAIL_TEMPLATES;
  const template  = templates.find((t) => t.event === "order_confirmation" && t.enabled);
  if (!template) return;

  const order: Order = {
    id:            row.id,
    customerId:    row.customer_id,
    date:          row.date ?? new Date().toISOString(),
    status:        "pending",
    fulfillment:   row.fulfillment as Order["fulfillment"],
    total:         row.total,
    items:         row.items,
    paymentMethod: row.payment_method,
    address:       row.address,
    deliveryFee:   row.delivery_fee,
    serviceFee:    row.service_fee,
    vatAmount:     row.vat_amount,
    vatInclusive:  row.vat_inclusive,
    couponCode:    row.coupon_code,
    couponDiscount: row.coupon_discount,
    storeCreditUsed: row.store_credit_used,
    giftCardUsed:  row.gift_card_used,
    deliveryCode:  row.delivery_code,
  };

  const customer: Customer = {
    id:          cust.id,
    name:        cust.name,
    email:       cust.email,
    phone:       cust.phone ?? "",
    createdAt:   cust.created_at,
    tags:        cust.tags ?? [],
    orders:      [],
  };

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ].filter(Boolean).join(", ");

  const vars    = buildVarMap(order, customer, settings);
  const subject = applyVars(template.subject, vars);
  const body    = applyVars(template.body,    vars);
  const html    = buildEmailDocument(body, settings.restaurant.name, restAddr, settings.restaurant.phone, settings.receiptSettings, settings.colors);

  const result = await sendEmailDirect(cust.email, subject, html);
  if (!result.ok && !result.error?.toLowerCase().includes("smtp not configured")) {
    console.error("[orders] confirmation email failed:", result.error);
  }
}

/**
 * Send the "gift card delivered" email to a recipient. Called by the Stripe
 * webhook after a successful gift card purchase and by the admin "resend"
 * action. The buyer (if logged in) gets a Stripe receipt separately.
 *
 * Silent no-op when SMTP is unconfigured. Logs but doesn't throw — the
 * caller has already inserted the gift_card row, so a failed email
 * shouldn't roll back the purchase. Admin can resend from the panel.
 */
export async function sendGiftCardDeliveredEmail(args: {
  code:             string;
  amount:           number;          // £
  recipientEmail:   string;
  recipientName:    string;
  senderName?:      string;          // falls back to "Someone" if anonymous purchase
  personalMessage?: string;
  expiresAt?:       string | null;   // ISO
}): Promise<{ ok: boolean; error?: string }> {
  const { data: settingsRow } = await supabaseAdmin
    .from("app_settings").select("data").limit(1).single();
  const settings = settingsRow?.data as AdminSettings | undefined;
  if (!settings) return { ok: false, error: "Settings row missing." };

  const templates = settings.emailTemplates?.length ? settings.emailTemplates : DEFAULT_EMAIL_TEMPLATES;
  const template  = templates.find((t) => t.event === "gift_card_delivered" && t.enabled);
  if (!template) return { ok: false, error: "gift_card_delivered template not enabled." };

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ].filter(Boolean).join(", ");

  const sym = settings.currency?.symbol ?? "£";
  const primaryColor    = settings.colors?.primaryColor    ?? "#f97316";
  const primaryColorLt  = settings.colors?.backgroundColor ?? "#fff7ed";

  const expiresOn = args.expiresAt
    ? new Date(args.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "No expiry";

  // If the buyer left a personal message, wrap it in a styled blockquote so
  // it visually separates from the boilerplate. Empty string when absent so
  // the {{personal_message}} placeholder collapses cleanly.
  const personalBlock = args.personalMessage?.trim()
    ? `<div style="background:${primaryColorLt};border-left:4px solid ${primaryColor};padding:14px 16px;margin:18px 0;border-radius:6px;font-style:italic;color:#374151">"${args.personalMessage.trim()}"</div>`
    : "";

  const vars: Record<string, string> = {
    gift_code:           args.code,
    gift_amount:         `${sym}${args.amount.toFixed(2)}`,
    gift_recipient_name: args.recipientName,
    gift_sender_name:    args.senderName?.trim() || "Someone",
    personal_message:    personalBlock,
    gift_expires_at:     expiresOn,
    restaurant_name:     settings.restaurant.name,
    restaurant_phone:    settings.restaurant.phone ?? "",
    restaurant_address:  restAddr,
    brand_color:         primaryColor,
    brand_color_light:   primaryColorLt,
  };

  const subject = applyVars(template.subject, vars);
  const body    = applyVars(template.body, vars);
  const html    = buildEmailDocument(body, settings.restaurant.name, restAddr, settings.restaurant.phone, settings.receiptSettings, settings.colors);

  const result = await sendEmailDirect(args.recipientEmail, subject, html);
  if (!result.ok && !result.error?.toLowerCase().includes("smtp not configured")) {
    console.error("[gift-cards] delivery email failed:", result.error);
  }
  return result;
}

const STATUS_TO_EVENT: Partial<Record<OrderStatus, EmailTemplateEvent>> = {
  confirmed: "order_confirmed",
  preparing: "order_preparing",
  ready:     "order_ready",
  delivered: "order_delivered",
  cancelled: "order_cancelled",
};

/**
 * Server-side order status-change email.
 * Fetches the order, customer, and settings from Supabase, finds the matching
 * enabled template, and sends. Silent no-op for statuses with no template
 * (e.g. "pending", "refunded") or when SMTP is not configured.
 */
export async function sendOrderStatusEmail(
  orderId: string,
  newStatus: OrderStatus,
): Promise<void> {
  const event = STATUS_TO_EVENT[newStatus];
  if (!event) return;

  const [{ data: orderRow }, { data: settingsRow }] = await Promise.all([
    supabaseAdmin.from("orders").select("*").eq("id", orderId).single(),
    supabaseAdmin.from("app_settings").select("data").limit(1).single(),
  ]);

  if (!orderRow) return;
  const settings = settingsRow?.data as AdminSettings | undefined;
  if (!settings) return;

  const templates = settings.emailTemplates?.length ? settings.emailTemplates : DEFAULT_EMAIL_TEMPLATES;
  const template  = templates.find((t) => t.event === event && t.enabled);
  if (!template) return;

  const customerId = orderRow.customer_id as string | undefined;
  // No real recipient for guest checkouts or the POS walk-in sentinel (its
  // email is the internal "pos-walkin@internal" placeholder, not a real inbox).
  if (!customerId || customerId === "guest" || customerId === "pos-walk-in") return;

  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, created_at, tags")
    .eq("id", customerId)
    .single();
  if (!cust?.email) return;
  // Skip internal placeholder inboxes (e.g. the POS walk-in sentinel).
  if (cust.email.endsWith("@internal")) return;

  const order: Order = {
    id:             orderRow.id as string,
    customerId:     customerId,
    date:           (orderRow.date as string) ?? new Date().toISOString(),
    status:         newStatus,
    fulfillment:    orderRow.fulfillment as Order["fulfillment"],
    total:          orderRow.total as number,
    items:          (orderRow.items as Order["items"]) ?? [],
    paymentMethod:  orderRow.payment_method as string | undefined,
    address:        orderRow.address as string | undefined,
    deliveryFee:    orderRow.delivery_fee as number | undefined,
    serviceFee:     orderRow.service_fee as number | undefined,
    vatAmount:      orderRow.vat_amount as number | undefined,
    vatInclusive:   orderRow.vat_inclusive as boolean | undefined,
    couponCode:     orderRow.coupon_code as string | undefined,
    couponDiscount: orderRow.coupon_discount as number | undefined,
    deliveryCode:   orderRow.delivery_code as string | undefined,
  };

  const customer: Customer = {
    id:        cust.id,
    name:      cust.name,
    email:     cust.email,
    phone:     cust.phone ?? "",
    createdAt: cust.created_at,
    tags:      cust.tags ?? [],
    orders:    [],
  };

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ].filter(Boolean).join(", ");

  const vars    = buildVarMap(order, customer, settings);
  const subject = applyVars(template.subject, vars);
  const body    = applyVars(template.body,    vars);
  const html    = buildEmailDocument(body, settings.restaurant.name, restAddr, settings.restaurant.phone, settings.receiptSettings, settings.colors);

  const result = await sendEmailDirect(cust.email, subject, html);
  if (!result.ok && !result.error?.toLowerCase().includes("smtp not configured")) {
    console.error(`[orders] status email (${newStatus}) failed:`, result.error);
  }
}

/**
 * Server-side refund-confirmation email. Fires on every refund issued from
 * the admin Refunds panel — partial or full — independent of the "order
 * cancelled" email a full refund on an undelivered order also triggers
 * (they communicate different things: money back vs. order won't be
 * fulfilled). Silent no-op for guests / POS walk-in / when no "order_refunded"
 * template is enabled, mirroring {@link sendOrderStatusEmail}'s guards.
 * Never throws — logs errors to console only.
 */
export async function sendRefundEmail(
  orderId: string,
  refund: { amount: number; reason?: string; type: "full" | "partial"; method: RefundMethod },
): Promise<void> {
  const [{ data: orderRow }, { data: settingsRow }] = await Promise.all([
    supabaseAdmin.from("orders").select("*").eq("id", orderId).single(),
    supabaseAdmin.from("app_settings").select("data").limit(1).single(),
  ]);

  if (!orderRow) return;
  const settings = settingsRow?.data as AdminSettings | undefined;
  if (!settings) return;

  const templates = settings.emailTemplates?.length ? settings.emailTemplates : DEFAULT_EMAIL_TEMPLATES;
  const template  = templates.find((t) => t.event === "order_refunded" && t.enabled);
  if (!template) return;

  const customerId = orderRow.customer_id as string | undefined;
  // Same guard as sendOrderStatusEmail — no real recipient for guest checkouts
  // or the POS walk-in sentinel.
  if (!customerId || customerId === "guest" || customerId === "pos-walk-in") return;

  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, created_at, tags")
    .eq("id", customerId)
    .single();
  if (!cust?.email) return;
  if (cust.email.endsWith("@internal")) return;

  const order: Order = {
    id:             orderRow.id as string,
    customerId:     customerId,
    date:           (orderRow.date as string) ?? new Date().toISOString(),
    status:         orderRow.status as OrderStatus,
    fulfillment:    orderRow.fulfillment as Order["fulfillment"],
    total:          orderRow.total as number,
    items:          (orderRow.items as Order["items"]) ?? [],
    paymentMethod:  orderRow.payment_method as string | undefined,
    address:        orderRow.address as string | undefined,
    deliveryFee:    orderRow.delivery_fee as number | undefined,
    serviceFee:     orderRow.service_fee as number | undefined,
    vatAmount:      orderRow.vat_amount as number | undefined,
    vatInclusive:   orderRow.vat_inclusive as boolean | undefined,
    couponCode:     orderRow.coupon_code as string | undefined,
    couponDiscount: orderRow.coupon_discount as number | undefined,
    deliveryCode:   orderRow.delivery_code as string | undefined,
  };

  const customer: Customer = {
    id:        cust.id,
    name:      cust.name,
    email:     cust.email,
    phone:     cust.phone ?? "",
    createdAt: cust.created_at,
    tags:      cust.tags ?? [],
    orders:    [],
  };

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ].filter(Boolean).join(", ");

  const sym = settings.currency?.symbol || "£";
  const reason = refund.reason?.trim();
  const methodLabel =
    refund.method === "cash"         ? "Cash" :
    refund.method === "store_credit" ? "Store credit" :
    order.paymentMethod || "Your original payment method";
  const vars = {
    ...buildVarMap(order, customer, settings),
    refund_amount: `${sym}${refund.amount.toFixed(2)}`,
    refund_type:   refund.type === "full" ? "Full refund" : "Partial refund",
    refund_method: escHtml(methodLabel),
    refund_reason: reason ? `<p><strong>Reason:</strong> ${escHtml(reason)}</p>` : "",
  };
  const subject = applyVars(template.subject, vars);
  const body    = applyVars(template.body,    vars);
  const html    = buildEmailDocument(body, settings.restaurant.name, restAddr, settings.restaurant.phone, settings.receiptSettings, settings.colors);

  const result = await sendEmailDirect(cust.email, subject, html);
  if (!result.ok && !result.error?.toLowerCase().includes("smtp not configured")) {
    console.error("[orders] refund email failed:", result.error);
  }
}
