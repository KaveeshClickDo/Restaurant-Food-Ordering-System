/**
 * Email dispatcher — single point through which every transactional and
 * staff-triggered email leaves the server.
 *
 *   • If RESEND_API_KEY is set, sends via the Resend HTTP API (recommended).
 *   • Otherwise falls back to SMTP via nodemailer (works with Gmail, SendGrid,
 *     Mailgun, Postmark, or Resend's SMTP endpoint).
 *   • If neither is configured, returns `{ ok: false, error: ... }` so callers
 *     can degrade gracefully (verification links land in server logs instead).
 *
 * Configured via env vars only — credentials never come from the request body.
 *
 *   Required for Resend mode:
 *     RESEND_API_KEY        Generated in the Resend dashboard.
 *
 *   Required for SMTP mode:
 *     SMTP_HOST             e.g. smtp.gmail.com
 *     SMTP_PORT             465 (TLS) or 587 (STARTTLS). Defaults to 587.
 *     SMTP_USER             Username (for Resend SMTP this is literally "resend").
 *     SMTP_PASS             Password / API key.
 *
 *   Optional, both modes:
 *     EMAIL_FROM            Sender address. Must be a verified domain in
 *                           Resend; otherwise it falls back to onboarding@resend.dev
 *                           for the shared testing domain.
 *     EMAIL_FROM_NAME       Display name (e.g. "Spice Garden").
 *
 *   Legacy aliases (still honoured): SMTP_FROM, SMTP_FROM_NAME.
 *
 * Server-only — never import from a client component.
 */

import type { Resend as ResendClient } from "resend";

export interface SendEmailArgs {
  to:       string;
  subject:  string;
  html:     string;
  fromName?: string;
  /** Extra SMTP headers. Used by marketing campaigns for the RFC 8058
   *  one-click unsubscribe pair (List-Unsubscribe / List-Unsubscribe-Post). */
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  ok:     boolean;
  error?: string;
}

const TRANSIENT_PATTERNS = [
  "econnreset", "etimedout", "econnrefused", "ehostunreach",
  "socket hang up", "connect etimedout", "connection timeout",
];

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Resolves the From address: explicit env override → SMTP_USER if it looks like
 *  an email → Resend's shared testing domain → SMTP_USER as a last resort. */
function resolveFromAddress(): string {
  const explicit = (process.env.EMAIL_FROM ?? process.env.SMTP_FROM ?? "").trim();
  if (explicit) return explicit;

  const smtpUser = (process.env.SMTP_USER ?? "").trim();
  if (isEmail(smtpUser)) return smtpUser;

  // Resend (HTTP or SMTP) ships with a shared testing domain that works
  // without verifying anything — useful for local dev.
  const usingResend = Boolean(process.env.RESEND_API_KEY) ||
                      (process.env.SMTP_HOST ?? "").includes("resend.com");
  if (usingResend) return "onboarding@resend.dev";

  return smtpUser;
}

function buildFromHeader(fromName?: string): string {
  const fromAddr = resolveFromAddress();
  const name     = (fromName ?? process.env.EMAIL_FROM_NAME ?? process.env.SMTP_FROM_NAME ?? "").trim();
  return name ? `${name} <${fromAddr}>` : fromAddr;
}

// ── Resend HTTP API ───────────────────────────────────────────────────────────

// Cache the Resend client across invocations to avoid re-importing the module
// on every send. The import is dynamic so the package isn't pulled into bundles
// where it isn't used (e.g. when only SMTP is configured).
let cachedResend: ResendClient | null = null;
async function getResend(apiKey: string): Promise<ResendClient> {
  if (cachedResend) return cachedResend;
  const { Resend } = await import("resend");
  cachedResend = new Resend(apiKey);
  return cachedResend;
}

async function sendViaResend(from: string, args: SendEmailArgs, apiKey: string): Promise<SendEmailResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600));
    try {
      const resend = await getResend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to:      args.to,
        subject: args.subject,
        html:    args.html,
        ...(args.headers ? { headers: args.headers } : {}),
      });
      if (error) {
        lastErr = new Error(error.message ?? "Resend API error");
        if (!isTransient(lastErr)) break;
        continue;
      }
      console.log(`[email/resend] sent "${args.subject}" → ${args.to} (id: ${data?.id ?? "?"})`);
      return { ok: true };
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) break;
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : "Unknown Resend error";
  console.error(`[email/resend] failed "${args.subject}" → ${args.to}:`, message);
  return { ok: false, error: message };
}

// ── SMTP via nodemailer (fallback) ────────────────────────────────────────────

async function sendViaSmtp(from: string, args: SendEmailArgs): Promise<SendEmailResult> {
  const { default: nodemailer } = await import("nodemailer");

  const smtpHost = (process.env.SMTP_HOST ?? "").trim();
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const smtpUser = (process.env.SMTP_USER ?? "").trim();
  const smtpPass = (process.env.SMTP_PASS ?? "").trim();

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
      await transporter.sendMail({
        from,
        to:      args.to,
        subject: args.subject,
        html:    args.html,
        ...(args.headers ? { headers: args.headers } : {}),
      });
      console.log(`[email/smtp] sent "${args.subject}" → ${args.to}`);
      return { ok: true };
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) break;
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : "Unknown SMTP error";
  console.error(`[email/smtp] failed "${args.subject}" → ${args.to}:`, message);
  return { ok: false, error: message };
}

// ── Public dispatcher ─────────────────────────────────────────────────────────

/**
 * Send a transactional email. Picks Resend if configured, otherwise SMTP.
 *
 *   const result = await sendEmail({ to, subject, html });
 *   if (!result.ok) console.warn("send failed:", result.error);
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  if (!args.to?.trim() || !args.subject?.trim() || !args.html?.trim()) {
    return { ok: false, error: "to, subject, and html are required" };
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const smtpHost  = process.env.SMTP_HOST?.trim();

  if (!resendKey && !smtpHost) {
    return { ok: false, error: "Email not configured (set RESEND_API_KEY or SMTP_HOST)" };
  }

  const from = buildFromHeader(args.fromName);

  if (resendKey) return sendViaResend(from, args, resendKey);
  return sendViaSmtp(from, args);
}

/** True when at least one email provider is configured. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() || process.env.SMTP_HOST?.trim());
}
