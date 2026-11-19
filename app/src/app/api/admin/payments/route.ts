/**
 * GET /api/admin/payments — paginated payment history for the admin
 * Payments panel, backed by the admin_payment_transactions SQL view
 * (supabase/schema.sql), which unions online orders, VIP booking fees, and
 * Stripe gift-card sales into one queryable source so this route doesn't
 * have to merge three queries in application code.
 *
 * Query params:
 *   page/pageSize  — pagination via `.range()` (default pageSize 20, max 100)
 *   status         — filter by payment_status ("paid" | "refunded" | "partially_refunded")
 *   method         — filter by payment_method (e.g. "Cash", "Card (Stripe)")
 *   from/to        — ISO date range filter
 *   search         — id / customer name / customer email / payment method /
 *                    Stripe or PayPal reference — all plain columns on the
 *                    view, so this is a single .or() with no join workaround
 *
 * `totals` (for the panel's stat cards) is computed over the same
 * status/method/date filters as the page, but NOT narrowed by `search` —
 * matches the panel's original behaviour, where the stat cards only ever
 * reflected the server-side filters, not the search box.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const url      = new URL(req.url);
  const status   = url.searchParams.get("status");
  const method   = url.searchParams.get("method");
  const from     = url.searchParams.get("from");
  const to       = url.searchParams.get("to");
  const search   = url.searchParams.get("search")?.trim();
  const page     = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo   = rangeFrom + pageSize - 1;

  let q = supabaseAdmin
    .from("admin_payment_transactions")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .range(rangeFrom, rangeTo);
  if (status) q = q.eq("payment_status", status);
  if (method) q = q.eq("payment_method", method);
  if (from)   q = q.gte("date", from);
  if (to)     q = q.lte("date", to);
  if (search) {
    const esc = search.replace(/[%,]/g, "");
    q = q.or(
      `id.ilike.%${esc}%,customer_name.ilike.%${esc}%,customer_email.ilike.%${esc}%,` +
      `payment_method.ilike.%${esc}%,stripe_payment_intent_id.ilike.%${esc}%,paypal_order_id.ilike.%${esc}%`,
    );
  }

  // Stats — same status/method/date filters as the page query above, but
  // never narrowed by search. No limit, but a narrow 4-column projection so
  // this stays cheap even over a large payment history.
  let statsQ = supabaseAdmin
    .from("admin_payment_transactions")
    .select("total, refunded_amount, stripe_payment_intent_id, payment_status");
  if (status) statsQ = statsQ.eq("payment_status", status);
  if (method) statsQ = statsQ.eq("payment_method", method);
  if (from)   statsQ = statsQ.gte("date", from);
  if (to)     statsQ = statsQ.lte("date", to);

  const [{ data, error, count }, { data: statsRows, error: statsErr }] = await Promise.all([q, statsQ]);
  if (error) {
    console.error("admin/payments GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (statsErr) {
    console.error("admin/payments stats:", statsErr.message);
    return NextResponse.json({ ok: false, error: statsErr.message }, { status: 500 });
  }

  const statRows = statsRows ?? [];
  const totalGross   = statRows.reduce((s, r) => s + Number(r.total), 0);
  const totalNet      = statRows.reduce((s, r) => s + Number(r.total) - Number(r.refunded_amount ?? 0), 0);
  const refundedSum   = statRows.reduce((s, r) => s + Number(r.refunded_amount ?? 0), 0);
  const stripeCount   = statRows.filter((r) => r.stripe_payment_intent_id).length;
  const paidCount     = statRows.filter((r) => r.payment_status === "paid").length;
  const refundedCount = statRows.filter((r) => r.payment_status === "refunded" || r.payment_status === "partially_refunded").length;

  return NextResponse.json({
    ok: true,
    payments: data ?? [],
    totalCount: count ?? 0,
    page,
    pageSize,
    totals: {
      txCount:    statRows.length,
      paidCount,
      refundedCount,
      stripeCount,
      totalGross:  parseFloat(totalGross.toFixed(2)),
      totalNet:    parseFloat(totalNet.toFixed(2)),
      refundedSum: parseFloat(refundedSum.toFixed(2)),
    },
  });
}
