/**
 * Server-side email utility — Node.js only (uses nodemailer directly).
 * Import this only from API routes, never from client components.
 *
 * Sending from API routes avoids the circular fetch that would occur if they
 * called /api/email via sendEmailViaApi().
 */

import nodemailer from "nodemailer";
import type { AdminSettings, Customer, EmailTemplateEvent, Order, OrderStatus } from "@/types";
import {
  applyVars,
  buildEmailDocument,
  buildVarMap,
  buildReservationVarMap,
  DEFAULT_EMAIL_TEMPLATES,
} from "./emailTemplates";
import type { ReservationEmailData } from "./emailTemplates";
import { supabaseAdmin } from "./supabaseAdmin";

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

function resolveFromAddress(): string {
  const explicit  = process.env.SMTP_FROM?.trim() ?? "";
  if (explicit) return explicit;
  const smtpUser  = process.env.SMTP_USER?.trim() ?? "";
  const smtpHost  = process.env.SMTP_HOST?.trim() ?? "";
  const isEmail   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtpUser);
  if (isEmail) return smtpUser;
  if (smtpHost.includes("resend.com")) return "onboarding@resend.dev";
  return smtpUser;
}

const TRANSIENT_ERROR_PATTERNS = [
  "econnreset", "etimedout", "econnrefused", "ehostunreach",
  "socket hang up", "connect etimedout", "connection timeout",
];

function isTransientSmtpError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/** Send a raw HTML email via SMTP. Reads credentials from env vars only. Retries once on transient errors. */
export async function sendEmailDirect(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const smtpHost = process.env.SMTP_HOST?.trim() ?? "";
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const smtpUser = process.env.SMTP_USER?.trim() ?? "";
  const smtpPass = process.env.SMTP_PASS?.trim() ?? "";

  if (!smtpHost) return { ok: false, error: "SMTP not configured" };

  const fromAddr = resolveFromAddress();
  const fromName = process.env.SMTP_FROM_NAME?.trim() ?? "";
  const from     = fromName ? `"${fromName}" <${fromAddr}>` : fromAddr;

  const transporter = nodemailer.createTransport({
    host:   smtpHost,
    port:   smtpPort,
    secure: smtpPort === 465,
    auth:   smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
    connectionTimeout: 8_000,
    greetingTimeout:   5_000,
    socketTimeout:     10_000,
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
    try {
      await transporter.sendMail({ from, to, subject, html });
      console.log(`[email] sent "${subject}" → ${to}`);
      return { ok: true };
    } catch (err) {
      lastErr = err;
      if (!isTransientSmtpError(err)) break;
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : "Unknown SMTP error";
  console.error(`[email] failed "${subject}" → ${to}:`, message);
  return { ok: false, error: message };
}

/**
 * High-level server-side reservation email sender.
 * Finds the template, applies variables, builds the HTML document, and sends.
 * Silent no-op when the template is disabled or SMTP is not configured.
 * Never throws — logs errors to console only.
 */
export async function sendReservationEmailServer(
  event: EmailTemplateEvent,
  res: ReservationEmailData,
  settings: AdminSettings,
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "",
): Promise<void> {
  const template = settings.emailTemplates?.find((t) => t.event === event && t.enabled);
  if (!template) return;

  const to = res.customer_email?.trim();
  if (!to) return;

  const vars    = buildReservationVarMap(res, settings, siteUrl);
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

  const result = await sendEmailDirect(to, subject, html);
  if (!result.ok) {
    if (result.error?.toLowerCase().includes("smtp not configured")) return;
    console.error(`[email] ${event} failed for ${to}:`, result.error);
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
  if (!customerId || customerId === "guest") return;

  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, created_at, tags")
    .eq("id", customerId)
    .single();
  if (!cust?.email) return;

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
