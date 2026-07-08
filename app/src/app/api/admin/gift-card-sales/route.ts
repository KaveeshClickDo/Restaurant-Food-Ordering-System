/**
 * GET /api/admin/gift-card-sales — gift card SALES as a revenue stream.
 *
 * A gift card is income when it's SOLD (it's prepaid money). This surfaces those
 * sales so the finance reports can book them the same way VIP booking fees are
 * booked. Three origins:
 *   • online — bought through Stripe (stripe_payment_intent_id set) → Online tab
 *   • admin  — sold at the counter cash/card (payment_method 'cash'|'card',
 *              payment_ref 'admin:…') → Admin tab
 *   • pos    — pre-issued card sold at the till (payment_ref 'pos:…') → POS tab
 * POS cannot MINT cards — it only sells (activates) admin pre-issued stock, so
 * every POS row here started life as an inactive card.
 *
 * Legacy comp cards issued before paid admin-sales existed (no payment_method
 * and no stripe id) carried no money, so they are excluded — they were never a
 * sale and must not inflate revenue.
 *
 * Query params:
 *   • source — "online" | "admin" | "pos" | "all" (default)
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
  const source = (url.searchParams.get("source") ?? "all") as "all" | "online" | "admin" | "pos";
  const from   = url.searchParams.get("from");
  const to     = url.searchParams.get("to");
  const limit  = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || 500));

  // Date filtering happens in JS below against the RECOGNITION date
  // (activated_at ?? created_at), not created_at alone — a pre-issued card
  // created in one period but sold/activated in another must book in the
  // activation period. Volume here is low (a single restaurant's gift cards),
  // so pulling up to `limit` rows and filtering in memory is fine.
  const q = supabaseAdmin
    .from("gift_cards")
    .select("id, code, initial_amount, created_at, activated_at, status, payment_method, payment_ref, stripe_payment_intent_id, issued_to_email, issued_to_name")
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data, error } = await q;
  if (error) {
    // Older DBs that haven't run the payment_method/_ref migration yet — return
    // an empty list rather than a 500 so the report panels render cleanly.
    if (error.message?.includes("schema cache") || error.message?.includes("payment_method") || error.message?.includes("payment_ref") || error.message?.includes("activated_at")) {
      return NextResponse.json({ ok: true, sales: [] });
    }
    console.error("admin/gift-card-sales GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const fromMs = from ? new Date(from).getTime() : null;
  const toMs   = to   ? new Date(to).getTime()   : null;

  const sales: Array<Record<string, unknown>> = [];
  for (const r of data ?? []) {
    const isOnline = !!r.stripe_payment_intent_id || r.payment_method === "stripe";
    // Cash/card sales split by WHERE the till rang: 'pos:…' payment_ref → POS
    // slice, otherwise (admin:… / legacy null ref with a payment_method) → Admin.
    const isPos    = typeof r.payment_ref === "string" && r.payment_ref.startsWith("pos:");
    const isAdmin  = !isPos && (r.payment_method === "cash" || r.payment_method === "card");
    const origin: "online" | "admin" | "pos" | null =
      isOnline ? "online" : isPos ? "pos" : isAdmin ? "admin" : null;
    if (!origin) continue;                                   // legacy comp / not-yet-activated — no money
    if (source !== "all" && origin !== source) continue;

    // Recognition date: when the money actually came in. For a pre-issued card
    // that's the activation moment; for everything else it's creation time.
    const recognisedAt = (r.activated_at as string | null) ?? (r.created_at as string);
    const recMs = new Date(recognisedAt).getTime();
    if (fromMs !== null && recMs < fromMs) continue;
    if (toMs   !== null && recMs > toMs)   continue;

    sales.push({
      id:              r.id,
      code:            r.code,
      amount:          Number(r.initial_amount),
      created_at:      recognisedAt,
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
