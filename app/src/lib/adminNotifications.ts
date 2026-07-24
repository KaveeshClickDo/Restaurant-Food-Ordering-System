/**
 * Admin notification emails — internal alerts sent TO the restaurant.
 *
 * Every other email in this app goes outbound to a customer. These go the other
 * way: "a new online order came in", "someone booked a table". Configured in
 * Admin → Integrations → Admin Emails.
 *
 * Deliberately NOT template-driven. The customer-facing emails in
 * lib/emailServer.ts resolve an admin-editable EmailTemplate with {{variables}};
 * these build a fixed key/value summary instead. There is nothing to customise
 * and nothing to break.
 *
 * Online activity only. POS sales and waiter/dine-in orders are placed by staff
 * who are already standing in the restaurant — notifying on those would flood
 * the inbox all service. The channel filters live inside the notify* helpers
 * rather than at the call sites so a future call site can't forget them.
 *
 * Delivery is best-effort by contract: every function swallows its own errors
 * and returns void, so a failed alert can never affect an order, a booking, or
 * a webhook acknowledgement. Call sites still add `.catch()` for safety.
 *
 * Server-only: never import from a client component.
 */

import type {
  AdminNotificationEvent, AdminNotificationSettings, AdminSettings,
} from "@/types";
import { buildEmailDocument } from "./emailTemplates";
import { emailConfigured, sendEmail } from "./emailSender";
import { supabaseAdmin } from "./supabaseAdmin";

/** Hard ceiling on recipients — a typo in the panel shouldn't fan out to 500 sends. */
const MAX_RECIPIENTS = 10;

/** The POS walk-in sentinel customer, shared by POS sales and waiter orders. */
const POS_CUSTOMER_ID = "pos-walk-in";

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Escape untrusted values (customer names, notes, item names) before they go
 *  into the HTML table — a stray `<` would otherwise mangle the email. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Normalise the stored config into something safe to act on.
 *
 * Returns null when notifications shouldn't fire at all. Handles the three
 * shapes a real install can present: the key absent entirely (predates this
 * feature — the raw app_settings blob gets no DEFAULT_SETTINGS merge on the
 * server), present but partial, or fully populated.
 */
function resolveConfig(
  settings: AdminSettings | null | undefined,
  event: AdminNotificationEvent,
): AdminNotificationSettings | null {
  const cfg = settings?.adminNotifications;
  if (!cfg || typeof cfg !== "object") return null;
  if (!cfg.enabled) return null;
  if (!cfg.events?.[event]) return null;

  const recipients = Array.from(
    new Set((Array.isArray(cfg.recipients) ? cfg.recipients : [])
      .map((r) => String(r ?? "").trim().toLowerCase())
      .filter(isEmail)),
  ).slice(0, MAX_RECIPIENTS);

  if (recipients.length === 0) return null;
  return { ...cfg, recipients };
}

/** Fetch the settings blob. Callers that already have it should pass it in. */
async function fetchSettings(): Promise<AdminSettings | null> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("data").limit(1).single();
  return (data?.data as AdminSettings | undefined) ?? null;
}

/**
 * Core send. Builds a plain label/value table, wraps it in the same branded
 * document shell the customer emails use (buildEmailDocument gives us the
 * logo, header colour and address footer for free), and delivers one copy per
 * recipient through the shared dispatcher — so Resend/SMTP selection and retry
 * behaviour are inherited unchanged from lib/emailSender.
 */
export async function sendAdminNotification(
  event: AdminNotificationEvent,
  subject: string,
  rows: Array<[label: string, value: string]>,
  settings?: AdminSettings | null,
): Promise<void> {
  try {
    if (!emailConfigured()) return;

    const resolved = settings ?? (await fetchSettings());
    const cfg = resolveConfig(resolved, event);
    if (!cfg || !resolved) return;

    const primary = resolved.colors?.primaryColor?.trim() || "#f97316";
    const restAddr = [
      resolved.restaurant?.addressLine1,
      resolved.restaurant?.city,
      resolved.restaurant?.postcode,
    ].filter(Boolean).join(", ");

    const tableRows = rows
      .filter(([, value]) => String(value ?? "").trim() !== "")
      .map(([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#111827;font-size:13px;font-weight:600">${value}</td>
        </tr>`)
      .join("");

    const siteUrl  = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
    const adminLink = siteUrl
      ? `<p style="margin:20px 0 0"><a href="${siteUrl}/admin" style="display:inline-block;background:${primary};color:#fff;font-weight:700;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:14px">Open admin dashboard</a></p>`
      : "";

    const body = `
      <h2 style="margin:0 0 4px;color:#111827;font-size:18px">${esc(subject)}</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:13px">Automatic staff notification — the customer does not see this email.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #f0f0f0;border-radius:8px">${tableRows}</table>
      ${adminLink}`;

    const html = buildEmailDocument(
      body,
      resolved.restaurant?.name ?? "Restaurant",
      restAddr,
      resolved.restaurant?.phone ?? "",
      resolved.receiptSettings,
      resolved.colors,
    );

    for (const to of cfg.recipients) {
      const result = await sendEmail({ to, subject, html });
      if (!result.ok) {
        console.error(`[admin-notify] ${event} → ${to} failed:`, result.error);
      }
    }
  } catch (err) {
    // Best-effort by contract — never let an alert break the caller.
    console.error(`[admin-notify] ${event} threw:`, err instanceof Error ? err.message : err);
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function money(amount: number | null | undefined, settings: AdminSettings | null): string {
  const sym = settings?.currency?.symbol ?? "£";
  return `${sym}${Number(amount ?? 0).toFixed(2)}`;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function itemLines(items: Array<{ name: string; qty: number; price: number }> | undefined): string {
  if (!items?.length) return "";
  return items.map((i) => `${i.qty} × ${esc(i.name)}`).join("<br>");
}

/** True when the order came from the till or table service rather than the
 *  online shop. Same rule the admin Payments panel uses to classify rows. */
function isStaffOrder(row: { customer_id?: string | null; fulfillment?: string | null }): boolean {
  return row.customer_id === POS_CUSTOMER_ID || row.fulfillment === "dine-in";
}

/** Resolve a display name/email for the ordering customer. Guest checkouts and
 *  deleted customers degrade to a readable placeholder rather than failing. */
async function describeCustomer(customerId: string | null | undefined): Promise<string> {
  if (!customerId || customerId === "guest" || customerId === POS_CUSTOMER_ID) return "Guest";
  const { data } = await supabaseAdmin
    .from("customers").select("name, email, phone").eq("id", customerId).maybeSingle();
  if (!data) return "Guest";
  const parts = [data.name, data.email, data.phone].filter(Boolean).map(esc);
  return parts.length ? parts.join("<br>") : "Guest";
}

// ─── Event wrappers ───────────────────────────────────────────────────────────

export interface OrderNotificationRow {
  id:              string;
  customer_id?:    string | null;
  fulfillment?:    string | null;
  total:           number;
  items?:          Array<{ name: string; qty: number; price: number }>;
  payment_method?: string | null;
  address?:        string | null;
  date?:           string | null;
}

/** A customer placed an online order. Called beside every
 *  sendOrderConfirmationEmail site: /api/orders plus the Stripe and PayPal
 *  webhooks. Staff-placed orders are filtered out here. */
export async function notifyNewOnlineOrder(row: OrderNotificationRow): Promise<void> {
  if (isStaffOrder(row)) return;

  const settings = await fetchSettings();
  if (!resolveConfig(settings, "new_online_order")) return;

  await sendAdminNotification("new_online_order", `New online order — ${row.id}`, [
    ["Order",       esc(row.id)],
    ["Placed",      esc(when(row.date ?? new Date().toISOString()))],
    ["Customer",    await describeCustomer(row.customer_id)],
    ["Fulfillment", esc(row.fulfillment ?? "")],
    ["Address",     esc(row.address ?? "")],
    ["Items",       itemLines(row.items)],
    ["Payment",     esc(row.payment_method ?? "")],
    ["Total",       esc(money(row.total, settings))],
  ], settings);
}

export interface ReservationNotificationRow {
  id:              string;
  customer_name:   string;
  customer_email?: string | null;
  customer_phone?: string | null;
  date:            string;
  time:            string;
  table_label?:    string | null;
  party_size:      number;
  source?:         string | null;
  note?:           string | null;
  vip_fee?:        number | null;
}

/** A guest booked a table on the customer site. Called beside both online
 *  reservation_confirmation sites: /api/reservations (free booking) and
 *  completeReservationFromSession (paid VIP booking). Phone and walk-in
 *  bookings entered by staff are filtered out here. */
export async function notifyNewOnlineReservation(row: ReservationNotificationRow): Promise<void> {
  if ((row.source ?? "online") !== "online") return;

  const settings = await fetchSettings();
  if (!resolveConfig(settings, "new_online_reservation")) return;

  const contact = [row.customer_name, row.customer_email, row.customer_phone]
    .filter(Boolean).map(esc).join("<br>");

  await sendAdminNotification("new_online_reservation", `New table booking — ${row.date} ${row.time}`, [
    ["Date",     esc(`${row.date} at ${row.time}`)],
    ["Table",    esc(row.table_label ?? "")],
    ["Party",    esc(`${row.party_size} guest${row.party_size === 1 ? "" : "s"}`)],
    ["Guest",    contact],
    ["Note",     esc(row.note ?? "")],
    ["Booking fee", row.vip_fee && row.vip_fee > 0 ? esc(money(row.vip_fee, settings)) : ""],
    ["Reference", esc(row.id)],
  ], settings);
}

/** An online order was cancelled or refunded. Called from the admin refund and
 *  status routes and from the KDS status route — a kitchen-side cancellation of
 *  an online order is the case most worth knowing about. Looks the order up
 *  itself so call sites stay one-liners. */
export async function notifyOrderCancelledOrRefunded(
  orderId: string,
  kind: "cancelled" | "refunded",
  opts?: { amount?: number; reason?: string },
): Promise<void> {
  const settings = await fetchSettings();
  if (!resolveConfig(settings, "order_cancelled_refunded")) return;

  const { data: row } = await supabaseAdmin
    .from("orders")
    .select("id, customer_id, fulfillment, total, payment_method, date, refunded_amount")
    .eq("id", orderId)
    .maybeSingle();
  if (!row || isStaffOrder(row)) return;

  const label = kind === "refunded" ? "refunded" : "cancelled";
  await sendAdminNotification("order_cancelled_refunded", `Order ${label} — ${row.id}`, [
    ["Order",     esc(row.id)],
    ["Placed",    esc(when(row.date as string | null))],
    ["Customer",  await describeCustomer(row.customer_id as string | null)],
    ["Order total", esc(money(row.total as number, settings))],
    [kind === "refunded" ? "Refunded" : "Status",
      kind === "refunded"
        ? esc(money(opts?.amount ?? (row.refunded_amount as number), settings))
        : "Cancelled"],
    ["Payment",   esc(row.payment_method as string | null ?? "")],
    ["Reason",    esc(opts?.reason ?? "")],
  ], settings);
}

/** A customer bought a gift card on the site. Only the Stripe webhook purchase
 *  path calls this — admin-minted and POS-sold cards are staff actions. */
export async function notifyGiftCardPurchased(args: {
  code:            string;
  amount:          number;
  recipientEmail:  string;
  recipientName?:  string;
  senderName?:     string;
  buyerEmail?:     string;
}): Promise<void> {
  const settings = await fetchSettings();
  if (!resolveConfig(settings, "gift_card_purchased")) return;

  await sendAdminNotification("gift_card_purchased", `Gift card purchased — ${money(args.amount, settings)}`, [
    ["Code",      esc(args.code)],
    ["Amount",    esc(money(args.amount, settings))],
    ["Recipient", [args.recipientName, args.recipientEmail].filter(Boolean).map(esc).join("<br>")],
    ["Bought by", [args.senderName, args.buyerEmail].filter(Boolean).map(esc).join("<br>")],
  ], settings);
}
