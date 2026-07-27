/**
 * POST /api/pos/dojo/sessions — start a card-present payment (or card refund) on
 * a Dojo terminal.
 *
 * For a Sale it: creates a payment intent, resolves a terminal (the pinned
 * DOJO_TERMINAL_ID, an explicit body.terminalId, or the first Available one),
 * then opens a terminal session bound to the intent — which wakes the machine.
 * Returns the initial snapshot + ids; the client then polls GET
 * /api/pos/dojo/sessions/{id} until it settles.
 *
 * Body (amounts in MAJOR units, e.g. 12.50): see DojoCreateSessionSchema.
 * Any logged-in POS session may take a payment; refund sessions are additionally
 * meaningful only to staff who can reach them from the void/refund UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAnyStaffSession, unauthorizedJson } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { DojoCreateSessionSchema } from "@/lib/schemas/dojo";
import { getDojoGateway, dojoConfig, toSnapshot } from "@/lib/dojo";
import { dojoErrorResponse, toMinorUnits } from "@/lib/dojo/respond";
import type { CreateTerminalSessionInput, DojoMoney } from "@/lib/dojo/types";

// Shared across POS / waiter / collection surfaces — each carries only its own
// session cookie, so ANY valid staff (or admin) session may drive the terminal.
export async function POST(req: NextRequest) {
  const session = await getAnyStaffSession();
  if (!session) return unauthorizedJson();

  const parsed = await parseBody(req, DojoCreateSessionSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const cfg = dojoConfig();
  const gateway = getDojoGateway();
  const sessionType = body.sessionType ?? "Sale";
  const money: DojoMoney = { value: toMinorUnits(body.amount), currencyCode: body.currencyCode ?? cfg.currencyCode };

  try {
    // 1. Resolve a terminal: pinned → explicit → first Available.
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

    // 2. For Sale / MatchedRefund we need a payment intent.
    let paymentIntentId: string | undefined = body.paymentIntentId;
    if (sessionType === "Sale") {
      const intent = await gateway.createPaymentIntent({
        amount: money,
        reference: body.reference,
        description: body.description,
        captureMode: body.captureMode ?? "Auto",
      });
      paymentIntentId = intent.id;
    } else if (sessionType === "MatchedRefund") {
      if (!paymentIntentId) {
        return NextResponse.json({ ok: false, error: "MatchedRefund requires the original paymentIntentId." }, { status: 400 });
      }
    }

    // 3. Open the terminal session (this initiates the intent + wakes the machine).
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
