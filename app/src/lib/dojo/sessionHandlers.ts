/**
 * Shared Dojo terminal-session route logic. SERVER-SIDE ONLY.
 *
 * The POS (/api/pos/dojo/*) and waiter (/api/waiter/dojo/*) surfaces expose the
 * same four operations, and each surface owns its OWN auth gate — the POS uses a
 * POS/any-staff session, the waiter uses requireWaiterAuth(). Only the gate
 * differs, so the actual work lives here once: a bug fixed in the card flow is
 * fixed for every surface, and the two can never drift apart.
 *
 * Each handler assumes the caller has ALREADY authenticated. They never read
 * cookies themselves — passing an unauthenticated request here would drive a
 * real card terminal, so callers must gate first.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/apiValidation";
import { DojoCreateSessionSchema, DojoSignatureSchema } from "@/lib/schemas/dojo";
import { getDojoGateway, dojoConfig, resolveSnapshot } from "@/lib/dojo";
import { startTerminalPayment } from "@/lib/dojo/flow";
import { dojoErrorResponse, toMinorUnits } from "@/lib/dojo/respond";

const missingId = () =>
  NextResponse.json({ ok: false, error: "Missing terminal session id." }, { status: 400 });

/**
 * Start a card-present payment (or card refund) on a terminal.
 *
 * The work is in lib/dojo/flow: resolve the terminal (explicit body.terminalId
 * → pinned DOJO_TERMINAL_ID → first Available; an id or a TID), reuse the
 * intent on a retry or create one, then open the session, which wakes the
 * machine. The caller then polls handleGetSession() until it settles.
 *
 * Body amounts are in MAJOR units (12.50); we convert to Dojo's minor units.
 */
export async function handleCreateSession(req: NextRequest): Promise<NextResponse> {
  const parsed = await parseBody(req, DojoCreateSessionSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const sessionType = body.sessionType ?? "Sale";
  if (sessionType === "MatchedRefund" && !body.paymentIntentId) {
    return NextResponse.json(
      { ok: false, error: "MatchedRefund requires the original paymentIntentId." },
      { status: 400 },
    );
  }

  try {
    const cfg = dojoConfig();
    const started = await startTerminalPayment(getDojoGateway(), {
      sessionType,
      amount: { value: toMinorUnits(body.amount), currencyCode: body.currencyCode ?? cfg.currencyCode },
      reference: body.reference,
      description: body.description,
      captureMode: body.captureMode,
      terminal: body.terminalId || cfg.terminalId || undefined,
      paymentIntentId: body.paymentIntentId,
    });
    return NextResponse.json({ ok: true, ...started });
  } catch (err) {
    return dojoErrorResponse(err, "create");
  }
}

/**
 * Poll a session's status (~once per second while the card is being taken).
 * On a successful settle, resolveSnapshot() also fetches the final payment
 * intent so the snapshot carries transactionId / authCode / card details.
 */
export async function handleGetSession(id: string): Promise<NextResponse> {
  if (!id) return missingId();
  try {
    const gateway = getDojoGateway();
    const session = await gateway.getTerminalSession(id);
    return NextResponse.json({ ok: true, snapshot: await resolveSnapshot(gateway, session) });
  } catch (err) {
    return dojoErrorResponse(err, "poll");
  }
}

/**
 * Accept or reject a signature verification. Called only after a poll returns
 * SignatureVerificationRequired. Dojo's 80-second rule applies: with no decision
 * the payment auto-accepts, so a late rejection is refused (and the client
 * keeps showing what the polls report).
 */
export async function handleSignSession(req: NextRequest, id: string): Promise<NextResponse> {
  if (!id) return missingId();
  const parsed = await parseBody(req, DojoSignatureSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  try {
    const gateway = getDojoGateway();
    const session = await gateway.submitSignature(id, parsed.data.accepted);
    return NextResponse.json({ ok: true, snapshot: await resolveSnapshot(gateway, session) });
  } catch (err) {
    return dojoErrorResponse(err, "signature");
  }
}

/**
 * Cancel a session before a card is presented. Dojo (and the mock) refuse once
 * the card has been presented; that comes back as code "cancel_too_late", and
 * the client keeps polling — the payment simply continues. PUT, not DELETE:
 * the session is not removed.
 */
export async function handleCancelSession(id: string): Promise<NextResponse> {
  if (!id) return missingId();
  try {
    const gateway = getDojoGateway();
    const session = await gateway.cancelTerminalSession(id);
    return NextResponse.json({ ok: true, snapshot: await resolveSnapshot(gateway, session) });
  } catch (err) {
    return dojoErrorResponse(err, "cancel");
  }
}
