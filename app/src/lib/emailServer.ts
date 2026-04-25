/**
 * Server-side email utility — Node.js only (uses nodemailer directly).
 * Import this only from API routes, never from client components.
 *
 * Sending from API routes avoids the circular fetch that would occur if they
 * called /api/email via sendEmailViaApi().
 */

import nodemailer from "nodemailer";
import type { AdminSettings, EmailTemplateEvent } from "@/types";
import {
  applyVars,
  buildEmailDocument,
  buildReservationVarMap,
} from "./emailTemplates";
import type { ReservationEmailData } from "./emailTemplates";

/** Send a raw HTML email via SMTP. Reads credentials from env vars only. */
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

  try {
    const transporter = nodemailer.createTransport({
      host:   smtpHost,
      port:   smtpPort,
      secure: smtpPort === 465,
      auth:   smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
      connectionTimeout: 8_000,
      greetingTimeout:   5_000,
      socketTimeout:     10_000,
    });

    await transporter.sendMail({
      from:    smtpUser ? `"${smtpUser}" <${smtpUser}>` : smtpUser,
      to,
      subject,
      html,
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown SMTP error" };
  }
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
): Promise<void> {
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
  );

  const result = await sendEmailDirect(to, subject, html);
  if (!result.ok) {
    if (result.error?.toLowerCase().includes("smtp not configured")) return;
    console.error(`[email] ${event} failed for ${to}:`, result.error);
  }
}
