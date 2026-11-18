/**
 * GET /api/pos/dojo/sales/[id] — was this till sale paid on the Dojo card
 * machine? The Void & Refund screen asks, so it can offer the refund back to
 * the card (done by PATCH /api/pos/sales/[id]) and say which card.
 *
 * Returns `payment: null` for a sale not paid on the card machine. Read-only,
 * from our own dojo_payments record; never the Dojo API key or anything secret.
 */

import { NextResponse } from "next/server";
import { requirePosSession } from "@/lib/posPermissions";
import { dojoConfig, isDojoSandboxKey } from "@/lib/dojo";
import { findDojoPayment, hasDojoRefund } from "@/lib/dojo/refund";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const payment = await findDojoPayment("pos_sale", id);
  const cfg = dojoConfig();
  return NextResponse.json({
    ok: true,
    payment: payment
      ? {
          cardScheme: payment.cardScheme,
          cardLast4: payment.cardLast4,
          amount: payment.amount,
          status: payment.status,
          refunded: await hasDojoRefund("pos_sale", id),
        }
      : null,
    test: cfg.mode === "mock" || isDojoSandboxKey(),
  });
}
