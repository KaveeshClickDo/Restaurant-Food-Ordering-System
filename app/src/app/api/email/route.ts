/**
 * POST /api/email
 *
 * Sends an HTML email via SMTP using nodemailer.
 * SMTP credentials are read exclusively from server-side environment variables
 * (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS). They are never accepted from
 * the request body, ensuring credentials cannot be read by browser clients.
 *
 * Required env vars (server-side only — no NEXT_PUBLIC_ prefix):
 *   SMTP_HOST  — e.g. smtp.gmail.com
 *   SMTP_PORT  — e.g. 587 (default) or 465
 *   SMTP_USER  — sender address / SMTP username
 *   SMTP_PASS  — SMTP password or app-specific password
 *
 * Runs on Node.js runtime (not Edge) — required for nodemailer.
 */

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

interface EmailRequest {
  to:      string;
  subject: string;
  html:    string;
}

export async function POST(request: Request) {
  // Reject requests that try to pass SMTP credentials in the body
  let body: EmailRequest & { smtp?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (body.smtp) {
    return NextResponse.json(
      { ok: false, error: "SMTP credentials must not be passed in the request body." },
      { status: 400 },
    );
  }

  const { to, subject, html } = body;

  if (!to || !subject || !html) {
    return NextResponse.json(
      { ok: false, error: "Required fields: to, subject, html" },
      { status: 400 },
    );
  }

  // Read credentials from server-side env vars only
  const smtpHost = process.env.SMTP_HOST?.trim() ?? "";
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const smtpUser = process.env.SMTP_USER?.trim() ?? "";
  const smtpPass = process.env.SMTP_PASS?.trim() ?? "";

  if (!smtpHost) {
    return NextResponse.json(
      { ok: false, error: "SMTP is not configured on the server. Set SMTP_HOST in environment variables." },
      { status: 503 },
    );
  }

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

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
