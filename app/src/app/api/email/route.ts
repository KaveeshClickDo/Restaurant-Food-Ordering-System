/**
 * POST /api/email
 *
 * Sends an HTML email via SMTP using nodemailer.
 * SMTP credentials are supplied in the request body (from admin settings
 * stored client-side in localStorage) so this route needs no server env vars.
 *
 * Runs on Node.js runtime (not Edge) — required for nodemailer.
 */

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

interface EmailRequest {
  to:      string;
  subject: string;
  html:    string;
  smtp: {
    host:     string;
    port:     number;
    user:     string;
    password: string;
  };
}

export async function POST(request: Request) {
  let body: EmailRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { to, subject, html, smtp } = body;

  if (!to || !subject || !html || !smtp?.host) {
    return NextResponse.json(
      { ok: false, error: "Required: to, subject, html, smtp.host" },
      { status: 400 },
    );
  }

  try {
    const transporter = nodemailer.createTransport({
      host:   smtp.host,
      port:   Number(smtp.port) || 587,
      secure: Number(smtp.port) === 465,   // true for 465, false for others
      auth: smtp.user
        ? { user: smtp.user, pass: smtp.password }
        : undefined,
      // Reasonable timeouts so a bad host doesn't hang indefinitely
      connectionTimeout: 8_000,
      greetingTimeout:   5_000,
      socketTimeout:     10_000,
    });

    await transporter.sendMail({
      from:    smtp.user ? `"${smtp.user}" <${smtp.user}>` : smtp.user,
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
