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
import { parseBody } from "@/lib/apiValidation";
import { EmailRelaySchema } from "@/lib/schemas/pos";

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

export async function POST(request: Request) {
  if (!await isStaffAuthenticated()) return unauthorizedJson();

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
