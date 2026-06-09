/**
 * GET /api/admin/gift-card-sales — gift card SALES as a revenue stream.
 *
 * A gift card is income when it's SOLD (it's prepaid money). This surfaces those
 * sales so the finance reports can book them the same way VIP booking fees are
 * booked. Two origins:
 *   • online — bought through Stripe (stripe_payment_intent_id set) → Online tab
 *   • admin  — sold at the counter cash/card (payment_method 'cash'|'card',
 *              payment_ref 'admin:…') → Admin tab
 * POS cannot issue gift cards, so there is no POS slice.
 *
 * Legacy comp cards issued before paid admin-sales existed (no payment_method
 * and no stripe id) carried no money, so they are excluded — they were never a
 * sale and must not inflate revenue.
 *
 * Query params:
 *   • source — "online" | "admin" | "all" (default)
 *   • from   — ISO lower bound on created_at (inclusive)
 *   • to     — ISO upper bound on created_at (inclusive)
 *   • limit  — page size (default 500, max 2000)
 */

import { NextRequest, NextResponse }                   from "next/server";
import { isAdminAuthenticated, unauthorizedResponse }  from "@/lib/adminAuth";
import { supabaseAdmin }                               from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const url    = new URL(req.url);
  const source = (url.searchParams.get("source") ?? "all") as "all" | "online" | "admin";
  const from   = url.searchParams.get("from");
  const to     = url.searchParams.get("to");
  const limit  = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || 500));

  let q = supabaseAdmin
    .from("gift_cards")
    .select("id, code, initial_amount, created_at, status, payment_method, payment_ref, stripe_payment_intent_id, issued_to_email, issued_to_name")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (from) q = q.gte("created_at", from);
  if (to)   q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) {
    // Older DBs that haven't run the payment_method/_ref migration yet — return
    // an empty list rather than a 500 so the report panels render cleanly.
    if (error.message?.includes("schema cache") || error.message?.includes("payment_method") || error.message?.includes("payment_ref")) {
      return NextResponse.json({ ok: true, sales: [] });
    }
    console.error("admin/gift-card-sales GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const sales: Array<Record<string, unknown>> = [];
  for (const r of data ?? []) {
    const isOnline = !!r.stripe_payment_intent_id || r.payment_method === "stripe";
    const isAdmin  = r.payment_method === "cash" || r.payment_method === "card";
    const origin: "online" | "admin" | null = isOnline ? "online" : isAdmin ? "admin" : null;
    if (!origin) continue;                                   // legacy comp — no money
    if (source !== "all" && origin !== source) continue;
    sales.push({
      id:              r.id,
      code:            r.code,
      amount:          Number(r.initial_amount),
      created_at:      r.created_at,
      status:          r.status,
      origin,
      payment_method:  r.payment_method,
      payment_ref:     r.payment_ref,
      recipient_name:  r.issued_to_name,
      recipient_email: r.issued_to_email,
    });
  }

  return NextResponse.json({ ok: true, sales });
}
