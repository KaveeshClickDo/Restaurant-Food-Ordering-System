/**
 * POST /api/email
 *
 * Shared transactional-email relay for the operator surfaces — POS dine-in /
 * sale receipts and the waiter app's "email receipt / email bill" feature.
 * Both surfaces run on their own device with only their own session cookie, so
 * this route accepts ANY authenticated staff session (admin, pos, waiter,
 * kitchen, collection, driver) rather than one surface's credential. It is a
 * generic utility, not a privileged resource — hence the broad gate plus a
 * per-session rate limit to blunt abuse from a compromised staff login.
 *
 * Admin tooling has its own /api/admin/email route; customer-facing
 * transactional emails (order confirmation, password reset, verification) are
 * sent in-process by lib/emailServer.ts and never hit this route.
 *
 * The actual transport (Resend HTTP API vs SMTP) is resolved inside the
 * dispatcher at lib/emailSender.ts based on env vars.
 *
 * Required env (one of):
 *   RESEND_API_KEY                         — Resend HTTP API key
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   — any SMTP provider
 *
 * Optional:
 *   EMAIL_FROM / EMAIL_FROM_NAME           — sender address + display name
 */

import { NextResponse } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { sendEmail, emailConfigured } from "@/lib/emailSender";
import { parseBody } from "@/lib/apiValidation";
import { EmailRelaySchema } from "@/lib/schemas/pos";
import { rateLimit } from "@/lib/rateLimit";
import { upsertMarketingContact } from "@/lib/marketingContacts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Any signed-in staff surface may relay a receipt/bill email from its own
  // device (previously gated on POS `canAccessSettings`, which 401'd the waiter
  // app and 403'd POS cashiers — both legitimate callers).
  const session = await getAnyStaffSession();
  if (!session) return unauthorizedJson();

  // The payload carries an arbitrary recipient + HTML body, so cap throughput
  // per session to keep this from being usable as a spam cannon.
  const { limited } = rateLimit(`email:${session.role}:${session.id}`, 30, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many emails. Please wait a minute." }, { status: 429 });
  }

  const parsed = await parseBody(request, EmailRelaySchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { to, subject, html, fromName, marketingOptIn } = parsed.data;

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

  // A customer asking staff to email them a bill/receipt just handed over
  // their address — capture it as a marketing contact. No name/phone here
  // (the receipt UI only collects the address). Best-effort, after the send
  // succeeded so a typo'd bounced address is less likely to pollute the list.
  // consent carries the checkbox next to the email field (unticked →
  // contact is created/kept unsubscribed).
  await upsertMarketingContact({ email: to, source: "ebill", consent: marketingOptIn });

  return NextResponse.json({ ok: true });
}
