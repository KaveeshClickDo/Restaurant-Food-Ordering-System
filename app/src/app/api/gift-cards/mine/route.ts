/**
 * GET /api/gift-cards/mine — gift cards the logged-in customer has purchased.
 *
 * Lets the buyer see codes they've bought (and resend the delivery email if
 * the recipient lost it). Requires a customer session. We return the code so
 * the buyer can re-share it — they paid for it, so they're entitled to see it.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();

  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .select("id, code, initial_amount, balance, status, issued_to_email, issued_to_name, expires_at, delivered_at, created_at")
    .eq("issued_by_customer_id", session.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const giftCards = (data ?? []).map((row: any) => ({
    id:            row.id,
    code:          row.code,
    initialAmount: Number(row.initial_amount),
    balance:       Number(row.balance),
    status:        row.status,
    issuedToEmail: row.issued_to_email ?? undefined,
    issuedToName:  row.issued_to_name ?? undefined,
    expiresAt:     row.expires_at ?? undefined,
    deliveredAt:   row.delivered_at ?? undefined,
    createdAt:     row.created_at,
  }));

  return NextResponse.json({ ok: true, giftCards });
}
