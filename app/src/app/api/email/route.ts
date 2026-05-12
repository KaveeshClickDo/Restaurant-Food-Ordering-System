/**
 * POST /api/email
 *
 * Sends an HTML email via SMTP using nodemailer.
 * SMTP credentials are read exclusively from server-side environment variables.
 *
 * Required env vars:
 *   SMTP_HOST  — e.g. smtp.resend.com
 *   SMTP_PORT  — 465 (SSL) or 587 (STARTTLS). Defaults to 587.
 *   SMTP_USER  — SMTP username (for Resend this is the literal string "resend")
 *   SMTP_PASS  — SMTP password / API key
 *
 * Optional:
 *   SMTP_FROM  — sender address shown in the From field.
 *                For Resend use a verified domain address, e.g. noreply@yourdomain.com
 *                Falls back to SMTP_USER if it looks like an email, or
 *                onboarding@resend.dev for Resend's shared testing domain.
 *
 * Runs on Node.js runtime (not Edge) — required for nodemailer.
 */

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import {
  getWaiterSession,
  getPosSession,
  getKitchenSession,
  unauthorizedJson,
} from "@/lib/auth";

export const runtime = "nodejs";

// Only authenticated staff may use the generic email relay. Customer-facing
// transactional emails (order confirmation, password reset, verification)
// are sent in-process by lib/emailServer.ts and never hit this route.
async function isStaffAuthenticated(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const [waiter, pos, kitchen] = await Promise.all([
    getWaiterSession(),
    getPosSession(),
    getKitchenSession(),
  ]);
  return Boolean(waiter || pos || kitchen);
}

interface EmailRequest {
  to:      string;
  subject: string;
  html:    string;
  fromName?: string;
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(request: Request) {
  if (!await isStaffAuthenticated()) return unauthorizedJson();

  let body: EmailRequest & { smtp?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.smtp) {
    return NextResponse.json(
      { ok: false, error: "SMTP credentials must not be passed in the request body." },
      { status: 400 },
    );
  }

  const { to, subject, html, fromName } = body;
  if (!to || !subject || !html) {
    return NextResponse.json(
      { ok: false, error: "Required fields: to, subject, html" },
      { status: 400 },
    );
  }

  const smtpHost = process.env.SMTP_HOST?.trim() ?? "";
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const smtpUser = process.env.SMTP_USER?.trim() ?? "";
  const smtpPass = process.env.SMTP_PASS?.trim() ?? "";

  if (!smtpHost) {
    return NextResponse.json(
      { ok: false, error: "SMTP is not configured. Set SMTP_HOST in environment variables." },
      { status: 503 },
    );
  }

  // ── Resolve the From address ────────────────────────────────────────────────
  // Priority: SMTP_FROM env var → SMTP_USER (if it's an email) → Resend shared testing address
  let fromAddr = process.env.SMTP_FROM?.trim() ?? "";
  if (!fromAddr) {
    if (isEmail(smtpUser)) {
      fromAddr = smtpUser;
    } else if (smtpHost.includes("resend.com")) {
      // Resend's shared domain for testing — works without domain verification
      fromAddr = "onboarding@resend.dev";
    } else {
      fromAddr = smtpUser; // best-effort fallback
    }
  }

  const senderName = fromName?.trim() || process.env.SMTP_FROM_NAME?.trim() || "";
  const from = senderName ? `"${senderName}" <${fromAddr}>` : fromAddr;

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

    await transporter.sendMail({ from, to, subject, html });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";
    console.error("[/api/email]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
