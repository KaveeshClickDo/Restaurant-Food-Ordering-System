/**
 * Shared Dojo terminal-session route logic. SERVER-SIDE ONLY.
 *
 * The POS (/api/pos/dojo/*) and waiter (/api/waiter/dojo/*) surfaces expose the
 * same operations (start, poll, sign, cancel, list machines), and each surface
 * owns its OWN auth gate — the POS takes a POS or collection session
 * (getTillStaffSession), the waiter uses requireWaiterAuth(). Only the gate
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
import { getDojoGateway, dojoConfig, resolveSnapshot, isDojoEffectivelyEnabled, isDojoSandboxKey } from "@/lib/dojo";
import { startTerminalPayment } from "@/lib/dojo/flow";
import { dojoErrorResponse, toMinorUnits } from "@/lib/dojo/respond";

const missingId = () =>
  NextResponse.json({ ok: false, error: "Missing terminal session id." }, { status: 400 });

/**
 * Start a sale on a terminal.
 *
 * The work is in lib/dojo/flow: resolve the terminal (explicit body.terminalId
 * → pinned DOJO_TERMINAL_ID → first Available; an id or a TID), reuse the
 * intent on a retry or create one, then open the session, which wakes the
 * machine. The caller then polls handleGetSession() until it settles.
 *
 * Always a Sale with automatic capture. Refund sessions pay money out and need
 * canIssueRefund, which these routes don't check; and nothing here captures a
 * pre-authorisation. So the schema doesn't accept either from the client.
 * `test` tells the screen to show a test-mode badge (simulator or sandbox key).
 *
 * A keyed sale (`cardHolderNotPresent`, MOTO) only where the route allows it:
 * the till, for phone bookings. A keyed payment has no chip & PIN check, so
 * the routes for the waiter app and the collection login refuse one.
 *
 * Body amounts are in MAJOR units (12.50); we convert to Dojo's minor units.
 */
export async function handleCreateSession(
  req: NextRequest,
  opts: { allowKeyed?: boolean } = {},
): Promise<NextResponse> {
  const parsed = await parseBody(req, DojoCreateSessionSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;
  if (body.cardHolderNotPresent && !opts.allowKeyed) {
    return NextResponse.json(
      { ok: false, error: "Keyed card payments can only be taken on the till.", code: "rejected" },
      { status: 403 },
    );
  }

  try {
    // The admin toggle hides the option in every UI; enforce it here too, so a
    // direct call can't start a payment while it's off. Polls, signatures and
    // cancels stay allowed, so a payment already under way can finish.
    if (!(await isDojoEffectivelyEnabled())) {
      return NextResponse.json(
        { ok: false, error: "Card machine payments are switched off.", code: "disabled" },
        { status: 503 },
      );
    }
    const cfg = dojoConfig();
    const started = await startTerminalPayment(getDojoGateway(), {
      sessionType: "Sale",
      amount: { value: toMinorUnits(body.amount), currencyCode: body.currencyCode ?? cfg.currencyCode },
      reference: body.reference,
      description: body.description,
      terminal: body.terminalId || cfg.terminalId || undefined,
      paymentIntentId: body.paymentIntentId,
      cardHolderNotPresent: body.cardHolderNotPresent,
    });
    const test = cfg.mode === "mock" || isDojoSandboxKey();
    return NextResponse.json({ ok: true, ...started, test });
  } catch (err) {
    return dojoErrorResponse(err, "create");
  }
}

/**
 * The account's card machines, for the payment screen's machine picker. Every
 * status by default, so staff see a busy or offline machine for what it is;
 * `availableOnly` keeps only the free ones. `test` as on create.
 */
export async function handleListTerminals(availableOnly = false): Promise<NextResponse> {
  try {
    const cfg = dojoConfig();
    const terminals = await getDojoGateway().listTerminals(availableOnly);
    return NextResponse.json({
      ok: true,
      terminals: terminals.map((t) => ({ id: t.id, status: t.status, tid: t.properties?.tid ?? null })),
      test: cfg.mode === "mock" || isDojoSandboxKey(),
    });
  } catch (err) {
    return dojoErrorResponse(err, "terminals");
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
