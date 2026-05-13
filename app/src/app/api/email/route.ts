/**
 * POST /api/email
 *
 * Ad-hoc email relay for authenticated staff (admin, POS, waiter, kitchen).
 * Used by admin tooling like the Email Templates panel's "Send test" action.
 *
 * The actual transport (Resend HTTP API vs SMTP) is resolved inside the
 * dispatcher at lib/emailSender.ts based on env vars — this route just
 * authorises the caller and forwards the payload.
 *
 * Required env (one of):
 *   RESEND_API_KEY                         — Resend HTTP API key
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   — any SMTP provider
 *
 * Optional:
 *   EMAIL_FROM / EMAIL_FROM_NAME           — sender address + display name
 *
 * Customer-facing transactional emails (order confirmation, password reset,
 * verification) are sent in-process by lib/emailServer.ts and never hit this
 * route.
 */

import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import {
  getWaiterSession,
  getPosSession,
  getKitchenSession,
  unauthorizedJson,
} from "@/lib/auth";
import { sendEmail, emailConfigured } from "@/lib/emailSender";

export const runtime = "nodejs";

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
  to:        string;
  subject:   string;
  html:      string;
  fromName?: string;
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

  if (!emailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Email is not configured. Set RESEND_API_KEY or SMTP_HOST in environment variables." },
      { status: 503 },
    );
  }

  const result = await sendEmail({ to, subject, html, fromName });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
