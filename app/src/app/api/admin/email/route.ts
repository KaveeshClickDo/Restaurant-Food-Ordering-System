/**
 * POST /api/admin/email
 *
 * Admin-only email relay — the admin-session equivalent of /api/email (which is
 * for POS operators). Used by admin tooling: the Email Templates panel's
 * "Send test" and the Customers panel's "Resend" action (both via
 * sendEmailViaApi in lib/emailTemplates).
 *
 * Transport (Resend HTTP API vs SMTP) is resolved inside lib/emailSender based
 * on env vars — this route just authorises the admin and forwards the payload.
 */

import { NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { sendEmail, emailConfigured } from "@/lib/emailSender";
import { parseBody } from "@/lib/apiValidation";
import { EmailRelaySchema } from "@/lib/schemas/pos";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(request, EmailRelaySchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { to, subject, html, fromName } = parsed.data;

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
