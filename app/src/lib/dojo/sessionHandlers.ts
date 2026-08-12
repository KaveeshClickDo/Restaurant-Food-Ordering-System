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
import { getDojoGateway, dojoConfig, toSnapshot, resolveSnapshot } from "@/lib/dojo";
import { dojoErrorResponse, toMinorUnits } from "@/lib/dojo/respond";
import type { CreateTerminalSessionInput, DojoMoney } from "@/lib/dojo/types";

const missingId = () =>
  NextResponse.json({ ok: false, error: "Missing terminal session id." }, { status: 400 });

/**
 * Start a card-present payment (or card refund) on a terminal.
 *
 * For a Sale it: creates a payment intent, resolves a terminal (explicit
 * body.terminalId → pinned DOJO_TERMINAL_ID → first Available), then opens the
 * session bound to that intent, which wakes the machine. The caller then polls
 * handleGetSession() until it settles.
 *
 * Body amounts are in MAJOR units (12.50); we convert to Dojo's minor units.
 */
export async function handleCreateSession(req: NextRequest): Promise<NextResponse> {
  const parsed = await parseBody(req, DojoCreateSessionSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const cfg = dojoConfig();
  const gateway = getDojoGateway();
  const sessionType = body.sessionType ?? "Sale";
  const money: DojoMoney = {
    value: toMinorUnits(body.amount),
    currencyCode: body.currencyCode ?? cfg.currencyCode,
  };

  try {
    // 1. Resolve a terminal: explicit → pinned → first Available.
    let terminalId = body.terminalId || cfg.terminalId;
    if (!terminalId) {
      const available = await gateway.listTerminals(true);
      if (available.length === 0) {
        return NextResponse.json(
          { ok: false, error: "No card terminal is available. Check the device is on and connected." },
          { status: 409 },
        );
      }
      terminalId = available[0].id;
    }

    // 2. Sale needs a fresh intent; MatchedRefund reuses the original one.
    let paymentIntentId: string | undefined = body.paymentIntentId;
    if (sessionType === "Sale") {
      const intent = await gateway.createPaymentIntent({
        amount: money,
        reference: body.reference,
        description: body.description,
        captureMode: body.captureMode ?? "Auto",
      });
      paymentIntentId = intent.id;
    } else if (sessionType === "MatchedRefund" && !paymentIntentId) {
      return NextResponse.json(
        { ok: false, error: "MatchedRefund requires the original paymentIntentId." },
        { status: 400 },
      );
    }

    // 3. Open the session — this initiates the intent and wakes the machine.
    const input: CreateTerminalSessionInput = {
      terminalId,
      sessionType,
      paymentIntentId,
      amount: sessionType === "UnlinkedRefund" ? money : undefined,
    };
    const session = await gateway.createTerminalSession(input);

    return NextResponse.json({
      ok: true,
      terminalId,
      paymentIntentId: paymentIntentId ?? null,
      terminalSessionId: session.id,
      snapshot: toSnapshot(session, null),
    });
  } catch (err) {
    return dojoErrorResponse(err);
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
    return dojoErrorResponse(err);
  }
}

/**
 * Accept or reject a signature verification. Called only after a poll returns
 * SignatureVerificationRequired. Dojo's 80-second rule applies: with no decision
 * the payment auto-accepts, so a late rejection is a no-op — the server just
 * relays whatever the operator chose.
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
    return dojoErrorResponse(err);
  }
}

/**
 * Cancel a session before a card is presented. Dojo (and the mock) refuse once
 * the card has been presented; that surfaces as a 422 the client tolerates — the
 * payment simply continues. PUT, not DELETE: the session is not removed.
 */
export async function handleCancelSession(id: string): Promise<NextResponse> {
  if (!id) return missingId();
  try {
    const gateway = getDojoGateway();
    const session = await gateway.cancelTerminalSession(id);
    return NextResponse.json({ ok: true, snapshot: await resolveSnapshot(gateway, session) });
  } catch (err) {
    return dojoErrorResponse(err);
  }
}
