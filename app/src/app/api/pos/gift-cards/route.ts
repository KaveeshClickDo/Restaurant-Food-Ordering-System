/**
 * GET /api/pos/gift-cards — gift cards as seen from the till.
 *
 * Two views:
 *   • view=sellable (default) — admin pre-issued INACTIVE cards. The POS shows
 *     these as a "Gift Cards" category on the Sale tab so a cashier can sell
 *     (activate) the physical card the customer picked off the rack. POS can
 *     NOT mint cards — only admin creates them; POS only sells what exists.
 *   • view=sold&from=ISO&to=ISO — cards this POS sold (payment_ref 'pos:…'),
 *     dated by activated_at, for the POS dashboard reports.
 *
 * Any valid POS session may read this (selling a card is a normal till action,
 * like taking a sale). Inactive codes are safe to expose: a card holds no
 * spendable balance until it is activated at the point of sale.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosSession } from "@/lib/posPermissions";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") ?? "sellable";

  if (view === "sold") {
    const from = searchParams.get("from");
    const to   = searchParams.get("to");

    let q = supabaseAdmin
      .from("gift_cards")
      .select("id, code, initial_amount, activated_at, payment_method, payment_ref, issued_to_email, issued_to_name")
      .like("payment_ref", "pos:%")
      .order("activated_at", { ascending: false })
      .limit(1000);
    if (from) q = q.gte("activated_at", from);
    if (to)   q = q.lte("activated_at", to);

    const { data, error } = await q;
    if (error) {
      console.error("GET /api/pos/gift-cards (sold):", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      sales: (data ?? []).map((r) => ({
        id:             r.id,
        code:           r.code,
        amount:         Number(r.initial_amount),
        soldAt:         r.activated_at,
        paymentMethod:  r.payment_method,
        recipientEmail: r.issued_to_email ?? undefined,
        recipientName:  r.issued_to_name ?? undefined,
      })),
    });
  }

  // Sellable: inactive pre-issued stock, oldest first so the rack rotates.
  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .select("id, code, initial_amount, created_at")
    .eq("status", "inactive")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("GET /api/pos/gift-cards (sellable):", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    giftCards: (data ?? []).map((r) => ({
      id:            r.id,
      code:          r.code,
      initialAmount: Number(r.initial_amount),
      createdAt:     r.created_at,
    })),
  });
}
